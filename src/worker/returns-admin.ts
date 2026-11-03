// Sección DEVOLUCIONES del panel (ETAPA 3).
//
//   GET   /api/admin/returns          — lista paginada con filtro y búsqueda
//   GET   /api/admin/returns/:id      — detalle + historial de estados
//   PATCH /api/admin/returns/:id      — cambia el estado y/o la respuesta pública
//
// Estas rutas se registran sobre `adminApp`, así heredan el login y el sliding
// session del panel: nunca se exponen sin sesión. A diferencia del seguimiento
// público, acá sí se ven nombre, WhatsApp/email y el comentario del cliente:
// son los datos con los que el comercio responde la solicitud.

import type { Hono } from "hono";
import type { Env } from "./db";
import { nowMs } from "./settings";
import {
  RETURN_STATUSES, STATUS_LABEL,
  type AdminReturn, type AdminReturnDetail, type AdminReturnEvent, type ReturnKind, type ReturnStatus,
} from "../shared/returns";
import { KIND_LABEL } from "../shared/returns";

interface Row {
  id: string;
  code: string;
  kind: string;
  name: string;
  contact: string;
  contact_kind: string;
  order_ref: string | null;
  product: string | null;
  detail: string | null;
  status: string;
  response: string | null;
  created_at: number;
  updated_at: number;
}

const COLUMNS =
  "id, code, kind, name, contact, contact_kind, order_ref, product, detail, status, response, created_at, updated_at";

function asKind(value: string): ReturnKind {
  return value in KIND_LABEL ? (value as ReturnKind) : "arrepentimiento";
}

function asStatus(value: string): ReturnStatus {
  return (RETURN_STATUSES as readonly string[]).includes(value) ? (value as ReturnStatus) : "recibida";
}

function toReturn(row: Row): AdminReturn {
  return {
    id: row.id,
    code: row.code,
    kind: asKind(row.kind),
    name: row.name,
    contact: row.contact,
    contactKind: row.contact_kind === "email" ? "email" : "wa",
    orderRef: row.order_ref,
    product: row.product,
    detail: row.detail,
    status: asStatus(row.status),
    response: row.response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Misma condición para listar y contar: el buscador no puede dar un total que
// no coincida con las filas mostradas.
const FILTER = `WHERE (?1 = '' OR status = ?1)
  AND (?2 = '' OR name LIKE ?2 OR code LIKE ?2 OR contact LIKE ?2 OR order_ref LIKE ?2 OR product LIKE ?2)`;

export interface ReturnFilters {
  status: "" | ReturnStatus;
  /** Texto ya normalizado sin comodines; "" = sin búsqueda. */
  q: string;
  limit: number;
  offset: number;
}

function like(q: string): string {
  return q === "" ? "" : `%${q}%`;
}

export async function listReturnsPaged(db: D1Database, f: ReturnFilters): Promise<AdminReturn[]> {
  const res = await db
    .prepare(`SELECT ${COLUMNS} FROM return_requests ${FILTER} ORDER BY created_at DESC LIMIT ?3 OFFSET ?4`)
    .bind(f.status, like(f.q), f.limit, f.offset)
    .all<Row>();
  return (res.results ?? []).map(toReturn);
}

export async function countReturns(db: D1Database, f: Pick<ReturnFilters, "status" | "q">): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS total FROM return_requests ${FILTER}`)
    .bind(f.status, like(f.q))
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

/** Contadores de los chips: un solo GROUP BY para todos los estados. */
export async function countReturnsByStatus(db: D1Database): Promise<Record<string, number>> {
  const res = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM return_requests GROUP BY status`)
    .all<{ status: string; n: number }>();
  const counts: Record<string, number> = {};
  for (const r of res.results ?? []) counts[asStatus(r.status)] = Number(r.n ?? 0);
  return counts;
}

async function eventsOf(db: D1Database, id: string): Promise<AdminReturnEvent[]> {
  const res = await db
    .prepare(`SELECT ts, status, note FROM return_events WHERE request_id = ?1 ORDER BY ts ASC`)
    .bind(id)
    .all<{ ts: number; status: string; note: string | null }>();
  return (res.results ?? []).map((e) => {
    const status = asStatus(e.status);
    return { at: e.ts, status, label: STATUS_LABEL[status], note: e.note ?? null };
  });
}

export async function getReturnDetail(db: D1Database, id: string): Promise<AdminReturnDetail | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM return_requests WHERE id = ?1`)
    .bind(id)
    .first<Row>();
  if (!row) return null;
  return { ...toReturn(row), history: await eventsOf(db, id) };
}

export interface ReturnPatch {
  status?: ReturnStatus;
  /** undefined = no tocar; null/"" = borrar la respuesta pública. */
  response?: string | null;
}

/**
 * Aplica cambios del panel. Solo escribe un hito en el historial cuando cambia
 * el estado (el seguimiento público lo lista como pasos); editar la respuesta
 * no agrega un paso repetido.
 */
export async function adminUpdateReturn(
  db: D1Database,
  id: string,
  patch: ReturnPatch,
  ts: number = nowMs(),
): Promise<AdminReturnDetail | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM return_requests WHERE id = ?1`)
    .bind(id)
    .first<Row>();
  if (!row) return null;

  const status = patch.status ?? asStatus(row.status);
  const response = patch.response === undefined ? row.response : patch.response;
  const changed = status !== asStatus(row.status);

  await db
    .prepare(`UPDATE return_requests SET status = ?2, response = ?3, updated_at = ?4 WHERE id = ?1`)
    .bind(id, status, response, ts)
    .run();

  if (changed) {
    await db
      .prepare(`INSERT INTO return_events (request_id, ts, status, note) VALUES (?1, ?2, ?3, ?4)`)
      .bind(id, ts, status, `Estado: ${STATUS_LABEL[status]}`)
      .run();
  }
  return getReturnDetail(db, id);
}

export function registerReturnAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/returns", async (c) => {
    const statusRaw = c.req.query("status") ?? "";
    const status: "" | ReturnStatus = (RETURN_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as ReturnStatus)
      : "";
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    const page = Math.max(1, Math.min(500, Math.trunc(Number(c.req.query("page") ?? 1)) || 1));
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(c.req.query("limit") ?? 50)) || 50));
    const filters = { status, q, limit, offset: (page - 1) * limit };
    const [returns, total, counts] = await Promise.all([
      listReturnsPaged(c.env.DB, filters),
      countReturns(c.env.DB, { status, q }),
      countReturnsByStatus(c.env.DB),
    ]);
    return c.json({
      returns,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
      counts,
    });
  });

  app.get("/returns/:id", async (c) => {
    const detail = await getReturnDetail(c.env.DB, c.req.param("id"));
    if (!detail) return c.json({ error: "Solicitud no encontrada" }, 404);
    return c.json({ request: detail });
  });

  app.patch("/returns/:id", async (c) => {
    const body = await c.req.json<{ status?: unknown; response?: unknown }>().catch(() => null);
    if (!body || (body.status === undefined && body.response === undefined)) {
      return c.json({ error: "Nada para actualizar" }, 400);
    }

    const patch: ReturnPatch = {};
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!(RETURN_STATUSES as readonly string[]).includes(status)) return c.json({ error: "Estado inválido" }, 400);
      patch.status = status as ReturnStatus;
    }
    if (body.response !== undefined) {
      if (body.response !== null && typeof body.response !== "string") {
        return c.json({ error: "Respuesta inválida" }, 400);
      }
      // Se recorta a 1000 caracteres: es lo que entra en la ficha pública.
      const response = (body.response ?? "").trim().slice(0, 1000);
      patch.response = response === "" ? null : response;
    }

    const request = await adminUpdateReturn(c.env.DB, c.req.param("id"), patch);
    if (!request) return c.json({ error: "Solicitud no encontrada" }, 404);
    return c.json({ ok: true, request });
  });
}
