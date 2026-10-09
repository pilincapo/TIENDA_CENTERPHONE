// URLs de la tienda de Tecnova, compartidas por el worker y el panel.
// Vive en un módulo chico y sin dependencias para que la SPA del panel no se
// lleve puesto el importador de la API (fetch, mapping de categorías, etc).

/** URL pública de la tienda: es la que se guarda como `url` del job de auto-importación. */
export const TECNOVA_PUBLIC_URL = "https://www.tecnova.com.ar/";

/** Etiqueta técnica de la fuente en `products.source_url` (ocultado automático + badge). */
export const TECNOVA_SOURCE_URL = "https://tecnova.com.ar/";

/**
 * ¿La URL apunta a la tienda de Tecnova (con o sin www)?
 * Ese sitio es una SPA de ~2.7 KB sin JSON-LD de productos, así que el importador
 * por URL nunca puede leerlo: estas URLs se ejecutan con la API oficial (Supabase)
 * en vez de `extractFromUrl`.
 */
export function isTecnovaSourceUrl(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (s === "") return false;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "tecnova.com.ar" || host.endsWith(".tecnova.com.ar");
}
