// Feed de productos para el catálogo de WhatsApp (Meta Commerce Manager).
//
// Cómo funciona el catálogo de WhatsApp: no se cargan productos de a uno desde
// ningún panel, y la app tampoco tiene una importación masiva. El catálogo de
// WhatsApp ES un catálogo de Meta (Commerce Manager) vinculado a la cuenta de
// WhatsApp, y Meta lo llena DESCARGANDO periódicamente un archivo de una URL
// pública (Commerce Manager → Catálogo → Fuentes de datos → Feed programado).
//
// Este módulo arma ese archivo: un CSV con los campos que Meta exige, de los
// productos que el panel marcó como "publicar en WhatsApp" (products.wa_publish).
// El endpoint que lo sirve es src/worker/wa-feed.ts.
//
// Es una función pura a propósito: el mapeo de campos (precio, disponibilidad,
// textos de respaldo y escapado del CSV) es la parte que se testea sin base de
// datos ni red.

import type { Availability, Product } from "./types";

/** Encabezado exacto del feed: Meta pide estos campos como obligatorios. */
export const WA_FEED_COLUMNS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "brand",
] as const;

/**
 * Moneda del feed: Meta pide el código ISO 4217, no el símbolo del panel
 * (`currencySymbol` es solo para mostrar precios en el sitio). El negocio es de
 * Argentina y el catálogo de Meta se configura por país, así que va fijo.
 */
export const WA_FEED_CURRENCY = "ARS";

/** Condición del ítem: el catálogo es de celulares y accesorios nuevos. */
export const WA_FEED_CONDITION = "new";

/** Límites de Meta para los campos de texto y para el id del ítem (retailer_id). */
export const WA_MAX_TITLE = 200;
export const WA_MAX_DESCRIPTION = 5000;
export const WA_MAX_ID = 100;

/** Meta acepta `availability` en inglés; el sitio lo guarda en español. */
export function waAvailability(a: Availability): string {
  if (a === "out_of_stock") return "out of stock";
  if (a === "preorder") return "preorder";
  return "in stock";
}

/** Precio para Meta: número con punto decimal + moneda ISO ("12500.00 ARS"). */
export function waPrice(priceCents: number): string {
  const pesos = Math.max(0, Math.round(Number(priceCents) || 0)) / 100;
  return `${pesos.toFixed(2)} ${WA_FEED_CURRENCY}`;
}

function normalizar(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** Texto terminado en punto (para armar oraciones al encadenar datos). */
function terminar(s: string): string {
  const t = normalizar(s);
  if (t === "") return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Descripción del ítem: Meta la exige, pero 995 de los 1365 productos del catálogo
 * no traen una (la fuente manda solo título y foto). Cuando falta se genera un
 * texto de respaldo con los datos que sí tenemos, porque un feed con la
 * descripción vacía se rechaza.
 */
export function waDescription(p: Product, storeName: string, categoryName = ""): string {
  const propia = normalizar(p.description);
  if (propia !== "") return propia.slice(0, WA_MAX_DESCRIPTION);
  const partes = [
    terminar(p.title),
    p.brand ? `Marca ${p.brand}.` : "",
    categoryName !== "" ? `Categoría: ${categoryName}.` : "",
    `Nuevo, disponible en ${storeName !== "" ? storeName : "la tienda"}.`,
    "Consultanos por WhatsApp por stock, colores, memoria y formas de pago.",
  ];
  return normalizar(partes.filter((x) => x !== "").join(" ")).slice(0, WA_MAX_DESCRIPTION);
}

/** Marca del ítem (campo obligatorio): la detectada al importar o el nombre de la tienda. */
export function waBrand(p: Product, storeName: string): string {
  const propia = normalizar(p.brand ?? "");
  if (propia !== "") return propia;
  const tienda = normalizar(storeName);
  return tienda !== "" ? tienda : "Genérico";
}

/** Celda de CSV (RFC 4180): entre comillas dobles si trae coma, comilla o salto. */
function csvCell(v: string): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface WaFeedOptions {
  /** Origen del sitio sin barra final: con eso se arma el link de cada producto. */
  origin: string;
  storeName: string;
  /** Nombres de categoría por id (para el texto de respaldo de la descripción). */
  categoryNames?: Map<string, string>;
}

export interface WaFeedResult {
  /** Contenido completo del archivo (encabezado + filas). */
  csv: string;
  /** Cuántos productos entraron al feed. */
  included: number;
  /** Productos marcados que quedaron afuera, con el motivo (se loguea en el worker). */
  skipped: { id: string; reason: string }[];
}

/**
 * Cuántos productos quedarían en el feed (los que descarga Meta) después de una acción
 * masiva sobre un alcance. `hoy` es el tamaño del feed ahora, `enFeed` los del alcance
 * que están en él y `conFoto` los del alcance con stock y foto (o sea los que el feed
 * tomaría si se marcan).
 *
 * Al marcar se suman solo los que todavía no estaban (conFoto - enFeed, que nunca es
 * negativo) y al quitar se restan los que estaban.
 */
export function feedResultante(publish: boolean, hoy: number, enFeed: number, conFoto: number): number {
  return publish ? hoy + (conFoto - enFeed) : hoy - enFeed;
}

/**
 * Aviso del panel cuando una acción masiva dejaría el catálogo de WhatsApp vacío o muy
 * chico. Devuelve "" cuando la acción no cambia nada importante.
 *
 * Dejar el feed en cero es peor de lo que parece: el endpoint responde error a propósito
 * para no borrar el catálogo de Meta, así que WhatsApp sigue mostrando los productos
 * viejos hasta que se marque algo de nuevo. Y un recorte grande es la firma típica de un
 * error de dedo. Con el feed ya vacío no hay nada que proteger (y avisar sería ruido).
 */
export function avisoCatalogoVacio(resultante: number, hoy: number): string {
  const plural = (n: number): string => (n === 1 ? "" : "s");
  if (hoy <= 0) return "";
  if (resultante <= 0) {
    return "⚠️ ATENCIÓN: esta acción deja el catálogo de WhatsApp VACÍO. El feed va a responder error a propósito (para no borrar el catálogo de Meta), así que WhatsApp va a seguir mostrando los productos viejos hasta que marques alguno de nuevo.";
  }
  // Menos de un cuarto de lo que hay hoy: se avisa aunque no quede vacío.
  if (resultante * 4 <= hoy) {
    return `⚠️ ATENCIÓN: esta acción dejaría el catálogo de WhatsApp con ${resultante} producto${plural(resultante)}, de los ${hoy} que hay hoy.`;
  }
  return "";
}

/**
 * Arma el feed completo. Solo entran los productos marcados (`waPublish`), con
 * título, foto absoluta (http/https) y id dentro del límite de Meta: un ítem sin
 * `image_link` o sin título hace fallar la validación de TODO el feed, así que se
 * saltea y se reporta.
 */
export function buildWaFeed(products: Product[], opts: WaFeedOptions): WaFeedResult {
  const filas: string[] = [WA_FEED_COLUMNS.join(",")];
  const skipped: { id: string; reason: string }[] = [];
  const storeName = normalizar(opts.storeName);
  const origin = opts.origin.replace(/\/+$/, "");

  for (const p of products) {
    // Defensivo: la query del worker ya filtra por la marca.
    if (p.waPublish !== true) continue;
    const id = normalizar(p.id);
    if (id === "" || id.length > WA_MAX_ID) {
      skipped.push({ id, reason: `id vacío o de más de ${WA_MAX_ID} caracteres` });
      continue;
    }
    const title = normalizar(p.title).slice(0, WA_MAX_TITLE);
    if (title === "") {
      skipped.push({ id, reason: "sin título" });
      continue;
    }
    const image = normalizar(p.imageUrl);
    if (!/^https?:\/\//i.test(image)) {
      skipped.push({ id, reason: "sin foto accesible (image_link es obligatorio y debe ser http/https)" });
      continue;
    }
    const categoria = p.categoryId ? opts.categoryNames?.get(p.categoryId) ?? "" : "";
    filas.push(
      [
        id,
        title,
        waDescription(p, storeName, categoria),
        waAvailability(p.availability),
        WA_FEED_CONDITION,
        waPrice(p.priceCents),
        `${origin}/producto/${encodeURIComponent(id)}`,
        image,
        waBrand(p, storeName),
      ]
        .map(csvCell)
        .join(",")
    );
  }

  // \r\n (RFC 4180) y salto final: Meta acepta ambos fines de línea y así el
  // archivo no queda con la última fila pegada al EOF si alguien lo abre a mano.
  return { csv: `${filas.join("\r\n")}\r\n`, included: filas.length - 1, skipped };
}
