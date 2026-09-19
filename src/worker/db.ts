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

export async function getProduct(db: D1Database, id: string): Promise<Product | null> {
  const row = await db.prepare("SELECT * FROM products WHERE id = ?1").bind(id).first<Dict>();
  return row ? rowToProduct(row) : null;
}

export async function upsertProduct(db: D1Database, p: Product, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO products (id, title, description, price_cents, category_id, subcategory_id, tags, image_url, status, availability, sort_order, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
       ON CONFLICT(id) DO UPDATE SET
         title = ?2, description = ?3, price_cents = ?4, category_id = ?5, subcategory_id = ?6,
         tags = ?7, image_url = ?8, status = ?9, availability = ?10, sort_order = ?11, updated_at = ?12`
    )
    .bind(
      p.id, p.title, p.description, p.priceCents, p.categoryId, p.subcategoryId,
      JSON.stringify(p.tags), p.imageUrl, p.status, p.availability, p.sortOrder, now
    )
    .run();
}

export async function deleteProduct(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM products WHERE id = ?1").bind(id).run();
}

// ---- Sync log ----

export async function insertSyncLog(db: D1Database, entry: SyncLogEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_log (id, trigger, status, items_total, items_imported, items_failed, error, detail, started_at, finished_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      entry.id, entry.trigger, entry.status, entry.itemsTotal,
      entry.itemsImported, entry.itemsFailed, entry.error, entry.detail, entry.startedAt, entry.finishedAt
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
