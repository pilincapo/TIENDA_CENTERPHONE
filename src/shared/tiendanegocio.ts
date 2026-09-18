// Parser del estado embebido de tiendas TiendaNegocio (script id="1-state").
// Ese estado trae los productos de la categoría con precio, stock e imagen,
// más la categoría actual — todo en un solo HTML, sin fichas individuales.

type Dict = Record<string, unknown>;

/** Decodifica el escaping especial del estado: &q; " &s; ' &a; &. */
export function decodeTiendaNegocioState(raw: string): string {
  return raw.replace(/&q;/g, '"').replace(/&s;/g, "'").replace(/&a;/g, "&");
}

/** Extrae y parsea el script id="1-state" de un HTML de TiendaNegocio. */
export function parseTiendaNegocioState(html: string): Dict | null {
  const m = /<script[^>]*id="1-state"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(
    html
  );
  if (!m) return null;
  try {
    const data = JSON.parse(decodeTiendaNegocioState(m[1] ?? "")) as unknown;
    return data && typeof data === "object" ? (data as Dict) : null;
  } catch {
    return null;
  }
}

function asStr(v: unknown, max = 2000): string {
  if (v === undefined || v === null) return "";
  return String(v).trim().slice(0, max);
}

/**
 * Convierte el estado TiendaNegocio en items crudos del importador.
 * - price: ya viene en unidades (2400 = $2.400); promo (oferta) si existe.
 * - stock: 0 → out_of_stock.
 * - category: título de la categoría de la página visitada.
 */
export function itemsFromTiendaNegocio(html: string): { items: unknown[]; category: string | null } {
  const state = parseTiendaNegocioState(html);
  if (!state) return { items: [], category: null };
  const pcs = state["products-categories-search"] as Dict | undefined;
  if (!pcs || typeof pcs !== "object") return { items: [], category: null };

  const cat = pcs.category as Dict | undefined;
  const category = asStr(cat?.title, 100) || null;

  const products = Array.isArray(pcs.products) ? pcs.products : [];
  type RawItem = Record<string, unknown>;
  const items: RawItem[] = [];
  for (const p of products) {
    if (!p || typeof p !== "object") continue;
    const o = p as Dict;
    const title = asStr(o.title, 200);
    if (title === "") continue;
    const promo = Number(o.promo);
    const base = Number(o.price);
    const price = Number.isFinite(promo) && promo > 0 ? promo : base;
    const stock = o.variant_stock ?? o.stock;
    items.push({
      id: asStr(o.hash ?? o.sku, 80) || undefined,
      title,
      description: asStr(o.seo_description, 2000),
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      category: category ?? undefined,
      image_url: asStr(o.thumbnail, 500) || undefined,
      tags: o.promo ? ["oferta"] : [],
      availability:
        Number(stock ?? 0) > 0 || stockAvailable(o) ? "in_stock" : "out_of_stock",
    });
  }
  return { items, category };
}

/** stockAvailable (bool) como fallback cuando stock numérico no viene. */
function stockAvailable(o: Dict): boolean {
  return o.stockAvailable === true;
}
