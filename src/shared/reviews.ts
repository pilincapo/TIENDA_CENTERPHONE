// Reseñas de Google curadas desde el panel.
//
// Google no deja publicar reseñas desde otro sitio ni guardar las que devuelve
// la API (Places prohíbe cachear contenido), así que la tienda carga a mano las
// que quiere mostrar, con su autor y su fecha reales. Acá viven el formato, la
// validación y los cálculos que comparten el worker y el frontend.

export interface GoogleReview {
  id: string;
  author: string;
  /** "Local Guide · 24 reseñas" (opcional): Google lo muestra así en Maps. */
  authorMeta: string;
  rating: number;
  body: string;
  /** Fecha de la reseña en ms; null si no se cargó (se muestra sin fecha). */
  reviewedAt: number | null;
  /** Respuesta pública del local (opcional). */
  localReply: string;
  /** Se destaca arriba de la lista y en el resumen. */
  featured: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** Lo que se guarda: el id y las fechas los pone el worker. */
export interface ReviewInput {
  author: string;
  authorMeta: string;
  rating: number;
  body: string;
  reviewedAt: number | null;
  localReply: string;
  featured: boolean;
  active: boolean;
  sortOrder: number;
}

export const MAX_REVIEW_AUTHOR = 60;
export const MAX_REVIEW_META = 60;
export const MAX_REVIEW_BODY = 1200;
export const MAX_REVIEW_REPLY = 800;
export const MAX_REVIEW_SORT = 999;

/** Estrellas: entero de 1 a 5. */
export function isReviewRating(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** Texto limpio: sin espacios de sobra y recortado al máximo del campo. */
export function cleanReviewText(raw: unknown, max: number): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** El cuerpo conserva los saltos de línea (una reseña puede tener párrafos). */
export function cleanReviewBody(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_REVIEW_BODY);
}

/**
 * Promedio para mostrar: el cargado a mano en la configuración manda (es el
 * número real de Google, con cientos de reseñas que no se pueden traer). Sin
 * ese dato se calcula con las reseñas cargadas.
 */
export function displayRating(configured: number, reviews: GoogleReview[]): number {
  if (Number.isFinite(configured) && configured > 0) return Math.min(5, configured);
  const active = reviews.filter((r) => r.active);
  if (active.length === 0) return 0;
  const sum = active.reduce((acc, r) => acc + r.rating, 0);
  return sum / active.length;
}

/** "4,9" (coma decimal, como se escribe en Argentina). Sin decimales si es entero. */
export function formatReviewRating(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

/** Cuántas 5, 4, 3, 2 y 1 estrellas hay entre las reseñas dadas. */
export function reviewDistribution(reviews: GoogleReview[]): Record<1 | 2 | 3 | 4 | 5, number> {
  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) {
    if (r.active && isReviewRating(r.rating)) dist[r.rating as 1 | 2 | 3 | 4 | 5]++;
  }
  return dist;
}

/** Fecha de la reseña: acepta ms o "AAAA-MM-DD" (mediodía argentino). */
export function parseReviewDate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 0 ? Math.trunc(raw) : null;
  const s = String(raw).trim();
  if (s === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const t = Date.parse(`${s}T12:00:00-03:00`);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Texto de la fecha para el sitio: "hace 2 semanas", "12 de octubre". */
export function reviewDateLabel(ms: number | null, now = Date.now()): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  // Días de calendario en Argentina (UTC-3 fijo): una reseña de ayer a la tarde
  // no tiene que decir "hoy" porque todavía no pasaron 24 horas.
  const days = dayIndexAr(now) - dayIndexAr(ms);
  if (days < 0) return "";
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `hace ${w} ${w === 1 ? "semana" : "semanas"}`;
  }
  if (days < 365) {
    const mo = Math.floor(days / 30);
    return `hace ${mo} ${mo === 1 ? "mes" : "meses"}`;
  }
  return new Date(ms).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

const AR_OFFSET_MS = 3 * 3_600_000;

/** Número de día local argentino (UTC-3 todo el año). */
function dayIndexAr(ms: number): number {
  return Math.floor((ms - AR_OFFSET_MS) / 86_400_000);
}

export type ReviewValidation =
  | { ok: true; value: ReviewInput }
  | { ok: false; error: string };

/** Valida y normaliza lo que manda el panel (alta o edición). */
export function validateReviewInput(body: Record<string, unknown>): ReviewValidation {
  const author = cleanReviewText(body.author, MAX_REVIEW_AUTHOR);
  if (author.length < 2) return { ok: false, error: "Escribí el nombre de quien escribió la reseña" };

  const rating = Number(body.rating);
  if (!isReviewRating(rating)) return { ok: false, error: "El puntaje tiene que ser un número entero de 1 a 5" };

  const bodyText = cleanReviewBody(body.body);
  const authorMeta = cleanReviewText(body.authorMeta, MAX_REVIEW_META);
  const localReply = cleanReviewBody(body.localReply).slice(0, MAX_REVIEW_REPLY);

  const reviewedAt = parseReviewDate(body.reviewedAt);
  if (body.reviewedAt !== undefined && body.reviewedAt !== null && body.reviewedAt !== "" && reviewedAt === null) {
    return { ok: false, error: "La fecha de la reseña no es válida" };
  }
  if (reviewedAt !== null && reviewedAt > Date.now() + 86_400_000) {
    return { ok: false, error: "La fecha de la reseña no puede ser futura" };
  }

  const sortOrderRaw = Number(body.sortOrder ?? 0);
  const sortOrder = Number.isFinite(sortOrderRaw) ? Math.max(-MAX_REVIEW_SORT, Math.min(MAX_REVIEW_SORT, Math.trunc(sortOrderRaw))) : 0;

  return {
    ok: true,
    value: {
      author,
      authorMeta,
      rating,
      body: bodyText,
      reviewedAt,
      localReply,
      featured: body.featured === true,
      active: body.active !== false,
      sortOrder,
    },
  };
}
