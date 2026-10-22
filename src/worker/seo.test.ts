// SEO en Search Console: estas tres respuestas definen cómo Google clasifica
// las URLs del sitio, así que cada una tiene su test anti-regresión.
// - /404 y /404.html responden 404 REAL (la capa de assets los servía con 200
//   y Google los clasificaba como «Soft 404»).
// - El sitemap NO lista URLs de categoría (/?cat=...): son la home filtrada
//   por JS con canonical a "/", y publicarlas generaba «Página alternativa con
//   etiqueta canónica adecuada» por cada categoría.
// - Redirect canónico http→https y www→sin www en UN solo 301 (antes http no
//   redirigía y Google podía tener copias indexadas sin versión canónica).
// - El espejo workers.dev responde X-Robots-Tag: noindex (duplicados).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seoApp } from "./seo";
import { applyWorkersDevNoIndex } from "./security";
import worker from "./index";
import type { Env } from "./db";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/**
 * Env de mentira: KV vacío (settings por defecto, mantenimiento apagado),
 * ASSETS que devuelve un body identificable por path, D1 sin filas.
 */
function mockEnv(): Env {
  const kv = {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  } as unknown as KVNamespace;
  const assets = {
    fetch: async (req: Request) =>
      new Response(`<html>asset:${new URL(req.url).pathname}</html>`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  } as unknown as Fetcher;
  const db = {
    prepare: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({ success: true }) }),
  } as unknown as D1Database;
  return { DB: db, KV: kv, ASSETS: assets, ADMIN_PASSWORD: "x", ADMIN_SESSION_SECRET: "y" } as unknown as Env;
}

function mockDbWith(rows: Record<string, unknown>[]): D1Database {
  return {
    prepare: () => ({ all: async () => ({ results: rows }), first: async () => null, run: async () => ({ success: true }) }),
  } as unknown as D1Database;
}

describe("sitemap.xml", () => {
  // El handler usa la Cache API del worker (caches.default), inexistente en node.
  beforeEach(() => {
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trae home + productos publicados y NINGUNA URL ?cat=", async () => {
    const env = mockEnv();
    env.DB = mockDbWith([
      { id: "p-1", title: "Uno", price_cents: 100, status: "published" },
      { id: "p-2", title: "Oculto", price_cents: 200, status: "hidden" },
    ]);
    const res = await seoApp.request("/sitemap.xml", {}, env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://centerphone.com.ar/</loc>");
    expect(xml).toContain("<loc>https://centerphone.com.ar/producto/p-1</loc>");
    // Los ocultos quedan fuera del índice.
    expect(xml).not.toContain("p-2");
    // Ninguna URL de categoría: era la causa de «Página alternativa con canónica adecuada».
    expect(xml).not.toContain("cat=");
  });

  it("robots.txt bloquea admin y el feed, y publica el sitemap", async () => {
    const res = await seoApp.request("/robots.txt", {}, mockEnv(), ctx);
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /api/whatsapp/feed.csv");
    expect(txt).toContain("Sitemap: https://centerphone.com.ar/sitemap.xml");
  });
});

describe("redirect canónico (soft 404 / duplicados)", () => {
  it("http:// sin www → 301 a https conservando path y query", async () => {
    const res = await worker.fetch(new Request("http://centerphone.com.ar/producto/5469?x=1"), mockEnv(), ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://centerphone.com.ar/producto/5469?x=1");
  });

  it("http://www → UN solo 301 a https sin www (sin cadena de redirects)", async () => {
    const res = await worker.fetch(new Request("http://www.centerphone.com.ar/"), mockEnv(), ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://centerphone.com.ar/");
  });

  it("https sin www (variante canónica) no redirige", async () => {
    const res = await worker.fetch(new Request("https://centerphone.com.ar/"), mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("el dev local (127.0.0.1) no entra al redirect canónico", async () => {
    const res = await worker.fetch(new Request("http://127.0.0.1:8787/"), mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });
});

describe("/404 responde 404 real (soft 404)", () => {
  it("/404 y /404.html devuelven status 404 con la página de error", async () => {
    for (const path of ["/404", "/404.html"]) {
      const res = await worker.fetch(new Request(`https://centerphone.com.ar${path}`), mockEnv(), ctx);
      expect(res.status, path).toBe(404);
      // El body es el del asset 404.html, traído por el worker.
      expect(await res.text(), path).toContain("asset:/404.html");
    }
  });

  it("una URL inexistente sigue respondiendo 404 (catch-all intacto)", async () => {
    const res = await worker.fetch(new Request("https://centerphone.com.ar/no-existe-xyz"), mockEnv(), ctx);
    expect(res.status).toBe(404);
  });
});

describe("workers.dev (espejo) queda noindex", () => {
  it("responde X-Robots-Tag: noindex bajo *.workers.dev", async () => {
    const res = await worker.fetch(new Request("https://celu-store.pilin123.workers.dev/"), mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("el dominio propio no lleva la cabecera", async () => {
    const res = await worker.fetch(new Request("https://centerphone.com.ar/"), mockEnv(), ctx);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("la Response cruda de ASSETS.fetch (headers inmutables) no revienta: se recrea y queda noindex", async () => {
    // En wrangler dev/prod "/" se sirve con env.ASSETS.fetch y esa respuesta
    // trae headers INMUTABLES (y ya todo el CSP de _headers, así que el
    // middleware de seguridad ni se entera): setear X-Robots-Tag directo
    // tiraba "Can't modify immutable headers" → 500 en workers.dev.
    const res = new Response("<html>asset:/</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    res.headers.set = () => {
      throw new TypeError("Can't modify immutable headers.");
    };
    const c = { res } as unknown as { res: Response };
    applyWorkersDevNoIndex(c, "celu-store.pilin123.workers.dev");
    expect(c.res.headers.get("X-Robots-Tag")).toBe("noindex");
    // La respuesta nueva conserva status y body.
    expect(c.res.status).toBe(200);
    expect(await c.res.text()).toContain("asset:/");
  });

  it("sin coincidencia de host no toca los headers (sin recrear nada)", () => {
    const c = { res: new Response("ok", { status: 200 }) } as unknown as { res: Response };
    applyWorkersDevNoIndex(c, "centerphone.com.ar");
    expect(c.res.headers.get("X-Robots-Tag")).toBeNull();
  });
});
