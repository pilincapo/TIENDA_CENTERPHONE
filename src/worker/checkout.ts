// Checkout y webhook de MercadoPago. Rutas públicas montadas en la raíz:
//   POST /api/checkout        — valida carrito server-side y crea preferencia
//   POST /api/payments/webhook — notificación de MP (200 rápido + verificación async)
//   GET  /api/orders/:id      — estado del pedido (solo con el id aleatorio)
//
// Anti-fraude: el cliente nunca manda precios ni totales; el worker recalcula
// todo desde D1. El webhook no confía en su payload: re-consulta el pago a la
// API de MP con el ACCESS_TOKEN antes de marcar "pagado".

import { Hono } from "hono";
import type { Env } from "./db";
import { getSettings } from "./settings";
import { listProducts } from "./db";
import { newId } from "./settings";
import {
  getOrder, insertOrder, sanitizeBuyer, setOrderPreference, updateOrderStatus, validateCart, type CartInput,
} from "./orders";
import { createPreference, fetchPayment } from "./mercadopago";
import { formatPrice } from "../shared/format";
import type { Order, OrderItem } from "../shared/types";
import { effectiveMemberPercent, memberDiscountCents, memberPhoneMatches } from "../shared/loyalty";
import { getActiveMemberByCode, touchMemberOrder } from "./loyalty";

export const checkoutApp = new Hono<{ Bindings: Env }>();

// ---- Rate limit en memoria (por isolate), mismo patrón que el login ----
const checkoutAttempts = new Map<string, { count: number; resetAt: number }>();
/** Solo para tests: el rate limit vive en memoria del isolate. */
export function resetCheckoutRateLimit(): void {
  checkoutAttempts.clear();
}
function checkoutBlocked(ip: string): boolean {
  const now = Date.now();
  const entry = checkoutAttempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 10;
}
function recordCheckoutAttempt(ip: string): void {
  const now = Date.now();
  const entry = checkoutAttempts.get(ip);
  if (!entry || entry.resetAt < now) checkoutAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  else entry.count += 1;
}

function sameSiteOrigin(c: { req: { header: (n: string) => string | undefined; url: string } }): boolean {
  // Igual que /api/track: se acepta también curl sin Origin en local.
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");
  // El header Host no siempre está expuesto (undici lo filtra en tests):
  // fallback al host de la URL del request, que es de donde sale en runtime.
  let host = c.req.header("host") ?? "";
  if (host === "") {
    try {
      host = new URL(c.req.url).host;
    } catch {
      return false;
    }
  }
  const raw = origin ?? referer ?? "";
  if (raw === "") return host === "" || host.startsWith("localhost") || host.startsWith("127.0.0.1");
  try {
    return new URL(raw).host === host;
  } catch {
    return false;
  }
}

/** Validación y persistencia compartida por /api/checkout y /api/orders/transfer.
 *  mode="mp": suma el recargo configurado (se cobra por MercadoPago).
 *  mode="transfer": resta el descuento por transferencia (cierre por WhatsApp).
 *
 *  El código de socio se valida en D1 y su descuento se aplica PRIMERO; el
 *  descuento por transferencia (o el recargo de MP) se calcula sobre el saldo.
 *  Así los porcentajes se acumulan sin que uno pise al otro. */
async function finalizeOrder(c: {
  env: { DB: D1Database; KV: KVNamespace };
  req: { json: <T = unknown>() => Promise<T> };
}, settings: {
  transferDiscountPercent?: number; mpSurchargePercent?: number;
  loyaltyEnabled?: boolean; loyaltyDiscountPercent?: number; loyaltyName?: string;
}, mode: "mp" | "transfer"): Promise<
  { error: string; status: 400 } |
  { order: Order; cartTotal: number; discountPercent: number; memberDiscountPercent: number }
> {
  const body = await c.req.json<{
    items?: CartInput[]; name?: unknown; phone?: unknown; memberCode?: unknown;
  }>().catch(() => null);
  const products = await listProducts(c.env.DB); // solo publicados
  const cart = validateCart(body?.items ?? [], products);
  if (!cart.ok) return { error: cart.error ?? "Carrito inválido", status: 400 as const };

  const buyer = sanitizeBuyer(body?.name, body?.phone);
  if (buyer.name === "" || buyer.phone === "") {
    return { error: "Necesitamos tu nombre y tu WhatsApp para coordinar la entrega", status: 400 as const };
  }

  const orderId = newId() + newId(); // 32 hex: intratable, es la credencial de la página /pedido/:id
  const cartTotal = cart.totalCents ?? 0;

  // Club de socios: el código lo manda el navegador, pero el descuento sale de
  // D1 (socio activo) y del % guardado en el panel. Un código inválido o
  // desactivado se ignora en silencio: el pedido se crea sin descuento.
  const memberCodeRaw = typeof body?.memberCode === "string" ? body.memberCode.trim() : "";
  const member = memberCodeRaw !== "" && settings.loyaltyEnabled === true
    ? await getActiveMemberByCode(c.env.DB, memberCodeRaw)
    : null;
  // El código es personal: solo vale para el WhatsApp con el que se dio de
  // alta. Si el cliente escribe otro número, se rechaza el pedido en vez de
  // cobrarle sin el descuento que creía tener (o dejar pasar un código ajeno).
  if (member && !memberPhoneMatches(member.phone, buyer.phone)) {
    return {
      error: "El código de socio no corresponde a este WhatsApp. Usá el número con el que te diste de alta o quitá el código.",
      status: 400 as const,
    };
  }
  // El % sale del nivel del socio (5/10/15); si no tiene nivel, del base
  // configurado. El navegador nunca manda el porcentaje.
  const memberPercent = member ? effectiveMemberPercent(member.discountPercent, settings.loyaltyDiscountPercent) : 0;
  const memberCents = memberDiscountCents(cartTotal, memberPercent);
  const baseAfterMember = cartTotal - memberCents;

  // Los ajustes (socio, transferencia, recargo) se congelan como ítems dentro
  // de items_json y entran al total: /pedido/:id, el panel, la preferencia de MP
  // y los mensajes de WhatsApp muestran SIEMPRE el mismo número, y cada % queda
  // fijo al comprar aunque el vendedor lo cambie después.
  const discountPercent = mode === "transfer"
    ? Math.min(50, Math.max(0, Math.round(Number(settings.transferDiscountPercent ?? 0))))
    : 0;
  const surchargePercent = mode === "mp"
    ? Math.min(50, Math.max(0, Math.round(Number(settings.mpSurchargePercent ?? 0))))
    : 0;
  const discountCents = discountPercent > 0 && baseAfterMember > 0
    ? Math.round((baseAfterMember * discountPercent) / 100)
    : 0;
  const surchargeCents = surchargePercent > 0 && baseAfterMember > 0
    ? Math.round((baseAfterMember * surchargePercent) / 100)
    : 0;

  const adjustments: OrderItem[] = [];
  if (memberCents > 0) {
    adjustments.push({
      id: "descuento-socio",
      title: `Descuento ${settings.loyaltyName || "Club CenterPhone"} (${memberPercent}%)`,
      qty: 1,
      priceCents: -memberCents,
    });
  }
  if (discountCents > 0) {
    adjustments.push({
      id: "descuento-transferencia",
      title: `Descuento transferencia (${discountPercent}%)`,
      qty: 1,
      priceCents: -discountCents,
    });
  }
  if (surchargeCents > 0) {
    adjustments.push({ id: "recargo-mp", title: `Recargo pago online (${surchargePercent}%)`, qty: 1, priceCents: surchargeCents });
  }

  const order: Order = {
    id: orderId,
    status: "pending" as const,
    totalCents: baseAfterMember - discountCents + surchargeCents,
    currency: "ARS",
    buyerName: buyer.name,
    buyerPhone: buyer.phone,
    payerEmail: null,
    items: [...(cart.items ?? []), ...adjustments],
    mpPreferenceId: null,
    mpPaymentId: null,
    paidAt: null,
    notifiedWa: false,
    memberCode: member?.code ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await insertOrder(c.env.DB, order);
  if (member) await touchMemberOrder(c.env.DB, member.id);
  return { order, cartTotal, discountPercent, memberDiscountPercent: memberPercent };
}

checkoutApp.post("/api/checkout", async (c) => {
  if (!sameSiteOrigin(c)) return c.json({ error: "Origen no permitido" }, 403);
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (checkoutBlocked(ip)) return c.json({ error: "Demasiados intentos. Probá en un minuto." }, 429);
  recordCheckoutAttempt(ip);

  const settings = await getSettings(c.env.KV);
  const token = c.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  if (!settings.paymentsEnabled || token === "") {
    return c.json({ error: "El pago online no está habilitado" }, 503);
  }

  const created = await finalizeOrder(c, settings, "mp");
  if ("error" in created) return c.json({ error: created.error }, created.status);
  const { order } = created;

  const url = new URL(c.req.url);
  const siteUrl = c.env.CF_SITE_ORIGIN || url.origin;
  // MercadoPago no acepta unit_price negativos: con descuento de socio se manda
  // UN ítem por el total final (exacto) en vez de la lista con el ajuste
  // negativo. Sin club, la preferencia conserva el detalle de siempre (incluido
  // el ítem de recargo positivo).
  const prefItems: OrderItem[] = order.memberCode
    ? [{ id: "pedido", title: `Pedido ${order.id.slice(0, 8).toUpperCase()}`, qty: 1, priceCents: order.totalCents }]
    : order.items;
  const pref = await createPreference({
    token,
    orderId: order.id,
    items: prefItems,
    buyerName: order.buyerName,
    buyerPhone: order.buyerPhone,
    siteUrl,
  });
  if (!pref.ok || !pref.initPoint) {
    // La preferencia falló: el pedido queda pending pero el usuario no pudo
    // pagar. Se informa el motivo real para poder diagnosticar desde el panel.
    return c.json({ error: pref.error ?? "No se pudo iniciar el pago" }, 502);
  }
  // Guardar el id de preferencia: permite rastrear el checkout de MP desde el
  // pedido (y asociar notificaciones de MP que lleguen sin external_reference).
  if (pref.preferenceId) await setOrderPreference(c.env.DB, order.id, pref.preferenceId);
  return c.json({ ok: true, orderId: order.id, initPoint: pref.initPoint });
});

/**
 * Pago por transferencia: crea el pedido pending SIN preferencia de MP.
 * Mismas validaciones y rate limit que /api/checkout (mismo anti-fraude);
 * el descuento por transferencia configurado se congela en el pedido.
 * El vendedor lo cierra a mano desde el panel cuando llega la transferencia.
 */
checkoutApp.post("/api/orders/transfer", async (c) => {
  if (!sameSiteOrigin(c)) return c.json({ error: "Origen no permitido" }, 403);
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (checkoutBlocked(ip)) return c.json({ error: "Demasiados intentos. Probá en un minuto." }, 429);
  recordCheckoutAttempt(ip);

  const settings = await getSettings(c.env.KV);
  // Modo catálogo: no se crean pedidos. El sitio solo muestra precios y WhatsApp,
  // pero la API queda cerrada para que nadie pueda cerrar una venta por transferencia
  // desde un carrito viejo o desde un cliente generado a mano.
  if (settings.storeMode !== "tienda") {
    return c.json({ error: "La tienda no está tomando pedidos en este momento" }, 503);
  }
  const created = await finalizeOrder(c, settings, "transfer");
  if ("error" in created) return c.json({ error: created.error }, created.status);
  const { order, cartTotal, discountPercent, memberDiscountPercent } = created;

  // CBU/alias configurable: si el vendedor lo cargó, va pre-cargado en el
  // mensaje de WhatsApp para que el comprador transfiera sin preguntar.
  const wa = settings.whatsappPhone.replace(/\D/g, "");
  const symbol = settings.currencySymbol || "$";
  const lines = order.items.filter((i) => i.priceCents > 0).map((i) => `• ${i.qty}x ${i.title} (${formatPrice(i.priceCents * i.qty, symbol)})`).join("\n");
  const discountLine = order.items
    .filter((i) => i.priceCents < 0)
    .map((i) => `\n${i.title}: -${formatPrice(-i.priceCents, symbol)}`)
    .join("");
  const cbu = settings.transferCbu?.trim() ? `\nCBU/Alias: ${settings.transferCbu.trim()}` : "";
  const text = `Hola! Quiero comprar este pedido por transferencia:\nPedido: ${order.id}\n${lines}\nTotal: ${formatPrice(cartTotal, symbol)}${discountLine}\nTotal a transferir: ${formatPrice(order.totalCents, symbol)}${cbu}\n¿A dónde te paso los datos?`;
  const waHref = wa !== "" ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null;

  return c.json({
    ok: true,
    orderId: order.id,
    totalCents: order.totalCents,
    discountPercent,
    memberDiscountPercent,
    memberCode: order.memberCode,
    waHref,
  });
});

/**
 * Webhook de MP: responde 200 enseguida (MP reintenta si le devolvemos error)
 * y verifica fuera de banda con waitUntil. Solo confía en un GET autenticado.
 * Idempotente: marcar paid dos veces no rompe nada (updateOrderStatus lo maneja).
 */
checkoutApp.post("/api/payments/webhook", async (c) => {
  const paymentId = c.req.query("data.id") ?? c.req.query("id") ?? "";
  const type = c.req.query("type") ?? c.req.query("topic") ?? "";
  let bodyId = "";
  try {
    const body = await c.req.json<{ data?: { id?: unknown } }>();
    bodyId = typeof body?.data?.id === "string" || typeof body?.data?.id === "number" ? String(body.data.id) : "";
  } catch {
    // sin body o body inválido: seguimos con los query params
  }
  const id = paymentId !== "" ? paymentId : bodyId;
  if (type !== "" && !/payment/i.test(type)) return c.json({ received: true });
  if (id === "") return c.json({ received: true }); // latido vacío de MP: no procesar

  // Log de seguridad (Workers Logs): cada notificación con id real queda
  // registrada, sin datos del comprador — solo ids y el resultado.
  console.log(`seguridad: webhook mp recibido (payment ${id})`);

  const token = c.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  if (token === "") return c.json({ received: true });

  c.executionCtx.waitUntil((async () => {
    const payment = await fetchPayment(token, id);
    if (!payment.found) console.log(`seguridad: webhook mp: pago ${id} no encontrado en la API de MP (¿sondeo?)`);
    if (!payment.found || !payment.approved || payment.isTest) return;
    const orderId = payment.externalReference ?? "";
    const order = orderId === "" ? null : await getOrder(c.env.DB, orderId);
    if (!order) {
      console.log(`seguridad: webhook mp: pago ${id} aprobado pero sin pedido válido (${orderId || "sin referencia"})`);
      return;
    }
    if (order.status === "paid") return; // ya confirmado
    // El email lo informa MP en la re-consulta; si viene, queda persistido.
    await updateOrderStatus(c.env.DB, orderId, "paid", { mpPaymentId: id, payerEmail: payment.payerEmail });
    console.log(`seguridad: webhook mp confirmó pago del pedido ${orderId} (payment ${id})`);
  })().catch(() => { /* el webhook nunca debe tirar excepción al waitUntil */ }));

  return c.json({ received: true });
});

// Estado del pedido para la página /pedido/:id (público: el id de 32 hex es
// la única credencial; no expone datos de pago, solo estado e ítems).
// Estado del pedido para la página /pedido/:id (público: el id de 32 hex es
// la única credencial). Se sirve una versión recortada del pedido: solo estado,
// ítems y total — SIN buyerPhone, payerEmail ni ids internos de MP, que no
// hacen falta para mostrar la página y no deben viajar por una API pública
// (el link puede compartirse por error o quedar en un historial).
function publicOrder(order: Order) {
  return {
    id: order.id,
    status: order.status,
    totalCents: order.totalCents,
    currency: order.currency,
    items: order.items,
    buyerName: order.buyerName,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
  };
}

checkoutApp.get("/api/orders/:id", async (c) => {
  const order = await getOrder(c.env.DB, c.req.param("id"));
  if (!order) return c.json({ error: "Pedido no encontrado" }, 404);
  return c.json({ order: publicOrder(order) });
});
