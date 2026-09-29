// Configuración de la tienda persistida en KV.

import type { StoreSettings } from "../shared/types";
import { DEFAULT_SETTINGS, KV_SETTINGS_KEY } from "../shared/types";

export async function getSettings(kv: KVNamespace): Promise<StoreSettings> {
  const raw = await kv.get(KV_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(kv: KVNamespace, next: Partial<StoreSettings>): Promise<StoreSettings> {
  const current = await getSettings(kv);
  const merged: StoreSettings = { ...current, ...next };
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
