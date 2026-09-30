import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutApp } from "./checkout";
import type { Dict } from "./db";

// Mock mínimo de D1: guarda filas en un Map y aplica las 3 sentencias que usa
// el flujo de pedidos (INSERT orders, UPDATE status, UPDATE preference).
function makeDb() {
  const orders = new Map<string, Dict>();
  const products = new Map<string, Dict>();
  const executed: string[] = [];

  function apply(sql: string, args: unknown[]): void {
    executed.push(sql.slice(0, 40));
    if (/INSERT INTO orders/i.test(sql)) {
      // Mismo orden de columnas que el INSERT de orders.ts
      const cols = ["id", "status", "total_cents", "currency", "buyer_name", "buyer_phone", "payer_email", "items_json", "mp_preference_id", "mp_payment_id", "paid_at", "notified_wa", "created_at", "updated_at"];
      const row: Dict = {};
      cols.forEach((c, i) => { row[c] = args[i]; });
      orders.set(String(row.id), row);
    } else if (/UPDATE orders SET status/i.test(sql)) {
      const row = orders.get(String(args[0]));
      if (row) {
        row.status = args[1];
        row.payer_email = args[2];
        row.mp_payment_id = args[3];
        row.paid_at = args[4];
        row.updated_at = args[5];
      }
    } else if (/UPDATE orders SET mp_preference_id/i.test(sql)) {
      const row = orders.get(String(args[0]));
      if (row) {
        row.mp_preference_id = args[1];
        row.updated_at = args[2];
      }
    }
  }

  const db = {
    prepare(sql: string) {
      // Expone run/first/all tanto directo como encadenado tras bind():
      // listProducts usa .all() sin bind; los updates de orders usan .bind().
      const exec = (args: unknown[]) => ({
        run: async () => { apply(sql, args); return { success: true }; },
        first: async () => (/FROM orders WHERE id/i.test(sql) ? orders.get(String(args[0])) ?? null : null),
        all: async () => ({
          results: sql.includes("FROM products") ? [...products.values()] : [...orders.values()],
        }),
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, orders, products, executed };
}

// KV con settings mínimos; getSettings solo hace kv.get(key) y hace merge.
function makeKv(paymentsEnabled: boolean, extra: Record<string, unknown> = {}) {
  return {
    get: async (key: string) => (key === "config:settings:v1" ? JSON.stringify({ paymentsEnabled, ...extra }) : null),
  };
}

function seedProduct(products: Map<string, Dict>): void {
  products.set("p1", {
    id: "p1", title: "iPhone 13", description: "", price_cents: 50_000_000,
    category_id: null, subcategory_id: null, tags: "[]", image_url: "",
    status: "published", availability: "in_stock", sort_order: 0,
    created_at: 1, updated_at: 1, source_url: null, brand: null,
  });
}

function seedPendingOrder(orders: Map<string, Dict>, id: string, status = "pending"): void {
  orders.set(id, {
    id, status, total_cents: 84_000, currency: "ARS", buyer_name: "Valeria", buyer_phone: "5491100000000",
    payer_email: null, items_json: "[]", mp_preference_id: null, mp_payment_id: null,
    paid_at: null, notified_wa: 0, created_at: 1, updated_at: 1,
  });
}

// Tipado leve: el mock no es un Env/ExecutionContext reales, con request() alcanza.
type ReqArgs = Parameters<typeof checkoutApp.request>;
function asEnv(e: unknown): ReqArgs[2] { return e as ReqArgs[2]; }
function asCtx(promises: Promise<unknown>[]): ReqArgs[3] {
  return {
    waitUntil: (p: Promise<unknown>) => { promises.push(p); },
    passThroughOnException: () => {},
    props: {},
  } as ReqArgs[3];
}

const ORDER_ID = "abc123def456abc123def456abc12345";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/payments/webhook", () => {
  it("re-consulta MP y persiste mp_payment_id y payer_email junto con el pago", async () => {
    const { db, orders } = makeDb();
    seedPendingOrder(orders, ORDER_ID);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        id: 555, status: "approved", external_reference: ORDER_ID,
        test_mode: false, payer: { email: "  Valeria@Example.com  " },
      }),
      { status: 200 },
    )));

    const promises: Promise<unknown>[] = [];
    const res = await checkoutApp.request(
      "/api/payments/webhook?type=payment&data.id=555",
      { method: "POST" },
      asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "t" }),
      asCtx(promises),
    );
    expect(res.status).toBe(200);
    await Promise.all(promises);

    const row = orders.get(ORDER_ID)!;
    expect(row.status).toBe("paid");
    expect(row.mp_payment_id).toBe("555");
    expect(row.payer_email).toBe("Valeria@Example.com"); // trim, sin normalizar el caso
    expect(row.paid_at).not.toBeNull();
  });

  it("no baja un pedido ya pagado ni toca pedidos desconocidos", async () => {
    const { db, orders } = makeDb();
    seedPendingOrder(orders, ORDER_ID, "paid");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 555, status: "approved", external_reference: ORDER_ID, test_mode: false, payer: { email: "x@y.com" } }),
      { status: 200 },
    )));

    const promises: Promise<unknown>[] = [];
    const res = await checkoutApp.request(
      "/api/payments/webhook?type=payment&data.id=555",
      { method: "POST" },
      asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "t" }),
      asCtx(promises),
    );
    expect(res.status).toBe(200);
    await Promise.all(promises);

    const row = orders.get(ORDER_ID)!;
    expect(row.status).toBe("paid");
    expect(row.payer_email).toBeNull(); // updateOrderStatus ni se llamó
    expect(row.mp_payment_id).toBeNull();

    // Pedido desconocido: webhook 200, no hay INSERT/UPDATE extra que rompa
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 777, status: "approved", external_reference: "fantasma", test_mode: false }),
      { status: 200 },
    )));
    const promises2: Promise<unknown>[] = [];
    const res2 = await checkoutApp.request(
      "/api/payments/webhook?type=payment&data.id=777",
      { method: "POST" },
      asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "t" }),
      asCtx(promises2),
    );
    expect(res2.status).toBe(200);
    await Promise.all(promises2);
    expect(orders.size).toBe(1);
  });
});

describe("POST /api/checkout", () => {
  it("guarda mp_preference_id del pedido y recalcula el precio desde D1", async () => {
    const { db, orders, products } = makeDb();
    seedProduct(products);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "pref-123", init_point: "https://mpago.la/xyz" }),
      { status: 201 },
    )));

    const promises: Promise<unknown>[] = [];
    const res = await checkoutApp.request(
      "/api/checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ items: [{ id: "p1", qty: 1 }], name: "Juan", phone: "342 555 1234" }),
      },
      asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "t" }),
      asCtx(promises),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; orderId?: string; initPoint?: string };
    expect(body.ok).toBe(true);
    expect(body.initPoint).toBe("https://mpago.la/xyz");

    const row = orders.get(body.orderId!)!;
    expect(row.mp_preference_id).toBe("pref-123"); // antes quedaba siempre NULL
    expect(row.status).toBe("pending");
    expect(row.total_cents).toBe(50_000_000); // precio de la base, no del cliente
  });

  it("cobra el recargo de MP como ítem extra de la preferencia, sin tocar el total base", async () => {
    const { db, orders, products } = makeDb();
    seedProduct(products);
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "pref-9", init_point: "https://mpago.la/9" }),
      { status: 201 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const res = await checkoutApp.request(
      "/api/checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ items: [{ id: "p1", qty: 1 }], name: "Juan", phone: "342 555 1234" }),
      },
      asEnv({ DB: db, KV: makeKv(true, { mpSurchargePercent: 10 }), MERCADOPAGO_ACCESS_TOKEN: "t" }),
      asCtx([]),
    );
    expect(res.status).toBe(200);

    const [, initReq] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const prefBody = JSON.parse(String(initReq.body)) as { items: { id: string; title: string; quantity: number; unit_price: number }[] };
    expect(prefBody.items).toHaveLength(2);
    expect(prefBody.items[1]).toEqual({ id: "recargo-mp", title: "Recargo pago online (10%)", quantity: 1, unit_price: 50000, currency_id: "ARS" });

    // El pedido congela el ítem de recargo y su total es el final (base + recargo):
    // /pedido/:id, el panel y MP muestran el mismo número.
    const row = [...orders.values()][0]!;
    expect(row.total_cents).toBe(55_000_000);
    expect(row.items_json).toContain("recargo-mp");
  });

  it("responde 503 cuando el token de MP no está configurado", async () => {
    const { db, products } = makeDb();
    seedProduct(products);
    const promises: Promise<unknown>[] = [];
    const res = await checkoutApp.request(
      "/api/checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ items: [{ id: "p1", qty: 1 }], name: "Juan", phone: "342 555 1234" }),
      },
      asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "" }),
      asCtx(promises),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("pago online");
  });
});
