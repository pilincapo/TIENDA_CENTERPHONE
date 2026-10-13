// Cinta de anuncio configurable desde el panel: barra fina sobre el topbar
// (ej. "📦 Envío gratis en Santa Fe · Cuotas sin interés"). El texto lo escribe
// el dueño, así que siempre se escapa antes de entrar al HTML.
// Puro (sin DOM) salvo `renderAnnouncement`, para poder testearlo en node.

import type { PublicSettings } from "./types-web";

export const ANNOUNCEMENT_ID = "announcement-bar";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

/** HTML de la cinta; "" cuando el texto está vacío (no se renderiza nada). */
export function announcementHtml(text: string | null | undefined): string {
  const t = String(text ?? "").trim();
  if (t === "") return "";
  return `<div class="announce" id="${ANNOUNCEMENT_ID}" role="status">${esc(t)}</div>`;
}

/**
 * Inserta la cinta arriba del topbar (o la actualiza si ya estaba). Con texto
 * vacío la quita, así el cambio desde el panel se refleja al recargar.
 */
export function renderAnnouncement(settings: Pick<PublicSettings, "announcementBar"> | null): void {
  const html = announcementHtml(settings?.announcementBar);
  const previo = document.getElementById(ANNOUNCEMENT_ID);
  if (html === "") {
    previo?.remove();
    return;
  }
  if (previo) {
    previo.outerHTML = html;
    return;
  }
  const topbar = document.querySelector("header.topbar");
  if (topbar) topbar.insertAdjacentHTML("beforebegin", html);
  else document.body.insertAdjacentHTML("afterbegin", html);
}
