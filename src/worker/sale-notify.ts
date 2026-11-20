// Aviso instantáneo de venta por email.
//
// Hasta ahora el único email que salía del worker era el resumen semanal de
// seguridad (digest.ts). Un pedido no avisaba nada: el que paga por MercadoPago
// quedaba "pagado" en la base y el que elige transferencia quedaba "pendiente"
// esperando que el vendedor abriera el panel — o que el cliente escribiera por
// WhatsApp. Con el binding de email ya configurado (wrangler.jsonc, restringido a
// la casilla verificada) el aviso sale gratis y en el momento.
//
// Reglas (mismas que el resto de los opcionales del worker):
//  - Sin binding de email no hace nada y no rompe el checkout.
//  - Un solo aviso por pedido: se marca en KV. El webhook de MercadoPago es
//    reintentable (MP notifica varias veces el mismo pago), así que sin la marca
//    llegarían varios emails de la misma venta.
//  - Un fallo de envío tampoco rompe nada: la venta ya está guardada en D1 y el
//    pedido se ve en el panel igual.
//  - El aviso por transferencia lo dispara un endpoint público: cualquiera puede
//    crear pedidos en bucle y llenar la casilla del dueño (o quemar la cuota de
//    envío y dejar sin resumen semanal). Por eso lleva topes propios (más abajo).

import type { Env } from "./db";
import type { Order } from "../shared/types";
import { formatPrice } from "../shared/format";

/** Tipo de aviso: por transferencia (todavía hay que acreditar) o pago acreditado. */
export type SaleKind = "transfer" | "paid";

export interface SaleNotifyOut {
  sent: boolean;
  motivo?: string; // por qué no se envió (sin binding, ya avisado, tope, fallo de envío)
}

export interface SaleNotifyOpts {
  storeName?: string;
  currencySymbol?: string;
  /** IP del request que originó la venta: solo para los topes anti-abuso. */
  ip?: string;
  /** Intentos de checkout de esa IP en el último minuto (rate limit del checkout). */
  attempts?: number;
}

// ---- Claves y topes ----
// El aviso por transferencia lo dispara un endpoint público: cualquiera puede
// crear pedidos en bucle y llenar la casilla del dueño, o quemar la cuota de
// envío y dejar sin resumen semanal. El rate limit del checkout (10 por minuto
// por IP) frena una ráfaga, pero vive en memoria del isolate: un goteo lento o
// un ataque repartido entre isolates lo esquiva. Por eso los topes se cuentan en
// KV (compartido por todo el worker) y por día.

/** Marca de "ya avisado" por pedido. 7 días alcanzan de sobra para los reintentos. */
const NOTIFIED_PREFIX = "venta:avisada:";
const NOTIFIED_TTL_SECONDS = 7 * 24 * 3600;
/** Contador de avisos frenados del día: el panel lo muestra sin abrir los logs. */
const BLOCKED_PREFIX = "venta:frenados:";
/** Los contadores viven 2 días: alcanzan para el día en curso y el borde de UTC. */
const COUNTER_TTL_SECONDS = 2 * 24 * 3600;

/** Avisos por IP y por día. Un comprador real no llega a tanto. */
const IP_MAX_PER_DAY = 3;
/** Avisos en total por día: el techo de la cuota de email y del resumen semanal. */
const DAY_MAX = 40;
/** Intentos de checkout en el mismo minuto que ya delatan un script, no a alguien
 *  que se equivocó dos veces con el WhatsApp. */
const ATTEMPTS_MAX = 3;

/** Hash corto de la IP: alcanza para contar por origen sin guardar el dato en claro. */
function ipHash(ip: string): string {
  let h = 5381;
  for (let i = 0; i < ip.length; i += 1) h = ((h * 33) ^ ip.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Día UTC: el tope se renueva a las 21:00 de Argentina, que es cuando menos se vende. */
function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Suma 1 al contador y devuelve el valor nuevo (lanza si KV falla: lo atrapa quien llama). */
async function bumpCounter(kv: KVNamespace, key: string): Promise<number> {
  const raw = await kv.get(key);
  const next = (Number(raw) || 0) + 1;
  // Se cuenta ANTES de enviar: si el envío falla se pierde una unidad del tope,
  // que es justo el lado seguro. KV no es atómico (dos requests en paralelo
  // pueden pisarse y subcontar), pero el tope por pedido y el del checkout ya
  // cubren la ráfaga; esto frena el goteo sostenido.
  await kv.put(key, String(next), { expirationTtl: COUNTER_TTL_SECONDS });
  return next;
}

/**
 * Devuelve el motivo del tope alcanzado, o null si el aviso puede salir.
 * El de pago acreditado no se limita: lo dispara el webhook de MercadoPago, que
 * re-consulta el pago contra su API, así que no se puede provocar desde afuera.
 * Si KV falla se prefiere avisar (un email de más antes que perder una venta).
 */
async function saleCap(env: Env, kind: SaleKind, opts: SaleNotifyOpts): Promise<string | null> {
  if (kind !== "transfer") return null;
  if ((opts.attempts ?? 0) > ATTEMPTS_MAX) return blockNotice(env, "demasiados intentos desde la misma IP");
  const dia = dayKey(Date.now());
  const ip = (opts.ip ?? "").trim();
  try {
    if (ip !== "") {
      const porIp = await bumpCounter(env.KV, `venta:ip:${ipHash(ip)}:${dia}`);
      if (porIp > IP_MAX_PER_DAY) return blockNotice(env, "tope diario por IP");
    }
    const delDia = await bumpCounter(env.KV, `venta:dia:${dia}`);
    if (delDia > DAY_MAX) return blockNotice(env, "tope diario de avisos");
  } catch {
    return null;
  }
  return null;
}

/**
 * Suma el corte en el contador del día (lo lee el panel) y devuelve el motivo.
 * La cuenta es informativa: si KV falla se pierde el número, no el corte.
 */
async function blockNotice(env: Env, motivo: string): Promise<string> {
  try {
    await bumpCounter(env.KV, BLOCKED_PREFIX + dayKey(Date.now()));
  } catch {
    // sin contador igual se frena el aviso
  }
  return motivo;
}

/**
 * Cuántos avisos de venta se frenaron por tope en el día en curso (UTC, igual
 * que los contadores). 0 si no hay KV, si falla o si todavía no hubo ninguno.
 */
export async function countBlockedSales(env: Env): Promise<number> {
  try {
    return Number(await env.KV.get(BLOCKED_PREFIX + dayKey(Date.now()))) || 0;
  } catch {
    return 0;
  }
}

/** Origen del email: el mismo que usa el resumen semanal. */
const AVISO_FROM = "noreply@centerphone.com.ar";

/** Link a WhatsApp del comprador, con el pedido ya escrito. */
function waComprador(order: Order): string {
  const numero = String(order.buyerPhone ?? "").replace(/\D/g, "");
  if (numero === "") return "";
  const texto = `Hola ${order.buyerName || ""}! Te escribo por tu pedido ${order.id.slice(0, 8).toUpperCase()} de la tienda.`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * Cuerpo del email (texto simple, igual que el resumen semanal: se lee en
 * cualquier cliente y no hay que mantener HTML).
 */
export function saleEmailText(
  order: Order,
  kind: SaleKind,
  opts: { storeName?: string; currencySymbol?: string; siteUrl?: string },
): string {
  const symbol = opts.currencySymbol || "$";
  const tienda = opts.storeName || "la tienda";
  const site = (opts.siteUrl ?? "").replace(/\/+$/, "");
  const codigo = order.id.slice(0, 8).toUpperCase();
  const lineas: string[] = [];

  lineas.push(kind === "paid" ? `✅ Pago acreditado — ${tienda}` : `💸 Pedido por transferencia — ${tienda}`);
  lineas.push("");
  lineas.push(
    kind === "paid"
      ? "MercadoPago confirmó el pago. El pedido está listo para despachar."
      : "Entró un pedido que se cierra por transferencia: acreditá el pago y coordiná la entrega.",
  );
  lineas.push("");
  lineas.push(`Pedido: ${codigo}`);
  lineas.push(`Cliente: ${order.buyerName || "(sin nombre)"}`);
  lineas.push(`WhatsApp: ${order.buyerPhone || "(sin teléfono)"}`);
  const wa = waComprador(order);
  if (wa !== "") lineas.push(`Escribirle: ${wa}`);
  if (order.memberCode) lineas.push(`Socio: ${order.memberCode}`);
  lineas.push("");
  lineas.push("Productos:");
  for (const item of order.items ?? []) {
    const total = item.priceCents * item.qty;
    lineas.push(`  ${item.qty}x ${item.title} — ${formatPrice(total, symbol)}`);
  }
  lineas.push("");
  lineas.push(`TOTAL: ${formatPrice(order.totalCents, symbol)}`);
  if (site !== "") {
    lineas.push("");
    lineas.push(`Ver el pedido en el panel: ${site}/admin/`);
  }
  lineas.push("");
  lineas.push("Aviso automático del sitio. No hace falta responder este email: escribile al cliente por WhatsApp.");
  return lineas.join("\n");
}

/**
 * Manda el aviso de una venta. Nunca lanza: devuelve si salió y, si no, el motivo.
 * La llama el checkout (transferencia) y el webhook de MercadoPago (pago).
 */
export async function notifySale(
  env: Env,
  order: Order,
  kind: SaleKind,
  opts: SaleNotifyOpts = {},
): Promise<SaleNotifyOut> {
  if (!env.EMAIL) return { sent: false, motivo: "sin binding de email" };

  // Un aviso por pedido: los reintentos de MercadoPago notifican el mismo pago.
  const clave = NOTIFIED_PREFIX + order.id;
  try {
    if ((await env.KV.get(clave)) !== null) return { sent: false, motivo: "ya avisado" };
  } catch {
    // Si KV no responde, se prefiere mandar el aviso (mejor duplicado que perdido).
  }

  // Un pedido real silenciado por el tope queda igual en D1 y se ve en el panel:
  // se pierde el email, no la venta. El warn deja el rastro en Workers Logs.
  const tope = await saleCap(env, kind, opts);
  if (tope !== null) {
    console.warn(`venta: aviso frenado (${tope}) del pedido ${order.id}`);
    return { sent: false, motivo: tope };
  }

  const subject = kind === "paid"
    ? `✅ Pago acreditado — ${order.id.slice(0, 8).toUpperCase()} (${formatPrice(order.totalCents, opts.currencySymbol || "$")})`
    : `💸 Pedido por transferencia — ${order.id.slice(0, 8).toUpperCase()} (${formatPrice(order.totalCents, opts.currencySymbol || "$")})`;
  const text = saleEmailText(order, kind, { ...opts, siteUrl: env.CF_SITE_ORIGIN ?? "" });

  try {
    await env.EMAIL.send({ from: AVISO_FROM, subject, text } as unknown as EmailMessageBuilder);
  } catch (e) {
    // El pedido ya está guardado: el email es un extra, no parte de la venta.
    console.error("venta: el aviso por email falló:", e);
    return { sent: false, motivo: "fallo de envío" };
  }

  try {
    await env.KV.put(clave, String(Date.now()), { expirationTtl: NOTIFIED_TTL_SECONDS });
  } catch {
    // Sin la marca, un reintento de MP podría mandar un segundo email. Se acepta.
  }
  console.log(`venta: aviso enviado (${kind}) del pedido ${order.id}`);
  return { sent: true };
}

/** Solo para tests: arma la clave de deduplicación sin duplicar el prefijo. */
export function saleNotifyKey(orderId: string): string {
  return NOTIFIED_PREFIX + orderId;
}
