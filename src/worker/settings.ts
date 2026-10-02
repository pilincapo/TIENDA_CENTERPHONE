// Configuración de la tienda persistida en KV.

import type { StoreMode, StoreSettings } from "../shared/types";
import { DEFAULT_SETTINGS, KV_SETTINGS_KEY } from "../shared/types";

export function isStoreMode(v: unknown): v is StoreMode {
  return v === "tienda" || v === "catalogo";
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
  return { ...base, storeMode, paymentsEnabled: storeMode === "tienda" };
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
