// Footer compartido de TODAS las páginas públicas (home, ficha y legales).
//
// Antes el pie vivía duplicado dentro de index.html: la ficha no lo tenía y las
// páginas nuevas iban a ser una tercera copia. Acá se arma una sola vez y se
// monta sobre el placeholder <footer data-site-footer>, con los datos del
// comercio que ya vienen del panel (settings), igual que antes.
//
// Los enlaces legales van en el HTML estático de cada página (no acá) para que
// funcionen aun sin JavaScript: este módulo solo aporta el resto del pie.

import type { PublicSettings } from "./types-web";
import { esc } from "../shared/html";

/** Datos del titular (Ley 24.240, art. 4: información cierta y detallada). */
export const TITULAR = "Esquivel Jorge Alberto";
export const CUIT = "20-24995402-1";
export const DOMICILIO = "Mendoza 2974, Santa Fe, Argentina";
export const WHATSAPP_DISPLAY = "+54 9 342 581 9402";

export interface LegalLink {
  href: string;
  label: string;
}

/** Columna LEGAL del pie. La usan las páginas para no repetir los textos. */
export const LEGAL_LINKS: LegalLink[] = [
  { href: "/politica-de-cambios-y-devoluciones", label: "Cambios y devoluciones" },
  // Va al formulario (y no al ancla de la política): es la acción, no la lectura.
  { href: "/devoluciones", label: "Botón de arrepentimiento" },
  { href: "/politica-de-privacidad", label: "Política de privacidad" },
];

const STEPS = [
  {
    num: "01",
    title: "Explorá",
    text: "Buscá por nombre de producto o explorá las categorías para encontrar lo que necesitás.",
  },
  {
    num: "02",
    title: "Consultá",
    text: "Te mostramos el precio y te ayudamos a verificar disponibilidad real.",
  },
  {
    num: "03",
    title: "Coordinamos",
    text: "Escribinos por WhatsApp y avanzamos con una atención directa.",
  },
];

function stepsHtml(): string {
  return STEPS.map(
    (s) => `
        <div class="footer-step">
          <span class="footer-step-num">${s.num}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.text)}</p>
        </div>`,
  ).join("");
}

function socialHtml(s: PublicSettings): string {
  return [
    s.facebookUrl
      ? `<a class="footer-social-btn" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener"><span class="fb-ico"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></span> Facebook</a>`
      : "",
    s.instagramUrl
      ? `<a class="footer-social-btn" href="${esc(s.instagramUrl)}" target="_blank" rel="noopener"><span class="ig-ico"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg></span> Instagram</a>`
      : "",
  ].join("");
}

/** HTML completo del pie. `s` es lo que devuelve /api/public/settings. */
export function footerHtml(s: PublicSettings): string {
  const hours = s.storeHours ? esc(s.storeHours).replace(/\n/g, "<br/>") : "—";
  const addressLink = s.storeAddress
    ? s.storeMapUrl
      ? `<a class="footer-link" href="${esc(s.storeMapUrl)}" target="_blank" rel="noopener">${esc(s.storeAddress)} ↗</a>`
      : esc(s.storeAddress)
    : "—";
  const legal = LEGAL_LINKS.map(
    (l) => `<li><a class="footer-link" href="${esc(l.href)}">${esc(l.label)}</a></li>`,
  ).join("");
  const social = socialHtml(s);

  return `
      <div class="footer-steps">${stepsHtml()}
      </div>
      <div class="footer-cols">
        <div class="footer-col">
          <p class="footer-brand">${esc(s.storeName || "CenterPhone Celulares")}</p>
          <p class="footer-tagline">Tecnología para elegir con información clara y atención directa.</p>
        </div>
        <div class="footer-col">
          <p class="footer-head">Horarios</p>
          <p id="footer-hours">${hours}</p>
        </div>
        <div class="footer-col">
          <p class="footer-head">Visitános</p>
          <p id="footer-address">${addressLink}</p>
        </div>
        <div class="footer-col">
          <p class="footer-head">Seguinos</p>
          <div class="footer-social" id="footer-social">${social}</div>
        </div>
        <div class="footer-col footer-col--legal">
          <p class="footer-head">Legal</p>
          <ul class="footer-legal">${legal}</ul>
          <p class="footer-legal-owner">Titular: ${esc(TITULAR)}<br/>CUIT ${esc(CUIT)}<br/>${esc(DOMICILIO)}</p>
        </div>
      </div>`;
}

/**
 * Monta el pie en el placeholder de la página actual. Si no hay placeholder
 * (páginas que no lo usan) no hace nada. Se llama después de tener settings.
 */
export function mountSiteFooter(s: PublicSettings): void {
  const host = document.querySelector<HTMLElement>("[data-site-footer]");
  if (!host) return;
  host.innerHTML = footerHtml(s);
  // El contenido se reemplaza: el aria-label del pie se mantiene en el HTML.
  host.hidden = false;
}
