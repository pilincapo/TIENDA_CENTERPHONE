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

import type { Env } from "./db";
import type { Order } from "../shared/types";
import { formatPrice } from "../shared/format";

/** Tipo de aviso: por transferencia (todavía hay que acreditar) o pago acreditado. */
export type SaleKind = "transfer" | "paid";

export interface SaleNotifyOut {
  sent: boolean;
  motivo?: string; // por qué no se envió (sin binding, ya avisado, fallo de envío)
}

/** Origen del email: el mismo que usa el resumen semanal. */
const AVISO_FROM = "noreply@centerphone.com.ar";

/** Marca de "ya avisado" por pedido. 7 días alcanzan de sobra para los reintentos. */
const KV_PREFIX = "venta:avisada:";
const KV_TTL_SECONDS = 7 * 24 * 3600;

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
  opts: { storeName?: string; currencySymbol?: string } = {},
): Promise<SaleNotifyOut> {
  if (!env.EMAIL) return { sent: false, motivo: "sin binding de email" };

  // Un aviso por pedido: los reintentos de MercadoPago notifican el mismo pago.
  const clave = KV_PREFIX + order.id;
  try {
    if ((await env.KV.get(clave)) !== null) return { sent: false, motivo: "ya avisado" };
  } catch {
    // Si KV no responde, se prefiere mandar el aviso (mejor duplicado que perdido).
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
    await env.KV.put(clave, String(Date.now()), { expirationTtl: KV_TTL_SECONDS });
  } catch {
    // Sin la marca, un reintento de MP podría mandar un segundo email. Se acepta.
  }
  console.log(`venta: aviso enviado (${kind}) del pedido ${order.id}`);
  return { sent: true };
}

/** Solo para tests: arma la clave de deduplicación sin duplicar el prefijo. */
export function saleNotifyKey(orderId: string): string {
  return KV_PREFIX + orderId;
}
