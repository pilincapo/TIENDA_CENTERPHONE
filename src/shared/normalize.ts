// Mapea items de una fuente externa (JSON) al formato interno.

import type { Product } from "./types";
import { parseAvailability, parsePriceCents, parseTags, slugify, tituloSlug, unicoSlug } from "./parse";
import { roundToPeso } from "./pricing";
import { detectBrand } from "./brands";

type Dict = Record<string, unknown>;

function pick(obj: Dict, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown, max = 300): string {
  if (v === undefined || v === null) return "";
  return String(v).trim().slice(0, max);
}

/** "ropa-de-mascotas" → "Ropa de mascotas" (para categorías que llegan como slug). */
function prettySlug(s: string): string {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t === "" ? s : t.charAt(0).toUpperCase() + t.slice(1);
}

export interface NormalizeOutcome {
  /** Items salteados con motivo ("Encendedor X: precio inválido"). */
  skipped: string[];
  products: Product[];
  categories: { id: string; name: string; parentId: string | null }[];
  errors: string[];
}

// Acepta { products: [...] } o [...] directamente.
export function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as Dict;
    for (const key of ["products", "items", "data", "results"]) {
      const v = o[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function normalizeExternalItems(rawItems: unknown[]): NormalizeOutcome {
  const products: Product[] = [];
  const categories: { id: string; name: string; parentId: string | null }[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];
  const seenCats = new Set<string>();
  // Slugs ya usados en esta corrida (anti-colisión entre títulos repetidos).
  const usados = new Set<string>();

  rawItems.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      skipped.push(`Item ${i}: no es un objeto`);
      return;
    }
    const o = item as Dict;
    const title = asString(pick(o, ["title", "name", "nombre"]), 200);
    if (title === "") {
      skipped.push(`Item ${i}: falta title/name`);
      return;
    }
    // price_cents/priceCents ya están en centavos (items internos o API propia):
    // se toman tal cual. price/precio se parsean como texto de usuario ("$1.299,99").
    const centsRaw = pick(o, ["price_cents", "priceCents"]);
    const parsedCents =
      centsRaw !== undefined && Number.isFinite(Number(centsRaw))
        ? Math.max(0, Math.round(Number(centsRaw)))
        : parsePriceCents(pick(o, ["price", "precio"]));
    if (parsedCents === null) {
      skipped.push(`"${title}": precio inválido, se salta el artículo`);
      return;
    }
    // Los precios de la tienda son siempre pesos enteros: sin centavos.
    const priceCents = roundToPeso(parsedCents);

    let categoryId: string | null = null;
    const catRaw = asString(pick(o, ["category", "categoria", "category_name"]), 100);
    const catIdRaw = asString(o.categoryId, 100);
    if (catRaw !== "") {
      categoryId = slugify(catRaw);
      if (!seenCats.has(categoryId)) {
        seenCats.add(categoryId);
        categories.push({ id: categoryId, name: catRaw, parentId: null });
      }
    } else if (catIdRaw !== "") {
      // Items ya normalizados (ej: selección confirmada desde el preview).
      categoryId = slugify(catIdRaw);
      if (!seenCats.has(categoryId)) {
        seenCats.add(categoryId);
        categories.push({ id: categoryId, name: prettySlug(catIdRaw), parentId: null });
      }
    }
    let subcategoryId: string | null = null;
    const subRaw = asString(pick(o, ["subcategory", "subcategoria"]), 100);
    const subIdRaw = asString(o.subcategoryId, 100);
    if (subRaw !== "") {
      subcategoryId = slugify(subRaw);
      if (!seenCats.has(subcategoryId)) {
        seenCats.add(subcategoryId);
        categories.push({ id: subcategoryId, name: subRaw, parentId: categoryId });
      }
    } else if (subIdRaw !== "") {
      subcategoryId = slugify(subIdRaw);
      if (!seenCats.has(subcategoryId)) {
        seenCats.add(subcategoryId);
        categories.push({ id: subcategoryId, name: prettySlug(subIdRaw), parentId: categoryId });
      }
    }

    // Nombre de página: el slug del TÍTULO, no el id opaco del proveedor (hash
    // numérico tipo "6160" de TiendaNegocio dejaba URLs crípticas en las fichas,
    // en el sitemap y en el feed de WhatsApp). `idFuente` es el id anterior — el
    // que la fila tiene hoy en D1 — y viaja en `prevId` para que el worker
    // renombre la fila y la URL vieja haga 301.
    // Ítems ya normalizados (la selección confirmada del preview, o internos de
    // otra fuente como los de Tecnova) traen `prevId`: se respeta su id tal cual
    // se calculó en la pasada anterior (con el dedupe ya resuelto), no se vuelve
    // a deduplicar — el panel reenvía los mismos items al partirlos en lotes de 50.
    const idFuente = slugify(asString(pick(o, ["id", "sku", "slug"]), 80) || title).slice(0, 80);
    const prevIdRaw = typeof o.prevId === "string" ? o.prevId.trim() : "";
    let id: string;
    let prevId: string | null = null;
    if (prevIdRaw !== "") {
      id = idFuente; // id ya calculado en el preview
      usados.add(id);
      prevId = prevIdRaw === id ? null : prevIdRaw;
    } else {
      id = unicoSlug(tituloSlug(title) || idFuente, usados);
      prevId = id === idFuente ? null : idFuente;
    }
    // Marca: si la fuente la trae explícita se usa; si no, se detecta del título.
    const brandRaw = asString(pick(o, ["brand", "marca"]), 60);
    const brand = brandRaw !== "" ? brandRaw : detectBrand(title);
    products.push({
      id,
      prevId,
      title,
      description: asString(pick(o, ["description", "descripcion", "desc"]), 2000),
      priceCents,
      categoryId,
      subcategoryId,
      tags: parseTags(o.tags ?? o.etiquetas),
      imageUrl: asString(pick(o, ["image_url", "imageUrl", "image", "imagen", "img"]), 500),
      status: String(o.status ?? "published") === "hidden" ? "hidden" : "published",
      availability: parseAvailability(o.availability ?? o.stock),
      sortOrder: i,
      createdAt: 0, // el worker lo completa con el timestamp real al hacer upsert
      sourceUrl: null, // importItems lo completa con la URL de la importación
      brand: brand !== "" ? brand : null,
    });
  });

  return { products, categories, skipped, errors: [] };
}
