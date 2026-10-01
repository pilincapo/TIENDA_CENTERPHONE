// Pedidos: acceso a D1 + validación server-side del carrito.
// Regla de oro: el cliente solo manda {id, qty}; los precios, títulos y el
// total se recalculan acá desde la base (sync de precios cada hora => nunca
// confiar en un total que venga del navegador).

import type { Order, OrderItem, OrderStatus } from "../shared/types";
import { ORDER_STATUSES } from "../shared/types";
import type { Product } from "../shared/types";
import type { Dict } from "./db";

export const MAX_QTY_PER_ITEM = 10;
export const MAX_ITEMS = 20;

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function rowToOrder(row: Dict): Order {
  let items: OrderItem[] = [];
  try {
    const parsed = JSON.parse(String(row.items_json ?? "[]")) as unknown;
    if (Array.isArray(parsed)) {
      items = parsed
        .filter((i): i is OrderItem => !!i && typeof i === "object")
        .map((i) => ({
          id: String((i as OrderItem).id ?? ""),
          title: String((i as OrderItem).title ?? ""),
          qty: Math.max(1, Math.round(Number((i as OrderItem).qty ?? 1))),
          // Puede ser negativo: es el ítem de ajuste "descuento-transferencia"
          // que se congela al crear el pedido (items_json lo escribe solo el
          // servidor, nunca el cliente).
          priceCents: Math.round(Number((i as OrderItem).priceCents ?? 0)),
        }))
        .filter((i) => i.id !== "");
    }
  } catch {
    items = [];
  }
  const status = String(row.status ?? "pending") as OrderStatus;
  return {
    id: String(row.id ?? ""),
    status: ORDER_STATUSES.includes(status) ? status : "pending",
    totalCents: num(row.total_cents),
    currency: String(row.currency ?? "ARS"),
    buyerName: String(row.buyer_name ?? ""),
    buyerPhone: String(row.buyer_phone ?? ""),
    payerEmail: row.payer_email == null ? null : String(row.payer_email),
    items,
    mpPreferenceId: row.mp_preference_id == null ? null : String(row.mp_preference_id),
    mpPaymentId: row.mp_payment_id == null ? null : String(row.mp_payment_id),
    paidAt: row.paid_at == null ? null : num(row.paid_at),
    notifiedWa: num(row.notified_wa) === 1,
    archivedAt: row.archived_at == null ? null : num(row.archived_at),
    archivedBy: row.archived_by == null ? null : String(row.archived_by),
    archiveNote: row.archive_note == null ? null : String(row.archive_note),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

export async function insertOrder(db: D1Database, o: Order): Promise<void> {
  // D1 no permite reutilizar el mismo placeholder numerado (?13 dos veces):
  // created_at y updated_at van como ?13 y ?14 con el mismo valor.
  await db
    .prepare(
      `INSERT INTO orders (id, status, total_cents, currency, buyer_name, buyer_phone, payer_email, items_json, mp_preference_id, mp_payment_id, paid_at, notified_wa, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    )
    .bind(
      o.id, o.status, o.totalCents, o.currency, o.buyerName, o.buyerPhone,
      o.payerEmail, JSON.stringify(o.items), o.mpPreferenceId, o.mpPaymentId,
      o.paidAt, o.notifiedWa ? 1 : 0, o.createdAt, o.updatedAt,
    )
    .run();
}

export async function getOrder(db: D1Database, id: string): Promise<Order | null> {
  const row = await db.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first<Dict>();
  return row ? rowToOrder(row) : null;
}

/** Pedidos para el panel (listado completo, más nuevos primero). */
export async function listOrders(db: D1Database, status: string, limit = 100): Promise<Order[]> {
  const capped = Math.min(Math.max(1, limit), 200);
  const { results } = status !== "" && ORDER_STATUSES.includes(status as OrderStatus)
    ? await db.prepare("SELECT * FROM orders WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2").bind(status, capped).all<Dict>()
    : await db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?1").bind(capped).all<Dict>();
  return (results ?? []).map(rowToOrder);
}

// ---- Paginación para el panel (Orders no carga todos de una) ----

export interface OrderPageFilter {
  status?: "" | OrderStatus; // "" = todos
  q?: string; // búsqueda por nombre de comprador o id de pedido
  limit?: number;
  offset?: number;
}

// Escapa los comodines de LIKE del texto del usuario (búsqueda literal).
function orderLikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function orderWhere(status: string, q: string): { sql: string; args: string[] } {
  const conds: string[] = [];
  const args: string[] = [];
  if (status !== "" && ORDER_STATUSES.includes(status as OrderStatus)) {
    conds.push("status = ?");
    args.push(status);
  } else if (status === "") {
    // Sin filtro explicito: excluye 'archived' (los archivados solo se ven
    // en la pestana de historico, donde status="archived").
    conds.push("status != ?");
    args.push("archived");
  }
  if (q !== "") {
    const pat = orderLikePattern(q);
    conds.push("(buyer_name LIKE ? ESCAPE '\' OR id LIKE ? ESCAPE '\')");
    args.push(pat, pat);
  }
  return { sql: conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "", args };
}

/** Una página de pedidos (todos los estados según filtro), para el panel. */
export async function listOrdersPaged(db: D1Database, f: OrderPageFilter): Promise<Order[]> {
  const { sql, args } = orderWhere(f.status ?? "", f.q ?? "");
  const limit = Math.max(1, Math.min(200, f.limit ?? 50));
  const offset = Math.max(0, f.offset ?? 0);
  const { results } = await db
    .prepare(`SELECT * FROM orders ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
    .all<Dict>();
  return (results ?? []).map(rowToOrder);
}

/** Cantidad de pedidos que devuelve el mismo filtro (para las páginas). */
export async function countOrders(db: D1Database, f: Pick<OrderPageFilter, "status" | "q">): Promise<number> {
  const { sql, args } = orderWhere(f.status ?? "", f.q ?? "");
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM orders ${sql}`).bind(...args).first<Dict>();
  return Number(row?.n ?? 0);
}

/** Totales por estado (para los chips sin cargar filas). */
export async function countOrdersByStatus(db: D1Database): Promise<Record<OrderStatus, number>> {
  const { results } = await db
    .prepare("SELECT status AS st, COUNT(*) AS n FROM orders GROUP BY status")
    .all<Dict>();
  const counts: Record<OrderStatus, number> = { pending: 0, paid: 0, cancelled: 0, rejected: 0, archived: 0 };
  for (const r of results ?? []) {
    if (ORDER_STATUSES.includes(String(r.st) as OrderStatus)) {
      counts[String(r.st) as OrderStatus] = Number(r.n ?? 0);
    }
  }
  return counts;
}

/** Marca de estado (panel o webhook). Idempotente: paid sólo escribe una vez. */
export async function updateOrderStatus(db: D1Database, id: string, status: OrderStatus, patch: { payerEmail?: string | null; mpPaymentId?: string | null } = {}): Promise<Order | null> {
  const existing = await getOrder(db, id);
  if (!existing) return null;
  if (existing.status === "paid" && status !== "paid") return existing; // no bajar de paid
  const paidAt = status === "paid" ? (existing.paidAt ?? Date.now()) : existing.paidAt;
  const payerEmail = patch.payerEmail !== undefined ? patch.payerEmail : existing.payerEmail;
  const mpPaymentId = patch.mpPaymentId !== undefined ? patch.mpPaymentId : existing.mpPaymentId;
  await db
    .prepare("UPDATE orders SET status = ?2, payer_email = ?3, mp_payment_id = ?4, paid_at = ?5, updated_at = ?6 WHERE id = ?1")
    .bind(id, status, payerEmail, mpPaymentId, paidAt, Date.now())
    .run();
  return getOrder(db, id);
}

/** Cambio manual desde el panel: escribe sin restricciones (a diferencia de
 *  updateOrderStatus, que usa el webhook y nunca baja un pedido de "paid"). */
export async function adminSetOrderStatus(db: D1Database, id: string, status: OrderStatus): Promise<Order | null> {
  const existing = await getOrder(db, id);
  if (!existing) return null;
  const paidAt = status === "paid" ? (existing.paidAt ?? Date.now()) : null;
  await db.prepare("UPDATE orders SET status = ?2, paid_at = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(id, status, paidAt, Date.now())
    .run();
  return getOrder(db, id);
}

/** Archiva un pedido: pasa a estado 'archived' con fecha y autor.
 *  Idempotente: si ya estaba archivado, no escribe ni cambia la fecha. */
export async function adminSetOrderArchive(db: D1Database, id: string, archive: { archivedBy?: string | null; note?: string | null } = {}): Promise<Order | null> {
  const existing = await getOrder(db, id);
  if (!existing) return null;
  if (existing.status === "archived") return existing;
  const now = Date.now();
  const archivedBy = archive.archivedBy === undefined ? null : String(archive.archivedBy).slice(0, 120);
  const note = archive.note === undefined || archive.note === null ? null : (String(archive.note).trim().slice(0, 200) || null);
  await db
    .prepare("UPDATE orders SET status = 'archived', archived_at = ?2, archived_by = ?3, archive_note = ?4, updated_at = ?5 WHERE id = ?1")
    .bind(id, now, archivedBy, note, now)
    .run();
  return getOrder(db, id);
}

/** Restaura un pedido archivado: vuelve a paid si tiene paid_at (el archivo
 *  nunca toca paid_at), o a pending en caso contrario. */
export async function adminSetOrderUnarchive(db: D1Database, id: string): Promise<Order | null> {
  const existing = await getOrder(db, id);
  if (!existing) return null;
  if (existing.status !== "archived") return existing;
  const restored = existing.paidAt != null ? "paid" : "pending";
  await db
    .prepare("UPDATE orders SET status = ?2, archived_at = NULL, archived_by = NULL, archive_note = NULL, updated_at = ?3 WHERE id = ?1")
    .bind(id, restored, Date.now())
    .run();
  return getOrder(db, id);
}

export async function setOrderNotifiedWa(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE orders SET notified_wa = 1, updated_at = ?2 WHERE id = ?1").bind(id, Date.now()).run();
}

export async function setOrderPreference(db: D1Database, id: string, preferenceId: string): Promise<void> {
  await db.prepare("UPDATE orders SET mp_preference_id = ?2, updated_at = ?3 WHERE id = ?1").bind(id, preferenceId, Date.now()).run();
}

// ---- Validación del carrito (server-side) ----

export interface CartInput {
  id?: unknown;
  qty?: unknown;
}

export interface CartValidation {
  ok: boolean;
  error?: string;
  items?: OrderItem[];
  totalCents?: number;
}

/**
 * Convierte el input crudo del cliente en ítems válidos recalculando TODO
 * desde la lista de productos de la base (listProducts con all=false ya
 * excluye los ocultos). Rechaza: producto inexistente/oculto, sin stock,
 * "bajo pedido", qty fuera de 1..10, más de 20 líneas, carrito vacío.
 */
export function validateCart(raw: CartInput[], products: Product[]): CartValidation {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "El carrito está vacío" };
  if (raw.length > MAX_ITEMS) return { ok: false, error: `Máximo ${MAX_ITEMS} productos distintos por pedido` };
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: OrderItem[] = [];
  for (const entry of raw) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const qty = Math.round(Number(entry?.qty ?? 1));
    const p = byId.get(id);
    if (!p) return { ok: false, error: "Un producto del carrito ya no está disponible" };
    // Defensa extra: aunque el caller pase listProducts(all=false), un hidden
    // que se cueló nunca es comprable.
    if (p.status !== "published") return { ok: false, error: "Un producto del carrito ya no está disponible" };
    if (p.availability !== "in_stock") return { ok: false, error: `"${p.title}" no está disponible para compra online` };
    if (!Number.isFinite(qty) || qty < 1) return { ok: false, error: "Cantidad inválida" };
    if (qty > MAX_QTY_PER_ITEM) return { ok: false, error: `Máximo ${MAX_QTY_PER_ITEM} unidades de "${p.title}"` };
    const existing = items.find((i) => i.id === id);
    if (existing) {
      if (existing.qty + qty > MAX_QTY_PER_ITEM) return { ok: false, error: `Máximo ${MAX_QTY_PER_ITEM} unidades de "${p.title}"` };
      existing.qty += qty;
    } else {
      items.push({ id: p.id, title: p.title, qty, priceCents: p.priceCents });
    }
  }
  if (items.length === 0) return { ok: false, error: "El carrito está vacío" };
  const totalCents = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
  return { ok: true, items, totalCents };
}

/** Limpia datos del comprador: acotados y sin caracteres de control. */
export function sanitizeBuyer(name: unknown, phone: unknown): { name: string; phone: string } {
  return {
    name: String(name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80),
    phone: String(phone ?? "").replace(/[^0-9+\-\s()]/g, "").trim().slice(0, 24),
  };
}
