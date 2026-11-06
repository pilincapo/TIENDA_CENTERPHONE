// Resumen de reseñas de Google en la home y en la ficha.
//
// La lista completa vive en /resenas; acá sólo va el número (promedio y total),
// que viene en /api/public/settings: no hace falta otra petición. El promedio y
// el total los carga el panel porque Google no permite traerlos ni cachearlos
// desde el sitio (ver src/worker/reviews.ts).

import type { PublicSettings } from "./types-web";
import { esc } from "../shared/html";
import { formatReviewRating } from "../shared/reviews";

/** Logotipo de Google (cuatro colores oficiales). */
const G_LOGO = `<svg class="rv-g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>`;

function starsHtml(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full) + '<span class="off">★</span>'.repeat(5 - full);
}

/** ¿Hay algo para mostrar? Sin promedio ni total, la franja no se pinta. */
export function hasReviewSummary(s: PublicSettings | null): boolean {
  return !!s && s.googleReviewsEnabled && s.googleReviewsRating > 0 && s.googleReviewsCount > 0;
}

/** Franja fina de la home, arriba del catálogo. */
export function mountReviewsStrip(settings: PublicSettings | null, host: HTMLElement | null): void {
  if (!host || !hasReviewSummary(settings) || !settings) return;
  const rating = formatReviewRating(settings.googleReviewsRating);
  const count = settings.googleReviewsCount;
  host.innerHTML = `
    ${G_LOGO}
    <span class="rv-stars" aria-hidden="true">${starsHtml(settings.googleReviewsRating)}</span>
    <span><b>${esc(rating)}</b> <span class="rv-strip-label">· ${count} ${count === 1 ? "reseña" : "reseñas"} en Google</span></span>
    <a class="rv-strip-link" href="/resenas">Ver todas →</a>`;
  host.removeAttribute("hidden");
}

/** Línea bajo el título de la ficha: promedio del local + acceso a /resenas. */
export function mountReviewLine(settings: PublicSettings | null, host: HTMLElement | null): void {
  if (!host || !hasReviewSummary(settings) || !settings) return;
  const rating = formatReviewRating(settings.googleReviewsRating);
  const count = settings.googleReviewsCount;
  // En la ficha no se promete "reseñas de este producto": en Google son del
  // local, no del artículo, y conviene decirlo.
  host.innerHTML = `
    ${G_LOGO}
    <span class="rv-stars" aria-hidden="true">${starsHtml(settings.googleReviewsRating)}</span>
    <span><b>${esc(rating)}</b> en Google · ${count} ${count === 1 ? "reseña" : "reseñas"} del local</span>
    <a href="/resenas">Ver reseñas →</a>
    ${settings.googleReviewUrl ? `<a href="${esc(settings.googleReviewUrl)}" target="_blank" rel="noopener">Escribir la tuya</a>` : ""}`;
  host.removeAttribute("hidden");
}
