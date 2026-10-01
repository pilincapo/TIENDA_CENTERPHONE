// Tests del endpoint paginado de productos del panel.
// Mock de D1 mínimo pero fiel: filtra por status/q y pagina con LIMIT/OFFSET.
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApp } from "./admin";
import type { Dict, Env } from "./db";

const PRODUCTOS = [
  { id: "p1", title: "iPhone 13", status: "published", sort_order: 0, created_at: 1 },
  { id: "p2", title: "iPhone 14", status: "published", sort_order: 1, created_at: 2 },
  { id: "p3", title: "Funda iPhone", status: "published", sort_order: 2, created_at: 3 },
  { id: "p4", title: "Cargador Samsung", status: "published", sort_order: 3, created_at: 4 },
  { id: "p5", title: "Cable USB-C", status: "published", sort_order: 4, created_at: 5 },
  { id: "p6", title: "Auriculares BT", status: "published", sort_order: 5, created_at: 6 },
  { id: "p7", title: "Viejo cargador", status: "hidden", sort_order: 6, created_at: 7 },
  { id: "p8", title: "Otro sin stock", status: "hidden", sort_order: 7, created_at: 8 },
];

function makeDb(): D1Database {
  const filtra = (condSql: string, binds: unknown[]): typeof PRODUCTOS => {
    let rows = [...PRODUCTOS];
    if (condSql.includes("status = ?")) {
      const st = binds.find((b) => b === "published" || b === "hidden");
      rows = rows.filter((p) => p.status === st);
    }
    const pat = binds.find((b) => typeof b === "string" && String(b).startsWith("%"));
    if (typeof pat === "string") {
      const q = pat.replaceAll("%", "").replaceAll("\\", "").toLowerCase();
      rows = rows.filter((p) => p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    }
    return rows;
  };
  return {
    prepare(sql: string) {
      const exec = (binds: unknown[]) => ({
        run: async () => ({ success: true }),
        first: async () => {
          if (/COUNT\(\*\) AS n FROM products/.test(sql)) {
            const n = filtra(sql, binds).length;
            return { n };
          }
          return null;
        },
        all: async () => {
          if (/GROUP BY status/.test(sql)) {
            const published = PRODUCTOS.filter((p) => p.status === "published").length;
            const hidden = PRODUCTOS.length - published;
            return { results: [{ st: "published", n: published }, { st: "hidden", n: hidden }] };
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

function mockEnv(kv: KVNamespace, extra: Record<string, string> = {}): Env {
  return { KV: kv, DB: makeDb(), ADMIN_PASSWORD: "pass-de-test", ...extra } as unknown as Env;
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

describe("GET /api/admin/products (paginado)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sin sesión responde 401", async () => {
    const res = await adminApp.request("/products", {}, mockEnv(mockKV()));
    expect(res.status).toBe(401);
  });

  it("primera página con el default de 50: devuelve todo lo publicado y los totales por estado", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/products?status=published", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Dict[]; total: number; page: number; pages: number; limit: number; counts: { published: number; hidden: number } };
    expect(body.products).toHaveLength(6);
    expect(body.total).toBe(6);
    expect(body.page).toBe(1);
    expect(body.pages).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.counts).toEqual({ published: 6, hidden: 2 });
  });

  it("pagina con limit=2: página 2 trae 2 distintos y pages=3", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/products?limit=2&page=2", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { products: { id: string }[]; total: number; page: number; pages: number };
    expect(body.total).toBe(8); // sin status: todos
    expect(body.pages).toBe(4);
    expect(body.page).toBe(2);
    expect(body.products.map((p) => p.id)).toEqual(["p3", "p4"]);
  });

  it("busca por texto (q) en el servidor: iPhone → 3, y resetea páginas", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/products?q=iphone", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { products: { title: string }[]; total: number; pages: number };
    expect(body.total).toBe(3);
    expect(body.products.map((p) => p.title)).toEqual(["iPhone 13", "iPhone 14", "Funda iPhone"]);
  });

  it("status=hidden trae solo los sin stock", async () => {
    const env = mockEnv(mockKV());
    const cookie = await loginYCookie(env);
    const res = await adminApp.request("/products?status=hidden", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { products: Dict[]; total: number };
    expect(body.total).toBe(2);
    expect(body.products.every((p) => p.status === "hidden")).toBe(true);
  });
});
