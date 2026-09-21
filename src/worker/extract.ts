// Extracción de productos desde una URL: JSON directo, HTML con JSON-LD
// embebido, o catálogo de tienda Shopify (/products.json).

import { extractItems, normalizeExternalItems } from "../shared/normalize";
import { itemsFromLdJson, productUrlsFromLdCategory } from "../shared/ldjson";
import { itemsFromTiendaNegocio } from "../shared/tiendanegocio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export interface ExtractResult {
  items: unknown[];
  source: "json" | "ldjson" | "ldjson-detail" | "tiendanegocio" | "shopify";
  errors: string[];
}

/** Límite de fichas a descargar cuando la categoría solo da URLs. */
const MAX_DETAIL_FETCH = 40;

/**
 * Estrategia "categoría": la lista JSON-LD da URLs de fichas sin precio;
 * se descarga cada ficha y se extrae su Product completo (con precio).
 */
async function itemsFromCategoryDetail(
  categoryHtml: string
): Promise<unknown[]> {
  const urls = productUrlsFromLdCategory(categoryHtml).slice(0, MAX_DETAIL_FETCH);
  if (urls.length === 0) return [];
  const results = await Promise.allSettled(
    urls.map(async (u): Promise<Record<string, unknown> | null> => {
      const html = await fetchText(u);
      const items = itemsFromLdJson(html);
      return (items[0] as Record<string, unknown>) ?? null; // una ficha = un producto
    })
  );
  return results.flatMap((r) => (r.status === "fulfilled" && r.value !== null ? [r.value] : []));
}

function fetchHeaders(): Record<string, string> {
  return { "User-Agent": UA, Accept: "application/json,text/html;q=0.9,*/*;q=0.8" };
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 500).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

async function fetchText(url: string): Promise<string> {
  // Reintentos automáticos ante errores temporales del sitio de origen: 522/524
  // (Cloudflare del origen saturado), 429 (rate limit) y otros 5xx. En la práctica
  // hacetupedido.com a veces da 522 y a los pocos segundos responde bien, lo que
  // dejaba fuentes enteras (mascotas, hogar) sin sincronizar. 3 intentos con
  // espera creciente; el último error es el que se reporta.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, attempt * 1500)); // 3s y 4.5s
    let res: Response;
    try {
      res = await fetch(url, { headers: fetchHeaders(), redirect: "follow" });
    } catch (e) {
      // Fallo de red/DNS: el runtime puede dar mensajes opacos (ej: "internal error;
      // reference = ..."). Traducimos a una causa clara para el historial.
      // Un fallo de red también se reintenta: puede ser un timeout puntual.
      lastError = new Error(`No se pudo conectar con el dominio (verificá la URL, el DNS o que el sitio esté online) — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      if (text.trim() === "") {
        lastError = new Error("La URL devolvió una respuesta vacía");
        continue;
      }
      return text;
    }
    const err = new Error(`La URL respondió con estado ${res.status}`);
    // 4xx (salvo 429) son permanentes (404, 403…): no tiene sentido reintentar.
    if (res.status < 500 && res.status !== 429) throw err;
    lastError = err;
  }
  throw lastError ?? new Error("No se pudo descargar la URL");
}

/** Tiendas Shopify: /products.json expone el catálogo completo paginado. */
async function shopifyItems(baseUrl: string): Promise<unknown[]> {
  const u = new URL(baseUrl);
  const endpoint = `${u.origin}/products.json?limit=250`;
  const text = await fetchText(endpoint);
  const data = JSON.parse(text) as { products?: unknown[] };
  const products = Array.isArray(data.products) ? data.products : [];
  return products.map((p) => {
    const o = p as Record<string, unknown>;
    const variants = Array.isArray(o.variants) ? o.variants : [];
    const v0 = variants[0] as Record<string, unknown> | undefined;
    const images = Array.isArray(o.images) ? (o.images as Record<string, unknown>[]) : [];
    const img0 = images[0]?.src;
    const title = String(o.title ?? "");
    const vendor = o.vendor ? String(o.vendor) : "";
    const productType = o.product_type ? String(o.product_type) : "";
    const tags = Array.isArray(o.tags) ? o.tags.map(String) : String(o.tags ?? "").split(",");
    return {
      id: o.handle ? String(o.handle) : undefined,
      title,
      description: String(o.body_html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000),
      price: v0?.price !== undefined ? Number(v0.price) : undefined,
      category: productType || vendor,
      subcategory: productType && vendor ? vendor : undefined,
      image_url: typeof img0 === "string" ? img0 : undefined,
      tags: tags.map((t) => t.trim()).filter((t) => t !== "").slice(0, 6),
      availability: o.published_at ? "in_stock" : "out_of_stock",
    };
  });
}

/**
 * Descarga la URL y extrae items de producto probando estrategias en orden:
 * 1. JSON directo (array o {products|items|data|results}).
 * 2. Estado embebido TiendaNegocio (script id="1-state": productos + categoría).
 * 3. JSON-LD schema.org embebido en HTML (ficha o categoría con fetch de fichas).
 * 4. Shopify /products.json.
 */
export async function extractFromUrl(url: string): Promise<ExtractResult> {
  const errors: string[] = [];

  // 1. Descarga y prueba JSON directo.
  let text: string;
  try {
    text = await fetchText(url);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "No se pudo descargar la URL");
  }

  if (!looksLikeHtml(text)) {
    try {
      const items = extractItems(JSON.parse(text));
      if (items.length > 0) return { items, source: "json", errors };
      errors.push("El JSON no contenía productos");
    } catch {
      errors.push("La respuesta no es JSON válido");
    }
  }

  // 2. Estado embebido de tiendas TiendaNegocio (productos completos en un solo HTML).
  const tn = itemsFromTiendaNegocio(text);
  if (tn.items.length > 0) {
    return { items: tn.items, source: "tiendanegocio", errors };
  }

  // 3. JSON-LD embebido en HTML.
  const ldItems = itemsFromLdJson(text);
  if (ldItems.length > 0) {
    return { items: ldItems, source: "ldjson", errors };
  }

  // 3b. Categoría JSON-LD que lista URLs de fichas: bajar cada ficha.
  if (looksLikeHtml(text)) {
    try {
      const detailItems = await itemsFromCategoryDetail(text);
      if (detailItems.length > 0) {
        return { items: detailItems, source: "ldjson-detail", errors };
      }
      errors.push("El HTML era una categoría sin fichas extraíbles");
    } catch (e) {
      errors.push(`Falló la descarga de las fichas de la categoría: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. Fallback Shopify.
  try {
    const items = await shopifyItems(url);
    if (items.length > 0) return { items, source: "shopify", errors };
    errors.push("Shopify no devolvió productos");
  } catch (e) {
    errors.push(`No parece una tienda Shopify accesible: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { items: [], source: "json", errors };
}

/** Normaliza items crudos a productos internos (reusa el mapeador del import). */
export function normalizeExtracted(items: unknown[]) {
  return normalizeExternalItems(items);
}
