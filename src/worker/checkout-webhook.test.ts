// Tests del webhook de MercadoPago: re-consulta a la API, idempotencia y
// registro de seguridad. Patrón igual que checkout.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutApp } from "./checkout";
import type { Dict } from "./db";

function makeDb() {
  const orders = new Map<string, Dict>();
  const executed: string[] = [];

  function apply(sql: string, args: unknown[]): void {
    executed.push(sql.slice(0, 40));
    if (/INSERT INTO orders/i.test(sql)) {
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
      const exec = (args: unknown[]) => ({
        run: async () => { apply(sql, args); return { success: true }; },
        first: async () => (/FROM orders WHERE id/i.test(sql) ? orders.get(String(args[0])) ?? null : null),
        all: async () => ({ results: [...orders.values()] }),
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, orders };
}

function makeKv(paymentsEnabled: boolean, extra: Record<string, unknown> = {}) {
  return {
    get: async (key: string) => (key === "config:settings:v1" ? JSON.stringify({ paymentsEnabled, ...extra }) : null),
  };
}

function seedPendingOrder(orders: Map<string, Dict>, id: string, status = "pending"): void {
  orders.set(id, {
    id, status, total_cents: 84_000, currency: "ARS", buyer_name: "Valeria",
    buyer_phone: "5491100000000", payer_email: null, items_json: "[]",
    mp_preference_id: null, mp_payment_id: null, paid_at: null, notified_wa: 0,
    created_at: 1, updated_at: 1,
  });
}

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

describe("POST /api/payments/webhook — re-consulta MP y confirma pagos", () => {
  it("re-consulta MP y persiste mp_payment_id, payer_email (trimmed) y paid_at", async () => {
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
    expect(row.payer_email).toBe("Valeria@Example.com");
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
    expect(row.payer_email).toBeNull(); // updateOrderStatus no se llamó
    expect(row.mp_payment_id).toBeNull();

    // Pedido desconocido: 200, sinINSERT/UPDATE extra.
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

  it("deja registro de seguridad: recepción, confirmación y sondeo sin explotar", async () => {
    const { db, orders } = makeDb();
    seedPendingOrder(orders, ORDER_ID);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ id: 555, status: "approved", external_reference: ORDER_ID, test_mode: false }),
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
      expect(logs.some((l) => l.includes("seguridad: webhook mp recibido (payment 555)"))).toBe(true);
      expect(logs.some((l) => l.includes(`seguridad: webhook mp confirmó pago del pedido ${ORDER_ID}`))).toBe(true);

      logs.length = 0;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 404 })));
      const promises2: Promise<unknown>[] = [];
      const res2 = await checkoutApp.request(
        "/api/payments/webhook?type=payment&data.id=999",
        { method: "POST" },
        asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "t" }),
        asCtx(promises2),
      );
      expect(res2.status).toBe(200);
      await Promise.all(promises2);
      expect(logs.some((l) => l.includes("seguridad: webhook mp: pago 999 no encontrado"))).toBe(true);
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("respeta el flag x-success (no confía en el payload, solo la re-consulta)", async () => {
    const { db, orders } = makeDb();
    seedPendingOrder(orders, ORDER_ID);
    // Webhook "aprobado" en el payload pero la re-consulta dice pending:
    // no confirma el pago.
    // La unica llamada del worker es la re-consulta: devuelve pending, con lo
    // que el pago NO se confirma aunque la notificacion haya sido de un pago.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 555, status: "pending", external_reference: ORDER_ID, test_mode: false }),
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
    expect(row.status).toBe("pending"); // la re-consulta controla
    expect(row.mp_payment_id).toBeNull();
  });

  it("es idempotente: dos webhooks del mismo pago no cambian el estado", async () => {
    const { db, orders } = makeDb();
    seedPendingOrder(orders, ORDER_ID);
    const log: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      log.push(args.map(String).join(" "));
    });
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ id: 555, status: "approved", external_reference: ORDER_ID, test_mode: false }),
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

      const row1 = orders.get(ORDER_ID)!;
      expect(row1.status).toBe("paid");
      expect(row1.mp_payment_id).toBe("555");

      // Webhook repetido del mismo pago: la guardia `if (order.status === "paid") return;`
      // hace que no se vuelva a escribir. La re-consulta a MP sigue pasando (no hay
      // cache de la API de MP dentro del worker), así que la consulta se repite.
      const res2 = await checkoutApp.request(
        "/api/payments/webhook?type=payment&data.id=555",
        { method: "POST" },
        asEnv({ DB: db, KV: makeKv(true), MERCADOPAGO_ACCESS_TOKEN: "t" }),
        asCtx([]),
      );
      expect(res2.status).toBe(200);

      // La DB no se modificó por segunda vez.
      const row2 = orders.get(ORDER_ID)!;
      expect(row2.status).toBe("paid");
      expect(row2.mp_payment_id).toBe("555");
      expect(row2.payer_email).toBeNull();
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
