// Tests mirror para PATCH /api/admin/orders/:id (cambio manual de estado),
// siguiendo el patrón de products-page.test.ts: mock de D1 mínimo, sesión
// admin con loginYCookie, body JSON, assertions sobre la fila de la base.
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApp } from "./admin";
import type { Dict, Env } from "./db";

// Mock D1 mínimo: guarda filas en un Map y aplica el UPDATE de status.
function makeDb() {
  const orders = new Map<string, Dict>();
  const executed: string[] = [];

  function apply(sql: string, args: unknown[]): void {
    executed.push(sql.slice(0, 40));
    if (/archived_at = \?2/.test(sql)) {
      // adminSetOrderArchive: status 'archived' + fecha/autor/nota del archivo.
      const row = orders.get(String(args[0]));
      if (row) {
        row.status = "archived";
        row.archived_at = args[1];
        row.archived_by = args[2];
        row.archive_note = args[3];
        row.updated_at = args[4];
        row.pre_archive_status = args[5]; // estado previo (migración 010)
      }
    } else if (/archived_at = NULL/.test(sql)) {
      // adminSetOrderUnarchive: vuelve a paid/pending y limpia el archivo.
      const row = orders.get(String(args[0]));
      if (row) {
        row.status = args[1];
        row.archived_at = null;
        row.archived_by = null;
        row.archive_note = null;
        row.pre_archive_status = null;
        row.updated_at = args[2];
      }
    } else if (/UPDATE orders SET status/i.test(sql)) {
      const row = orders.get(String(args[0]));
      if (row) {
        row.status = args[1];
        row.paid_at = args[2];
        row.updated_at = args[3];
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
  return { db, orders, executed };
}

// KV para getSettings (sin settings guardadas: cae a DEFAULT_SETTINGS).
function makeKv() {
  return { get: async () => null };
}

function seedOrders(orders: Map<string, Dict>, ids: string[]): void {
  for (const id of ids) {
    orders.set(id, {
      id, status: "pending", total_cents: 100_000, currency: "ARS",
      buyer_name: "Prueba", buyer_phone: "5491100000000", payer_email: null,
      items_json: "[]", mp_preference_id: null, mp_payment_id: null,
      paid_at: null, notified_wa: 0, archived_at: null, archived_by: null, archive_note: null, pre_archive_status: null,
      created_at: 1, updated_at: 1,
    });
  }
}

function mockEnv(db: unknown): Env {
  return { DB: db, KV: makeKv(), ADMIN_PASSWORD: "pass-de-test" } as unknown as Env;
}

async function loginYCookie(env: Env): Promise<string> {
  const login = await adminApp.request(
    "/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
    env,
  );
  expect(login.status).toBe(200);
  return login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

const ORDER_ID = "o-patch-1";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PATCH /api/admin/orders/:id (cambio manual de estado, panel)", () => {
  it("cambia el estado de un pedido pending a paid y congela paid_at", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      `/orders/${ORDER_ID}`,
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status: "paid" }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order?: Dict };
    expect(body.order?.status).toBe("paid");
    expect(orders.get(ORDER_ID)?.status).toBe("paid");
    expect(orders.get(ORDER_ID)?.paid_at).not.toBeNull();
  });

  it("acepta todos los estados válidos (pending/paid/cancelled/rejected)", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    for (const status of ["cancelled", "rejected", "pending", "paid"]) {
      const res = await adminApp.request(
        `/orders/${ORDER_ID}`,
        { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status }) },
        env,
      );
      expect(res.status).toBe(200);
      expect(orders.get(ORDER_ID)?.status).toBe(status);
    }
  });

  it("rechaza un estado inválido con 400", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      `/orders/${ORDER_ID}`,
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status: "borrada" }) },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Estado inválido");
    // La fila no cambió.
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("responde 404 con un pedido inexistente y no toca la base", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      "/orders/no-existe",
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ status: "paid" }) },
      env,
    );
    expect(res.status).toBe(404);
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("responde 401 sin sesión", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const res = await adminApp.request(
      `/orders/${ORDER_ID}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }) },
      mockEnv(db),
    );
    expect(res.status).toBe(401);
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
  });
});

describe("POST /api/admin/orders/:id/archive y /unarchive (historial)", () => {
  it("archiva con confirmacion: pasa a archived y guarda fecha/autor", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; archived: boolean };
    expect(body.ok).toBe(true);
    expect(body.archived).toBe(true);
    const row = orders.get(ORDER_ID)!;
    expect(row.status).toBe("archived");
    expect(row.archived_at).not.toBeNull();
    expect(row.archived_by).not.toBeNull();
  });

  it("es idempotente: archivar dos veces no cambia la fecha original", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    const firstArchivedAt = orders.get(ORDER_ID)!.archived_at;
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(orders.get(ORDER_ID)!.archived_at).toBe(firstArchivedAt);
  });

  it("restaura un pendiente archivado a pending y limpia el archivo", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    const res = await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(res.status).toBe(200);
    const row = orders.get(ORDER_ID)!;
    expect(row.status).toBe("pending");
    expect(row.archived_at).toBeNull();
    expect(row.archived_by).toBeNull();
  });

  it("restaura al estado previo: cancelled y rejected vuelven como estaban", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    for (const status of ["cancelled", "rejected"]) {
      orders.get(ORDER_ID)!.status = status;
      await adminApp.request(
        `/orders/${ORDER_ID}/archive`,
        { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
        env,
      );
      expect(orders.get(ORDER_ID)?.status).toBe("archived");
      expect(orders.get(ORDER_ID)?.pre_archive_status).toBe(status);
      await adminApp.request(
        `/orders/${ORDER_ID}/unarchive`,
        { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
        env,
      );
      expect(orders.get(ORDER_ID)?.status).toBe(status);
      expect(orders.get(ORDER_ID)?.pre_archive_status).toBeNull();
    }
  });

  it("fila archivada antes de la migración 010 (sin pre_archive_status) cae al fallback paid/pending", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    // Fila legada: archivada sin pre_archive_status (columna nueva).
    orders.get(ORDER_ID)!.status = "archived";
    orders.get(ORDER_ID)!.archived_at = 111;
    orders.get(ORDER_ID)!.archived_by = "panel";
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
    // Con paid_at setado, el fallback restaura paid.
    orders.get(ORDER_ID)!.status = "archived";
    orders.get(ORDER_ID)!.archived_at = 222;
    orders.get(ORDER_ID)!.paid_at = 999;
    await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(orders.get(ORDER_ID)?.status).toBe("paid");
  });

  it("restaura a paid si el pedido tenia paid_at (el archivo no lo toca)", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    orders.get(ORDER_ID)!.paid_at = 12345; // pago confirmado antes de archivar
    orders.get(ORDER_ID)!.status = "paid"; // y el pedido en estado pagado
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    const row = orders.get(ORDER_ID)!;
    expect(row.status).toBe("paid");
    expect(row.paid_at).toBe(12345);
  });

  it("archive responde 404 con pedido inexistente y unarchive 400 si no estaba archivado", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const r1 = await adminApp.request(
      "/orders/fantasma/archive",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(r1.status).toBe(404);
    const r2 = await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(r2.status).toBe(400);
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
  });

  it("guarda el motivo opcional en archive_note y se limpia al restaurar", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ note: "Pedido de prueba, sin cobro real" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(orders.get(ORDER_ID)?.archive_note).toBe("Pedido de prueba, sin cobro real");

    await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(orders.get(ORDER_ID)?.archive_note).toBeNull();
  });

  it("sin motivo (note vacio o ausente) queda archive_note en null", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    // Sin note en el body.
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(orders.get(ORDER_ID)?.archive_note).toBeNull();

    // Note en blanco: se normaliza a null.
    orders.get(ORDER_ID)!.status = "pending";
    orders.get(ORDER_ID)!.archived_at = null;
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ note: "   " }),
      },
      env,
    );
    expect(orders.get(ORDER_ID)?.archive_note).toBeNull();
  });

  it("acota el motivo a 200 caracteres", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ note: "x".repeat(500) }),
      },
      env,
    );
    expect(String(orders.get(ORDER_ID)?.archive_note)).toHaveLength(200);
  });

  it("ambos endpoints responden 401 sin sesion", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const r1 = await adminApp.request(
      `/orders/${ORDER_ID}/archive`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );
    expect(r1.status).toBe(401);
    const r2 = await adminApp.request(
      `/orders/${ORDER_ID}/unarchive`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );
    expect(r2.status).toBe(401);
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
  });
});

describe("POST /api/admin/orders/archive-bulk (archivo masivo, una sola confirmacion)", () => {
  it("archiva varios pedidos de una vez con una nota compartida", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, ["b-1", "b-2", "b-3"]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      "/orders/archive-bulk",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ ids: ["b-1", "b-2", "b-3"], note: "Cancelados en lote" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; requested: number; archived: number; notFound: number };
    expect(body).toEqual({ ok: true, requested: 3, archived: 3, notFound: 0 });
    for (const id of ["b-1", "b-2", "b-3"]) {
      expect(orders.get(id)?.status).toBe("archived");
      expect(orders.get(id)?.archive_note).toBe("Cancelados en lote");
      expect(orders.get(id)?.archived_at).not.toBeNull();
      expect(orders.get(id)?.pre_archive_status).toBe("pending"); // estado previo capturado
    }
  });

  it("deduplica ids, ignora basura y cuenta los inexistentes como notFound", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, ["b-1"]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await adminApp.request(
      "/orders/archive-bulk",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ ids: ["b-1", "b-1", " ", null, 42, "fantasma"] }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requested: number; archived: number; notFound: number };
    expect(body.requested).toBe(2); // b-1 deduplicado + fantasma
    expect(body.archived).toBe(1);
    expect(body.notFound).toBe(1);
  });

  it("responde 400 sin ids, 400 con lista vacia y 401 sin sesion", async () => {
    const { db, orders } = makeDb();
    seedOrders(orders, [ORDER_ID]);
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const r1 = await adminApp.request(
      "/orders/archive-bulk",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env,
    );
    expect(r1.status).toBe(400);
    const r2 = await adminApp.request(
      "/orders/archive-bulk",
      { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ ids: [] }) },
      env,
    );
    expect(r2.status).toBe(400);
    const r3 = await adminApp.request(
      "/orders/archive-bulk",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [ORDER_ID] }) },
      env,
    );
    expect(r3.status).toBe(401);
    expect(orders.get(ORDER_ID)?.status).toBe("pending");
  });
});
