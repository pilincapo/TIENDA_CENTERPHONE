// Tests del endpoint paginado de pedidos del panel (espejo de products-page.test.ts).
// Recuperados en el archivo propio: la pagina de pedido (/pedido/:id) vive en
// orders-page.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApp } from "./admin";
import type { Dict, Env } from "./db";

const PEDIDOS = [
  { id: "o1", status: "pending", total_cents: 5000, currency: "ARS", buyer_name: "Juan Perez", buyer_phone: "3425819402", payer_email: null, items_json: "[]", mp_preference_id: null, mp_payment_id: null, paid_at: null, notified_wa: 0, created_at: 6, updated_at: 6 },
  { id: "o2", status: "paid", total_cents: 840, currency: "ARS", buyer_name: "Maria Perez", buyer_phone: "3425819403", payer_email: "maria@gmail.com", items_json: "[]", mp_preference_id: "pref_1", mp_payment_id: "pay_1", paid_at: 5, notified_wa: 1, created_at: 5, updated_at: 5 },
  { id: "o3", status: "cancelled", total_cents: 1200, currency: "ARS", buyer_name: "Pedro Sanchez", buyer_phone: "3425819404", payer_email: null, items_json: "[]", mp_preference_id: null, mp_payment_id: null, paid_at: null, notified_wa: 0, created_at: 4, updated_at: 4 },
  { id: "o4", status: "paid", total_cents: 3000, currency: "ARS", buyer_name: "Ana Martinez", buyer_phone: "3425819405", payer_email: "ana@gmail.com", items_json: "[]", mp_preference_id: "pref_2", mp_payment_id: "pay_2", paid_at: 3, notified_wa: 0, created_at: 3, updated_at: 3 },
  { id: "o5", status: "pending", total_cents: 1500, currency: "ARS", buyer_name: "Luis Garcia", buyer_phone: "3425819406", payer_email: null, items_json: "[]", mp_preference_id: null, mp_payment_id: null, paid_at: null, notified_wa: 0, created_at: 2, updated_at: 2 },
  { id: "o6", status: "rejected", total_cents: 700, currency: "ARS", buyer_name: "Carla Ruiz", buyer_phone: "3425819407", payer_email: "carla@gmail.com", items_json: "[]", mp_preference_id: null, mp_payment_id: "pay_3", paid_at: null, notified_wa: 0, created_at: 1, updated_at: 1 },
  // Un pedido archivado: NUNCA aparece en la vista principal (status="").
  { id: "o7", status: "archived", total_cents: 900, currency: "ARS", buyer_name: "Prueba Test", buyer_phone: "3425819408", payer_email: null, items_json: "[]", mp_preference_id: null, mp_payment_id: null, paid_at: null, notified_wa: 0, archived_at: 7, archived_by: "panel", created_at: 0, updated_at: 7 },
];

function makeDb(): D1Database {
  const filtra = (condSql: string, binds: unknown[]): typeof PEDIDOS => {
    let rows = [...PEDIDOS];
    if (condSql.includes("status = ?")) {
      const st = binds.find((b) => b === "pending" || b === "paid" || b === "cancelled" || b === "rejected" || b === "archived");
      rows = rows.filter((o) => o.status === st);
    }
    if (condSql.includes("status != ?")) {
      rows = rows.filter((o) => o.status !== "archived");
    }
    const pats = binds.filter((b) => typeof b === "string" && String(b).startsWith("%"));
    const pat = pats[0];
    if (typeof pat === "string") {
      const q = pat.replaceAll("%", "").replaceAll("\\", "").toLowerCase();
      // Si el backend calculó dígitos para el teléfono, va en el último bind
      // (nombre/id/email + teléfono crudo = 4) y se compara TAL CUAL para
      // castigar una regex de dígitos rota.
      const phonePat = pats.length > 3 ? String(pats[pats.length - 1]).replaceAll("%", "") : null;
      rows = rows.filter(
        (o) =>
          o.buyer_name.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.payer_email ?? "").toLowerCase().includes(q) ||
          (phonePat !== null && o.buyer_phone.replace(/\D/g, "").includes(phonePat)),
      );
    }
    return rows;
  };
  return {
    prepare(sql: string) {
      const exec = (binds: unknown[]) => ({
        run: async () => ({ success: true }),
        first: async () => {
          if (/COUNT\(\*\) AS n FROM orders/.test(sql)) {
            return { n: filtra(sql, binds).length };
          }
          return null;
        },
        all: async () => {
          if (/GROUP BY status/.test(sql)) {
            const counts = { pending: 0, paid: 0, cancelled: 0, rejected: 0, archived: 0 };
            for (const o of PEDIDOS) {
              counts[o.status as keyof typeof counts]++;
            }
            return { results: Object.entries(counts).map(([st, n]) => ({ st, n })) };
          }
          let rows = filtra(sql, binds);
          if (/LIMIT \? OFFSET \?/.test(sql)) {
            const limit = Number(binds[binds.length - 2] ?? 50);
            const offset = Number(binds[binds.length - 1] ?? 0);
            rows = rows.slice(offset, offset + limit);
          }
          return { results: rows };
        },
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  } as unknown as D1Database;
}

function mockEnv(kv: KVNamespace): Env {
  return { KV: kv, DB: makeDb(), ADMIN_PASSWORD: "pass-de-test" } as unknown as Env;
}

function mockKV(): KVNamespace {
  return { get: async () => null, put: async () => {} } as unknown as KVNamespace;
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

describe("GET /api/admin/orders (paginado)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sin sesión responde 401", async () => {
    const res = await adminApp.request("/orders", {}, mockEnv(mockKV()));
    expect(res.status).toBe(401);
  });

  it("primera página con el default de 50: excluye los archivados y trae los totales", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      orders: Dict[];
      total: number;
      page: number;
      pages: number;
      limit: number;
      counts: { pending: number; paid: number; cancelled: number; rejected: number; archived: number };
    };
    // 7 pedidos en total, pero o7 está archivado: no aparece en "Todos".
    expect(body.orders.map((o) => o.id)).not.toContain("o7");
    expect(body.orders).toHaveLength(6);
    expect(body.total).toBe(6);
    expect(body.page).toBe(1);
    expect(body.pages).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.counts).toEqual({ pending: 2, paid: 2, cancelled: 1, rejected: 1, archived: 1 });
  });

  it("pagina con limit=2: página 2 trae 2 distintos y pages=3", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?limit=2&page=2", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number; page: number; pages: number };
    expect(body.total).toBe(6);
    expect(body.pages).toBe(3);
    expect(body.page).toBe(2);
    expect(body.orders.map((o) => o.id)).toEqual(["o3", "o4"]);
  });

  it("busca por texto (q) en el servidor: perez → 2", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?q=perez", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number; pages: number };
    expect(body.total).toBe(2);
    expect(body.orders.map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("busca por teléfono aunque la query tenga espacios: 342 581 9403 → o2", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?q=342%20581%209403", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number };
    expect(body.total).toBe(1);
    expect(body.orders.map((o) => o.id)).toEqual(["o2"]);
  });

  it("busca por teléfono solo con dígitos: 3425819404 → o3", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?q=3425819404", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number };
    expect(body.total).toBe(1);
    expect(body.orders.map((o) => o.id)).toEqual(["o3"]);
  });

  it("busca por email del comprador: maria@ → o2", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?q=maria%40", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number };
    expect(body.total).toBe(1);
    expect(body.orders.map((o) => o.id)).toEqual(["o2"]);
  });

  it("status=paid trae solo los pagados", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?status=paid", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number };
    expect(body.total).toBe(2);
    expect(body.orders.every((o) => o.status === "paid")).toBe(true);
  });

  it("status=archived muestra solo el historial (el pedido archivado)", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/orders?status=archived", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { orders: Dict[]; total: number };
    expect(body.total).toBe(1);
    expect(body.orders.map((o) => o.id)).toEqual(["o7"]);
  });
});
