// Páginas legales públicas: /politica-de-cambios-y-devoluciones y
// /politica-de-privacidad. Son HTML estático servido por el worker en su ruta
// limpia (sin .html) para recibir las cabeceras de seguridad del sitio.
import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./db";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** Env de mentira: ASSETS devuelve el path pedido; si `falta` coincide, 404. */
function mockEnv(falta = ""): Env {
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace;
  const assets = {
    fetch: async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path === falta) return new Response("no existe", { status: 404 });
      return new Response(`<html>asset:${path}</html>`, { status: 200, headers: { "Content-Type": "text/html" } });
    },
  } as unknown as Fetcher;
  const db = {
    prepare: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({ success: true }) }),
  } as unknown as D1Database;
  return { DB: db, KV: kv, ASSETS: assets, ADMIN_PASSWORD: "x", ADMIN_SESSION_SECRET: "y" } as unknown as Env;
}

describe("páginas legales", () => {
  const rutas = [
    ["/politica-de-cambios-y-devoluciones", "/politica-de-cambios-y-devoluciones.html"],
    ["/politica-de-privacidad", "/politica-de-privacidad.html"],
  ] as const;

  it("sirven el HTML estático en la ruta limpia, con status 200", async () => {
    for (const [ruta, asset] of rutas) {
      const res = await worker.fetch(new Request(`https://centerphone.com.ar${ruta}`), mockEnv(), ctx);
      expect(res.status, ruta).toBe(200);
      expect(await res.text(), ruta).toContain(`asset:${asset}`);
    }
  });

  it("llevan las cabeceras de seguridad del worker (CSP)", async () => {
    const res = await worker.fetch(new Request("https://centerphone.com.ar/politica-de-privacidad"), mockEnv(), ctx);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("si el asset no está en el build responde 404 real, no un 200 vacío", async () => {
    const env = mockEnv("/politica-de-cambios-y-devoluciones.html");
    const res = await worker.fetch(new Request("https://centerphone.com.ar/politica-de-cambios-y-devoluciones"), env, ctx);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("asset:/404.html");
  });
});
