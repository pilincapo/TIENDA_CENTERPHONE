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

export const checkoutApp = new Hono<{ Bindings: Env }>();

// ---- Rate limit en memoria (por isolate), mismo patrón que el login ----
const checkoutAttempts = new Map<string, { count: number; resetAt: number }>();
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
 *  mode="transfer": resta el descuento por transferencia (cierre por WhatsApp). */
async function finalizeOrder(c: {
  env: { DB: D1Database; KV: KVNamespace };
  req: { json: <T = unknown>() => Promise<T> };
}, settings: { transferDiscountPercent?: number; mpSurchargePercent?: number }, mode: "mp" | "transfer"): Promise<{ error: string; status: 400 } | { order: Order; cartTotal: number; discountPercent: number }> {
  const body = await c.req.json<{ items?: CartInput[]; name?: unknown; phone?: unknown }>().catch(() => null);
  const products = await listProducts(c.env.DB); // solo publicados
  const cart = validateCart(body?.items ?? [], products);
  if (!cart.ok) return { error: cart.error ?? "Carrito inválido", status: 400 as const };

  const buyer = sanitizeBuyer(body?.name, body?.phone);
  if (buyer.name === "" || buyer.phone === "") {
    return { error: "Necesitamos tu nombre y tu WhatsApp para coordinar la entrega", status: 400 as const };
  }

  const orderId = newId() + newId(); // 32 hex: intratable, es la credencial de la página /pedido/:id
  const cartTotal = cart.totalCents ?? 0;
  // El ajuste (recargo MP o descuento transferencia) se congela como ítem dentro
  // de items_json y entra al total: /pedido/:id, el panel, la preferencia de MP
  // y los mensajes de WhatsApp muestran SIEMPRE el mismo número, y el % queda
  // fijo al comprar aunque el vendedor lo cambie después.
  const discountPercent = mode === "transfer"
    ? Math.min(50, Math.max(0, Math.round(Number(settings.transferDiscountPercent ?? 0))))
    : 0;
  const surchargePercent = mode === "mp"
    ? Math.min(50, Math.max(0, Math.round(Number(settings.mpSurchargePercent ?? 0))))
    : 0;
  const discountCents = discountPercent > 0 && cartTotal > 0 ? Math.round((cartTotal * discountPercent) / 100) : 0;
  const surchargeCents = surchargePercent > 0 && cartTotal > 0 ? Math.round((cartTotal * surchargePercent) / 100) : 0;
  const adjustment: OrderItem | null = discountCents > 0
    ? { id: "descuento-transferencia", title: `Descuento transferencia (${discountPercent}%)`, qty: 1, priceCents: -discountCents }
    : (surchargeCents > 0 ? { id: "recargo-mp", title: `Recargo pago online (${surchargePercent}%)`, qty: 1, priceCents: surchargeCents } : null);
  const items: OrderItem[] = adjustment ? [...(cart.items ?? []), adjustment] : (cart.items ?? []);
  const order: Order = {
    id: orderId,
    status: "pending" as const,
    totalCents: cartTotal - discountCents + surchargeCents,
    currency: "ARS",
    buyerName: buyer.name,
    buyerPhone: buyer.phone,
    payerEmail: null,
    items,
    mpPreferenceId: null,
    mpPaymentId: null,
    paidAt: null,
    notifiedWa: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await insertOrder(c.env.DB, order);
  return { order, cartTotal, discountPercent };
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
  const pref = await createPreference({
    token,
    orderId: order.id,
    items: order.items, // incluye el ítem de recargo si está configurado
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
  const created = await finalizeOrder(c, settings, "transfer");
  if ("error" in created) return c.json({ error: created.error }, created.status);
  const { order, cartTotal, discountPercent } = created;

  // CBU/alias configurable: si el vendedor lo cargó, va pre-cargado en el
  // mensaje de WhatsApp para que el comprador transfiera sin preguntar.
  const wa = settings.whatsappPhone.replace(/\D/g, "");
  const symbol = settings.currencySymbol || "$";
  const lines = order.items.filter((i) => i.priceCents > 0).map((i) => `• ${i.qty}x ${i.title} (${formatPrice(i.priceCents * i.qty, symbol)})`).join("\n");
  const adjustment = order.items.find((i) => i.priceCents < 0);
  const discountLine = adjustment ? `\n${adjustment.title}: -${formatPrice(-adjustment.priceCents, symbol)}` : "";
  const cbu = settings.transferCbu?.trim() ? `\nCBU/Alias: ${settings.transferCbu.trim()}` : "";
  const text = `Hola! Quiero comprar este pedido por transferencia:\nPedido: ${order.id}\n${lines}\nTotal: ${formatPrice(cartTotal, symbol)}${discountLine}\nTotal a transferir: ${formatPrice(order.totalCents, symbol)}${cbu}\n¿A dónde te paso los datos?`;
  const waHref = wa !== "" ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null;

  return c.json({ ok: true, orderId: order.id, totalCents: order.totalCents, discountPercent, waHref });
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

  const token = c.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  if (token === "") return c.json({ received: true });

  c.executionCtx.waitUntil((async () => {
    const payment = await fetchPayment(token, id);
    if (!payment.found || !payment.approved || payment.isTest) return;
    const orderId = payment.externalReference ?? "";
    if (orderId === "") return;
    const order = await getOrder(c.env.DB, orderId);
    if (!order || order.status === "paid") return; // desconocido o ya confirmado
    // El email lo informa MP en la re-consulta; si viene, queda persistido.
    await updateOrderStatus(c.env.DB, orderId, "paid", { mpPaymentId: id, payerEmail: payment.payerEmail });
  })().catch(() => { /* el webhook nunca debe tirar excepción al waitUntil */ }));

  return c.json({ received: true });
});

// Estado del pedido para la página /pedido/:id (público: el id de 32 hex es
// la única credencial; no expone datos de pago, solo estado e ítems).
checkoutApp.get("/api/orders/:id", async (c) => {
  const order = await getOrder(c.env.DB, c.req.param("id"));
  if (!order) return c.json({ error: "Pedido no encontrado" }, 404);
  return c.json({ order });
});
