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

/**
 * Límite de fichas a descargar cuando la categoría solo da URLs.
 *
 * No es un número arbitrario: el plan gratis da **50 subrequests por
 * invocación** y esta ruta ya gastó la de la categoría. Con 20 fichas de un
 * solo intento el peor caso es 1 + 20 = **21 subrequests**, con margen para el
 * resto de la importación (upsert por chunks, snapshot). Antes eran 40 fichas ×
 * 3 reintentos = hasta **120**: la invocación entera fallaba y se perdía la
 * importación completa.
 *
 * 20 (y no 10) porque una categoría real ronda las 19-25 fichas: con 10 se
 * perdía la mitad del listado sin que nadie se enterara.
 */
const MAX_DETAIL_FETCH = 20;

/**
 * Fichas en paralelo. El tope que importa es el de subrequests (no el de
 * concurrencia), así que esto se calibró midiendo con una categoría real (19
 * fichas): de a 3 trajo 17 de 19; de a 6 el sitio empezó a cortar requests y
 * quedaron 2. Un sitio puede limitar por IP si se repite la corrida seguida, así
 * que la cobertura depende de la fuente; una ficha caída no descarta a las demás.
 */
const DETAIL_CONCURRENCY = 3;

/** Timeout por ficha: una ficha colgada no puede comerse el request entero. */
const DETAIL_TIMEOUT_MS = 10_000;

// ---- Destinos permitidos para las fichas de una categoría ----
// Las URLs salen del JSON-LD de un HTML de TERCEROS (`productUrlsFromLdCategory`)
// y se pedían tal cual: una fuente comprometida podía hacer que el worker
// pidiera loopback (`127.0.0.1:8787`), redes privadas o link-local (SSRF
// acotado), y sumar subrequests a voluntad.

/** Rangos IPv4 que nunca son un sitio público (loopback, privadas, link-local, CGNAT). */
function ipv4Bloqueada(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** IPv6 de loopback, unspecified, link-local, unique-local (fc00::/7) o IPv4 mapeada. */
function ipv6Bloqueada(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  // Solo direcciones IPv6 (con `:`): si no, un dominio que empieza con "fc"
  // (ej. fcelulares.com) se tomaría como fc00::/7.
  if (!h.includes(":")) return false;
  return (
    h === "::1" ||
    h === "::" ||
    h.startsWith("fe80:") ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("::ffff:")
  );
}

/** Nombres de host que apuntan a la propia máquina o a la red interna. */
function hostInterno(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.startsWith("localhost.") ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".localdomain") ||
    h.endsWith(".internal") ||
    h.endsWith(".home.arpa")
  );
}

/**
 * ¿Se puede pedir esta URL desde el importador "categoría"? Solo http(s)
 * absolutas a hosts públicos. `new URL` normaliza las formas raras de IPv4
 * (decimal/hexadecimal) a cuadrado con puntos, así que alcanza con mirar el
 * hostname ya parseado.
 */
export function urlExternaPermitida(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (host === "") return false;
  return !hostInterno(host) && !ipv4Bloqueada(host) && !ipv6Bloqueada(host);
}

/**
 * Una sola descarga, sin reintentos, para las fichas de una categoría: acá el
 * presupuesto de subrequests manda (ver MAX_DETAIL_FETCH).
 */
async function fetchFicha(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: fetchHeaders(),
    redirect: "follow",
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
  });
  // Un redirect puede aterrizar en loopback/red privada aunque la URL original
  // fuera pública: si el destino FINAL no es público, el contenido no se lee ni
  // se guarda en el catálogo.
  if (res.url !== "" && !urlExternaPermitida(res.url)) {
    throw new Error("La ficha redirige a un host no permitido");
  }
  if (!res.ok) throw new Error(`La ficha respondió con estado ${res.status}`);
  return await readBodyCapped(res);
}

/**
 * Estrategia "categoría": la lista JSON-LD da URLs de fichas sin precio;
 * se descarga cada ficha y se extrae su Product completo (con precio).
 * En lotes de DETAIL_CONCURRENCY: una ficha caída no descarta las demás ni
 * multiplica los subrequests (una descarga por ficha, sin reintentos).
 */
async function itemsFromCategoryDetail(
  categoryHtml: string
): Promise<unknown[]> {
  const urls = productUrlsFromLdCategory(categoryHtml)
    .filter(urlExternaPermitida)
    .slice(0, MAX_DETAIL_FETCH);
  const out: unknown[] = [];
  for (let i = 0; i < urls.length; i += DETAIL_CONCURRENCY) {
    const lote = urls.slice(i, i + DETAIL_CONCURRENCY);
    const respuestas = await Promise.allSettled(lote.map((u) => fetchFicha(u)));
    for (const r of respuestas) {
      // Ficha caída o no permitida: se sigue con la próxima.
      if (r.status !== "fulfilled") continue;
      const item = itemsFromLdJson(r.value)[0] as Record<string, unknown> | undefined;
      if (item) out.push(item); // una ficha = un producto
    }
  }
  return out;
}

function fetchHeaders(): Record<string, string> {
  return { "User-Agent": UA, Accept: "application/json,text/html;q=0.9,*/*;q=0.8" };
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 500).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

// Límite de descarga por respuesta: una fuente gigante (o maliciosa) no puede
// reventar la memoria del isolate del free tier. Los JSON de catálogo reales
// quedan muy por debajo (Shopify 250 items ≈ 1-2MB).
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024; // 8MB

/** Lee el body con tope de tamaño; error claro si la respuesta lo supera. */
export async function readBodyCapped(res: Response, maxBytes = MAX_DOWNLOAD_BYTES): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > maxBytes) {
    throw new Error(`La respuesta pesa más de ${Math.round(maxBytes / 1024 / 1024)}MB — no se descarga`);
  }
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`La respuesta supera el límite de ${Math.round(maxBytes / 1024 / 1024)}MB — descarga abortada`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
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
      // Timeout de 20s por intento: una fuente colgada no puede consumir el
      // presupuesto de CPU del plan gratis y matar toda la invocación del cron
      // (eso perdía las filas del historial de las fuentes ya procesadas).
      res = await fetch(url, { headers: fetchHeaders(), redirect: "follow", signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      // Timeout: la fuente existe pero tardó más de 20s en responder.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        lastError = new Error("La fuente no respondió en 20 segundos (timeout) — se reintenta");
        continue;
      }
      // Fallo de red/DNS: el runtime puede dar mensajes opacos (ej: "internal error;
      // reference = ..."). Traducimos a una causa clara para el historial.
      // Un fallo de red también se reintenta: puede ser un timeout puntual.
      lastError = new Error(`No se pudo conectar con el dominio (verificá la URL, el DNS o que el sitio esté online) — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (res.ok) {
      const text = await readBodyCapped(res);
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
