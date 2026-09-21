// Acceso a datos en D1.

import type { Category, Product, SyncLogEntry, SyncTrigger } from "../shared/types";
import type { PriceRule } from "../shared/pricing";
import type { AutoImport } from "../shared/autoimport";
import { TAGS } from "../shared/types";

type Dict = Record<string, unknown>;

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SECRET: string;
  // Opcionales: habilitan la purga del caché edge de /api/catalog al regenerar
  // el snapshot. Sin ellos, la purga se omite silenciosamente (el sitio funciona igual).
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
  CF_SITE_ORIGIN?: string;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function rowToProduct(row: Dict): Product {
  let tags: Product["tags"] = [];
  try {
    const parsed = JSON.parse(String(row.tags ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      tags = parsed.filter((t): t is Product["tags"][number] => TAGS.includes(t as never));
    }
  } catch {
    tags = [];
  }
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    priceCents: num(row.price_cents),
    categoryId: row.category_id == null ? null : String(row.category_id),
    subcategoryId: row.subcategory_id == null ? null : String(row.subcategory_id),
    tags,
    imageUrl: String(row.image_url ?? ""),
    status: row.status === "hidden" ? "hidden" : "published",
    availability: (["in_stock", "out_of_stock", "preorder"].includes(String(row.availability))
      ? String(row.availability)
      : "in_stock") as Product["availability"],
    sortOrder: num(row.sort_order),
    createdAt: num(row.created_at),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
  };
}

export function rowToCategory(row: Dict): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    active: num(row.active) === 1,
  };
}

function rowToSyncLog(row: Dict): SyncLogEntry {
  return {
    id: String(row.id),
    trigger: String(row.trigger) as SyncTrigger,
    status: row.status === "error" ? "error" : "ok",
    itemsTotal: row.items_total == null ? null : num(row.items_total),
    itemsImported: row.items_imported == null ? null : num(row.items_imported),
    itemsFailed: row.items_failed == null ? null : num(row.items_failed),
    itemsDeactivated: row.items_deactivated == null ? null : num(row.items_deactivated),
    error: row.error == null ? null : String(row.error),
    detail: row.detail == null ? null : String(row.detail),
    startedAt: num(row.started_at),
    finishedAt: row.finished_at == null ? null : num(row.finished_at),
  };
}

// ---- Categorías ----

export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await db.prepare("SELECT * FROM categories ORDER BY name").all<Dict>();
  return (results ?? []).map(rowToCategory);
}

export async function upsertCategory(db: D1Database, c: Category, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO categories (id, name, parent_id, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET name = ?2, parent_id = ?3, active = ?4, updated_at = ?5`
    )
    .bind(c.id, c.name, c.parentId, c.active ? 1 : 0, now)
    .run();
}

export async function deleteCategory(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM categories WHERE id = ?1").bind(id).run();
}

// ---- Productos ----

export async function listProducts(db: D1Database, all = false): Promise<Product[]> {
  const sql = all
    ? "SELECT * FROM products ORDER BY sort_order, created_at"
    : "SELECT * FROM products WHERE status = 'published' ORDER BY sort_order, created_at";
  const { results } = await db.prepare(sql).all<Dict>();
  return (results ?? []).map(rowToProduct);
}

/** Cantidad de productos por categoría (publicados y totales) para el panel. */
export async function countProductsByCategory(db: D1Database): Promise<Map<string, { total: number; published: number }>> {
  const { results } = await db
    .prepare("SELECT category_id AS cat, COUNT(*) AS total, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS pub FROM products WHERE category_id IS NOT NULL GROUP BY category_id")
    .all<Dict>();
  const map = new Map<string, { total: number; published: number }>();
  for (const r of results ?? []) {
    map.set(String(r.cat), { total: Number(r.total ?? 0), published: Number(r.pub ?? 0) });
  }
  return map;
}

export async function getProduct(db: D1Database, id: string): Promise<Product | null> {
  const row = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(id).first<Dict>();
  return row ? rowToProduct(row) : null;
}

export async function upsertProduct(db: D1Database, p: Product, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO products (id, title, description, price_cents, category_id, subcategory_id, tags, image_url, status, availability, sort_order, created_at, updated_at, source_url)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)
       ON CONFLICT(id) DO UPDATE SET
         title = ?2, description = ?3, price_cents = ?4, category_id = ?5, subcategory_id = ?6,
         tags = ?7, image_url = ?8, status = ?9, availability = ?10, sort_order = ?11, updated_at = ?12,
         source_url = COALESCE(?13, source_url)`
    )
    .bind(
      p.id, p.title, p.description, p.priceCents, p.categoryId, p.subcategoryId,
      JSON.stringify(p.tags), p.imageUrl, p.status, p.availability, p.sortOrder, now,
      p.sourceUrl ?? null
    )
    .run();
}

export async function deleteProduct(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM products WHERE id = ?1").bind(id).run();
}

/** Tamaño de chunk para batches: respetan el límite de 50 queries por invocación (D1 free)
 *  y el de 100 parámetros por statement. */
const BATCH_SIZE = 30;

export async function upsertCategoriesBatch(db: D1Database, cats: Category[], now: number): Promise<void> {
  if (cats.length === 0) return;
  for (let i = 0; i < cats.length; i += BATCH_SIZE) {
    const chunk = cats.slice(i, i + BATCH_SIZE);
    const stmt = db.prepare(
      `INSERT INTO categories (id, name, parent_id, active, created_at, updated_at)
       VALUES ${chunk.map((_, j) => `(?${j * 4 + 1}, ?${j * 4 + 2}, ?${j * 4 + 3}, ?${j * 4 + 4}, ?${chunk.length * 4 + 1}, ?${chunk.length * 4 + 1})`).join(",")}
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, active = excluded.active, updated_at = excluded.updated_at`
    );
    const binds: unknown[] = [];
    for (const c of chunk) binds.push(c.id, c.name, c.parentId, c.active ? 1 : 0);
    binds.push(now);
    await stmt.bind(...binds).run();
  }
}

/** Inserta/actualiza productos de a chunks (un solo statement por chunk).
 *  created_at solo se setea en el INSERT (nuevo producto); en el UPDATE se
 *  preserva el original para que el badge "Nuevo" no se reinicie en cada sync.
 *  Devuelve los productos cuyo upsert falló con el MOTIVO real (para el historial). */
export async function upsertProductsBatch(db: D1Database, prods: Product[], now: number): Promise<{ title: string; reason: string }[]> {
  const failed: { title: string; reason: string }[] = [];
  if (prods.length === 0) return failed;
  for (let i = 0; i < prods.length; i += BATCH_SIZE) {
    const chunk = prods.slice(i, i + BATCH_SIZE);
    // 12 binds por producto (sin created_at propio) + 1 de now = 12n + 1 (≤ 361, dentro del límite).
    const stmt = db.prepare(
      `INSERT INTO products (id, title, description, price_cents, category_id, subcategory_id, tags, image_url, status, availability, sort_order, created_at, updated_at, source_url)
       VALUES ${chunk.map((_, j) => `(?${j * 12 + 1}, ?${j * 12 + 2}, ?${j * 12 + 3}, ?${j * 12 + 4}, ?${j * 12 + 5}, ?${j * 12 + 6}, ?${j * 12 + 7}, ?${j * 12 + 8}, ?${j * 12 + 9}, ?${j * 12 + 10}, ?${j * 12 + 11}, ?${chunk.length * 12 + 1}, ?${chunk.length * 12 + 1}, ?${j * 12 + 12})`).join(",")}
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, description = excluded.description, price_cents = excluded.price_cents,
         category_id = excluded.category_id, subcategory_id = excluded.subcategory_id, tags = excluded.tags,
         image_url = excluded.image_url, status = excluded.status, availability = excluded.availability,
         sort_order = excluded.sort_order, updated_at = excluded.updated_at,
         source_url = COALESCE(excluded.source_url, products.source_url)`
    );
    const binds: unknown[] = [];
    for (const p of chunk) {
      binds.push(p.id, p.title, p.description, p.priceCents, p.categoryId, p.subcategoryId,
        JSON.stringify(p.tags), p.imageUrl, p.status, p.availability, p.sortOrder, p.sourceUrl ?? null);
    }
    binds.push(now);
    try {
      await stmt.bind(...binds).run();
    } catch (e) {
      // Un chunk completo falló (dato inválido en algún producto): reintentar producto por producto
      // para aislar el culpable y poder continuar con el resto. Se registra el
      // motivo real del error de la base, no solo el título.
      const chunkError = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      for (const p of chunk) {
        try {
          await upsertProduct(db, p, now);
        } catch (pe) {
          const reason = pe instanceof Error ? pe.message.slice(0, 200) : String(pe).slice(0, 200);
          failed.push({ title: p.title, reason: `${reason} (chunk: ${chunkError})` });
        }
      }
    }
  }
  return failed;
}

/** Ids de productos de una fuente (para detectar desaparecidos sin IN gigante). */
export async function listProductIdsBySource(db: D1Database, sourceUrl: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM products WHERE source_url = ?1")
    .bind(sourceUrl)
    .all<Dict>();
  return (results ?? []).map((r) => String(r.id));
}

/** Oculta (status=hidden) los productos de una fuente cuyo id NO esté en keepIds. Devuelve cuántos. */
export async function hideProductsNotIn(db: D1Database, sourceUrl: string, keepIds: string[], now: number): Promise<number> {
  // Por chunks: D1 admite máximo 100 parámetros por query; con más de ~99 ids la
  // query del IN explotaba y abortaba TODA la importación de fuentes grandes.
  const prev = await listProductIdsBySource(db, sourceUrl);
  const keep = new Set(keepIds);
  const toHide = prev.filter((id) => !keep.has(id));
  let hidden = 0;
  for (let i = 0; i < toHide.length; i += BATCH_SIZE) {
    const chunk = toHide.slice(i, i + BATCH_SIZE);
    const marks = chunk.map((_, j) => `?${j + 2}`).join(",");
    const r = await db
      .prepare(`UPDATE products SET status = 'hidden', updated_at = ?${chunk.length + 2} WHERE source_url = ?1 AND id IN (${marks})`)
      .bind(sourceUrl, ...chunk, now)
      .run();
    hidden += r.meta.changes ?? 0;
  }
  return hidden;
}

/** Reactiva los productos ocultos de una fuente que volvieron a aparecer (status published). */
export async function unhideProductsIn(db: D1Database, sourceUrl: string, ids: string[], now: number): Promise<number> {
  // Chunks por el límite de 100 parámetros de D1 (antes explotaba con >99 ids).
  if (ids.length === 0) return 0;
  let unhid = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const marks = chunk.map((_, j) => `?${j + 2}`).join(",");
    const r = await db
      .prepare(`UPDATE products SET status = 'published', updated_at = ?${chunk.length + 2} WHERE source_url = ?1 AND status = 'hidden' AND id IN (${marks})`)
      .bind(sourceUrl, ...chunk, now)
      .run();
    unhid += r.meta.changes ?? 0;
  }
  return unhid;
}

// ---- Sync log ----

export async function insertSyncLog(db: D1Database, entry: SyncLogEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_log (id, trigger, status, items_total, items_imported, items_failed, items_deactivated, error, detail, started_at, finished_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    )
    .bind(
      entry.id, entry.trigger, entry.status, entry.itemsTotal,
      entry.itemsImported, entry.itemsFailed, entry.itemsDeactivated, entry.error, entry.detail, entry.startedAt, entry.finishedAt
    )
    .run();
}

export async function listSyncLog(db: D1Database, limit = 10): Promise<SyncLogEntry[]> {
  const { results } = await db
    .prepare("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?1")
    .bind(limit)
    .all<Dict>();
  return (results ?? []).map(rowToSyncLog);
}

export async function listSyncLogByTrigger(db: D1Database, trigger: SyncTrigger, limit = 50): Promise<SyncLogEntry[]> {
  const { results } = await db
    .prepare("SELECT * FROM sync_log WHERE trigger = ?1 ORDER BY started_at DESC LIMIT ?2")
    .bind(trigger, limit)
    .all<Dict>();
  return (results ?? []).map(rowToSyncLog);
}

/** Última corrida por URL (para mostrar el detalle del error en Auto-importaciones). */
export async function lastSyncLogByDetail(db: D1Database, detail: string, limit = 200): Promise<SyncLogEntry | null> {
  const { results } = await db
    .prepare("SELECT * FROM sync_log WHERE detail = ?1 ORDER BY started_at DESC LIMIT 1")
    .bind(detail)
    .all<Dict>();
  if (results && results.length > 0) return rowToSyncLog(results[0] as Dict);
  // Fallback sin LIMIT (versiones viejas de D1 a veces lo exigen con LIKE).
  const { results: all } = await db
    .prepare("SELECT * FROM sync_log WHERE detail = ?1 ORDER BY started_at DESC")
    .bind(detail)
    .all<Dict>();
  return all && all.length > 0 ? rowToSyncLog(all[0] as Dict) : null;
}

// ---- Reglas de precio ----

export function rowToPriceRule(row: Dict): PriceRule {
  return {
    id: String(row.id),
    name: String(row.name),
    groupName: row.group_name == null ? null : String(row.group_name),
    minCents: num(row.min_cents),
    maxCents: row.max_cents == null ? null : num(row.max_cents),
    percent: Number(row.percent ?? 0),
    active: num(row.active) === 1,
    priority: num(row.priority),
  };
}

export async function listPriceRules(db: D1Database): Promise<PriceRule[]> {
  const { results } = await db
    .prepare("SELECT * FROM price_rules ORDER BY priority DESC, min_cents")
    .all<Dict>();
  return (results ?? []).map(rowToPriceRule);
}

export async function upsertPriceRule(db: D1Database, r: PriceRule, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO price_rules (id, name, group_name, min_cents, max_cents, percent, active, priority, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(id) DO UPDATE SET
         name = ?2, group_name = ?3, min_cents = ?4, max_cents = ?5, percent = ?6, active = ?7, priority = ?8, updated_at = ?9`
    )
    .bind(r.id, r.name, r.groupName, r.minCents, r.maxCents, r.percent, r.active ? 1 : 0, r.priority, now)
    .run();
}

export async function deletePriceRule(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM price_rules WHERE id = ?1").bind(id).run();
}

// ---- Auto-importaciones programadas ----

function rowToAutoImport(row: Dict): AutoImport {
  let times: string[] = [];
  try {
    const parsed = JSON.parse(String(row.times ?? "[]")) as unknown;
    if (Array.isArray(parsed)) times = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    times = [];
  }
  return {
    id: String(row.id),
    url: String(row.url ?? ""),
    label: String(row.label ?? ""),
    priceRuleId: row.price_rule_id == null ? null : String(row.price_rule_id),
    times,
    active: num(row.active) === 1,
    lastRunAt: row.last_run_at == null ? null : num(row.last_run_at),
    lastStatus: row.last_status == null ? null : String(row.last_status),
  };
}

export async function listAutoImports(db: D1Database): Promise<AutoImport[]> {
  const { results } = await db
    .prepare("SELECT * FROM auto_imports ORDER BY created_at DESC")
    .all<Dict>();
  return (results ?? []).map(rowToAutoImport);
}

export async function getAutoImportByUrl(db: D1Database, url: string): Promise<AutoImport | null> {
  const row = await db.prepare("SELECT * FROM auto_imports WHERE url = ?1").bind(url).first<Dict>();
  return row ? rowToAutoImport(row) : null;
}

export async function upsertAutoImport(db: D1Database, j: AutoImport, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auto_imports (id, url, label, price_rule_id, times, active, last_run_at, last_status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(id) DO UPDATE SET
         url = ?2, label = ?3, price_rule_id = ?4, times = ?5, active = ?6, last_run_at = ?7, last_status = ?8, updated_at = ?9`
    )
    .bind(j.id, j.url, j.label, j.priceRuleId, JSON.stringify(j.times), j.active ? 1 : 0, j.lastRunAt, j.lastStatus, now)
    .run();
}

export async function deleteAutoImport(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM auto_imports WHERE id = ?1").bind(id).run();
}
