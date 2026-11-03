// Solicitudes de cambio, devolución, garantía y arrepentimiento (ETAPA 2).
//
//   POST /api/returns          — crea la solicitud y devuelve el código
//   GET  /api/returns/:token   — estado público (sin datos personales)
//
// Reglas legales que este módulo hace cumplir:
//  - Sin registro, sin cuenta y sin justificar el motivo (Ley 24.240 art. 34;
//    Disposición 954/2025). El campo `detail` es opcional.
//  - Se registra fecha y hora de recepción y se devuelve un código identificador
//    en el acto (la política promete informarlo dentro de las 24 h).
//  - El seguimiento público no expone nombre, teléfono, email ni notas internas.
//
// Anti-abuso: sin datos del cliente para validar (no hay login), así que se
// combinan honeypot, límite de tamaño del body, mismo origen y un rate limit
// por IP (en memoria del isolate + consulta D1 de las últimas horas).

import { Hono } from "hono";
import type { Env } from "./db";
import { nowMs } from "./settings";

export const RETURN_KINDS = ["arrepentimiento", "cambio", "devolucion", "garantia"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];

/** Estados posibles. El comercio los cambia desde el panel (ETAPA 3). */
export const RETURN_STATUSES = ["recibida", "en_revision", "aprobada", "resuelta", "cerrada"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const KIND_LABEL: Record<ReturnKind, string> = {
  arrepentimiento: "Arrepentimiento (compra a distancia)",
  cambio: "Cambio",
  devolucion: "Devolución",
  garantia: "Garantía",
};

export const STATUS_LABEL: Record<ReturnStatus, string> = {
  recibida: "Solicitud recibida",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  resuelta: "Resuelta",
  cerrada: "Cerrada",
};

const KIND_PREFIX: Record<ReturnKind, string> = {
  arrepentimiento: "ARR",
  cambio: "CAM",
  devolucion: "DEV",
  garantia: "GAR",
};

export interface ReturnRequest {
  id: string;
  code: string;
  kind: ReturnKind;
  name: string;
  contact: string;
  contactKind: "wa" | "email";
  orderRef: string | null;
  product: string | null;
  detail: string | null;
  status: ReturnStatus;
  response: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Lo que se devuelve por la API pública: sin datos personales ni notas. */
export interface PublicReturn {
  code: string;
  kind: ReturnKind;
  kindLabel: string;
  status: ReturnStatus;
  statusLabel: string;
  product: string | null;
  response: string | null;
  createdAt: number;
  updatedAt: number;
  history: { at: number; status: ReturnStatus; label: string }[];
}

// ---- Helpers ----

/** Id de 32 hex (credencial del seguimiento), como en /pedido/:id. */
export function newToken(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidToken(token: string): boolean {
  return /^[0-9a-f]{32}$/.test(token);
}

// Sin caracteres ambiguos (0/O, 1/I/L): el código se dicta por teléfono.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Código legible, p. ej. ARR-7K4P2M. */
export function newCode(kind: ReturnKind): string {
  const buf = crypto.getRandomValues(new Uint8Array(6));
  const body = [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${KIND_PREFIX[kind]}-${body}`;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Se descartan los caracteres de control (incluye saltos en campos de una
  // línea) y se recorta el largo: el body ya viene limitado, pero esto evita
  // filas gigantes en D1.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

export interface ReturnInput {
  kind: ReturnKind;
  name: string;
  contact: string;
  contactKind: "wa" | "email";
  orderRef: string | null;
  product: string | null;
  detail: string | null;
}

export type ValidationResult = { ok: true; value: ReturnInput } | { ok: false; error: string };

/** Valida y normaliza el cuerpo del formulario. No mira la DB. */
export function validateReturnInput(raw: {
  kind?: unknown;
  name?: unknown;
  contact?: unknown;
  orderRef?: unknown;
  product?: unknown;
  detail?: unknown;
}): ValidationResult {
  const kindRaw = typeof raw.kind === "string" ? raw.kind : "arrepentimiento";
  const kind = (RETURN_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ReturnKind) : "arrepentimiento";

  const name = clean(raw.name, 80);
  if (name.length < 2) return { ok: false, error: "Necesitamos tu nombre para identificar la solicitud" };

  const contactRaw = clean(raw.contact, 120);
  if (contactRaw === "") return { ok: false, error: "Dejanos un WhatsApp o un email para responderte" };

  let contactKind: "wa" | "email" = "wa";
  let contact = contactRaw;
  if (contactRaw.includes("@")) {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(contactRaw)) return { ok: false, error: "El email no parece válido" };
    contactKind = "email";
    contact = contactRaw.toLowerCase();
  } else {
    const digits = contactRaw.replace(/\D/g, "");
    // WhatsApp argentino con código de país: 10 a 15 dígitos.
    if (digits.length < 8 || digits.length > 15) return { ok: false, error: "El número de WhatsApp no parece válido" };
    contactKind = "wa";
    contact = digits;
  }

  return {
    ok: true,
    value: {
      kind,
      name,
      contact,
      contactKind,
      orderRef: clean(raw.orderRef, 40) || null,
      product: clean(raw.product, 120) || null,
      detail: cleanMultiline(raw.detail, 1000) || null,
    },
  };
}

/** Hash de la IP: sirve para limitar abuso sin guardar el dato en claro. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ---- Persistencia ----

export async function insertReturn(
  db: D1Database,
  input: ReturnInput,
  ipHash: string | null,
): Promise<{ id: string; code: string }> {
  const ts = nowMs();
  const id = newToken();
  // Colisión de código: 30^6 combinaciones; se reintenta por las dudas (el
  // UNIQUE de `code` es la garantía final).
  for (let intento = 0; intento < 5; intento++) {
    const code = newCode(input.kind);
    try {
      await db
        .prepare(
          `INSERT INTO return_requests
             (id, code, kind, name, contact, contact_kind, order_ref, product, detail, status, response, ip_hash, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'recibida', NULL, ?10, ?11, ?11)`,
        )
        .bind(id, code, input.kind, input.name, input.contact, input.contactKind, input.orderRef, input.product, input.detail, ipHash, ts)
        .run();
      await db
        .prepare(`INSERT INTO return_events (request_id, ts, status, note) VALUES (?1, ?2, 'recibida', ?3)`)
        .bind(id, ts, "Solicitud registrada")
        .run();
      return { id, code };
    } catch (e) {
      // Si el choque fue del código, se prueba otro; cualquier otro error sube.
      if (String(e).includes("UNIQUE") && String(e).includes("code")) continue;
      throw e;
    }
  }
  throw new Error("No se pudo generar un código único");
}

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

function asKind(value: string): ReturnKind {
  return (RETURN_KINDS as readonly string[]).includes(value) ? (value as ReturnKind) : "arrepentimiento";
}

function asStatus(value: string): ReturnStatus {
  return (RETURN_STATUSES as readonly string[]).includes(value) ? (value as ReturnStatus) : "recibida";
}

export async function getReturnByToken(db: D1Database, token: string): Promise<ReturnRequest | null> {
  if (!isValidToken(token)) return null;
  const row = await db
    .prepare(
      `SELECT id, code, kind, name, contact, contact_kind, order_ref, product, detail, status, response, created_at, updated_at
         FROM return_requests WHERE id = ?1`,
    )
    .bind(token)
    .first<Row>();
  if (!row) return null;
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

/** Vista pública: sin nombre, contacto ni comentarios internos. */
export async function getPublicReturn(db: D1Database, token: string): Promise<PublicReturn | null> {
  const req = await getReturnByToken(db, token);
  if (!req) return null;
  const events = await db
    .prepare(`SELECT ts, status FROM return_events WHERE request_id = ?1 ORDER BY ts ASC`)
    .bind(req.id)
    .all<{ ts: number; status: string; note: string | null }>();
  const history = (events.results ?? []).map((e) => {
    const status = asStatus(e.status);
    return { at: e.ts, status, label: STATUS_LABEL[status] };
  });
  return {
    code: req.code,
    kind: req.kind,
    kindLabel: KIND_LABEL[req.kind],
    status: req.status,
    statusLabel: STATUS_LABEL[req.status],
    product: req.product,
    response: req.response,
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
    history,
  };
}

// ---- Anti-abuso ----

const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 5;

const attempts = new Map<string, { count: number; resetAt: number }>();

export function resetReturnRateLimit(): void {
  attempts.clear();
}

function rateLimited(ip: string, now: number): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= RATE_MAX;
}

function recordAttempt(ip: string, now: number): void {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  else entry.count += 1;
}

function sameOrigin(c: { req: { header: (n: string) => string | undefined; url: string } }): boolean {
  const raw = c.req.header("origin") ?? c.req.header("referer") ?? "";
  if (raw === "") return true; // curl / formularios sin cabecera: lo frena el rate limit
  let host = c.req.header("host") ?? "";
  if (host === "") {
    try {
      host = new URL(c.req.url).host;
    } catch {
      return false;
    }
  }
  try {
    return new URL(raw).host === host;
  } catch {
    return false;
  }
}

export const returnsApp = new Hono<{ Bindings: Env }>();

returnsApp.post("/api/returns", async (c) => {
  if (!sameOrigin(c)) return c.json({ ok: false, error: "Origen no permitido" }, 403);

  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const now = nowMs();
  if (rateLimited(ip, now)) {
    return c.json({ ok: false, error: "Recibimos varias solicitudes desde esta conexión. Esperá unos minutos o escribinos por WhatsApp." }, 429);
  }

  // Tamaño: se lee el texto y se corta antes de parsear (un body enorme no debe
  // llegar nunca al parser ni a D1).
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ ok: false, error: "El formulario es demasiado largo" }, 413);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "Datos inválidos" }, 400);
  }

  // Honeypot: un campo que el formulario oculta por CSS. Si viene con contenido
  // es un bot; se responde 200 sin crear nada (no se le da señal de error).
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return c.json({ ok: true, code: "ARR-000000", token: "", url: "" });
  }

  const result = validateReturnInput(body);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 400);

  recordAttempt(ip, now);
  const ipHash = await hashIp(ip, c.env.ADMIN_SESSION_SECRET ?? "").catch(() => null);
  const created = await insertReturn(c.env.DB, result.value, ipHash);
  return c.json(
    {
      ok: true,
      code: created.code,
      token: created.id,
      url: `/devoluciones/seguimiento/${created.id}`,
      message: "Solicitud registrada. Te informamos el código por el mismo medio en el que la iniciaste.",
    },
    201,
  );
});

returnsApp.get("/api/returns/:token", async (c) => {
  const data = await getPublicReturn(c.env.DB, c.req.param("token"));
  if (!data) return c.json({ ok: false, error: "Solicitud no encontrada" }, 404);
  return c.json({ ok: true, request: data }, 200, { "Cache-Control": "no-store" });
});
