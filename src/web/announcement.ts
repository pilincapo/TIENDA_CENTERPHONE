// Cinta de anuncio configurable desde el panel: barra fina sobre el topbar
// (ej. "📦 Envío gratis en Santa Fe · Cuotas sin interés"). El texto lo escribe
// el dueño, así que siempre se escapa antes de entrar al HTML.
// Puro (sin DOM) salvo `renderAnnouncement`, para poder testearlo en node.
// Con más de una promo (una por línea) las rotamos una atrás de otra cada
// rotateEveryMs(motion, speed) ms; el movimiento elegido se reinicia en cada
// cambio. La velocidad (slow/normal/fast) reescala tanto esas rotaciones como
// la duración CSS de la animación (vía la clase `announce--<speed>`).

import type { PublicSettings } from "./types-web";
import {
  ANNOUNCEMENT_SPEED_FACTOR,
  isAnnouncementMotion,
  isAnnouncementSpeed,
  MAX_ANNOUNCEMENT_PROMOS,
  type AnnouncementMotion,
  type AnnouncementSpeed,
} from "../shared/types";

export const ANNOUNCEMENT_ID = "announcement-bar";

/**
 * Cuánto dura cada promo antes de pasar a la siguiente, según el movimiento
 * (base a velocidad "normal"; luego se reescala por el factor de velocidad):
 * - marquee 18s = UN barrido completo: la promo cruza la barra entera y recién
 *   cambia (literal "una atrás de otra").
 * - swing 8s = 2 ciclos de oscilación (4s c/u); fade 7s = 2 ciclos (3.5s c/u).
 * - none 6s = swap simple, sin animación.
 */
const ROTATE_MS: Record<AnnouncementMotion, number> = {
  none: 6000,
  fade: 7000,
  swing: 8000,
  marquee: 18000,
};

/**
 * Multiplicador de duración de las animaciones, en CSS: lento alarga, rápido
 * acorta. Se aplica por clase (`announce--slow` / `announce--fast`) para que
 * "normal" no agregue nada y el HTML de siempre no cambie.
 */
export const SPEED_FACTOR: Record<AnnouncementSpeed, number> = ANNOUNCEMENT_SPEED_FACTOR;

/** Texto de la cinta para una velocidad dada ("normal" = sin modificador). */
function speedSuffix(speed?: string | null): string {
  const s = isAnnouncementSpeed(speed) && speed !== "normal" ? speed : null;
  return s ? ` announce--${s}` : "";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

/**
 * Intervalo real entre promos en ms, escalado por la velocidad. Es puro para
 * poder testear el cálculo sin tocar timers.
 */
export function rotateEveryMs(motion: AnnouncementMotion, speed: AnnouncementSpeed): number {
  return Math.round(ROTATE_MS[motion] * SPEED_FACTOR[speed]);
}

/** Promos de la cinta: una por línea, sin vacías, nunca más de MAX_ANNOUNCEMENT_PROMOS. */
export function announcementPromos(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, MAX_ANNOUNCEMENT_PROMOS);
}

/**
 * HTML de la cinta; "" cuando no hay ninguna promo (no se renderiza nada).
 * Cada promo es un `<span class="announce-msg">` y solo la primera (la marcada
 * `is-on`) se ve en el HTML inicial: sin JS se ve una promo y no todas pegadas.
 * `motion` ("none" o ausente = estática, como siempre) agrega el modificador
 * `announce--<motion>` y envuelve en `<span class="announce-track">`, que es lo
 * que la animación CSS mueve/opaca. Un valor desconocido cae a estático.
 * `speed` agrega `announce--<speed>` (excepto "normal", que no toca nada) para
 * que CSS reescale la duración de la animación.
 */
export function announcementHtml(text: string | null | undefined, motion?: string | null, speed?: string | null): string {
  const promos = announcementPromos(text);
  if (promos.length === 0) return "";
  const m = isAnnouncementMotion(motion) && motion !== "none" ? motion : null;
  const cls = `announce${m ? ` announce--${m}` : ""}${speedSuffix(speed)}`;
  const inner = promos
    .map((p, i) => `<span class="announce-msg${i === 0 ? " is-on" : ""}">${esc(p)}</span>`)
    .join("");
  const body = m ? `<span class="announce-track">${inner}</span>` : inner;
  return `<div class="${cls}" id="${ANNOUNCEMENT_ID}" role="status">${body}</div>`;
}

// Rotación (solo DOM): el timer vive a nivel de módulo para poder apagarlo si
// la cinta se re-renderiza o se vacía. Sin promos visibles no queda girando.
let rotateTimer: ReturnType<typeof setInterval> | null = null;

function stopRotation(): void {
  if (rotateTimer !== null) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
}

function startRotation(motion: string | null | undefined, speed?: string | null): void {
  stopRotation();
  const bar = document.getElementById(ANNOUNCEMENT_ID);
  if (!bar) return;
  const msgs = Array.from(bar.querySelectorAll<HTMLElement>(".announce-msg"));
  if (msgs.length < 2) return; // una sola promo: no hay nada que rotar
  const m = isAnnouncementMotion(motion) ? motion : "none";
  const s = isAnnouncementSpeed(speed) ? speed : "normal";
  const every = rotateEveryMs(m, s);
  let i = 0;
  rotateTimer = setInterval(() => {
    const activo = msgs[i];
    i = (i + 1) % msgs.length;
    const sig = msgs[i];
    if (!activo || !sig) {
      stopRotation(); // el nodo se reemplazó: que no quede un timer huérfano
      return;
    }
    activo.classList.remove("is-on");
    sig.classList.add("is-on");
    // Reinicia la animación de movimiento para que la promo nueva arranque de
    // cero (en marquee, con el barrido completo; el reflow fuerza el restart).
    const track = bar.querySelector<HTMLElement>(".announce-track");
    if (track) {
      track.style.animation = "none";
      void track.offsetWidth;
      track.style.animation = "";
    }
  }, every);
}

/**
 * Inserta la cinta arriba del topbar (o la actualiza si ya estaba). Sin promos
 * la quita, así el cambio desde el panel se refleja al recargar. Con varias,
 * empieza a rotarlas.
 */
export function renderAnnouncement(
  settings: Pick<PublicSettings, "announcementBar" | "announcementMotion" | "announcementSpeed"> | null,
): void {
  const html = announcementHtml(settings?.announcementBar, settings?.announcementMotion, settings?.announcementSpeed);
  const previo = document.getElementById(ANNOUNCEMENT_ID);
  if (html === "") {
    stopRotation();
    previo?.remove();
    return;
  }
  if (previo) {
    previo.outerHTML = html;
  } else {
    const topbar = document.querySelector("header.topbar");
    if (topbar) topbar.insertAdjacentHTML("beforebegin", html);
    else document.body.insertAdjacentHTML("afterbegin", html);
  }
  startRotation(settings?.announcementMotion, settings?.announcementSpeed);
}
