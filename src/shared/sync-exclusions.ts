// Artículos que el dueño no quiere en la tienda nunca: la sincronización los
// saltea y, si ya existen, se ocultan al guardar la lista.
//
// El panel acepta una entrada por línea y, como el dueño no tiene por qué saber
// el id interno, se puede pegar cualquiera de estas formas:
//   6233
//   /producto/6233
//   https://centerphone.com.ar/producto/6233?utm=google
//   https://centerphone.com.ar/producto/samsung-galaxy-a15/
// Todas terminan reducidas al mismo id (`6233`, `samsung-galaxy-a15`), que es el
// que usa D1 y la URL pública /producto/<id>.

/** Tope de líneas y de largo por línea: la lista se guarda en el KV de settings. */
export const MAX_EXCLUDE_LINES = 300;
export const MAX_EXCLUDE_LINE_LEN = 200;

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Reduce una línea del panel al id del producto ("" si no aporta nada).
 * Los comentarios con `#` se ignoran, igual que las líneas vacías.
 */
export function normalizeExclusionEntry(line: string): string {
  let s = String(line ?? "").trim();
  if (s === "" || s.startsWith("#")) return "";
  s = s.toLowerCase();
  // Link de la ficha: lo que sigue a /producto/ es el id, sin query ni hash.
  const product = s.match(/\/producto\/([^/?#\s]+)/);
  if (product?.[1]) return decodeSafe(product[1]);
  // Cualquier otra URL (link del proveedor, link corto): se usa el último
  // segmento del path, que es lo único parecido a un código.
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    const path = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[?#]/)[0] ?? "";
    const segments = path.split("/").filter((seg) => seg !== "");
    return decodeSafe(segments[segments.length - 1] ?? "");
  }
  // Código suelto: se limpian barras, query y hash.
  return decodeSafe(s.split(/[?#]/)[0]!.replace(/^\/+|\/+$/g, ""));
}

/** Ids únicos de la lista (sin vacíos ni repetidos). */
export function parseExclusionList(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const id = normalizeExclusionEntry(line);
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Set listo para comparar contra `product.id` en la importación. */
export function exclusionSet(raw: string): Set<string> {
  return new Set(parseExclusionList(raw));
}

export function isExcluded(exclusions: Set<string>, id: string): boolean {
  if (exclusions.size === 0) return false;
  return exclusions.has(String(id ?? "").toLowerCase());
}

/**
 * Texto que se guarda en la configuración: una entrada por línea, tal cual la
 * pegó el dueño (así reconoce lo que escribió), sin repetidos ni comentarios.
 * Los recortes evitan que un pegado enorme infle el KV.
 */
export function sanitizeSyncExcludeList(raw: unknown): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim().slice(0, MAX_EXCLUDE_LINE_LEN);
    const id = normalizeExclusionEntry(trimmed);
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(trimmed);
    if (out.length >= MAX_EXCLUDE_LINES) break;
  }
  return out.join("\n");
}
