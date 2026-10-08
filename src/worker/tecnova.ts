// Importador de Tecnova (worker): muestra el preview con mapeo de categorías y
// reglas de precio, e importa en chunks reutilizando importItems (mismo camino
// que el importador por URL: chunks, ocultado automático y snapshot al final).
// Todo vive montado en /api/admin/import/tecnova/* (solo sesiones de admin).

import { Hono } from "hono";
import { DEFAULT_TECNOVA_CATEGORY_MAP, fetchTecnovaItems, tecnovaItemsToInternal, TECNOVA_MAPPING_KEY, TECNOVA_SOURCE_URL, type TecnovaMapping } from "../shared/tecnova";
import type { Env } from "./db";
import { listCategories, listPriceRules, upsertCategoriesBatch, insertSyncLog } from "./db";
import { importItems } from "./sync";
import { newId, nowMs } from "./settings";
import { slugify } from "../shared/parse";

export const tecnovaApp = new Hono<{ Bindings: Env }>();

const PAGE = 120; // items por página de preview
const IMPORT_CHUNK = 50; // iguales que el importador por URL

interface MappingBody {
  /** categoría Tecnova (KEY normalizada) → id de raíz propia o "" de saltarla */
  targets?: Record<string, string>;
  /** categoría Tecnova → subcategoría propia opcional */
  subs?: Record<string, string>;
}

/** Lee el mapping guardado por el admin (KV) o devuelve los defaults. */
async function readMapping(env: Env): Promise<TecnovaMapping> {
  const raw = await env.KV.get(TECNOVA_MAPPING_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<TecnovaMapping>;
      return {
        targets: parsed.targets ?? { ...DEFAULT_TECNOVA_CATEGORY_MAP },
        subs: parsed.subs ?? {},
      };
    } catch { /* mapping corrupto: cae a defaults */ }
  }
  return { targets: { ...DEFAULT_TECNOVA_CATEGORY_MAP }, subs: {} };
}

/** Guarda el mapping actualizado (write chico, solo cuando el admin confirma). */
async function saveMapping(env: Env, mapping: TecnovaMapping): Promise<void> {
  await env.KV.put(TECNOVA_MAPPING_KEY, JSON.stringify(mapping), {});
}

/**
 * Categorías propias ACTIVAS (activas = las que aparecen en el panel). El mapping
 * del admin introduce ids de raíz existente; si el admin tipea una nueva, la creamos.
 */
async function ensureCategories(env: Env, mapping: TecnovaMapping): Promise<Set<string>> {
  const cats = await listCategories(env.DB);
  const existing = new Set(cats.filter((c) => c.active).map((c) => c.id));
  const roots = [...new Set(Object.values(mapping.targets).filter((v) => v !== ""))];
  // Categorías nuevas que el admin eligió y no existen: darlas de alta (root).
  const toCreate = roots.filter((id) => !existing.has(id));
  if (toCreate.length === 0) return existing;
  const now = nowMs();
  const created = toCreate.map((id) => ({
    id: slugify(id).slice(0, 100),
    name: prettyCatName(id),
    parentId: null as string | null,
    active: true,
  }));
  await upsertCategoriesBatch(env.DB, created, now);
  for (const c of created) existing.add(c.id);
  return existing;
}

/** "Belleza y Cuidado Personal" — el nombre presentable se arma desde el id. */
function prettyCatName(id: string): string {
  const t = id.replace(/[-_]+/g, " ").trim();
  return t === "" ? id : t.charAt(0).toUpperCase() + t.slice(1);
}

tecnovaApp.post("/preview", async (c) => {
  const body = await c.req.json<MappingBody>().catch(() => null);
  const saved = await readMapping(c.env);
  const mapping: TecnovaMapping = {
    targets: body?.targets && Object.keys(body.targets).length > 0 ? body.targets : saved.targets,
    subs: body?.subs ?? saved.subs,
  };
  try {
    const { items, errors } = await fetchTecnovaItems();
    const { items: internal, skipped } = tecnovaItemsToInternal(items, mapping);
    if (errors.length > 0) return c.json({ error: errors.join("; ") }, 502);
    // Categorías propias del panel (para el selector de mapping del frontend).
    const cats = await listCategories(c.env.DB);
    const roots = cats.filter((x) => x.parentId === null && x.active).map((x) => ({ id: x.id, name: x.name }));
    const subsByRoot: Record<string, { id: string; name: string }[]> = {};
    for (const x of cats.filter((x) => x.parentId !== null && x.active)) {
      const p = x.parentId as string;
      (subsByRoot[p] ??= []).push({ id: x.id, name: x.name });
    }
    // Reglas de precio activas (para el selector del preview).
    const rules = await listPriceRules(c.env.DB);
    const page = internal.slice(0, PAGE);
    return c.json({
      total: items.length,
      importables: internal.length,
      skipped: skipped.slice(0, 40),
      sample: page,
      mappingSuggestions: mapping.targets,
      ownRoots: roots,
      ownSubs: subsByRoot,
      rules,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Error consultando la API de Tecnova" }, 502);
  }
});

tecnovaApp.post("/import", async (c) => {
  const body = await c.req.json<(MappingBody & { chunkIndex?: number; chunkTotal?: number; priceRuleId?: string | null })>().catch(() => null);
  if (!body?.targets) return c.json({ error: "Faltó el mapping de categorías" }, 400);
  const mapping: TecnovaMapping = { targets: body.targets, subs: body.subs ?? {} };
  const chunkIndex = body.chunkIndex ?? 0;
  const chunkTotal = body.chunkTotal ?? 1;
  const startedAt = nowMs();
  try {
    const { items, errors } = await fetchTecnovaItems();
    if (errors.length > 0) return c.json({ error: errors.join("; ") }, 502);
    const { items: internal, skipped } = tecnovaItemsToInternal(items, mapping);
    // Crea las categorías raíz que el mapping pidió y no existían (alta nueva).
    await ensureCategories(c.env, mapping);
    // Chunk de trabajo: solo la porción de este request (límite de CPU del free tier).
    const slice = internal.slice(chunkIndex * IMPORT_CHUNK, (chunkIndex + 1) * IMPORT_CHUNK);
    // BUG del ocultado automático (fix): importItems oculta los productos de la
    // fuente que NO estén en el chunk actual — correcto para una fuente de un
    // solo request, pero con chunks de 50 el ÚLTIMO chunk ocultaba los 300+
    // importados por los anteriores (los productos aparecían "Sin stock").
    // El ocultado real lo hace el último chunk contra la lista COMPLETA de ids
    // importables; los chunks intermedios solo guardan (skipHide).
    const isLast = chunkIndex >= chunkTotal - 1;
    const keepIds = isLast ? internal.map((i) => String(i.id)) : undefined;
    const outcome = await importItems(c.env, slice, {
      forceRuleId: body.priceRuleId ?? null,
      skipRules: false,
      sourceUrl: TECNOVA_SOURCE_URL,
      isLastChunk: isLast,
      skipHide: !isLast,
      hideKeepIds: keepIds,
    });
    const motivos = [...outcome.errors, ...skipped].slice(0, 40).join("; ");
    void insertSyncLog(c.env.DB, {
      id: newId(),
      trigger: "import",
      status: outcome.ok ? "ok" : "error",
      itemsTotal: outcome.total,
      itemsImported: outcome.imported,
      itemsFailed: outcome.failed,
      itemsDeactivated: outcome.deactivated,
      error: motivos !== "" ? motivos.slice(0, 900) : null,
      detail: `${TECNOVA_SOURCE_URL} — chunk ${chunkIndex + 1}/${chunkTotal}`,
      startedAt,
      finishedAt: nowMs(),
    }).catch(() => { /* el historial no debe romper la importación */ });
    // Persistir el mapping usado (write chico solo en el primer chunk).
    if (chunkIndex === 0) await saveMapping(c.env, mapping);
    return c.json({ ...outcome, skippedPreview: skipped.length }, outcome.ok ? 200 : 422);
  } catch (e) {
    void insertSyncLog(c.env.DB, {
      id: newId(), trigger: "import", status: "error",
      itemsTotal: null, itemsImported: null, itemsFailed: null, itemsDeactivated: null,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 900),
      detail: TECNOVA_SOURCE_URL, startedAt, finishedAt: nowMs(),
    }).catch(() => { /* ya en falla */ });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
