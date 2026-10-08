// Importador de productos de Tecnova (tecnova.com.ar).
// La fuente es la API REST de Supabase que ya alimenta su web pública
// (solo lectura, la clave "anon" es la misma que expone su frontend).
// El panel admin la usa vía /api/admin/import/tecnova/preview y /import/tecnova.
//
// Reglas acordadas:
//  - Se importan TODAS las categorías del proveedor, pero el admin elige
//    a qué categoría raíz del catálogo propio mapea cada una (y viceversa).
//  - Sin marca de proveedor: nunca se menciona "Tecnova" en el catálogo
//    (sourceUrl genérico "tecnova-catalogo" NO se usa; se usa la URL de la API
//    como source_url técnica para el ocultado automático, como cualquier otra fuente).
//  - Precio base = minorista; la regla de recargo (40-30-20 u otra) se elige
//    en el panel al confirmar la importación (mismo flujo que el importador URL).

import type { Availability, Product, Tag } from "./types";
import { slugify } from "./parse";
import { detectBrand } from "./brands";
import { roundToPeso } from "./pricing";

/** Proyecta un valor desconocido con alta de diccionario plano. */
type Dict = Record<string, unknown>;

/** URL de la API pública de Tecnova (Supabase REST, solo lectura). */
export const TECNOVA_API_BASE = "https://jimqifdqqgthrwzjiyfr.supabase.co/rest/v1";
/** Clave anon pública de su frontend (solo lectura, mismo trato que cualquier source). */
export const TECNOVA_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppbXFpZmRxcWd0aHJ3emppeWZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NzU5MTYsImV4cCI6MjA4OTM1MTkxNn0.WV7RypsqnFaMff65IVcSaWDKC55qpNWxPznxJWtMtHs";

/** Etiqueta técnica de la fuente en `products.source_url` (para el ocultado automático). */
export const TECNOVA_SOURCE_URL = "https://tecnova.com.ar/";

/** Clave KV donde el panel guarda el mapping de categorías Tecnova → catálogo propio. */
export const TECNOVA_MAPPING_KEY = "tecnova:mapping:v1";

/** Tabla REST que expone los productos de Tecnova. */
const PRODUCTS_PATH = `${TECNOVA_API_BASE}/products?select=*`;

/** Límite de filas pedidas a PostgREST por página. */
const PAGE_SIZE = 1000;

/**
 * Mapeo default por nombre de categoría de Tecnova → categoría raíz propia.
 * La copia de trabajo vive en el KV del panel (els defaults acá sirven de semilla
 * y se muestran pre-cargados en el preview).
 */
export const DEFAULT_TECNOVA_CATEGORY_MAP: Record<string, string> = {
  "CABLES Y ADAPTADORES": "electronica",
  "COMPONENTES Y ACCESORIOS DE PC": "computacion",
  "ELECTRÓNICA GENERAL": "electronica",
  "ELECTRONICA GENERAL": "electronica",
  AUDIO: "electronica",
  "CELULARES Y ACCESORIOS": "electronica",
  VARIOS: "hogar",
  ILUMINACION: "electronica",
  "CARGADORES Y PILAS": "electronica",
  "JUGUETES Y REGALOS": "hogar",
  CONECTIVIDAD: "electronica",
  IMAGEN: "electronica",
  "TONER, TINTAS Y CARTUCHOS": "computacion",
  ALMACENAMIENTO: "computacion",
  GAMER: "computacion",
  BAZAR: "hogar",
  "PILAS Y ACCESORIOS": "electronica",
  LIBRERIA: "hogar",
};

/**
 * Elección del admin por categoría fuente: representa id de categoría raíz del
 * catálogo propio ("" = no importar esa categoría). Cada entrada guarda también
 * la subcategoría opcional dentro de la raíz.
 */
export interface TecnovaMapping {
  /** categoría Tecnova (nombre tal cual en su API) → id de raíz propia o "" si se salta */
  targets: Record<string, string>;
  /** subcategoría opcional que se pondrá como subcategoryId del producto */
  subs: Record<string, string>;
}

/** Etiqueta raíz de una fuente: cómo se llama al proveedor en el detalle del historial. */
export const TECNOVA_SOURCE_LABEL = "migración Tecnova";

/** Normaliza el nombre de categoría de Tecnova para usar como clave de mapeo. */
export function tecnovaCatKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // sin acentos
    .trim()
    .toUpperCase();
}

/** Escala "40/30/20" y variantes: no es fija del worker, es una regla o grupo del panel. */
export const EXAMPLE_PRICE_RULE = "40-30-20";

/**
 * Trae el catálogo completo de Tecnova (todas las páginas).
 * Devuelve items crudos tal como vienen, listos para normalizeTecnovaItems.
 */
export async function fetchTecnovaItems(): Promise<{ items: Dict[]; errors: string[] }> {
  const items: Dict[] = [];
  const errors: string[] = [];
  let from = 0;
  for (;;) {
    const url = `${PRODUCTS_PATH}&limit=${PAGE_SIZE}&offset=${from}&order=id.asc`;
    const res = await fetch(url, {
      headers: { apikey: TECNOVA_ANON_KEY, Authorization: `Bearer ${TECNOVA_ANON_KEY}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      errors.push(`La API de Tecnova respondió con estado ${res.status} (página ${from})`);
      break;
    }
    const page = (await res.json()) as unknown[];
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...(page as Dict[]));
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { items, errors };
}

/**
 * Normaliza items crudos de Tecnova al formato interno (mismo shape que
 * consume normalizeExternalItems). Los "Tecnova" names van como nombre
 * de categoría en `category`, dejando que el caller ajuste el mapping.
 */
export function tecnovaItemsToInternal(
  raw: Dict[],
  mapping: TecnovaMapping
): {
  items: Record<string, unknown>[];
  catName: Record<string, string>; // slug técnico de cat fuente → nombre traducido completo
  skipped: string[];
} {
  const items: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  const catName: Record<string, string> = {};
  const seenSubs = new Set<string>();
  raw.forEach((o, i) => {
    const t = String(o.title ?? "").trim();
    if (t === "") {
      skipped.push(`Item ${i}: falta title`);
      return;
    }
    const centsRaw = o.price;
    const price = typeof centsRaw === "number" && Number.isFinite(centsRaw) && centsRaw >= 0
      ? roundToPeso(Math.round(centsRaw * 100))
      : null;
    if (price === null || price <= 0) {
      skipped.push(`"${t}": precio inválido, se salta`);
      return;
    }
    const cats = Array.isArray(o.categories) ? (o.categories as unknown[]).map(String) : [];
    const catFuente = cats[0] ?? "";
    const key = tecnovaCatKey(catFuente);
    // El mapping explícito manda ("" = saltar la categoría), incluso contra el default.
    const mapped = mapping.targets[key];
    const rootId = mapped !== undefined ? mapped : (DEFAULT_TECNOVA_CATEGORY_MAP[key] ?? "");
    if (rootId === "") {
      skipped.push(`"${t}": categoría "${catFuente}" no mapeada a una categoría propia`);
      return;
    }
    const subId = mapping.subs[key] ?? "";
    const subName = subId !== "" ? tecnicaPrettySub(subId) : "";
    // El nombre traducido de la categoría raíz se fija más abajo en el worker
    // (necesita listCategories). Acá se deja como slug técnico en `category`;
    // el worker lo reemplaza con el nombre real del catálogo.
    const internal: Record<string, unknown> = {
      id: slugify(`tecnova-${o.id ?? t}`).slice(0, 80),
      title: t.slice(0, 200),
      description:
        String(o.description ?? "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000) || t.slice(0, 160),
      price_cents: price,
      // La categoría técnica va por el id de raíz propio: el frontend y el panel
      // leen categoryId, no el número de Tecnova.
      categoryId: rootId,
      subcategoryId: subId !== "" ? subId : undefined,
      tags: parseTecnovaTags(o),
      image_url: String(o.image ?? "").slice(0, 500),
      availability: tecnovaAvailability(o, typeof o.stock === "number" ? o.stock : null),
      // El sort stable importa solo mientras la fuente viva, se usa el id.
      sort_order: i,
    };
    if (subId !== "" && !seenSubs.has(subId)) {
      seenSubs.add(subId);
    }
    items.push(internal);
    techKeyLabel(key, catFuente, subName, catName);
  });
  return { items, catName, skipped };
}

/**
 * Determina si un producto Tecnova está en stock (debe ser in_stock o out_of_stock).
 * Si stock > 0 y no es "sur pedido", está disponible.
 */
function tecnovaAvailability(o: Dict, stock: number | null): Availability {
  const s = stock ?? Number(o.stock ?? 0);
  if (Number.isFinite(s) && s > 0) return "in_stock";
  const lead = String(o.on_demand_lead_time ?? "").trim();
  return lead === "" ? "out_of_stock" : "preorder";
}

/** Extrae tags legibles de la fila de Tecnova (oferta / nuevo / destacado). */
function parseTecnovaTags(o: Dict): Tag[] {
  const out: Tag[] = [];
  if (o.is_offer === true) out.push("offer");
  if (o.is_new === true) out.push("new");
  if (o.is_featured === true) out.push("featured");
  return out.filter((t): t is Tag => t === "new" || t === "featured" || t === "offer");
}

/** "audio-video" → "Audio video" (para mostrar en el detalle del preview). */
function tecnicaPrettySub(subId: string): string {
  const t = subId.replace(/[-_]+/g, " ").trim();
  return t === "" ? subId : t.charAt(0).toUpperCase() + t.slice(1);
}

/** Guarda en catName la etiqueta de la categoría fuente para juegos de mapeo. */
function techKeyLabel(
  key: string,
  catFuente: string,
  subName: string,
  catName: Record<string, string>
): void {
  const label = catFuente !== "" ? catFuente : key;
  if (!catName[key]) catName[key] = label === "" ? label : label;
}
