// Parsers básicos compartidos.

import type { Availability, Tag } from "./types";
import { TAGS } from "./types";
import { roundToPeso } from "./pricing";

export function slugify(text: string): string {
  const s = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "item" : s;
}

/** Largo máximo del id (que es también la URL /producto/{id}). */
export const SLUG_MAX = 80;

/**
 * "Nombre de página" de un producto: el slug del TÍTULO, no el id opaco del
 * proveedor (hash numérico tipo `6160`, o `tecnova-185`). Corta en límite de
 * palabra solo si el título supera el tope, y devuelve "" cuando el título no
 * deja nada utilizable: ahí el caller cae al id legado.
 */
export function tituloSlug(title: string): string {
  const limpio = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (limpio === "") return "";
  if (limpio.length <= SLUG_MAX) return limpio;
  const cortado = limpio.slice(0, SLUG_MAX);
  const corte = cortado.lastIndexOf("-");
  return (corte > 0 ? cortado.slice(0, corte) : cortado).replace(/-+$/, "");
}

/**
 * Resuelve colisiones dentro de la misma corrida: dos productos con el mismo
 * título quedan `...` y `...-2` (el tercero, `...-3`). El orden de la fuente es
 * estable entre corridas, así que el sufijo también lo es.
 */
export function unicoSlug(base: string, usados: Set<string>): string {
  if (!usados.has(base)) {
    usados.add(base);
    return base;
  }
  let n = 2;
  while (usados.has(`${base}-${n}`)) n += 1;
  const cand = `${base}-${n}`;
  usados.add(cand);
  return cand;
}

// Convierte 1234.5 | "1234.50" | "$1.234,56" | "1,234.56" a centavos.
// La tienda no usa decimales: el resultado siempre redondea al peso entero.
export function parsePriceCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return roundToPeso(Math.round(v * 100));
  }
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^0-9.,-]/g, "");
  if (cleaned === "") return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    // El último separador es el decimal.
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && /\.\d{3}$/.test(cleaned)) {
    // Solo puntos y terminando en 3 dígitos: miles al estilo AR ("10.500").
    normalized = cleaned.replace(/\./g, "");
  } else {
    normalized = cleaned;
  }
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return roundToPeso(Math.round(num * 100)); // la tienda no usa decimales
}

export function parseTags(v: unknown): Tag[] {
  const list: unknown[] = Array.isArray(v) ? v : String(v ?? "").split(",");
  const found = new Set<Tag>();
  for (const raw of list) {
    const s = String(raw).trim().toLowerCase();
    const t: Tag =
      s === "destacado" || s === "destacada"
        ? "featured"
        : s === "oferta"
          ? "offer"
          : s === "nuevo" || s === "nueva"
            ? "new"
            : (s as Tag);
    if (TAGS.includes(t)) found.add(t);
  }
  return TAGS.filter((t) => found.has(t));
}

export function parseAvailability(v: unknown): Availability {
  const s = String(v ?? "").trim().toLowerCase();
  if (["out", "out_of_stock", "sin stock", "agotado", "no", "0"].includes(s)) {
    return "out_of_stock";
  }
  if (["preorder", "bajo pedido", "reservado", "pedido"].includes(s)) {
    return "preorder";
  }
  return "in_stock";
}
