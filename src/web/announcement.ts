// Cinta de anuncio configurable desde el panel: barra fina sobre el topbar
// (ej. "📦 Envío gratis en Santa Fe · Cuotas sin interés"). El texto lo escribe
// el dueño, así que siempre se escapa antes de entrar al HTML.
// Puro (sin DOM) salvo `renderAnnouncement`, para poder testearlo en node.

import type { PublicSettings } from "./types-web";
import { isAnnouncementMotion } from "../shared/types";

export const ANNOUNCEMENT_ID = "announcement-bar";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

/**
 * HTML de la cinta; "" cuando el texto está vacío (no se renderiza nada).
 * `motion` ("none" o ausente = estática, como siempre) agrega el modificador
 * `announce--<motion>`; con movimiento el texto va dentro de un `<span class="announce-track">`
 * que es lo que la animación CSS mueve/opaca, para no tocar la barra entera.
 * Un valor desconocido cae a estático: el HTML sigue siendo correcto aunque
 * el cliente mande cualquier cosa.
 */
export function announcementHtml(text: string | null | undefined, motion?: string | null): string {
  const t = String(text ?? "").trim();
  if (t === "") return "";
  const m = isAnnouncementMotion(motion) && motion !== "none" ? motion : null;
  const cls = m ? `announce announce--${m}` : "announce";
  const inner = m ? `<span class="announce-track">${esc(t)}</span>` : esc(t);
  return `<div class="${cls}" id="${ANNOUNCEMENT_ID}" role="status">${inner}</div>`;
}

/**
 * Inserta la cinta arriba del topbar (o la actualiza si ya estaba). Con texto
 * vacío la quita, así el cambio desde el panel se refleja al recargar.
 */
export function renderAnnouncement(
  settings: Pick<PublicSettings, "announcementBar" | "announcementMotion"> | null,
): void {
  const html = announcementHtml(settings?.announcementBar, settings?.announcementMotion);
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
