// El CSV del catálogo de WhatsApp se sirve desde una COPIA en KV: la descarga de Meta
// (cada hora, o cada vez que alguien tenga la URL con el token) no puede leer el catálogo
// entero en D1 cada vez. Qué se prueba acá:
//
//  - la primera descarga lee D1 y deja la copia; la segunda sale de KV y no toca D1;
//  - cualquier cambio del catálogo tira la copia (markCatalogPending es el hook por donde
//    pasan el panel, la sincronización y las auto-importaciones);
//  - el feed vacío —que responde 500 a propósito para no vaciar el catálogo de Meta— NO
//    se cachea nunca;
//  - sin token o con token inválido no se lee ni D1 ni la copia (404 y listo).
import { describe, expect, it } from "vitest";
import { WA_FEED_CACHE_KEY, invalidateWaFeedCache, waFeedApp } from "./wa-feed";
import { markCatalogPending } from "./sync";
import { KV_SETTINGS_KEY } from "../shared/types";
import type { Env } from "./db";

const TOKEN = "token-de-prueba";
const FEED_URL = `/api/whatsapp/feed.csv?t=${TOKEN}`;

/** Fila cruda de D1 (nombres de columna reales; el worker la mapea con rowToProduct). */
const FILA: Record<string, unknown> = {
  id: "5469",
  title: "iPhone 13 128 GB",
  description: "Nuevo",
  price_cents: 1234500,
  category_id: "celulares",
  subcategory_id: null,
  tags: "[]",
  image_url: "https://cdn.ejemplo.com/13.jpg",
  status: "published",
  availability: "in_stock",
  sort_order: 0,
  created_at: 1,
  updated_at: 2,
  source_url: "https://tecnova.com.ar/",
  brand: null,
  wa_publish: 1,
};

/** D1 de mentira: cuenta cuántas veces se leyó el catálogo (lo que hay que evitar). */
function makeDb(productos: Record<string, unknown>[]): { db: D1Database; lecturas: () => number } {
  let lecturas = 0;
  const prepare = (sql: string) => ({
    all: async () => {
      if (/FROM categories/i.test(sql)) return { results: [] };
      lecturas++;
      return { results: productos };
    },
    first: async () => null,
    run: async () => ({ success: true, meta: { changes: 1 } }),
    bind: () => prepare(sql),
  });
  return { db: { prepare } as unknown as D1Database, lecturas: () => lecturas };
}

/** KV de mentira con el tipo "json" como el real (sin él, el caché no se leería nunca). */
function makeKv(entradas: Record<string, string> = {}): KVNamespace & { _map: Map<string, string> } {
  const map = new Map(Object.entries(entradas));
  const kv = {
    get: async (k: string, tipo?: string): Promise<unknown> => {
      const v = map.get(k) ?? null;
      if (v === null) return null;
      return tipo === "json" ? (JSON.parse(v) as unknown) : v;
    },
    put: async (k: string, v: string): Promise<void> => {
      map.set(k, v);
    },
    delete: async (k: string): Promise<void> => {
      map.delete(k);
    },
    _map: map,
  };
  return kv as unknown as KVNamespace & { _map: Map<string, string> };
}

function makeEnv(productos: Record<string, unknown>[]): {
  env: Env;
  kv: KVNamespace & { _map: Map<string, string> };
  lecturas: () => number;
} {
  const kv = makeKv({ [KV_SETTINGS_KEY]: JSON.stringify({ whatsappFeedToken: TOKEN, storeName: "Center Phone" }) });
  const m = makeDb(productos);
  return { env: { KV: kv, DB: m.db, CF_SITE_ORIGIN: "https://centerphone.com.ar" } as unknown as Env, kv, lecturas: m.lecturas };
}

describe("feed de WhatsApp servido desde KV", () => {
  it("la primera descarga lee D1 y deja la copia; la segunda sale de KV", async () => {
    const { env, kv, lecturas } = makeEnv([FILA]);

    const primera = await waFeedApp.request(FEED_URL, {}, env);
    expect(primera.status).toBe(200);
    expect(primera.headers.get("X-Wa-Feed-Cache")).toBe("d1");
    expect(primera.headers.get("Content-Type")).toContain("text/csv");
    expect(await primera.text()).toContain("/producto/5469");
    expect(lecturas()).toBe(1);
    expect(kv._map.has(WA_FEED_CACHE_KEY)).toBe(true);

    // La copia guarda el CSV ya armado: la segunda descarga no vuelve a leer D1.
    const segunda = await waFeedApp.request(FEED_URL, {}, env);
    expect(segunda.status).toBe(200);
    expect(segunda.headers.get("X-Wa-Feed-Cache")).toBe("kv");
    expect(await segunda.text()).toContain("/producto/5469");
    expect(lecturas()).toBe(1);
  });

  it("cualquier escritura del catálogo tira la copia (markCatalogPending)", async () => {
    const { env, kv, lecturas } = makeEnv([FILA]);
    await waFeedApp.request(FEED_URL, {}, env);
    expect(kv._map.has(WA_FEED_CACHE_KEY)).toBe(true);

    await markCatalogPending(env);
    expect(kv._map.has(WA_FEED_CACHE_KEY)).toBe(false);

    const despues = await waFeedApp.request(FEED_URL, {}, env);
    expect(despues.headers.get("X-Wa-Feed-Cache")).toBe("d1");
    expect(lecturas()).toBe(2);
  });

  it("invalidateWaFeedCache también la tira (lo que usan las acciones de WhatsApp)", async () => {
    const { env, kv } = makeEnv([FILA]);
    await waFeedApp.request(FEED_URL, {}, env);
    await invalidateWaFeedCache(env);
    expect(kv._map.has(WA_FEED_CACHE_KEY)).toBe(false);
  });

  it("una copia ilegible se trata como fallo de caché, no como error de la descarga", async () => {
    const { env, kv } = makeEnv([FILA]);
    kv._map.set(WA_FEED_CACHE_KEY, "{no es json}");
    const res = await waFeedApp.request(FEED_URL, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Wa-Feed-Cache")).toBe("d1");
  });

  it("el feed vacío responde 500 y no se cachea (el guard anti-borrado sigue mandando)", async () => {
    const { env, kv, lecturas } = makeEnv([]);
    const res = await waFeedApp.request(FEED_URL, {}, env);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("No hay productos marcados");
    expect(kv._map.has(WA_FEED_CACHE_KEY)).toBe(false);

    // Tampoco se cachea el 500: la descarga siguiente vuelve a intentar contra D1.
    await waFeedApp.request(FEED_URL, {}, env);
    expect(lecturas()).toBe(2);
  });

  it("sin token o con token inválido ni se lee D1 ni la copia", async () => {
    const { env, lecturas } = makeEnv([FILA]);
    expect((await waFeedApp.request("/api/whatsapp/feed.csv", {}, env)).status).toBe(404);
    expect((await waFeedApp.request("/api/whatsapp/feed.csv?t=otro", {}, env)).status).toBe(404);
    expect(lecturas()).toBe(0);
  });
});
