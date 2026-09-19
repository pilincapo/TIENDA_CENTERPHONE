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
      s.facebookUrl ? `<a class="footer-social-btn" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener"><span class="fb-ico">f</span> Facebook</a>` : "",
      s.instagramUrl ? `<a class="footer-social-btn" href="${esc(s.instagramUrl)}" target="_blank" rel="noopener"><span class="ig-ico">◎</span> Instagram</a>` : "",
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
      s.instagramUrl ? `<a href="${esc(s.instagramUrl)}" target="_blank" rel="noopener">Instagram</a>` : "",
      s.facebookUrl ? `<a href="${esc(s.facebookUrl)}" target="_blank" rel="noopener">Facebook</a>` : "",
    ].filter(Boolean).join(" · ");
    items.innerHTML = [
      s.storeAddress ? `<div class="modal-contact-item"><span>📍</span><div><strong>Local</strong><p>${s.storeMapUrl ? `<a href="${esc(s.storeMapUrl)}" target="_blank" rel="noopener">${esc(s.storeAddress)}</a>` : esc(s.storeAddress)}</p></div></div>` : "",
      hoursHtml ? `<div class="modal-contact-item"><span>🕐</span><div><strong>Horarios</strong><p>${hoursHtml}</p></div></div>` : "",
      s.whatsappOk ? `<div class="modal-contact-item"><span>💬</span><div><strong>WhatsApp</strong><p>Consultás desde cualquier botón de la página</p></div></div>` : "",
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
