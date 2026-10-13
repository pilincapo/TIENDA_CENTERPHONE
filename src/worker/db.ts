// Acceso a datos en D1.

import type { Category, Product, SyncLogEntry, SyncTrigger } from "../shared/types";
import type { PriceRule } from "../shared/pricing";
import type { AutoImport } from "../shared/autoimport";
import { TAGS } from "../shared/types";
import { fixMojibake } from "../shared/encoding";

export type Dict = Record<string, unknown>;

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SECRET: string;
  // Pago online (MercadoPago): secret. Vacío = pagos deshabilitados aunque el
  // panel tenga el toggle activado.
  MERCADOPAGO_ACCESS_TOKEN?: string;
  // Envíos por Andreani: credenciales como secrets. Vacíos = cotizador apagado
  // aunque el panel tenga el toggle activado (igual que MercadoPago).
  ANDREANI_USER?: string;
  ANDREANI_PASSWORD?: string;
  // Opcionales: habilitan la purga del caché edge de /api/catalog al regenerar
  // el snapshot. Sin ellos, la purga se omite silenciosamente (el sitio funciona igual).
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
  CF_SITE_ORIGIN?: string;
  // Opcional: lectura de eventos de seguridad (pestaña Seguridad del panel).
  // CF_ACCOUNT_ID es una var (en wrangler.jsonc); CF_LOGS_TOKEN es un secret
  // (API token con permiso de lectura de Workers Logs). Sin token, la pestaña
  // muestra las instrucciones y el resto del panel funciona igual.
  CF_ACCOUNT_ID?: string;
  CF_LOGS_TOKEN?: string;
  // Opcional: envío de email (resumen semanal de seguridad, ver digest.ts).
  // Binding send_email de Cloudflare Email Routing; requiere Email Routing
  // activo y la casilla destino verificada. Sin él, el resumen se salta.
  EMAIL?: SendEmail;
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
    waPublish: num(row.wa_publish) === 1,
    sortOrder: num(row.sort_order),
    createdAt: num(row.created_at),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    brand: row.brand == null || String(row.brand) === "" ? null : String(row.brand),
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

// ---- Texto que se escribe (reparación de mojibake) ----

/**
 * Sanea el texto de un producto antes de escribirlo en D1. El mojibake
 * (UTF-8 leído como latin-1/cp1252, ver shared/encoding.ts) puede venir de la
 * fuente externa o de una importación vieja; con esto el catálogo, el snapshot
 * y el JSON-LD quedan sanos desde el próximo guardado/sync.
 *
 * Se aplica al ESCRIBIR y no al leer: la lectura del catálogo es la ruta
 * caliente (y el snapshot se cachea en KV), así que el costo de sanear 1365
 * productos no debe pagarse en cada request.
 *
 * NO se tocan `id` ni `sourceUrl`: son claves de identidad (los productos se
 * emparejan por id y `source_url` se compara literal en hide/unhide). Si a
 * `sourceUrl` le cambiara un byte, un producto pasaría a verse "desaparecido".
 */
export function repararTextoProducto(p: Product): Product {
  return {
    ...p,
    title: fixMojibake(p.title),
    description: fixMojibake(p.description),
    imageUrl: fixMojibake(p.imageUrl),
    // `== null` cubre null y ausente (el bind ya enviaba null en los dos casos).
    brand: p.brand == null ? null : fixMojibake(p.brand),
  };
}

/** Nombre de categoría saneado (`id` y `parentId` son identidad: no se tocan). */
export function repararNombreCategoria(c: Category): Category {
  return { ...c, name: fixMojibake(c.name) };
}

// ---- Categorías ----

export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await db.prepare("SELECT * FROM categories ORDER BY name").all<Dict>();
  return (results ?? []).map(rowToCategory);
}

export async function upsertCategory(db: D1Database, c: Category, now: number): Promise<void> {
  const limpia = repararNombreCategoria(c);
  await db
    .prepare(
      `INSERT INTO categories (id, name, parent_id, active, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET name = ?2, parent_id = ?3, active = ?4, updated_at = ?5`
    )
    .bind(limpia.id, limpia.name, limpia.parentId, limpia.active ? 1 : 0, now)
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

// ---- Paginación para el panel (Products no carga todos de una) ----

export interface ProductPageFilter {
  status?: "" | "published" | "hidden"; // "" = todos
  q?: string; // búsqueda por título o código (id)
  /** Filtro por origen: "tecnova" | "hacetupedido" | "manual" | "" = todos */
  src?: string;
  limit?: number;
  offset?: number;
}

// Escapa los comodines de LIKE del texto del usuario (búsqueda literal).
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Condición de origen de un producto (el "Origen:" del panel): dominio contenido en
 * `source_url`, o NULL para los altas manuales. Vive acá y no en el panel porque la
 * usan el filtro de la lista, los contadores por origen y la acción masiva de WhatsApp
 * por origen: con una versión cada uno, podrían discrepar en qué es "de Tecnova".
 * Devuelve sql vacío para "todos".
 */
export function sourceCondition(src: string): { sql: string; args: string[] } {
  if (src === "manual") return { sql: "source_url IS NULL", args: [] };
  if (src === "") return { sql: "", args: [] };
  return { sql: "source_url LIKE ?", args: [`%${src}%`] };
}

function productWhere(status: "" | "published" | "hidden", q: string, src = ""): { sql: string; args: string[] } {
  const conds: string[] = [];
  const args: string[] = [];
  if (status === "published" || status === "hidden") {
    conds.push("status = ?");
    args.push(status);
  }
  if (q !== "") {
    const pat = likePattern(q);
    conds.push("(title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')");
    args.push(pat, pat);
  }
  // Origen: dominio contenido en source_url, o NULL para alta manual.
  const origen = sourceCondition(src);
  if (origen.sql !== "") {
    conds.push(origen.sql);
    args.push(...origen.args);
  }
  return { sql: conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "", args };
}

/** Una página de productos (todos los estados según filtro), para el panel. */
export async function listProductsPaged(db: D1Database, f: ProductPageFilter): Promise<Product[]> {
  const { sql, args } = productWhere(f.status ?? "", f.q ?? "", f.src ?? "");
  const limit = Math.max(1, Math.min(200, f.limit ?? 50));
  const offset = Math.max(0, f.offset ?? 0);
  const { results } = await db
    .prepare(`SELECT * FROM products ${sql} ORDER BY sort_order, created_at, id LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
    .all<Dict>();
  return (results ?? []).map(rowToProduct);
}

/** Cantidad de productos que devuelve el mismo filtro (para las páginas). */
export async function countProducts(db: D1Database, f: Pick<ProductPageFilter, "status" | "q" | "src">): Promise<number> {
  const { sql, args } = productWhere(f.status ?? "", f.q ?? "", f.src ?? "");
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM products ${sql}`).bind(...args).first<Dict>();
  return Number(row?.n ?? 0);
}

/** Totales por estado (para los chips "Todos" / "Sin stock" sin cargar filas). */
export async function countProductsByStatus(db: D1Database): Promise<{ published: number; hidden: number; total: number }> {
  const { results } = await db.prepare("SELECT status AS st, COUNT(*) AS n FROM products GROUP BY status").all<Dict>();
  let published = 0;
  let hidden = 0;
  for (const r of results ?? []) {
    if (r.st === "published") published = Number(r.n ?? 0);
    if (r.st === "hidden") hidden = Number(r.n ?? 0);
  }
  return { published, hidden, total: published + hidden };
}

/** Totales por origen (para los chips de origen del panel): dominio contenido en source_url. */
export async function countProductsBySource(db: D1Database): Promise<{ tecnova: number; hacetupedido: number; manual: number }> {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN source_url LIKE '%tecnova%' THEN 1 ELSE 0 END) AS tecnova,
         SUM(CASE WHEN source_url LIKE '%hacetupedido%' THEN 1 ELSE 0 END) AS hacetupedido,
         SUM(CASE WHEN source_url IS NULL THEN 1 ELSE 0 END) AS manual
       FROM products`
    )
    .first<Dict>();
  return { tecnova: Number(row?.tecnova ?? 0), hacetupedido: Number(row?.hacetupedido ?? 0), manual: Number(row?.manual ?? 0) };
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
  const limpio = repararTextoProducto(p);
  await db
    .prepare(
      `INSERT INTO products (id, title, description, price_cents, category_id, subcategory_id, tags, image_url, status, availability, sort_order, created_at, updated_at, source_url, brand)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, ?14)
       ON CONFLICT(id) DO UPDATE SET
         title = ?2, description = ?3, price_cents = ?4, category_id = ?5, subcategory_id = ?6,
         tags = ?7, image_url = ?8, status = ?9, availability = ?10, sort_order = ?11, updated_at = ?12,
         source_url = COALESCE(?13, source_url),
         brand = COALESCE(?14, brand)`
    )
    .bind(
      limpio.id, limpio.title, limpio.description, limpio.priceCents, limpio.categoryId, limpio.subcategoryId,
      JSON.stringify(limpio.tags), limpio.imageUrl, limpio.status, limpio.availability, limpio.sortOrder, now,
      limpio.sourceUrl ?? null, limpio.brand ?? null
    )
    .run();
}

export async function deleteProduct(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM products WHERE id = ?1").bind(id).run();
}

/** D1 acepta como máximo 100 parámetros por sentencia (límite duro del servicio). */
const MAX_PARAMS_PER_STATEMENT = 100;

/**
 * Cuántas filas entran por statement sin pasarse del límite de parámetros.
 * `reserved` = binds fijos de la sentencia que no son de fila (source_url, now…).
 */
export function chunkSizeFor(bindsPerRow: number, reserved = 1): number {
  const perRow = Math.max(1, Math.floor(bindsPerRow));
  const libres = MAX_PARAMS_PER_STATEMENT - Math.max(0, reserved);
  return Math.max(1, Math.floor(libres / perRow));
}

// 4 binds por categoría + 1 de now.
const CATEGORY_CHUNK = chunkSizeFor(4); // 24 categorías -> 97 parámetros
// 1 bind por id + source_url (?1) + updated_at al final: 2 reservados (99 daba 101 y
// reventaba con D1_ERROR en las importaciones grandes).
const ID_CHUNK = chunkSizeFor(1, 2); // 98 ids -> 100 parámetros exactos

export async function upsertCategoriesBatch(db: D1Database, cats: Category[], now: number): Promise<void> {
  if (cats.length === 0) return;
  for (let i = 0; i < cats.length; i += CATEGORY_CHUNK) {
    const chunk = cats.slice(i, i + CATEGORY_CHUNK);
    const stmt = db.prepare(
      `INSERT INTO categories (id, name, parent_id, active, created_at, updated_at)
       VALUES ${chunk.map((_, j) => `(?${j * 4 + 1}, ?${j * 4 + 2}, ?${j * 4 + 3}, ?${j * 4 + 4}, ?${chunk.length * 4 + 1}, ?${chunk.length * 4 + 1})`).join(",")}
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, active = excluded.active, updated_at = excluded.updated_at`
    );
    const binds: unknown[] = [];
    for (const c of chunk) binds.push(c.id, fixMojibake(c.name), c.parentId, c.active ? 1 : 0);
    binds.push(now);
    await stmt.bind(...binds).run();
  }
}

/**
 * Filas por statement en el upsert de productos.
 * Las filas viajan dentro de UN bind (JSON) y se expanden con `json_each`, así que
 * el límite de 100 parámetros por sentencia deja de ser el cuello de botella:
 * con la versión anterior (7 filas por statement por sus 13 binds) una fuente de
 * 370 productos eran 53 statements y reventaba las 50 queries por invocación que
 * permite el plan gratis de Cloudflare — justamente lo que necesitaba la
 * auto-importación de Tecnova (catálogo completo en una sola corrida).
 */
const PRODUCT_JSON_CHUNK = 50;

// `WHERE true` no es redundante: sin una cláusula WHERE el parser de SQLite confunde
// el `ON CONFLICT` del upsert con el `ON` de un JOIN de la sentencia SELECT.
// `now` viaja en cada fila del JSON (created_at/updated_at) para usar un solo bind.
const UPSERT_PRODUCTS_SQL = `
  INSERT INTO products (id, title, description, price_cents, category_id, subcategory_id, tags, image_url, status, availability, sort_order, created_at, updated_at, source_url, brand)
  SELECT
    j.value ->> '$.id',
    j.value ->> '$.title',
    COALESCE(j.value ->> '$.description', ''),
    CAST(j.value ->> '$.priceCents' AS INTEGER),
    j.value ->> '$.categoryId',
    j.value ->> '$.subcategoryId',
    COALESCE(j.value ->> '$.tags', '[]'),
    COALESCE(j.value ->> '$.imageUrl', ''),
    COALESCE(j.value ->> '$.status', 'published'),
    COALESCE(j.value ->> '$.availability', 'in_stock'),
    COALESCE(CAST(j.value ->> '$.sortOrder' AS INTEGER), 0),
    CAST(j.value ->> '$.now' AS INTEGER),
    CAST(j.value ->> '$.now' AS INTEGER),
    j.value ->> '$.sourceUrl',
    j.value ->> '$.brand'
  FROM json_each(?1) AS j
  WHERE true
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, description = excluded.description, price_cents = excluded.price_cents,
    category_id = excluded.category_id,
    subcategory_id = COALESCE(excluded.subcategory_id, products.subcategory_id), tags = excluded.tags,
    image_url = excluded.image_url, status = excluded.status, availability = excluded.availability,
    sort_order = excluded.sort_order, updated_at = excluded.updated_at,
    source_url = COALESCE(excluded.source_url, products.source_url),
    brand = COALESCE(excluded.brand, products.brand)`;

/** Inserta/actualiza productos de a chunks (un solo statement por chunk de JSON).
 *  created_at solo se setea en el INSERT (nuevo producto); en el UPDATE se
 *  preserva el original para que el badge "Nuevo" no se reinicie en cada sync.
 *  Devuelve los productos cuyo upsert falló con el MOTIVO real (para el historial). */
export async function upsertProductsBatch(db: D1Database, prods: Product[], now: number): Promise<{ title: string; reason: string }[]> {
  const failed: { title: string; reason: string }[] = [];
  if (prods.length === 0) return failed;
  // El texto se sanea una sola vez por corrida (todo el lote pasa por acá).
  const limpios = prods.map(repararTextoProducto);
  for (let i = 0; i < limpios.length; i += PRODUCT_JSON_CHUNK) {
    const chunk = limpios.slice(i, i + PRODUCT_JSON_CHUNK);
    const payload = JSON.stringify(chunk.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      priceCents: p.priceCents,
      categoryId: p.categoryId,
      subcategoryId: p.subcategoryId,
      tags: JSON.stringify(p.tags),
      imageUrl: p.imageUrl,
      status: p.status,
      availability: p.availability,
      sortOrder: p.sortOrder,
      sourceUrl: p.sourceUrl ?? null,
      brand: p.brand ?? null,
      now,
    })));
    try {
      await db.prepare(UPSERT_PRODUCTS_SQL).bind(payload).run();
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
  for (let i = 0; i < toHide.length; i += ID_CHUNK) {
    const chunk = toHide.slice(i, i + ID_CHUNK);
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
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const marks = chunk.map((_, j) => `?${j + 2}`).join(",");
    const r = await db
      .prepare(`UPDATE products SET status = 'published', updated_at = ?${chunk.length + 2} WHERE source_url = ?1 AND status = 'hidden' AND id IN (${marks})`)
      .bind(sourceUrl, ...chunk, now)
      .run();
    unhid += r.meta.changes ?? 0;
  }
  return unhid;
}

// ---- Catálogo de WhatsApp (feed CSV que descarga Meta) ----

/**
 * Productos marcados para el catálogo de WhatsApp: SOLO los publicados (un
 * producto oculto —sin stock en la fuente— no debe seguir visible en WhatsApp).
 * Es la consulta que alimenta el feed de src/worker/wa-feed.ts.
 */
export async function listWhatsAppFeedProducts(db: D1Database): Promise<Product[]> {
  const { results } = await db
    .prepare("SELECT * FROM products WHERE wa_publish = 1 AND status = 'published' ORDER BY sort_order, created_at")
    .all<Dict>();
  return (results ?? []).map(rowToProduct);
}

/**
 * Tamaño del feed que descarga Meta, para el panel: marcados, publicados Y con foto.
 * Las tres condiciones son las mismas que aplica el feed (una ficha sin foto no entra:
 * Meta la exige), así el número del panel es la cantidad de filas del archivo y no
 * promete productos que Meta igual va a saltear. Es también la referencia contra la que
 * el panel avisa cuando una acción masiva dejaría el catálogo casi vacío.
 */
export async function countWhatsAppProducts(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE wa_publish = 1 AND status = 'published' AND image_url <> ''")
    .first<Dict>();
  return Number(row?.n ?? 0);
}

export interface WaScopePreview {
  /** Productos del alcance, en cualquier estado. */
  total: number;
  /** Cuántos ya están marcados para WhatsApp. */
  yaMarcados: number;
  /** Cuántos se marcarán con la acción (los que todavía no lo están). */
  aMarcar: number;
  /** De todo el alcance: los que tienen stock y foto, o sea los que el feed toma. */
  conFoto: number;
  /** De todo el alcance: quedan afuera por estar sin stock (hidden). */
  sinStock: number;
  /** De todo el alcance: quedan afuera por no tener foto (Meta la exige). */
  sinFoto: number;
  /** De todo el alcance: los que están EN el feed ahora (marcados, publicados y con foto). */
  enFeed: number;
}

/** Alcance de una acción masiva: una categoría o un origen, ya como WHERE + binds. */
export interface WaScope {
  where: string;
  args: string[];
}

/**
 * Alcance por categoría: la MISMA semántica que el borrado masivo del panel (los
 * productos que la tienen como categoría o como subcategoría).
 */
export function waCategoryScope(categoryId: string): WaScope {
  return { where: "(category_id = ? OR subcategory_id = ?)", args: [categoryId, categoryId] };
}

/**
 * Alcance por origen (Tecnova, Hacetupedido, manuales): la misma semántica que el
 * filtro "Origen:" de la lista. Devuelve null para "todos", porque marcar TODO el
 * catálogo de un saque no es una acción que el panel deba ofrecer a un clic.
 */
export function waSourceScope(src: string): WaScope | null {
  const { sql, args } = sourceCondition(src);
  return sql === "" ? null : { where: sql, args };
}

/**
 * Números para la vista previa de una acción masiva (panel). No modifica nada.
 *
 * `conFoto`/`sinStock`/`sinFoto` se cuentan sobre el alcance ENTERO (no solo sobre los
 * que todavía no están marcados) para que el texto siga diciendo la verdad después de
 * aplicar la acción y para que `conFoto + sinStock + sinFoto = total`. `enFeed` es
 * cuántos de esos ya están en el archivo que descarga Meta.
 */
export async function whatsAppScopePreview(db: D1Database, scope: WaScope): Promise<WaScopePreview> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN wa_publish = 1 THEN 1 ELSE 0 END) AS ya_marcados,
         SUM(CASE WHEN wa_publish = 0 THEN 1 ELSE 0 END) AS a_marcar,
         SUM(CASE WHEN status = 'published' AND image_url <> '' THEN 1 ELSE 0 END) AS con_foto,
         SUM(CASE WHEN status <> 'published' THEN 1 ELSE 0 END) AS sin_stock,
         SUM(CASE WHEN status = 'published' AND image_url = '' THEN 1 ELSE 0 END) AS sin_foto,
         SUM(CASE WHEN wa_publish = 1 AND status = 'published' AND image_url <> '' THEN 1 ELSE 0 END) AS en_feed
       FROM products WHERE ${scope.where}`
    )
    .bind(...scope.args)
    .first<Dict>();
  return {
    total: num(row?.total),
    yaMarcados: num(row?.ya_marcados),
    aMarcar: num(row?.a_marcar),
    conFoto: num(row?.con_foto),
    sinStock: num(row?.sin_stock),
    sinFoto: num(row?.sin_foto),
    enFeed: num(row?.en_feed),
  };
}

/**
 * Marca/desmarca TODO un alcance (una categoría con sus subcategorías, o un origen)
 * para el catálogo de WhatsApp, en una sola consulta.
 *
 * Se marcan también los productos sin stock a propósito: la marca significa "este
 * producto pertenece al catálogo de WhatsApp", así que si la fuente lo vuelve a
 * traer con stock aparece solo (y el feed, mientras tanto, no lo publica). Por eso
 * el `WHERE` filtra por el valor contrario: lo que devuelve son los cambios reales.
 */
export async function setWhatsAppScope(db: D1Database, scope: WaScope, publish: boolean, now: number): Promise<number> {
  const r = await db
    .prepare(
      `UPDATE products SET wa_publish = ?, updated_at = ?
       WHERE wa_publish = ? AND (${scope.where})`
    )
    .bind(publish ? 1 : 0, now, publish ? 0 : 1, ...scope.args)
    .run();
  return r.meta.changes ?? 0;
}

/**
 * Marca/desmarca productos para el catálogo de WhatsApp (acción masiva del panel).
 * Se hace por chunks por el límite de 100 parámetros por sentencia de D1: 98 ids
 * + wa_publish + updated_at = 100 exactos.
 * NO toca `status` ni el snapshot público: la marca no cambia el catálogo del sitio.
 */
export async function setProductsWaPublish(db: D1Database, ids: string[], publish: boolean, now: number): Promise<number> {
  if (ids.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const marks = chunk.map((_, j) => `?${j + 3}`).join(",");
    const r = await db
      .prepare(`UPDATE products SET wa_publish = ?1, updated_at = ?2 WHERE id IN (${marks})`)
      .bind(publish ? 1 : 0, now, ...chunk)
      .run();
    updated += r.meta.changes ?? 0;
  }
  return updated;
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
    .bind(j.id, j.url, fixMojibake(j.label), j.priceRuleId, JSON.stringify(j.times), j.active ? 1 : 0, j.lastRunAt, j.lastStatus, now)
    .run();
}

export async function deleteAutoImport(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM auto_imports WHERE id = ?1").bind(id).run();
}
