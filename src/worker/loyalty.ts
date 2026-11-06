// Club CenterPhone: API pública del club de socios.
//
//   POST /api/loyalty/join      — alta gratuita (o recuperación por WhatsApp)
//   GET  /api/loyalty/validate  — valida un código para el carrito
//
// Reglas:
//  - Suscripción gratuita: sin cuenta, sin contraseña y sin tarjeta. El código
//    SOC-XXXXXX es la credencial; el WhatsApp normalizado permite recuperarlo.
//  - El alta solo guarda nombre, WhatsApp, email y cumpleaños (día/mes) si el
//    cliente los carga. No se exponen por la API pública.
//  - Anti-abuso igual que /api/returns: mismo origen, honeypot, tope de body y
//    rate limit por IP en memoria del isolate.

import { Hono } from "hono";
import type { Dict, Env } from "./db";
import { getSettings, newId, nowMs } from "./settings";
import {
  MEMBER_CODE_PREFIX, birthdayMonthDay, effectiveMemberPercent, firstName, isValidMemberCode,
  isValidMemberPhone, memberPhoneMatches, memberTierPercent, newMemberCodeBody,
  normalizeMemberCode, normalizeMemberPhone,
  type Member,
} from "../shared/loyalty";

const COLUMNS =
  "id, code, name, phone, email, birthday, active, source, created_at, updated_at, last_order_at, discount_percent";

/** Fila de D1 → Member (los valores de D1 son laxos: se normalizan acá). */
export function rowToMember(row: Dict): Member {
  const source = String(row.source ?? "web");
  return {
    id: String(row.id ?? ""),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    email: row.email == null ? null : String(row.email),
    birthday: row.birthday == null ? null : String(row.birthday),
    active: Number(row.active ?? 0) === 1,
    // Solo 5/10/15: un valor viejo o raro cae al descuento base en vez de romper.
    discountPercent: memberTierPercent(row.discount_percent),
    source: source === "panel" ? "panel" : "web",
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    lastOrderAt: row.last_order_at == null ? null : Number(row.last_order_at),
  };
}

export async function getMemberByPhone(db: D1Database, phone: string): Promise<Member | null> {
  if (phone === "") return null;
  const row = await db.prepare(`SELECT ${COLUMNS} FROM members WHERE phone = ?1`).bind(phone).first<Dict>();
  return row ? rowToMember(row) : null;
}

export async function getMemberByCode(db: D1Database, code: string): Promise<Member | null> {
  const normalized = normalizeMemberCode(code);
  if (!isValidMemberCode(normalized)) return null;
  const row = await db.prepare(`SELECT ${COLUMNS} FROM members WHERE code = ?1`).bind(normalized).first<Dict>();
  return row ? rowToMember(row) : null;
}

/** Solo socios activos: un código desactivado no da descuento. */
export async function getActiveMemberByCode(db: D1Database, code: string): Promise<Member | null> {
  const member = await getMemberByCode(db, code);
  return member && member.active ? member : null;
}

/** Alta: reintenta si el código aleatorio choca con el índice único. */
export async function insertMember(
  db: D1Database,
  input: MemberInput,
  source: Member["source"] = "web",
  // Nivel del club con el que entra el socio; null = el base de la configuración.
  discountPercent: unknown = null,
): Promise<Member> {
  const now = nowMs();
  for (let attempt = 0; attempt < 5; attempt++) {
    const member: Member = {
      id: newId() + newId(),
      code: `${MEMBER_CODE_PREFIX}-${newMemberCodeBody()}`,
      name: input.name,
      phone: input.phone,
      email: input.email,
      birthday: input.birthday,
      active: true,
      discountPercent: memberTierPercent(discountPercent),
      source,
      createdAt: now,
      updatedAt: now,
      lastOrderAt: null,
    };
    try {
      await db
        .prepare(
          `INSERT INTO members (id, code, name, phone, email, birthday, active, source, created_at, updated_at, last_order_at, discount_percent)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          member.id, member.code, member.name, member.phone, member.email, member.birthday,
          member.active ? 1 : 0, member.source, member.createdAt, member.updatedAt, member.lastOrderAt,
          member.discountPercent,
        )
        .run();
      return member;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Si el choque es del WhatsApp (otro request lo creó en paralelo), se
      // devuelve ese socio en vez de seguir intentando.
      const existing = await getMemberByPhone(db, input.phone).catch(() => null);
      if (existing && /unique|constraint/i.test(message)) return existing;
      if (!/unique|constraint/i.test(message)) throw e;
    }
  }
  throw new Error("No se pudo generar un código de socio único");
}

/** Marca el último pedido del socio (solo se llama con un código válido). */
export async function touchMemberOrder(db: D1Database, memberId: string): Promise<void> {
  const now = nowMs();
  await db
    .prepare("UPDATE members SET last_order_at = ?2, updated_at = ?3 WHERE id = ?1")
    .bind(memberId, now, now)
    .run();
}

// ---- Validación del alta ----

export interface MemberInput {
  name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
}

export type MemberValidation = { ok: true; value: MemberInput } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function validateMemberInput(body: Record<string, unknown>): MemberValidation {
  const name = cleanName(body.name);
  if (name.length < 2) return { ok: false, error: "Ingresá tu nombre" };

  const phone = normalizeMemberPhone(body.phone);
  if (!isValidMemberPhone(phone)) {
    return { ok: false, error: "Ingresá un WhatsApp válido, con código de área y sin 0 ni 15" };
  }

  let email: string | null = null;
  if (body.email !== undefined && body.email !== null && String(body.email).trim() !== "") {
    const candidate = String(body.email).trim().toLowerCase();
    if (candidate.length > 120 || !EMAIL_RE.test(candidate)) {
      return { ok: false, error: "Revisá el email" };
    }
    email = candidate;
  }

  let birthday: string | null = null;
  if (body.birthday !== undefined && body.birthday !== null && String(body.birthday).trim() !== "") {
    birthday = birthdayMonthDay(body.birthday);
    if (birthday === null) return { ok: false, error: "Revisá la fecha de cumpleaños" };
  }

  return { ok: true, value: { name, phone, email, birthday } };
}

// ---- Anti-abuso ----

const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 5;

const attempts = new Map<string, { count: number; resetAt: number }>();

export function resetLoyaltyRateLimit(): void {
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

export const loyaltyApp = new Hono<{ Bindings: Env }>();

loyaltyApp.post("/api/loyalty/join", async (c) => {
  if (!sameOrigin(c)) return c.json({ ok: false, error: "Origen no permitido" }, 403);

  const settings = await getSettings(c.env.KV);
  if (!settings.loyaltyEnabled) {
    return c.json({ ok: false, error: "El club no está activo en este momento" }, 503);
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const now = nowMs();
  if (rateLimited(ip, now)) {
    return c.json({ ok: false, error: "Recibimos varios registros desde esta conexión. Esperá unos minutos." }, 429);
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ ok: false, error: "El formulario es demasiado largo" }, 413);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "Datos inválidos" }, 400);
  }

  // Honeypot: campo oculto por CSS. Un bot recibe un OK inofensivo sin alta.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return c.json({ ok: true, code: "SOC-000000", recovered: false, discountPercent: 0 });
  }

  const result = validateMemberInput(body);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 400);

  recordAttempt(ip, now);
  // El socio nuevo entra con el nivel base que el dueño configuró en el panel
  // (5, 10 o 15). Si ese valor no es un nivel, el socio queda sin nivel y usa
  // el base de la configuración, igual que los socios viejos.
  const initialTier = memberTierPercent(settings.loyaltyDiscountPercent);

  // Recuperación: el mismo WhatsApp devuelve el mismo código, sin exponer
  // email, cumpleaños ni el nombre completo.
  const existing = await getMemberByPhone(c.env.DB, result.value.phone);
  if (existing) {
    return c.json(
      {
        ok: true,
        code: existing.code,
        recovered: true,
        discountPercent: effectiveMemberPercent(existing.discountPercent, settings.loyaltyDiscountPercent),
        name: firstName(existing.name),
        active: existing.active,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  }

  const member = await insertMember(c.env.DB, result.value, "web", initialTier);
  return c.json(
    {
      ok: true,
      code: member.code,
      recovered: false,
      discountPercent: effectiveMemberPercent(member.discountPercent, settings.loyaltyDiscountPercent),
      name: firstName(member.name),
      active: true,
    },
    201,
    { "Cache-Control": "no-store" },
  );
});

loyaltyApp.get("/api/loyalty/validate", async (c) => {
  const code = normalizeMemberCode(c.req.query("code") ?? "");
  // El carrito manda también el WhatsApp de la compra: el código solo vale
  // para el número con el que se dio de alta. Sin `phone` (consulta pública en
  // /club) se valida solo el código, como antes.
  const phoneRaw = (c.req.query("phone") ?? "").trim();
  const settings = await getSettings(c.env.KV);
  const base = { ok: true, valid: false, discountPercent: 0, code, name: "" };
  if (!settings.loyaltyEnabled || !isValidMemberCode(code)) {
    return c.json(base, 200, { "Cache-Control": "no-store" });
  }
  const member = await getMemberByCode(c.env.DB, code);
  if (!member || !member.active) {
    return c.json(base, 200, { "Cache-Control": "no-store" });
  }
  if (phoneRaw !== "" && !memberPhoneMatches(member.phone, phoneRaw)) {
    return c.json({ ...base, reason: "phone_mismatch" }, 200, { "Cache-Control": "no-store" });
  }
  return c.json(
    {
      ok: true,
      valid: true,
      code: member.code,
      discountPercent: effectiveMemberPercent(member.discountPercent, settings.loyaltyDiscountPercent),
      name: firstName(member.name),
    },
    200,
    { "Cache-Control": "no-store" },
  );
});
