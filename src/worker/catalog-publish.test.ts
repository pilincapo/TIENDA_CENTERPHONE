// Las escrituras del panel (alta/edición/baja/categorías) ya NO deben regenerar el
// snapshot: leer TODO el catálogo en D1 por cada edición se come la cuota de filas
// del free tier. Lo que hacen es marcar "sin publicar"; publicar (o sincronizar)
// regenera el snapshot y limpia la marca.
import { describe, expect, it } from "vitest";
import { adminApp } from "./admin";
import { getCatalogStatus, markCatalogPending, regenerateSnapshot } from "./sync";
import type { Env } from "./db";

interface MockDb {
  db: D1Database;
  /** Consultas que leen el catálogo entero (lo que hace regenerateSnapshot). */
  lecturasCompletas: string[];
}

function makeDb(productos: Record<string, unknown>[] = [], categorias: Record<string, unknown>[] = []): MockDb {
  const lecturasCompletas: string[] = [];
  const filas: Record<string, unknown>[] = productos;
  const cats: Record<string, unknown>[] = categorias;
  const prepare = (sql: string) => {
    const exec = (binds: unknown[]) => ({
      run: async () => ({ success: true, meta: { changes: 1 } }),
      first: async () => {
        // getProduct: SELECT * FROM products WHERE id = ?1
        if (/FROM products WHERE id/.test(sql)) return filas.find((r) => r.id === binds[0]) ?? null;
        return null;
      },
      all: async () => {
        if (/FROM categories/.test(sql)) {
          lecturasCompletas.push(sql);
          return { results: cats };
        }
        if (/FROM products/.test(sql)) {
          lecturasCompletas.push(sql);
          return { results: filas };
        }
        // Consulta auxiliar (ids por categoría en el borrado masivo).
        return { results: filas.map((r) => ({ id: r.id })) };
      },
    });
    return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
  };
  return { db: { prepare } as unknown as D1Database, lecturasCompletas };
}

function makeKv(entries: Record<string, string> = {}): KVNamespace & { _map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  const kv = {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
    _map: map,
  };
  return kv as KVNamespace & { _map: Map<string, string> };
}

function makeEnv(): { env: Env; kv: ReturnType<typeof makeKv>; m: MockDb } {
  const kv = makeKv();
  const m = makeDb(
    [{ id: "p1", title: "iPhone 13", price_cents: 1000, status: "published", sort_order: 0, created_at: 1, tags: "[]" }],
    [{ id: "c1", name: "Celulares", parent_id: null, active: 1 }],
  );
  const env = { KV: kv, DB: m.db, ADMIN_PASSWORD: "pass-de-test" } as unknown as Env;
  return { env, kv, m };
}

async function login(env: Env): Promise<string> {
  const res = await adminApp.request(
    "/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
    env,
  );
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

const JSON_HEADERS = { "Content-Type": "application/json" };

describe("escrituras del panel: marcan sin publicar, no regeneran el snapshot", () => {
  it("alta de producto: no lee el catálogo y deja la marca puesta", async () => {
    const { env, kv, m } = makeEnv();
    const cookie = await login(env);
    const res = await adminApp.request(
      "/products",
      { method: "POST", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify({ title: "Nuevo", priceCents: 5000 }) },
      env,
    );
    expect(res.status).toBe(201);
    expect(m.lecturasCompletas).toHaveLength(0);
    expect(kv._map.has("catalog:snapshot:v1")).toBe(false);
    expect(kv._map.get("catalog:pending:v1")).toBeTruthy();
    const status = await getCatalogStatus(env);
    expect(status.pending).toBe(true);
  });

  it("edición de producto: no lee el catálogo", async () => {
    const { env, kv, m } = makeEnv();
    const cookie = await login(env);
    const res = await adminApp.request(
      "/products/p1",
      { method: "PUT", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify({ title: "Editado", priceCents: 7000 }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(m.lecturasCompletas).toHaveLength(0);
    expect(kv._map.has("catalog:snapshot:v1")).toBe(false);
    expect((await getCatalogStatus(env)).pending).toBe(true);
  });

  it("baja de producto: no lee el catálogo", async () => {
    const { env, kv, m } = makeEnv();
    const cookie = await login(env);
    const res = await adminApp.request("/products/p1", { method: "DELETE", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    expect(m.lecturasCompletas).toHaveLength(0);
    expect(kv._map.has("catalog:snapshot:v1")).toBe(false);
    expect((await getCatalogStatus(env)).pending).toBe(true);
  });

  it("alta/edición/baja de categoría: tampoco leen el catálogo", async () => {
    const { env, kv, m } = makeEnv();
    const cookie = await login(env);
    const post = await adminApp.request(
      "/categories",
      { method: "POST", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify({ name: "Accesorios" }) },
      env,
    );
    expect(post.status).toBe(201);
    const put = await adminApp.request(
      "/categories/c1",
      { method: "PUT", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify({ name: "Celulares y mas" }) },
      env,
    );
    expect(put.status).toBe(200);
    const del = await adminApp.request("/categories/c1", { method: "DELETE", headers: { Cookie: cookie } }, env);
    expect(del.status).toBe(200);
    expect(m.lecturasCompletas).toHaveLength(0);
    expect(kv._map.has("catalog:snapshot:v1")).toBe(false);
    expect((await getCatalogStatus(env)).pending).toBe(true);
  });

  it("borrado masivo: una sola marca, sin leer el catálogo", async () => {
    const { env, m } = makeEnv();
    const cookie = await login(env);
    const res = await adminApp.request(
      "/products/bulk",
      { method: "POST", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify({ ids: ["p1"] }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(m.lecturasCompletas.filter((q) => /FROM products/.test(q))).toHaveLength(0);
    expect((await getCatalogStatus(env)).pending).toBe(true);
  });
});

describe("publicar: regenera el snapshot y limpia la marca", () => {
  it("POST /snapshot lee el catálogo, publica y deja pending=false", async () => {
    const { env, kv, m } = makeEnv();
    const cookie = await login(env);
    await markCatalogPending(env);
    expect((await getCatalogStatus(env)).pending).toBe(true);

    const res = await adminApp.request("/snapshot", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    expect(m.lecturasCompletas.length).toBeGreaterThan(0);
    expect(kv._map.has("catalog:snapshot:v1")).toBe(true);

    const status = await getCatalogStatus(env);
    expect(status.pending).toBe(false);
    expect(status.generatedAt).toBeGreaterThan(0);
  });

  it("GET /catalog-status expone el estado (sin sesión responde 401)", async () => {
    const { env } = makeEnv();
    const sinSesion = await adminApp.request("/catalog-status", {}, env);
    expect(sinSesion.status).toBe(401);

    const cookie = await login(env);
    const limpio = (await (await adminApp.request("/catalog-status", { headers: { Cookie: cookie } }, env)).json()) as {
      pending: boolean;
    };
    expect(limpio.pending).toBe(false);

    await markCatalogPending(env);
    const conCambios = (await (await adminApp.request("/catalog-status", { headers: { Cookie: cookie } }, env)).json()) as {
      pending: boolean;
      pendingAt: number | null;
    };
    expect(conCambios.pending).toBe(true);
    expect(conCambios.pendingAt).toBeGreaterThan(0);
  });

  it("regenerateSnapshot directo también limpia la marca (lo usa la sincronización)", async () => {
    const { env, kv } = makeEnv();
    await markCatalogPending(env);
    await regenerateSnapshot(env);
    expect((await getCatalogStatus(env)).pending).toBe(false);
    expect(kv._map.get("catalog:pending:v1")).toBe("");
  });
});