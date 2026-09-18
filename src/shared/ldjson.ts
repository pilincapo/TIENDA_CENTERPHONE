// Extracción de JSON-LD (schema.org) desde HTML y mapeo a items de producto.
// Lo usa el importador cuando la URL devuelve una página HTML en vez de JSON.

type Dict = Record<string, unknown>;

/** Extrae y parsea los bloques <script type="application/ld+json"> del HTML. */
export function extractLdJsonBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as unknown);
    } catch {
      // Bloque malformado: se ignora sin romper el resto.
    }
  }
  return out;
}

/** Aplana estructuras @graph y arrays anidados recursivamente. */
function flattenLd(node: unknown, acc: Dict[] = []): Dict[] {
  if (Array.isArray(node)) {
    for (const n of node) flattenLd(n, acc);
  } else if (node && typeof node === "object") {
    const o = node as Dict;
    acc.push(o);
    if (o["@graph"]) flattenLd(o["@graph"], acc);
  }
  return acc;
}

/** Precio de un schema.org Offer (o lista de ofertas). */
function offerPrice(offers: unknown): number | null {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const offer = o as Dict;
    const raw = offer.price ?? offer.lowPrice ?? offer.highPrice;
    if (raw !== undefined && raw !== null && raw !== "") return Number(raw);
  }
  return null;
}

/** Disponibilidad desde offers ("https://schema.org/InStock" u otros). */
function availabilityFromOffer(offers: unknown): string {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const a = (o as Dict).availability;
    if (typeof a === "string") {
      if (a.toLowerCase().includes("outofstock")) return "out_of_stock";
      if (a.toLowerCase().includes("preorder")) return "preorder";
    }
  }
  return "in_stock";
}

/** Texto plano de un nombre schema.org (string o { name }). */
function nameOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "name" in (v as Dict)) {
    return String((v as Dict).name ?? "");
  }
  return "";
}

/** Imagen: string o array de strings. */
function imageOf(v: unknown): string {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === "string" ? first : "";
}

/**
 * Extrae ItemsList de CollectionPage/ItemList en JSON-LD de categorías:
 * devuelve las URLs de las fichas de producto (para fetching en detalle).
 */
export function productUrlsFromLdCategory(html: string): string[] {
  const urls: string[] = [];
  for (const node of flattenLd(extractLdJsonBlocks(html))) {
    const type = node["@type"];
    const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
    const isList = types.includes("CollectionPage") || types.includes("ItemList");
    if (!isList) continue;
    const mainEntity = node.mainEntity ?? node;
    const elements = (mainEntity as Dict).itemListElement;
    if (!Array.isArray(elements)) continue;
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      const o = el as Dict;
      const url = typeof o.url === "string" ? o.url : (o.item as Dict | undefined)?.url;
      if (typeof url === "string" && url !== "") urls.push(url);
    }
  }
  return [...new Set(urls)];
}

/**
 * Convierte bloques JSON-LD en items crudos compatibles con el normalizador
 * del importador (claves title/price/category/tags/image_url/...).
 */
export function itemsFromLdJson(html: string): unknown[] {
  const items: unknown[] = [];
  for (const node of flattenLd(extractLdJsonBlocks(html))) {
    const type = node["@type"];
    const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
    if (!types.includes("Product")) continue;
    const title = nameOf(node.name).trim();
    if (title === "") continue;
    items.push({
      title,
      description: nameOf(node.description).slice(0, 2000),
      price: offerPrice(node.offers),
      image_url: imageOf(node.image),
      category: nameOf(node.category),
      sku: typeof node.sku === "string" ? node.sku : undefined,
      tags: [],
      availability: availabilityFromOffer(node.offers),
    });
  }
  return items;
}
