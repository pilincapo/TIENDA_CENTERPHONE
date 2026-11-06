// Entrada de la página pública /resenas.
//
// El worker devuelve las reseñas ACTIVAS que el panel cargó a mano (no hay
// llamadas a la API de Google: Places devuelve hasta 5 y no permite guardarlas).
// El botón de escribir reseña es un link a Google: acá nunca se publica nada.

import type { PublicSettings } from "./types-web";
import { fillStoreInfo } from "./store-modals";
import { mountSiteFooter } from "./site-footer";
import { esc } from "../shared/html";
import { formatReviewRating, reviewDateLabel } from "../shared/reviews";

interface PublicReview {
  id: string;
  author: string;
  authorMeta: string;
  rating: number;
  body: string;
  reviewedAt: number | null;
  localReply: string;
  featured: boolean;
}

interface ReviewsPayload {
  enabled: boolean;
  reviewUrl: string;
  mapsUrl: string;
  storeName: string;
  storeAddress: string;
  rating: number;
  count: number;
  reviews: PublicReview[];
}

const AVATAR_COLORS = ["#8ab4f8", "#fdd663", "#81c995", "#f6aea9", "#c5a3ff"];

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Estrellas llenas + apagadas, sin texto (el número va al lado). */
function starsHtml(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full) + '<span class="off">★</span>'.repeat(5 - full);
}

function reviewCard(r: PublicReview, index: number): string {
  const when = reviewDateLabel(r.reviewedAt);
  const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
  const initial = (r.author.trim()[0] ?? "?").toUpperCase();
  return `
    <article class="rv-card" data-rating="${r.rating}">
      <div class="rv-card-top">
        <span class="rv-avatar" style="background:${color}">${esc(initial)}</span>
        <span class="rv-who">
          <span class="rv-author">${esc(r.author)}</span>
          ${r.authorMeta ? `<span class="rv-meta">${esc(r.authorMeta)}</span>` : ""}
        </span>
      </div>
      <div class="rv-stars-row">
        <div class="rv-stars" aria-label="${r.rating} de 5">${starsHtml(r.rating)}</div>
        ${when ? `<span class="rv-when">${esc(when)}</span>` : ""}
      </div>
      ${r.body ? `<p class="rv-text">${esc(r.body)}</p>` : ""}
      ${r.localReply ? `<p class="rv-reply"><b>Respuesta del local:</b> ${esc(r.localReply)}</p>` : ""}
      <div class="rv-foot">
        <svg class="rv-g" style="width:12px;height:12px" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>
        Publicada en Google
      </div>
    </article>`;
}

function renderSummary(payload: ReviewsPayload): void {
  const rating = formatReviewRating(payload.rating);
  const count = payload.count;
  if (rating !== "") {
    for (const id of ["rv-score", "rv-score-side"]) {
      const el = byId(id);
      if (el) el.textContent = rating;
    }
    for (const id of ["rv-stars", "rv-stars-side"]) {
      const el = byId(id);
      if (el) el.innerHTML = starsHtml(payload.rating);
    }
    byId("rv-summary")?.removeAttribute("hidden");
  }
  const countText = count > 0 ? `${count} ${count === 1 ? "reseña" : "reseñas"} en Google Maps` : "";
  for (const id of ["rv-count", "rv-count-side"]) {
    const el = byId(id);
    if (el) el.textContent = countText;
  }
}

/** Barras 5→1: sólo cuando cargamos todas las reseñas. Si el total de Google es
 *  mayor, dibujarlas con una muestra mentiría sobre la distribución. */
function renderBars(reviews: PublicReview[], count: number): void {
  const wrap = byId("rv-bars");
  if (!wrap) return;
  if (count > reviews.length) {
    wrap.innerHTML = `<p class="rv-note" style="margin:0">El detalle completo de las ${count} reseñas está en Google Maps.</p>`;
    return;
  }
  const counts = [0, 0, 0, 0, 0, 0]; // índice = estrellas (1..5)
  for (const r of reviews) {
    const i = Math.round(r.rating);
    if (i >= 1 && i <= 5) counts[i] = (counts[i] ?? 0) + 1;
  }
  const total = reviews.length || 1;
  wrap.innerHTML = [5, 4, 3, 2, 1]
    .map((n) => {
      const qty = counts[n] ?? 0;
      const pct = Math.round((qty / total) * 100);
      return `<div class="rv-bar-row"><span>${n} ★</span><div class="rv-bar-track"><div class="rv-bar-fill" style="width:${pct}%"></div></div><span>${qty}</span></div>`;
    })
    .join("");
}

function wireFilters(): void {
  const chips = document.querySelectorAll<HTMLButtonElement>("[data-rv-stars]");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const want = Number(chip.dataset.rvStars ?? 0);
      chips.forEach((c) => c.classList.toggle("on", c === chip));
      document.querySelectorAll<HTMLElement>(".rv-card").forEach((card) => {
        const rating = Number(card.dataset.rating ?? 0);
        card.hidden = want !== 0 && rating !== want;
      });
    });
  });
}

function setLinks(payload: ReviewsPayload): void {
  const write = payload.reviewUrl;
  for (const id of ["rv-write", "rv-write-side"]) {
    const el = byId<HTMLAnchorElement>(id);
    if (!el) continue;
    if (write === "") continue;
    el.href = write;
    el.removeAttribute("hidden");
  }
  const maps = byId<HTMLAnchorElement>("rv-maps");
  if (maps && payload.mapsUrl) {
    maps.href = payload.mapsUrl;
    maps.textContent = payload.count > 0 ? `Ver las ${payload.count} en Google Maps →` : "Abrir la ficha en Google Maps →";
  }

  // Mapa embebido: la API de Maps Embed no pide key para este uso (?output=embed)
  // y se carga con lazy, así no pesa en el resto de la navegación.
  const addr = payload.storeAddress.trim();
  const iframe = byId<HTMLIFrameElement>("rv-map");
  const wrap = byId("rv-map-wrap");
  if (addr !== "" && iframe && wrap) {
    iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(addr)}&output=embed`;
    wrap.removeAttribute("hidden");
  }
}

async function init(): Promise<void> {
  const [settings, payload] = await Promise.all([
    fetch("/api/public/settings")
      .then((r) => (r.ok ? (r.json() as Promise<PublicSettings>) : null))
      .catch(() => null),
    fetch("/api/google-reviews")
      .then((r) => (r.ok ? (r.json() as Promise<ReviewsPayload>) : null))
      .catch(() => null),
  ]);

  if (settings) {
    fillStoreInfo(settings);
    mountSiteFooter(settings);
  }
  if (!payload) {
    const empty = byId("rv-empty");
    const text = byId("rv-empty-text");
    if (text) text.textContent = "No pudimos cargar las reseñas. Recargá o escribinos por WhatsApp.";
    if (empty) empty.removeAttribute("hidden");
    return;
  }

  if (!payload.enabled) {
    const text = byId("rv-empty-text");
    if (text) text.textContent = "Por ahora no estamos mostrando reseñas en el sitio. Podés verlas en Google Maps.";
    byId("rv-empty")?.removeAttribute("hidden");
    const maps = byId<HTMLAnchorElement>("rv-maps");
    if (maps) maps.href = payload.mapsUrl;
    document.title = "Reseñas — CenterPhone Celulares";
    return;
  }

  renderSummary(payload);
  setLinks(payload);
  document.title =
    payload.rating > 0
      ? `Reseñas en Google — ${formatReviewRating(payload.rating)} de 5 (${payload.count})`
      : "Reseñas en Google — CenterPhone Celulares";

  if (payload.reviews.length === 0) {
    const text = byId("rv-empty-text");
    if (text) text.textContent = "Todavía no cargamos reseñas para mostrar. Mientras tanto, están todas en Google Maps.";
    byId("rv-empty")?.removeAttribute("hidden");
    return;
  }

  const list = byId("rv-list");
  if (list) list.innerHTML = payload.reviews.map((r, i) => reviewCard(r, i)).join("");
  renderBars(payload.reviews, payload.count);
  byId("rv-filters")?.removeAttribute("hidden");
  byId("rv-layout")?.removeAttribute("hidden");
  wireFilters();
}

void init();
