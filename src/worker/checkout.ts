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
  getOrder, insertOrder, sanitizeBuyer, updateOrderStatus, validateCart, type CartInput,
} from "./orders";
import { createPreference, fetchPayment } from "./mercadopago";

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

function sameSiteOrigin(c: { req: { header: (n: string) => string | undefined } }): boolean {
  // Igual que /api/track: se acepta también curl sin Origin en local.
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");
  const host = c.req.header("host") ?? "";
  const raw = origin ?? referer ?? "";
  if (raw === "") return host === "" || host.startsWith("localhost") || host.startsWith("127.0.0.1");
  try {
    return new URL(raw).host === host;
  } catch {
    return false;
  }
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

  const body = await c.req.json<{ items?: CartInput[]; name?: unknown; phone?: unknown }>().catch(() => null);
  const products = await listProducts(c.env.DB); // solo publicados
  const cart = validateCart(body?.items ?? [], products);
  if (!cart.ok) return c.json({ error: cart.error ?? "Carrito inválido" }, 400);

  const buyer = sanitizeBuyer(body?.name, body?.phone);
  if (buyer.name === "" || buyer.phone === "") {
    return c.json({ error: "Necesitamos tu nombre y tu WhatsApp para coordinar la entrega" }, 400);
  }

  const orderId = newId() + newId(); // 32 hex: intratable, es la credencial de la página /pedido/:id
  const order = {
    id: orderId,
    status: "pending" as const,
    totalCents: cart.totalCents ?? 0,
    currency: "ARS",
    buyerName: buyer.name,
    buyerPhone: buyer.phone,
    payerEmail: null,
    items: cart.items ?? [],
    mpPreferenceId: null,
    mpPaymentId: null,
    paidAt: null,
    notifiedWa: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await insertOrder(c.env.DB, order);

  const url = new URL(c.req.url);
  const siteUrl = c.env.CF_SITE_ORIGIN || url.origin;
  const pref = await createPreference({
    token,
    orderId,
    items: order.items,
    buyerName: buyer.name,
    buyerPhone: buyer.phone,
    siteUrl,
  });
  if (!pref.ok || !pref.initPoint) {
    // La preferencia falló: el pedido queda pending pero el usuario no pudo
    // pagar. Se informa el motivo real para poder diagnosticar desde el panel.
    return c.json({ error: pref.error ?? "No se pudo iniciar el pago" }, 502);
  }
  return c.json({ ok: true, orderId, initPoint: pref.initPoint });
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
    await updateOrderStatus(c.env.DB, orderId, "paid", { mpPaymentId: id });
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
