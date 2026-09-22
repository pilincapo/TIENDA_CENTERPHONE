// Sincronización, importación y snapshot público en KV.

import type { CatalogSnapshot, Product, StoreSettings, SyncTrigger } from "../shared/types";
import { KV_SNAPSHOT_KEY, KV_SYNC_STATE_KEY } from "../shared/types";
import { extractItems, normalizeExternalItems } from "../shared/normalize";
import { applyRuleSet } from "../shared/pricing";
import type { Env } from "./db";
import { hideProductsNotIn, insertSyncLog, listCategories, listPriceRules, listProducts, unhideProductsIn, upsertCategoriesBatch, upsertProductsBatch } from "./db";
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
  /** Motivos de los productos que fallaron al guardarse (título + causa). */
  errors: string[];
  /** Tiempo de ejecución en ms (para el historial). */
  durationMs: number;
  /** Estrategia de extracción detectada (json, ldjson, tiendanegocio, shopify…). */
  source?: string;
}

export interface SyncState {
  lastSyncAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
}

// Invalidación del caché del catálogo. La Cache API del worker (ver /api/catalog
// en index.ts) es un cache por-PoP que la API de purga de zona NO afecta, así que
// la invalidación real es por versión: el snapshot guarda un `cacheVersion` en KV
// y la clave de cache incluye ese valor — al regenerar, la clave cambia y el PoP
// vuelve a ejecutar el handler (el cache viejo caduca solo por TTL de 5 min).
// CF_ZONE_ID/CF_API_TOKEN quedan sin uso; si algún día volvemos a Cache Rules de
// zona, purgeCatalogEdgeCache vuelve a tener efecto.
async function purgeCatalogEdgeCache(env: Env): Promise<void> {
  const zoneId = env.CF_ZONE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!zoneId || !apiToken) return;
  try {
    const origin = env.CF_SITE_ORIGIN ?? "https://celu-store.pilin123.workers.dev";
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [`${origin}/api/catalog`] }),
    });
    if (!res.ok) console.error(`purge_catalog_cache: HTTP ${res.status} — ${await res.text()}`);
  } catch (e) {
    console.error("purge_catalog_cache falló:", e);
  }
}

export async function regenerateSnapshot(env: Env): Promise<CatalogSnapshot> {
  const [products, categories] = await Promise.all([
    listProducts(env.DB),
    listCategories(env.DB),
  ]);
  // Snapshot liviano: el home no usa la descripción completa (búsqueda con 160
  // chars alcanza) ni source_url (solo lo usa el panel, que lee de D1). Con ~1000
  // productos esto baja el JSON de ~420KB a ~200KB sin comprimir.
  const light: Product[] = products.map((p) => ({
    ...p,
    description: p.description.slice(0, 160),
    sourceUrl: null,
  }));
  const snapshot: CatalogSnapshot = {
    generatedAt: nowMs(),
    categories: categories.filter((c) => c.active),
    products: light,
  };
  await env.KV.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshot));
  // Bump de versión del cache: la clave de /api/catalog incluye catalog:v, así
  // que al cambiarla el PoP deja de servir el snapshot viejo (el TTL de 5 min lo
  // limpia solo). Un write chico por regeneración, dentro del free tier.
  await env.KV.put("catalog:v", String(nowMs()));
  // Purga de zona (solo tiene efecto con Cache Rules de zona, no con la Cache API
  // del worker). No bloquea: los errores no propagan.
  await purgeCatalogEdgeCache(env);
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
  importOptions: { forceRuleId?: string | null; skipRules?: boolean; sourceUrl?: string | null; isLastChunk?: boolean } = {}
): Promise<SyncOutcome> {
  const outcome = await importItemsChunk(env, rawItems, importOptions);
  // El importador manual manda los productos en chunks (para no exceder el límite
  // de CPU del plan gratis); solo el ÚLTIMO chunk oculta los ausentes y toca el
  // snapshot, así un chunk intermedio nunca "esconde" lo que viene en el próximo.
  if (importOptions.isLastChunk === false) {
    return { ...outcome, deactivated: 0, errors: [...outcome.errors] };
  }
  return outcome;
}

async function importItemsChunk(
  env: Env,
  rawItems: unknown[],
  importOptions: { forceRuleId?: string | null; skipRules?: boolean; sourceUrl?: string | null; isLastChunk?: boolean } = {}
): Promise<SyncOutcome> {
  const startedAt = nowMs();
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
  // Asociar los productos con la URL de la fuente (source_url) para que el
  // ocultado automático pueda comparar contra la importación anterior.
  if (importOptions.sourceUrl) {
    for (const p of products) p.sourceUrl = importOptions.sourceUrl;
  }
  // Escrituras en chunks (un statement por chunk): sin esto una fuente de 160
  // productos dispara ~330 queries y revienta el límite de 50 por invocación
  // de D1 free — la causa de los errores recurrentes con listas grandes.
  await upsertCategoriesBatch(env.DB, categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, active: true })), now);
  const failedItems = await upsertProductsBatch(env.DB, products, now);
  for (const f of failedItems) errors.push(`"${f.title}": falló al guardar — ${f.reason}`);
  const saved = products.length - failedItems.length;
  // Desactivación automática: si la importación viene de una URL, los productos
  // anteriores de esa misma fuente que NO aparezcan ahora se ocultan (status hidden).
  // Los que vuelven a aparecer se reactivan. Solo afecta a productos de esa URL;
  // los de alta manual (source_url NULL) nunca se tocan.
  // Si la fuente vino vacía (extracción fallida) NO se oculta nada: así un error
  // temporal de la web de origen no borra medio catálogo.
  let deactivated = 0;
  if (importOptions.sourceUrl && saved > 0) {
    deactivated = await hideProductsNotIn(env.DB, importOptions.sourceUrl, products.map((p) => p.id), now);
    await unhideProductsIn(env.DB, importOptions.sourceUrl, products.map((p) => p.id), now);
  }
  await regenerateSnapshot(env);
  // Corrida sin productos guardados: NO es una corrida "ok" (confunde en el
  // historial). Se marca con aviso explícito del motivo probable.
  if (saved === 0 && rawItems.length === 0) {
    errors.unshift("La fuente no devolvió productos (posible cambio en el sitio de origen o extracción fallida)");
  }
  const ok = saved > 0;
  return {
    ok,
    // Hasta 40 avisos en el historial (antes 20): con fuentes grandes el recorte
    // escondía la mayoría de los motivos.
    warnings: skipped.slice(0, 40),
    total: rawItems.length,
    imported: saved,
    failed: rawItems.length - saved,
    deactivated,
    errors,
    durationMs: nowMs() - startedAt,
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
      itemsDeactivated: outcome.deactivated,
      detail: null,
      error: outcome.ok
        ? (outcome.warnings.length > 0 ? outcome.warnings.join("; ") : null)
        : (outcome.errors.join("; ") || "Error de sincronización"),
      startedAt, finishedAt: nowMs(),
    });
    await env.KV.put(KV_SYNC_STATE_KEY, JSON.stringify({ lastSyncAt: startedAt, lastStatus: outcome.ok ? "ok" : "error", lastError: outcome.ok ? null : outcome.errors.join("; ") }));
    return { ...outcome, durationMs: nowMs() - startedAt };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await insertSyncLog(env.DB, {
      id: logId, trigger, status: "error",
      itemsTotal: null, itemsImported: null, itemsFailed: null, itemsDeactivated: null,
      detail: null,
      error: message, startedAt, finishedAt: nowMs(),
    });
    await env.KV.put(KV_SYNC_STATE_KEY, JSON.stringify({ lastSyncAt: startedAt, lastStatus: "error", lastError: message }));
    return { ok: false, warnings: [], total: 0, imported: 0, failed: 0, deactivated: 0, errors: [message], durationMs: nowMs() - startedAt };
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
