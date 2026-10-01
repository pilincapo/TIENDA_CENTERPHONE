// Tests del endpoint GET /pedido/:id: renderizado de la página de pedido con
// estado del pedido, items, total y botón de WhatsApp. No empieza sesión: la
// página es pública (solo el id de 32 hex es la credencial).
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderPageApp } from "./orders-page";
import type { Dict, Env } from "./db";

// Mock D1 mínimo: guarda filas y aplica SELECT.
function makeDb() {
  const orders = new Map<string, Dict>();

  const db = {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        run: async () => ({ success: true }),
        first: async () => (/FROM orders WHERE id/i.test(sql) ? orders.get(String(args[0])) ?? null : null),
        all: async () => ({ results: [...orders.values()] }),
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, orders };
}

// KV solo para getSettings; params de pagos no importan en este test.
function makeKv(extra: Record<string, unknown> = {}) {
  return {
    get: async (key: string) => (key === "config:settings:v1" ? JSON.stringify(extra) : null),
  };
}

function seedOrder(orders: Map<string, Dict>, id: string, status: Dict["status"] = "pending"): void {
  orders.set(id, {
    id, status, total_cents: 150_000, currency: "ARS",
    buyer_name: "Juan Perez", buyer_phone: "3425819402", payer_email: null,
    items_json: JSON.stringify([
      { id: "p1", title: "iPhone 13", qty: 1, priceCents: 100000 },
      { id: "p2", title: "Funda", qty: 2, priceCents: 25000 },
    ]),
    mp_preference_id: null, mp_payment_id: null, paid_at: null,
    notified_wa: 0, created_at: 1, updated_at: 1,
  } as Dict);
}

type ReqArgs = Parameters<typeof orderPageApp.request>;
function asEnv(e: unknown): ReqArgs[2] { return e as ReqArgs[2]; }

const ORDER_ID = "pedido-mirror-1";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /pedido/:id (página de estado del pedido)", () => {
  it("responde 404 y HTML cuando no hay pedido", async () => {
    const { db } = makeDb();
    const res = await orderPageApp.request(
      `/pedido/${ORDER_ID}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ paymentsEnabled: false }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Pedido no encontrado");
    expect(html).not.toContain('id="pending-hint"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("responde 200 con items, total y botón de WhatsApp para pending", async () => {
    const { db, orders } = makeDb();
    seedOrder(orders, ORDER_ID);
    const res = await orderPageApp.request(
      `/pedido/${ORDER_ID}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares" }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // Items: qty + título + subtotal
    expect(html).toContain("1x iPhone 13");
    expect(html).toContain("2x Funda");
    expect(html).toContain("$500"); // subtotal Funda (2 x 25000 centavos)
    expect(html).toContain("$1.500"); // total (150000 centavos)
    expect(html).toContain("Juan Perez");
    // Estado pending: emoji + hint visible
    expect(html).toContain("⏳");
    expect(html).toContain("Esperando el pago");
    expect(html).toContain("pending-hint");
    // Botón de WhatsApp
    expect(html).toContain("Coordinar entrega por WhatsApp");
    const waMatch = html.match(/href="https:\/\/wa\.me\/(\d+)/);
    expect(waMatch).toBeTruthy();
    expect(waMatch![1]).toBe("5491100000000");
  });

  it("renderiza estado paid: sin pending-hint, línea de acreditado y badge paid", async () => {
    const { db, orders } = makeDb();
    seedOrder(orders, ORDER_ID, "paid");
    // paidAt se pone en el mock si se pasa; de lo contrario es null y no
    // pinta la línea. Agregamos paidAt explícito.
    orders.get(ORDER_ID)!.paid_at = 1_700_000_000_000;
    const res = await orderPageApp.request(
      `/pedido/${ORDER_ID}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares" }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("✅");
    expect(html).toContain("Pago confirmado");
    expect(html).not.toContain('id="pending-hint"');
    expect(html).toContain("Acreditado el");
    // Badge de pago
    const paidMatches = html.match(/st-badge paid/g);
    expect(paidMatches).toBeTruthy();
  });

  it("renderiza estado cancelled/rejected con sus badges y emojis", async () => {
    const { db, orders } = makeDb();
    seedOrder(orders, ORDER_ID, "cancelled");
    const res = await orderPageApp.request(
      `/pedido/${ORDER_ID}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares" }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("🚫");
    expect(html).toContain("Cancelado");
    expect(html).not.toContain('id="pending-hint"');
    // El boton de WhatsApp es de contacto general: se muestra en todos los
    // estados (incluido cancelled), el badge y el emoji ya validan el estado.

    // Rejected
    seedOrder(orders, "o-rejected", "rejected");
    const res2 = await orderPageApp.request(
      "/pedido/o-rejected",
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares" }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain("❌");
    expect(html2).toContain("Pago rechazado");
  });

  it("escapa correctamente el nombre del comprador y los títulos (XSS seguro)", async () => {
    const { db, orders } = makeDb();
    const evilId = "o-xss-1";
    orders.set(evilId, {
      id: evilId, status: "pending", total_cents: 10_000, currency: "ARS",
      buyer_name: '<script>alert("xss")</script>', buyer_phone: "3425819402",
      payer_email: null, items_json: JSON.stringify([
        { id: "p1", title: '<img src=x onerror=alert(1)>', qty: 1, priceCents: 10000 },
      ]),
      mp_preference_id: null, mp_payment_id: null, paid_at: null,
      notified_wa: 0, created_at: 1, updated_at: 1,
    } as Dict);
    const res = await orderPageApp.request(
      `/pedido/${evilId}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares" }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // Los tags se escapan, no se ejecutan.
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img src=x onerror");
    expect(html).not.toContain("<img src=x onerror=alert");
  });

  it("no expone buyer_phone, payer_email ni ids internos de MP por la página", async () => {
    const { db, orders } = makeDb();
    seedOrder(orders, ORDER_ID);
    orders.get(ORDER_ID)!.payer_email = "x@y.com";
    orders.get(ORDER_ID)!.mp_payment_id = "pay-1";
    orders.get(ORDER_ID)!.mp_preference_id = "pref-1";
    const res = await orderPageApp.request(
      `/pedido/${ORDER_ID}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares" }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("x@y.com");
    expect(html).not.toContain("pay-1");
    expect(html).not.toContain("pref-1");
  });

  it("pinta la nota de checkout configurable en el cuerpo de la página", async () => {
    const { db, orders } = makeDb();
    seedOrder(orders, ORDER_ID);
    const res = await orderPageApp.request(
      `/pedido/${ORDER_ID}`,
      { method: "GET" },
      asEnv({ DB: db, KV: makeKv({ whatsappPhone: "5491100000000", paymentsEnabled: false, storeName: "CenterPhone Celulares", checkoutNote: "Envío gratis en la ciudad de Santa Fe." }), ADMIN_PASSWORD: "pass-de-test", ADMIN_SESSION_SECRET: "secret-de-test" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Envío gratis en la ciudad de Santa Fe.");
    expect(html).toContain("note");
  });
});
