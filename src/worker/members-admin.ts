// Sección CLUB del panel: socios del Club CenterPhone.
//
//   GET   /api/admin/members         — listado paginado + contadores
//   POST  /api/admin/members         — alta manual desde el panel
//   PATCH /api/admin/members/:id     — activar / desactivar
//   PATCH /api/admin/club            — prender / apagar el club en todo el sitio
//
// Se registra sobre `adminApp`, así hereda el login y el sliding session: acá
// se ven nombre, WhatsApp, email y cumpleaños (datos que la API pública no
// expone). Nunca se borra un socio: se desactiva para que el código deje de
// dar descuento sin perder el historial.

import type { Hono } from "hono";
import type { Dict, Env } from "./db";
import { nowMs, saveSettings } from "./settings";
import { insertMember, rowToMember, validateMemberInput } from "./loyalty";
import { memberTierPercent, type Member } from "../shared/loyalty";

const COLUMNS =
  "id, code, name, phone, email, birthday, active, source, created_at, updated_at, last_order_at, discount_percent";

// Misma condición para listar y contar: el total no puede diferir de las filas.
const FILTER = `WHERE (?1 = '' OR (?1 = 'active' AND active = 1) OR (?1 = 'inactive' AND active = 0))
  AND (?2 = '' OR name LIKE ?2 ESCAPE '\\' OR code LIKE ?2 ESCAPE '\\' OR phone LIKE ?2 ESCAPE '\\' OR email LIKE ?2 ESCAPE '\\')`;

function likePattern(q: string): string {
  return q === "" ? "" : `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Mes actual en hora Argentina (UTC-3), para el contador de cumpleaños. */
export function currentMonthArgentina(now = Date.now()): string {
  const art = new Date(now - 3 * 60 * 60 * 1000);
  return String(art.getUTCMonth() + 1).padStart(2, "0");
}

export function registerMemberAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/members", async (c) => {
    const statusRaw = c.req.query("status") ?? "";
    const status = statusRaw === "active" || statusRaw === "inactive" ? statusRaw : "";
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    const page = Math.max(1, Math.min(2000, Math.trunc(Number(c.req.query("page") ?? 1)) || 1));
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(c.req.query("limit") ?? 50)) || 50));
    const pattern = likePattern(q);

    const [rows, countRow, byActive, birthdays] = await Promise.all([
      c.env.DB
        .prepare(`SELECT ${COLUMNS} FROM members ${FILTER} ORDER BY created_at DESC LIMIT ?3 OFFSET ?4`)
        .bind(status, pattern, limit, (page - 1) * limit)
        .all<Dict>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM members ${FILTER}`).bind(status, pattern).first<Dict>(),
      c.env.DB.prepare("SELECT active, COUNT(*) AS n FROM members GROUP BY active").all<Dict>(),
      c.env.DB
        .prepare("SELECT COUNT(*) AS n FROM members WHERE active = 1 AND substr(birthday, 1, 2) = ?1")
        .bind(currentMonthArgentina())
        .first<Dict>(),
    ]);

    const counts = { all: 0, active: 0, inactive: 0 };
    for (const r of byActive.results ?? []) {
      const n = Number(r.n ?? 0);
      counts.all += n;
      if (Number(r.active ?? 0) === 1) counts.active += n;
      else counts.inactive += n;
    }

    const total = Number(countRow?.n ?? 0);
    const pageRows = rows.results ?? [];

    // Compras y total gastado por socio: solo pedidos con estado "paid" (un
    // pending por transferencia todavía no es plata cobrada). Una sola consulta
    // por página, no una por fila.
    const codes = pageRows.map((r) => String(r.code ?? ""));
    const stats = new Map<string, { ordersCount: number; spentCents: number }>();
    if (codes.length > 0) {
      const placeholders = codes.map((_, i) => `?${i + 1}`).join(", ");
      const spentRes = await c.env.DB
        .prepare(
          `SELECT member_code, COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS spent
           FROM orders WHERE status = 'paid' AND member_code IN (${placeholders})
           GROUP BY member_code`,
        )
        .bind(...codes)
        .all<Dict>();
      for (const row of spentRes.results ?? []) {
        stats.set(String(row.member_code ?? ""), {
          ordersCount: Number(row.n ?? 0),
          spentCents: Number(row.spent ?? 0),
        });
      }
    }

    return c.json({
      members: pageRows.map((row) => {
        const member = rowToMember(row);
        const s = stats.get(member.code);
        return { ...member, ordersCount: s?.ordersCount ?? 0, spentCents: s?.spentCents ?? 0 };
      }),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts,
      birthdaysThisMonth: Number(birthdays?.n ?? 0),
      month: currentMonthArgentina(),
    });
  });

  app.post("/members", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "Body inválido" }, 400);
    const result = validateMemberInput(body);
    if (!result.ok) return c.json({ error: result.error }, 400);
    // Nivel opcional del alta manual: sin nivel, el socio usa el base.
    let tier: number | null = null;
    if (body.discountPercent !== undefined && body.discountPercent !== null && body.discountPercent !== "") {
      tier = memberTierPercent(body.discountPercent);
      if (tier === null) return c.json({ error: "El descuento debe ser 5, 10 o 15 %" }, 400);
    }

    const existing = await c.env.DB
      .prepare("SELECT code FROM members WHERE phone = ?1")
      .bind(result.value.phone)
      .first<Dict>();
    if (existing) {
      return c.json({ error: `Ya hay un socio con ese WhatsApp (código ${String(existing.code ?? "")})` }, 409);
    }

    const member = await insertMember(c.env.DB, result.value, "panel", tier);
    return c.json({ ok: true, member }, 201);
  });

  // Interruptor general del club. Va por acá (y no por PUT /settings) para no
  // tener que mandar el formulario completo: saveSettings mezcla con lo que ya
  // está guardado, así que solo cambia este flag. Al apagarlo, /club deja de
  // ofrecer el alta, el carrito no pide código, el checkout no aplica descuento
  // y la página sale del sitemap.
  app.patch("/club", async (c) => {
    const body = await c.req.json<{ enabled?: unknown }>().catch(() => null);
    if (!body || typeof body.enabled !== "boolean") return c.json({ error: "Body inválido" }, 400);

    const settings = await saveSettings(c.env.KV, { loyaltyEnabled: body.enabled });
    // El sitemap se cachea 24 h en el borde: se suelta para que /club entre o
    // salga del índice al instante y no quede una copia vieja.
    try {
      await caches.default.delete(new URL("/sitemap.xml", c.req.url).toString());
    } catch {
      // Cache API ausente (tests): el TTL lo corrige solo.
    }
    return c.json({ ok: true, loyaltyEnabled: settings.loyaltyEnabled });
  });

  // Cambia el estado y/o el nivel de descuento. `discountPercent: null` borra el
  // nivel y el socio vuelve a usar el descuento base de la configuración.
  app.patch("/members/:id", async (c) => {
    const body = await c.req.json<{ active?: unknown; discountPercent?: unknown }>().catch(() => null);
    if (!body) return c.json({ error: "Body inválido" }, 400);
    const hasActive = body.active !== undefined;
    const hasTier = body.discountPercent !== undefined;
    if (!hasActive && !hasTier) return c.json({ error: "Body inválido" }, 400);
    if (hasActive && typeof body.active !== "boolean") return c.json({ error: "Body inválido" }, 400);

    let tier: number | null = null;
    if (hasTier && body.discountPercent !== null && body.discountPercent !== "") {
      tier = memberTierPercent(body.discountPercent);
      if (tier === null) return c.json({ error: "El descuento debe ser 5, 10 o 15 %" }, 400);
    }

    const id = c.req.param("id");
    const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM members WHERE id = ?1`).bind(id).first<Dict>();
    if (!row) return c.json({ error: "Socio no encontrado" }, 404);

    const now = nowMs();
    if (hasActive) {
      await c.env.DB
        .prepare("UPDATE members SET active = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id, body.active ? 1 : 0, now)
        .run();
    }
    if (hasTier) {
      await c.env.DB
        .prepare("UPDATE members SET discount_percent = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id, tier, now)
        .run();
    }

    const updated = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM members WHERE id = ?1`).bind(id).first<Dict>();
    return c.json({ ok: true, member: rowToMember(updated ?? row) as Member });
  });
}
