// URL pública del feed del catálogo de WhatsApp (la que descarga Meta).
//
// El catálogo de WhatsApp no se llena desde el panel: Meta descarga solo (cada
// hora o cada día, según cómo se configure la fuente en Commerce Manager) un
// archivo desde una URL. Este endpoint es esa URL: devuelve el CSV de los
// productos que el panel marcó como "publicar en WhatsApp" (ver
// src/shared/wa-feed.ts, que arma el archivo).
//
// El token viaja en la query (?t=): Meta no permite cabeceras propias en la
// descarga, así que la URL es el único lugar donde se puede autenticar. Se genera
// y se rota desde el panel (Ajustes → Catálogo de WhatsApp) y vive en KV con los
// ajustes de la tienda.
//
// El CSV se sirve desde una copia en KV: así la descarga no lee el catálogo
// entero en D1 cada vez ni multiplica la factura de filas si la URL se filtra y
// alguien la golpea. La copia se tira en cada cambio del catálogo (ver
// invalidateWaFeedCache), así que el TTL es solo el techo de cuánto puede quedar
// vieja, no la única garantía de frescura.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./db";
import { listCategories, listWhatsAppFeedProducts } from "./db";
import { getSettings } from "./settings";
import { timingSafeEqualStr } from "./auth";
import { buildWaFeed } from "../shared/wa-feed";

export const waFeedApp = new Hono<{ Bindings: Env }>();

/** Copia del CSV en KV (una por sitio: el worker es de un solo comercio). */
export const WA_FEED_CACHE_KEY = "wa:feed:cache:v1";

/**
 * Vencimiento corto de la copia. Es el techo de frescura si alguna escritura no
 * llegara a invalidarla; los cambios del panel se ven igual al instante.
 */
export const WA_FEED_CACHE_TTL_SECONDS = 300;

/**
 * Tira la copia del feed. Se llama desde cada cambio que puede alterar el archivo:
 * las marcas de WhatsApp (POST /products/whatsapp y /products/whatsapp/scope) y
 * cualquier escritura del catálogo (markCatalogPending, que es el hook que ya usan
 * el panel, la sincronización y las auto-importaciones). Son 1-2 escrituras de KV
 * por cambio, nunca por request: eso es lo que mantiene el caché dentro del plan
 * gratis.
 */
export async function invalidateWaFeedCache(env: Env): Promise<void> {
  try {
    await env.KV.delete(WA_FEED_CACHE_KEY);
  } catch (e) {
    // Best-effort a propósito: acá ya se guardó un cambio de verdad (o se sincronizó) y
    // no puede fallar la operación entera porque el caché no responda. La copia vence
    // sola en WA_FEED_CACHE_TTL_SECONDS, así que lo peor es un feed de unos minutos de
    // antigüedad, y el error queda en Workers Logs.
    console.error("invalidateWaFeedCache falló:", e);
  }
}

/** Encabezados comunes del CSV (y de dónde salió, para poder verificarlo desde afuera). */
function responderCsv(c: Context<{ Bindings: Env }>, csv: string, desde: "kv" | "d1"): Response {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  c.header("X-Wa-Feed-Cache", desde);
  return c.body(csv);
}

waFeedApp.get("/api/whatsapp/feed.csv", async (c) => {
  const settings = await getSettings(c.env.KV);
  const esperado = settings.whatsappFeedToken ?? "";
  const token = c.req.query("t") ?? "";
  // Sin token configurado el feed no existe: ni siquiera se confirma que la URL
  // sea la correcta (404 igual que cualquier ruta inexistente).
  if (esperado === "" || token === "" || !timingSafeEqualStr(token, esperado)) {
    return c.json({ error: "No encontrado" }, 404);
  }

  // Copia en KV: si está, la descarga no toca D1. Un JSON ilegible se trata como
  // fallo de caché (se rearma), no como error de la descarga.
  const cacheado = await c.env.KV.get<{ csv?: string; included?: number }>(WA_FEED_CACHE_KEY, "json").catch(() => null);
  if (cacheado && typeof cacheado.csv === "string" && cacheado.csv !== "") {
    console.log(`wa-feed: servido desde KV (${cacheado.included ?? "?"} producto(s), sin leer D1)`);
    return responderCsv(c, cacheado.csv, "kv");
  }

  const [products, categories] = await Promise.all([
    listWhatsAppFeedProducts(c.env.DB),
    listCategories(c.env.DB),
  ]);

  // Guarda anti-borrado: con la fuente configurada como "reemplazo completo", un
  // archivo con cero productos VACÍA el catálogo de WhatsApp. Es preferible que la
  // descarga falle (Meta la marca con error y deja el catálogo como estaba) a que
  // se publique un feed vacío. Justamente por eso este caso NO se cachea.
  if (products.length === 0) {
    console.warn("wa-feed: no hay productos marcados para WhatsApp; se rechaza la descarga para no vaciar el catálogo");
    c.header("Cache-Control", "no-store");
    return c.text("No hay productos marcados para el catálogo de WhatsApp", 500);
  }

  const origin = (c.env.CF_SITE_ORIGIN ?? "").replace(/\/+$/, "") || new URL(c.req.url).origin;
  const { csv, included, skipped } = buildWaFeed(products, {
    origin,
    storeName: settings.storeName ?? "",
    categoryNames: new Map(categories.map((cat) => [cat.id, cat.name])),
  });
  // Queda en Workers Logs: cuántos productos salieron y cuáles se saltearon (y por qué).
  if (skipped.length > 0) {
    console.warn(
      `wa-feed: ${skipped.length} producto(s) quedaron fuera del feed: ${skipped
        .map((s) => `${s.id} (${s.reason})`)
        .join("; ")}`
    );
  }
  console.log(`wa-feed: ${included} producto(s) publicados para el catálogo de WhatsApp`);

  // Solo se cachea un feed válido: el guard de arriba ya descartó el vacío. Si la
  // escritura falla, el CSV se devuelve igual (la descarga de Meta no puede fallar por
  // el caché) y queda el registro en Workers Logs.
  try {
    await c.env.KV.put(WA_FEED_CACHE_KEY, JSON.stringify({ csv, included }), {
      expirationTtl: WA_FEED_CACHE_TTL_SECONDS,
    });
  } catch (e) {
    console.error("wa-feed: no se pudo guardar la copia en KV:", e);
  }
  return responderCsv(c, csv, "d1");
});
