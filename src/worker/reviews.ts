// Reseñas de Google: lectura pública y CRUD del panel.
//
//   GET    /api/google-reviews             — reseñas activas + resumen (público)
//   GET    /api/admin/google-reviews       — todas, incluidas las ocultas
//   POST   /api/admin/google-reviews       — alta desde el panel
//   PATCH  /api/admin/google-reviews/:id   — editar, destacar, activar
//   DELETE /api/admin/google-reviews/:id   — borrar
//   PATCH  /api/admin/google-reviews/config — prender/apagar + promedio + links
//
// No hay integración con la API de Google a propósito: Places devuelve hasta 5
// reseñas, no permite cachearlas y exige facturación. El panel cura las que se
// muestran y el botón "Escribir una reseña" abre la ficha del local.

import { Hono } from "hono";
import type { Dict, Env } from "./db";
import { forceHttpsUrl, getSettings, newId, nowMs, saveSettings } from "./settings";
import { displayRating, validateReviewInput, type GoogleReview } from "../shared/reviews";

const COLUMNS =
  "id, author, author_meta, rating, body, reviewed_at, local_reply, featured, active, sort_order, created_at, updated_at";

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function rowToReview(row: Dict): GoogleReview {
  return {
    id: String(row.id ?? ""),
    author: String(row.author ?? ""),
    authorMeta: row.author_meta == null ? "" : String(row.author_meta),
    rating: num(row.rating),
    body: String(row.body ?? ""),
    reviewedAt: row.reviewed_at == null ? null : num(row.reviewed_at),
    localReply: row.local_reply == null ? "" : String(row.local_reply),
    featured: num(row.featured) === 1,
    active: num(row.active) === 1,
    sortOrder: num(row.sort_order),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

/** Lo que ve el público: sin los campos internos del panel. */
function publicReview(r: GoogleReview): Record<string, unknown> {
  return {
    id: r.id,
    author: r.author,
    authorMeta: r.authorMeta,
    rating: r.rating,
    body: r.body,
    reviewedAt: r.reviewedAt,
    localReply: r.localReply,
    featured: r.featured,
  };
}

export const reviewsApp = new Hono<{ Bindings: Env }>();

reviewsApp.get("/api/google-reviews", async (c) => {
  const settings = await getSettings(c.env.KV);
  const base = {
    enabled: settings.googleReviewsEnabled,
    reviewUrl: settings.googleReviewUrl,
    mapsUrl: settings.storeMapUrl,
    storeName: settings.storeName,
    storeAddress: settings.storeAddress,
  };
  if (!settings.googleReviewsEnabled) {
    return c.json({ ...base, rating: 0, count: 0, reviews: [] }, 200, { "cache-control": "no-store" });
  }

  const rows = await c.env.DB
    .prepare(
      `SELECT ${COLUMNS} FROM google_reviews WHERE active = 1 ORDER BY featured DESC, sort_order ASC, reviewed_at DESC`,
    )
    .all<Dict>();
  const reviews = (rows.results ?? []).map(rowToReview);
  // El total del panel manda: en Google puede haber cientos de reseñas y acá
  // sólo se muestran las curadas, así que contar las filas mentiría.
  const count = settings.googleReviewsCount > 0 ? settings.googleReviewsCount : reviews.length;

  // 60 s de caché: una edición en el panel se ve enseguida y la página no pega
  // a D1 en cada visita.
  return c.json(
    {
      ...base,
      rating: displayRating(settings.googleReviewsRating, reviews),
      count,
      reviews: reviews.map(publicReview),
    },
    200,
    { "cache-control": "public, max-age=60" },
  );
});

// ---- Panel ----

export function registerReviewsAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/google-reviews", async (c) => {
    const [rows, settings] = await Promise.all([
      c.env.DB
        .prepare(`SELECT ${COLUMNS} FROM google_reviews ORDER BY featured DESC, sort_order ASC, reviewed_at DESC`)
        .all<Dict>(),
      getSettings(c.env.KV),
    ]);
    const reviews = (rows.results ?? []).map(rowToReview);
    return c.json({
      reviews,
      config: {
        enabled: settings.googleReviewsEnabled,
        rating: settings.googleReviewsRating,
        count: settings.googleReviewsCount,
        reviewUrl: settings.googleReviewUrl,
        mapsUrl: settings.storeMapUrl,
        storeAddress: settings.storeAddress,
      },
      // Promedio que se está mostrando: el del panel o el de las cargadas.
      effectiveRating: displayRating(settings.googleReviewsRating, reviews),
    });
  });

  app.post("/google-reviews", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "Body inválido" }, 400);
    const result = validateReviewInput(body);
    if (!result.ok) return c.json({ error: result.error }, 400);
    const v = result.value;
    const id = newId();
    const now = nowMs();
    await c.env.DB
      .prepare(`INSERT INTO google_reviews (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
      .bind(
        id,
        v.author,
        v.authorMeta,
        v.rating,
        v.body,
        v.reviewedAt,
        v.localReply,
        v.featured ? 1 : 0,
        v.active ? 1 : 0,
        v.sortOrder,
        now,
        now,
      )
      .run();
    const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM google_reviews WHERE id = ?1`).bind(id).first<Dict>();
    return c.json({ ok: true, review: rowToReview(row ?? {}) }, 201);
  });

  // `config` va antes de `:id`: Hono resuelve por orden de registro y si no
  // un PATCH de la configuración caería en el handler de edición.
  // Configuración del bloque (no toca las reseñas cargadas).
  app.patch("/google-reviews/config", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "Body inválido" }, 400);
    const next: Record<string, unknown> = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return c.json({ error: "Body inválido" }, 400);
      next.googleReviewsEnabled = body.enabled;
    }
    if (body.rating !== undefined) {
      const r = Number(body.rating);
      if (!Number.isFinite(r) || r < 0 || r > 5) return c.json({ error: "El promedio tiene que ir de 0 a 5" }, 400);
      next.googleReviewsRating = r;
    }
    if (body.count !== undefined) {
      const n = Number(body.count);
      if (!Number.isInteger(n) || n < 0) return c.json({ error: "El total de reseñas tiene que ser un entero positivo" }, 400);
      next.googleReviewsCount = n;
    }
    if (body.reviewUrl !== undefined) {
      const raw = String(body.reviewUrl ?? "").trim();
      const url = forceHttpsUrl(raw, 500);
      // Una URL inválida se rechaza en vez de guardarse vacía sin avisar: el
      // botón "Escribir una reseña" desaparecería sin explicación.
      if (raw !== "" && url === "") return c.json({ error: "El link para escribir la reseña tiene que ser una URL https válida" }, 400);
      next.googleReviewUrl = url;
    }
    if (Object.keys(next).length === 0) return c.json({ error: "Body inválido" }, 400);

    const settings = await saveSettings(c.env.KV, next);
    return c.json({
      ok: true,
      config: {
        enabled: settings.googleReviewsEnabled,
        rating: settings.googleReviewsRating,
        count: settings.googleReviewsCount,
        reviewUrl: settings.googleReviewUrl,
      },
    });
  });

  app.patch("/google-reviews/:id", async (c) => {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM google_reviews WHERE id = ?1`).bind(id).first<Dict>();
    if (!row) return c.json({ error: "Reseña no encontrada" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "Body inválido" }, 400);

    // Edición completa (modal) o cambio rápido de un flag desde la tabla: se
    // mezcla con lo guardado para no exigir el formulario entero.
    const current = rowToReview(row);
    const merged = {
      author: body.author ?? current.author,
      authorMeta: body.authorMeta ?? current.authorMeta,
      rating: body.rating ?? current.rating,
      body: body.body ?? current.body,
      reviewedAt: body.reviewedAt === undefined ? current.reviewedAt : body.reviewedAt,
      localReply: body.localReply ?? current.localReply,
      featured: body.featured === undefined ? current.featured : body.featured,
      active: body.active === undefined ? current.active : body.active,
      sortOrder: body.sortOrder ?? current.sortOrder,
    };
    const result = validateReviewInput(merged);
    if (!result.ok) return c.json({ error: result.error }, 400);
    const v = result.value;
    await c.env.DB
      .prepare(
        `UPDATE google_reviews SET author = ?2, author_meta = ?3, rating = ?4, body = ?5,
           reviewed_at = ?6, local_reply = ?7, featured = ?8, active = ?9, sort_order = ?10, updated_at = ?11
         WHERE id = ?1`,
      )
      .bind(
        id,
        v.author,
        v.authorMeta,
        v.rating,
        v.body,
        v.reviewedAt,
        v.localReply,
        v.featured ? 1 : 0,
        v.active ? 1 : 0,
        v.sortOrder,
        nowMs(),
      )
      .run();
    const updated = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM google_reviews WHERE id = ?1`).bind(id).first<Dict>();
    return c.json({ ok: true, review: rowToReview(updated ?? row) });
  });

  app.delete("/google-reviews/:id", async (c) => {
    const id = c.req.param("id");
    const res = await c.env.DB.prepare("DELETE FROM google_reviews WHERE id = ?1").bind(id).run();
    if (Number(res.meta?.changes ?? 0) === 0) return c.json({ error: "Reseña no encontrada" }, 404);
    return c.json({ ok: true });
  });
}
