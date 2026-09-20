// Sincronización, importación y snapshot público en KV.

import type { CatalogSnapshot, StoreSettings, SyncTrigger } from "../shared/types";
import { KV_SNAPSHOT_KEY, KV_SYNC_STATE_KEY } from "../shared/types";
import { extractItems, normalizeExternalItems } from "../shared/normalize";
import { applyRuleSet } from "../shared/pricing";
import type { Env } from "./db";
import { hideProductsNotIn, insertSyncLog, listCategories, listPriceRules, listProducts, unhideProductsIn, upsertCategory, upsertProduct } from "./db";
import { getSettings, newId, nowMs } from "./settings";

export interface SyncOutcome {
  ok: boolean;
  /** Corrida exitosa pero con items salteados (precio inválido, etc.). */
  warnings: string[];
  total: number;
  imported: number;
  failed: number;
  /** Productos de esta fuente que ya no vienen en el listado y fueron ocultados. */
  deactivated: number;
  errors: string[];
}

export interface SyncState {
  lastSyncAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
}

export async function regenerateSnapshot(env: Env): Promise<CatalogSnapshot> {
  const [products, categories] = await Promise.all([
    listProducts(env.DB),
    listCategories(env.DB),
  ]);
  const snapshot: CatalogSnapshot = {
    generatedAt: nowMs(),
    categories: categories.filter((c) => c.active),
    products,
  };
  await env.KV.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function getSnapshot(env: Env): Promise<CatalogSnapshot | null> {
  const raw = await env.KV.get(KV_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CatalogSnapshot;
  } catch {
    return null;
  }
}

export async function importItems(
  env: Env,
  rawItems: unknown[],
  importOptions: { forceRuleId?: string | null; skipRules?: boolean; sourceUrl?: string | null } = {}
): Promise<SyncOutcome> {
  const { products, categories, skipped } = normalizeExternalItems(rawItems);
  const errors: string[] = [];
  // Reglas de precio automáticas (rangos activos); se puede forzar una con forceRuleId.
  // skipRules: los items ya vienen con el precio final (selección del preview).
  if (!importOptions.skipRules) {
    const rules = await listPriceRules(env.DB);
    for (const p of products) {
      const app = applyRuleSet(p.priceCents, rules, importOptions.forceRuleId ?? null);
      if (app.ruleId !== null) p.priceCents = app.finalCents;
    }
  }
  const now = nowMs();
  for (const c of categories) {
    await upsertCategory(env.DB, { id: c.id, name: c.name, parentId: c.parentId, active: true }, now);
  }
  for (const p of products) {
    p.sourceUrl = importOptions.sourceUrl ?? p.sourceUrl ?? null;
    await upsertProduct(env.DB, p, now);
  }
  // Desactivación automática: si la importación viene de una URL, los productos
  // anteriores de esa misma fuente que NO aparezcan ahora se ocultan (status hidden).
  // Los que vuelven a aparecer se reactivan. Solo afecta a productos de esa URL;
  // los de alta manual (source_url NULL) nunca se tocan.
  let deactivated = 0;
  if (importOptions.sourceUrl) {
    deactivated = await hideProductsNotIn(env.DB, importOptions.sourceUrl, products.map((p) => p.id), now);
    await unhideProductsIn(env.DB, importOptions.sourceUrl, products.map((p) => p.id), now);
  }
  await regenerateSnapshot(env);
  // Los items con precio inválido o sin título se SALTAN (no abortan la sync):
  // la corrida es ok si al menos un producto se importó. Quedan como avisos.
  const ok = products.length > 0 || (rawItems.length === 0 && errors.length === 0);
  return {
    ok,
    warnings: skipped.slice(0, 20),
    total: rawItems.length,
    imported: products.length,
    failed: rawItems.length - products.length,
    deactivated,
    errors,
  };
}

export async function runSync(env: Env, trigger: SyncTrigger): Promise<SyncOutcome> {
  const startedAt = nowMs();
  const logId = newId();
  const settings = await getSettings(env.KV);
  try {
    if (settings.syncUrl === "") throw new Error("No hay URL de sincronización configurada");
    const headers: Record<string, string> = {};
    if (settings.syncToken !== "") headers.Authorization = `Bearer ${settings.syncToken}`;
    const res = await fetch(settings.syncUrl, { headers });
    if (!res.ok) throw new Error(`La fuente respondió con estado ${res.status}`);
    const payload: unknown = await res.json();
    const outcome = await importItems(env, extractItems(payload));
    await insertSyncLog(env.DB, {
      id: logId, trigger, status: outcome.ok ? "ok" : "error",
      itemsTotal: outcome.total, itemsImported: outcome.imported, itemsFailed: outcome.failed,
      error: outcome.ok
        ? (outcome.warnings.length > 0 ? outcome.warnings.join("; ") : null)
        : (outcome.errors.join("; ") || "Error de sincronización"),
      startedAt, finishedAt: nowMs(),
    });
    await env.KV.put(KV_SYNC_STATE_KEY, JSON.stringify({ lastSyncAt: startedAt, lastStatus: outcome.ok ? "ok" : "error", lastError: outcome.ok ? null : outcome.errors.join("; ") }));
    return outcome;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await insertSyncLog(env.DB, {
      id: logId, trigger, status: "error",
      itemsTotal: null, itemsImported: null, itemsFailed: null,
      error: message, startedAt, finishedAt: nowMs(),
    });
    await env.KV.put(KV_SYNC_STATE_KEY, JSON.stringify({ lastSyncAt: startedAt, lastStatus: "error", lastError: message }));
    return { ok: false, total: 0, imported: 0, failed: 0, errors: [message] };
  }
}

export async function isSyncDue(kv: KVNamespace, settings: StoreSettings): Promise<boolean> {
  const raw = await kv.get(KV_SYNC_STATE_KEY);
  if (!raw) return true;
  try {
    const st = JSON.parse(raw) as { lastSyncAt?: number };
    return nowMs() - (st.lastSyncAt ?? 0) >= settings.syncIntervalMinutes * 60_000;
  } catch {
    return true;
  }
}

export async function getSyncState(kv: KVNamespace): Promise<SyncState> {
  const raw = await kv.get(KV_SYNC_STATE_KEY);
  if (!raw) return { lastSyncAt: null, lastStatus: null, lastError: null };
  try {
    const st = JSON.parse(raw) as Partial<SyncState>;
    return {
      lastSyncAt: st.lastSyncAt ?? null,
      lastStatus: st.lastStatus ?? null,
      lastError: st.lastError ?? null,
    };
  } catch {
    return { lastSyncAt: null, lastStatus: null, lastError: null };
  }
}
