// Configuración de la tienda persistida en KV.

import type { StoreMode, StoreSettings } from "../shared/types";
import { DEFAULT_SETTINGS, KV_SETTINGS_KEY, MAX_ANNOUNCEMENT_PROMOS, MAX_ANNOUNCEMENT_PROMO_LEN } from "../shared/types";
import { repairTextFields } from "../shared/encoding";
import { sanitizeSyncExcludeList } from "../shared/sync-exclusions";

export function isStoreMode(v: unknown): v is StoreMode {
  return v === "tienda" || v === "catalogo";
}

/**
 * Cinta de anuncio con varias promos: cada línea no vacía es una promo
 * (una por fila, igual que los pasos de "Cómo comprar"). Se queda con
 * hasta MAX_ANNOUNCEMENT_PROMOS líneas de MAX_ANNOUNCEMENT_PROMO_LEN
 * caracteres; el resto se descarta. Un valor no-string (campo ausente en
 * un body parcial) queda "", igual que antes: cinta no renderizada.
 */
export function sanitizeAnnouncementBar(raw: unknown): string {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, MAX_ANNOUNCEMENT_PROMOS)
    .map((l) => l.slice(0, MAX_ANNOUNCEMENT_PROMO_LEN))
    .join("\n");
}

/**
 * El modo del sitio es la única fuente de verdad: `paymentsEnabled` se deriva de
 * ahí. Así no pueden quedar dos flags contradiciendose (poder activar el pago
 * online "en catálogo" y que el sitio muestre un carrito que el backend rechaza).
 */
export function normalizeSettings(raw: Partial<StoreSettings> | null | undefined): StoreSettings {
  const base = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  // Se mira `raw` (no `base`): si el objeto guardado es de antes del modo, no trae
  // storeMode y hay que derivarlo del checkbox de pagos. Si se mirara `base`, el
  // default "tienda" taparía la derivación y una tienda que tenía los pagos
  // apagados se abriría sola.
  const storeMode: StoreMode = isStoreMode(raw?.storeMode)
    ? raw.storeMode
    : raw?.paymentsEnabled === true
      ? "tienda"
      : "catalogo";
  // Texto: repara el mojibake que haya quedado guardado (UTF-8 leído como
  // latin-1/cp1252, ver shared/encoding.ts). Pasa por acá tanto la lectura como
  // el guardado, así que el sitio y el JSON-LD se ven bien al instante y el
  // próximo guardado del panel ya lo persiste corregido. Es solo memoria: no
  // agrega escrituras a KV en cada request (regla del free tier).
  // Reseñas de Google: el promedio va de 0 (calcular con las cargadas) a 5 con
  // un decimal, el total es un entero y el link se fuerza a https (o se
  // descarta si no es una URL válida: el botón no se muestra).
  const ratingRaw = Number(base.googleReviewsRating ?? 0);
  const googleReviewsRating = Number.isFinite(ratingRaw)
    ? Math.min(5, Math.max(0, Math.round(ratingRaw * 10) / 10))
    : 0;
  const countRaw = Number(base.googleReviewsCount ?? 0);
  const googleReviewsCount = Number.isFinite(countRaw) ? Math.max(0, Math.min(1_000_000, Math.trunc(countRaw))) : 0;
  const googleReviewUrl = forceHttpsUrl(base.googleReviewUrl, 500);
  // Lista de artículos excluidos: líneas limpias y sin repetidos. Pasa por acá
  // tanto al leer como al guardar, así una lista pegada a mano nunca trae
  // entradas vacías que hagan comparar de más en cada importación.
  const syncExcludeList = sanitizeSyncExcludeList(base.syncExcludeList);

  return repairTextFields({
    ...base,
    storeMode,
    paymentsEnabled: storeMode === "tienda",
    googleReviewsRating,
    googleReviewsCount,
    googleReviewUrl,
    syncExcludeList,
  });
}

export async function getSettings(kv: KVNamespace): Promise<StoreSettings> {
  const raw = await kv.get(KV_SETTINGS_KEY);
  if (!raw) return normalizeSettings(null);
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings(null);
  }
}

export async function saveSettings(kv: KVNamespace, next: Partial<StoreSettings>): Promise<StoreSettings> {
  const current = await getSettings(kv);
  const merged = normalizeSettings({ ...current, ...next });
  await kv.put(KV_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function newId(): string {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fuerza https:// en una URL configurable (fix B1/B3): http en texto claro
 * filtra datos (tokens de sync, destino de seguimiento) a interceptadores.
 * Acepta vacío; agrega el esquema si falta. Devuelve "" si no es una URL válida.
 */
export function forceHttpsUrl(raw: unknown, max: number): string {
  const s = String(raw ?? "").trim().slice(0, max);
  if (s === "") return "";
  const candidate = /^https?:\/\//.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:") return ""; // rechaza http:// explícito
    u.protocol = "https:";
    return u.toString();
  } catch {
    return "";
  }
}

export function nowMs(): number {
  return Date.now();
}
