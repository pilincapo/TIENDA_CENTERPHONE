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

export function nowMs(): number {
  return Date.now();
}
