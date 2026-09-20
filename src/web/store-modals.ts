// Modales compartidos "Cómo comprar" y "Contacto" + datos del comercio.
// Los usan el home (catalog.ts) y la ficha de producto (product.ts).
// El HTML de los modales vive en cada página (index.html / product.html).

import type { PublicSettings } from "./types-web";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

export function waHref(settings: PublicSettings, text: string): string | null {
  if (!settings.whatsappOk) return null;
  return `https://wa.me/${settings.whatsappPhone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

// Rellena footer y modales con los datos configurados en el panel.
// root: document para el home; en la ficha también aplica (mismos ids).
// Aplica el storeName al header: primera palabra blanca (brand-name),
// resto verde (brand-tag). Si hay una sola palabra, todo queda en brand-name.
function applyBrandName(name: string): void {
  const nameEl = document.querySelector<HTMLElement>(".brand-name");
  const tagEl = document.querySelector<HTMLElement>(".brand-tag");
  const logo = document.querySelector<HTMLImageElement>(".brand-logo");
  const trimmed = name.trim();
  if (!trimmed) return;
  const space = trimmed.indexOf(" ");
  const first = space === -1 ? trimmed : trimmed.slice(0, space);
  const rest = space === -1 ? "" : trimmed.slice(space + 1);
  if (nameEl) nameEl.textContent = first;
  if (tagEl) {
    tagEl.textContent = rest;
    // El HTML reserva el span con el atributo hidden: hay que quitarlo, no basta
    // con display (la regla global [hidden] usa !important).
    tagEl.hidden = !rest;
  }
  if (logo) logo.alt = trimmed;
  const brand = document.querySelector<HTMLAnchorElement>("a.brand");
  if (brand) brand.title = trimmed;
}

export function fillStoreInfo(s: PublicSettings): void {
  // Nombre de la tienda: header (marca), footer y alt del logo.
  if (s.storeName) applyBrandName(s.storeName);
  if (s.storeName) {
    const fb = document.querySelector(".footer-brand");
    if (fb) fb.textContent = s.storeName;
  }

  // Footer: horarios, dirección con link a Maps y redes.
  // Link de Seguimiento del header: lo actualiza con lo configurado en el panel;
  // si queda vacío, se oculta el botón.
  const track = document.getElementById("nav-track") as HTMLAnchorElement | null;
  if (track) {
    if (s.trackUrl) {
      track.href = s.trackUrl;
      track.hidden = false;
    } else {
      track.hidden = true;
    }
  }
  const hours = document.getElementById("footer-hours");
  if (hours && s.storeHours) hours.innerHTML = esc(s.storeHours).replace(/\n/g, "<br/>");
  const addr = document.getElementById("footer-address");
  if (addr && s.storeAddress) {
    addr.innerHTML = s.storeMapUrl
      ? `<a class="footer-link" href="${esc(s.storeMapUrl)}" target="_blank" rel="noopener">${esc(s.storeAddress)} ↗</a>`
      : esc(s.storeAddress);
  }
  const social = document.getElementById("footer-social");
  if (social) {
    social.innerHTML = [
      s.facebookUrl ? `<a class="footer-social-btn" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener"><span class="fb-ico"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></span> Facebook</a>` : "",
      s.instagramUrl ? `<a class="footer-social-btn" href="${esc(s.instagramUrl)}" target="_blank" rel="noopener"><span class="ig-ico"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg></span> Instagram</a>` : "",
    ].join("");
  }

  // Modal Cómo comprar: nota de retiro con la dirección.
  const howNote = document.getElementById("modal-how-note");
  if (howNote && s.storeAddress) {
    howNote.hidden = false;
    howNote.innerHTML = `📍 Retiro en el local: <strong>${esc(s.storeAddress)}</strong>`;
  }

  // Modal Contacto: ítems según lo que haya configurado.
  const items = document.getElementById("modal-contact-items");
  if (items) {
    const hoursHtml = s.storeHours ? esc(s.storeHours).replace(/\n/g, "<br/>") : "";
    const socialLinks = [
      s.instagramUrl ? `<a class="social-link" href="${esc(s.instagramUrl)}" target="_blank" rel="noopener"><span class="ig-ico"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg></span> Instagram</a>` : "",
      s.facebookUrl ? `<a class="social-link" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener"><span class="fb-ico"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></span> Facebook</a>` : "",
    ].filter(Boolean).join(" · ");
    items.innerHTML = [
      s.storeAddress ? `<div class="modal-contact-item"><span>📍</span><div><strong>Local</strong><p>${s.storeMapUrl ? `<a href="${esc(s.storeMapUrl)}" target="_blank" rel="noopener">${esc(s.storeAddress)}</a>` : esc(s.storeAddress)}</p></div></div>` : "",
      hoursHtml ? `<div class="modal-contact-item"><span>🕐</span><div><strong>Horarios</strong><p>${hoursHtml}</p></div></div>` : "",
      s.whatsappOk ? `<div class="modal-contact-item"><span class="ico-wa"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg></span><div><strong>WhatsApp</strong><p>Consultás desde cualquier botón de la página</p></div></div>` : "",
      socialLinks ? `<div class="modal-contact-item"><span>📷</span><div><strong>Redes</strong><p>${socialLinks}</p></div></div>` : "",
    ].filter(Boolean).join("");
  }

  // Ficha de producto: tarjeta de horario y dirección bajo el detalle.
  const card = document.getElementById("store-card");
  if (card && (s.storeHours || s.storeAddress)) {
    const ch = document.getElementById("store-card-hours");
    if (ch && s.storeHours) ch.innerHTML = esc(s.storeHours).replace(/\n/g, "<br/>");
    const ca = document.getElementById("store-card-address");
    if (ca && s.storeAddress) {
      ca.innerHTML = s.storeMapUrl
        ? `<a href="${esc(s.storeMapUrl)}" target="_blank" rel="noopener">${esc(s.storeAddress)} ↗</a>`
        : esc(s.storeAddress);
    }
    card.hidden = false;
  }
}

// Abre/cierra los dos modales y conecta los botones del header.
// waText: mensaje pre-cargado para los botones de WhatsApp de los modales.
export function setupModals(s: PublicSettings): void {
  const waText = "Hola! Tengo una consulta sobre el catálogo.";
  const href = waHref(s, waText);
  for (const id of ["modal-how", "modal-contact"]) {
    const modal = document.getElementById(id);
    if (!modal) continue;
    const waLink = modal.querySelector<HTMLAnchorElement>(".modal-wa");
    if (waLink) {
      if (href) waLink.href = href;
      else waLink.remove();
    }
    modal.querySelector<HTMLButtonElement>(".modal-x")?.addEventListener("click", () => {
      modal.hidden = true;
    });
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) modal.hidden = true;
    });
  }
  document.getElementById("nav-how")?.addEventListener("click", () => openModal("modal-how"));
  document.getElementById("nav-contact")?.addEventListener("click", () => openModal("modal-contact"));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      const how = document.getElementById("modal-how");
      const contact = document.getElementById("modal-contact");
      if (how) how.hidden = true;
      if (contact) contact.hidden = true;
    }
  });
}

function openModal(id: string): void {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  const obs = new MutationObserver(() => {
    if (modal.hidden) {
      document.body.style.overflow = "";
      obs.disconnect();
    }
  });
  obs.observe(modal, { attributes: true, attributeFilter: ["hidden"] });
}
