// Las URLs viejas de producto (id opaco del proveedor: "6160", "tecnova-185")
// ya están indexadas en Google y compartidas en WhatsApp: cuando el importador
// renombra la fila al nombre de página, esas URLs tienen que responder 301 al
// id nuevo en vez de 404 — perder la página sería tirar el posicionamiento.
// Sin redirect registrado la URL vieja sigue siendo 404 real (igual que antes).
import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./db";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** Env de mentira: D1 que sirve el producto si existe y el redirect si está. */
function mockEnv(opts: { producto: boolean; redirect: string | null; status?: "published" | "hidden" }): Env {
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace;
  const assets = {
    fetch: async (req: Request) =>
      new Response(`<html>asset:${new URL(req.url).pathname}</html>`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  } as unknown as Fetcher;
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes("FROM product_redirects")) {
            return opts.redirect === null ? null : { to_id: opts.redirect };
          }
          if (sql.includes("FROM products")) {
            return opts.producto
              ? { id: "cargador-usb-c", title: "Cargador USB-C", price_cents: 5000, status: opts.status ?? "published", tags: "[]" }
              : null;
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    }),
  } as unknown as D1Database;
  return { DB: db, KV: kv, ASSETS: assets, ADMIN_PASSWORD: "x", ADMIN_SESSION_SECRET: "y" } as unknown as Env;
}

describe("/producto/* con id viejo renombrado", () => {
  it("la URL vieja responde 301 al nombre de página nuevo", async () => {
    const env = mockEnv({ producto: false, redirect: "cargador-usb-c" });
    const res = await worker.fetch(new Request("https://centerphone.com.ar/producto/6160"), env, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/producto/cargador-usb-c");
  });

  it("conserva el resto de la URL encodificada (ids con caracteres especiales)", async () => {
    const env = mockEnv({ producto: false, redirect: "cable usb-c" });
    const res = await worker.fetch(new Request("https://centerphone.com.ar/producto/6160?utm=x"), env, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/producto/cable%20usb-c");
  });

  it("sin redirect registrado la URL vieja sigue siendo 404 real", async () => {
    const env = mockEnv({ producto: false, redirect: null });
    const res = await worker.fetch(new Request("https://centerphone.com.ar/producto/6160"), env, ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("si el producto existe y está publicado se sirve la ficha, sin mirar redirects", async () => {
    const env = mockEnv({ producto: true, redirect: "nunca-deberia-usarse" });
    const res = await worker.fetch(new Request("https://centerphone.com.ar/producto/cargador-usb-c"), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
    expect(await res.text()).toContain("asset:/product.html");
  });

  // El dedupe entre fuentes deja la copia OCULTA (no la borra): esa fila sigue
  // existiendo, así que sin esta regla la URL duplicada viviría con 200.
  it("una fila oculta con redirect también responde 301 (copia descartada del dedupe)", async () => {
    const env = mockEnv({ producto: true, redirect: "cargador-usb-c", status: "hidden" });
    const res = await worker.fetch(new Request("https://centerphone.com.ar/producto/4693"), env, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/producto/cargador-usb-c");
  });

  it("una ficha oculta sin redirect sigue sirviéndose (sin stock, por link directo)", async () => {
    const env = mockEnv({ producto: true, redirect: null, status: "hidden" });
    const res = await worker.fetch(new Request("https://centerphone.com.ar/producto/cargador-usb-c"), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });
});
