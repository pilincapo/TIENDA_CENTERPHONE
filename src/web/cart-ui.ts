// UI del carrito compartida por el home y la ficha de producto.
// El modal se inyecta en el <body> al iniciar (los HTML base no lo traen).
// El checkout solo envía {id, qty} + nombre/teléfono: los precios los calcula
// el worker (ver src/worker/checkout.ts).

import type { Product } from "../shared/types";
import type { PublicSettings } from "./types-web";
import { formatPrice } from "../shared/format";
import {
  cartAdd, cartClear, cartLines, cartRemove, cartSetQty, cartCount, onCartChange,
  MAX_QTY_PER_ITEM,
} from "./cart";

const STORAGE_KEY_SNAPSHOT = "celu_products_cache";

export interface CartUIInit {
  settings: PublicSettings;
  /** Productos de la página actual (para resolver id → título/precio). */
  products: Product[];
}

let init: CartUIInit | null = null;
let paying = false;

// Cache liviano de productos (sessionStorage) para que el modal resuelva
// títulos/precios aunque la página ya haya re-renderizado.
export function cacheProducts(products: Product[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify(products.slice(0, 500)));
  } catch {
    // sessionStorage lleno: el modal igual funciona con lo cargado en memoria.
  }
}

function cachedProducts(): Product[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_SNAPSHOT);
    return raw ? (JSON.parse(raw) as Product[]) : [];
  } catch {
    return [];
  }
}

function productById(id: string): Product | undefined {
  return init?.products.find((p) => p.id === id) ?? cachedProducts().find((p) => p.id === id);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

function ensureModal(): void {
  if (document.getElementById("modal-cart")) return;
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "modal-cart";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-box modal-box--cart" role="dialog" aria-modal="true" aria-label="Carrito">
      <button class="modal-x" type="button" aria-label="Cerrar">✕</button>
      <h2>Tu carrito</h2>
      <div id="cart-body"></div>
      <p class="cart-note" id="cart-note"></p>
      <div id="cart-checkout" hidden>
        <div class="cart-fields">
          <input id="cart-name" type="text" placeholder="Tu nombre" maxlength="80" autocomplete="name" />
          <input id="cart-phone" type="tel" placeholder="Tu WhatsApp (ej: 342 555 1234)" maxlength="24" autocomplete="tel" />
        </div>
        <p class="cart-error" id="cart-error" hidden></p>
        <button class="btn btn-primary cart-pay" id="cart-pay" type="button">Pagar con MercadoPago</button>
        <button class="btn cart-transfer-btn" id="cart-transfer" type="button" hidden>Coordinar por transferencia</button>
        <p class="cart-secure">🔒 Pago procesado por MercadoPago. No guardamos datos de tarjeta.</p>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".modal-x")?.addEventListener("click", closeCart);
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) closeCart();
  });
  document.getElementById("cart-pay")?.addEventListener("click", () => void submitCheckout());
  document.getElementById("cart-transfer")?.addEventListener("click", () => void submitTransfer());
}

function closeCart(): void {
  const modal = document.getElementById("modal-cart");
  if (modal) modal.hidden = true;
  document.body.style.overflow = "";
}

function setPayError(msg: string): void {
  const errEl = document.getElementById("cart-error");
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.hidden = msg === "";
}

async function submitCheckout(): Promise<void> {
  if (paying) return;
  const name = (document.getElementById("cart-name") as HTMLInputElement | null)?.value ?? "";
  const phone = (document.getElementById("cart-phone") as HTMLInputElement | null)?.value ?? "";
  const btn = document.getElementById("cart-pay") as HTMLButtonElement | null;
  const lines = cartLines();
  if (lines.length === 0) return;
  if (name.trim() === "" || phone.trim() === "") {
    setPayError("Completá tu nombre y tu WhatsApp para coordinar la entrega.");
    return;
  }
  setPayError("");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Redirigiendo a MercadoPago…";
  }
  paying = true;
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: lines, name, phone }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; orderId?: string; initPoint?: string; error?: string } | null;
    if (!res.ok || !data?.initPoint) {
      setPayError(data?.error ?? "No se pudo iniciar el pago. Probá de nuevo.");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Pagar con MercadoPago";
      }
      paying = false;
      return;
    }
    // El pedido ya quedó registrado en el worker con los precios congelados:
    // se limpia el carrito y se guarda el id para la página de seguimiento.
    try {
      if (data.orderId) sessionStorage.setItem("celu_last_order", data.orderId);
    } catch { /* no-op */ }
    cartClear();
    location.href = data.initPoint;
  } catch {
    setPayError("Error de red. Verificá tu conexión y probá de nuevo.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Pagar con MercadoPago";
    }
    paying = false;
  }
}

/**
 * Checkout por transferencia: mismo formulario (nombre + WhatsApp), crea el
 * pedido pending SIN pasar por MercadoPago y muestra los datos para transferir
 * + WhatsApp pre-cargado. El vendedor lo cierra a mano desde el panel.
 */
async function submitTransfer(): Promise<void> {
  if (paying) return;
  const name = (document.getElementById("cart-name") as HTMLInputElement | null)?.value ?? "";
  const phone = (document.getElementById("cart-phone") as HTMLInputElement | null)?.value ?? "";
  const btn = document.getElementById("cart-transfer") as HTMLButtonElement | null;
  const lines = cartLines();
  if (lines.length === 0) return;
  if (name.trim() === "" || phone.trim() === "") {
    setPayError("Completá tu nombre y tu WhatsApp para coordinar la entrega.");
    return;
  }
  setPayError("");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Registrando tu pedido…";
  }
  paying = true;
  try {
    const res = await fetch("/api/orders/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: lines, name, phone }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; orderId?: string; totalCents?: number; discountPercent?: number; waHref?: string | null; error?: string } | null;
    if (!res.ok || !data?.ok || !data.orderId) {
      setPayError(data?.error ?? "No se pudo registrar el pedido. Probá de nuevo.");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Coordinar por transferencia";
      }
      paying = false;
      return;
    }
    try {
      sessionStorage.setItem("celu_last_order", data.orderId);
      sessionStorage.setItem("celu_transfer_ok", JSON.stringify({ totalCents: data.totalCents ?? 0, discountPercent: data.discountPercent ?? 0, waHref: data.waHref ?? null }));
    } catch { /* no-op */ }
    cartClear();
    updateBadge();
    showTransferDone(data.orderId, data.totalCents ?? 0, data.discountPercent ?? 0, data.waHref ?? null);
    paying = false;
  } catch {
    setPayError("Error de red. Verificá tu conexión y probá de nuevo.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Coordinar por transferencia";
    }
    paying = false;
  }
}

/** Pantalla de éxito del pedido por transferencia (dentro del modal). */
function showTransferDone(orderId: string, totalCents: number, discountPercent: number, waHref: string | null): void {
  if (!init) return;
  const symbol = init.settings.currencySymbol || "$";
  const body = document.getElementById("cart-body");
  const checkout = document.getElementById("cart-checkout");
  const noteEl = document.getElementById("cart-note");
  if (checkout) checkout.hidden = true;
  if (noteEl) noteEl.textContent = "";
  if (!body) return;
  const waBtn = waHref !== "" && waHref
    ? `<a class="btn btn-primary cart-pay" id="transfer-wa" href="${esc(waHref)}" target="_blank" rel="noopener">💬 Avisar por WhatsApp y coordinar</a>`
    : "";
  const link = `${location.origin}/pedido/${esc(orderId)}`;
  const cbu = (init.settings.transferCbu ?? "").trim();
  const cbuBlock = cbu !== ""
    ? `<div class="cbu-box">
        <div class="cbu-label">CBU / Alias para transferir</div>
        <div class="cbu-row">
          <code class="cbu-value">${esc(cbu)}</code>
          <button type="button" class="btn cbu-copy" id="cbu-copy">Copiar</button>
        </div>
      </div>`
    : `<p class="cart-secure">Te pasamos el CBU/alias por WhatsApp al avisar tu pago.</p>`;
  body.innerHTML = `
    <div class="transfer-done">
      <div class="transfer-done-emoji">📝</div>
      <h3 class="transfer-done-title">¡Pedido registrado!</h3>
      <p class="transfer-done-sub">Transferí el total de abajo y avisá con el botón de WhatsApp. Pasalo a nombre de quien hace la transferencia.</p>
      <div class="transfer-done-total">Total a transferir <b>${formatPrice(totalCents, symbol)}</b>${discountPercent > 0 ? ` <small class="muted">(ya con el ${discountPercent}% de descuento)</small>` : ""}</div>
      ${cbuBlock}
      ${waBtn}
      <a class="btn cart-transfer-btn" href="${link}">Ver el estado de mi pedido</a>
      <p class="cart-secure">Transferí con el CBU/alias de arriba y avisá con el botón. El pedido queda en lista hasta que se acredite.</p>
    </div>`;

  // Copiar CBU/alias al portapapeles (con fallback de selección manual).
  document.getElementById("cbu-copy")?.addEventListener("click", async () => {
    const btn = document.getElementById("cbu-copy") as HTMLButtonElement | null;
    const codeEl = document.querySelector(".cbu-value");
    if (!btn || !codeEl) return;
    try {
      await navigator.clipboard.writeText(cbu);
      btn.textContent = "✓ Copiado";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      btn.textContent = "Seleccionalo y copialo";
    }
    setTimeout(() => { btn.textContent = "Copiar"; }, 2500);
  });
}

function updateBadge(): void {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  const n = cartCount();
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.hidden = n === 0;
}

function renderCart(): void {
  const body = document.getElementById("cart-body");
  const checkout = document.getElementById("cart-checkout");
  if (!body || !init) return;
  const symbol = init.settings.currencySymbol || "$";
  const lines = cartLines();
  const consult = init.settings.whatsappOk
    ? `<p class="cart-consult">¿Preferís coordinar por WhatsApp? <button type="button" class="cart-consult-btn" id="cart-consult">Consultar este pedido</button></p>`
    : "";
  const cBtn = document.getElementById("cart-consult");
  if (cBtn) cBtn.remove(); // re-wire limpio en cada render
  if (lines.length === 0) {
    body.innerHTML = `<p class="cart-empty">Tu carrito está vacío.<br/>Agregá productos con el botón <b>Agregar</b>.</p>${consult}`;
    if (checkout) checkout.hidden = true;
    const noteEl = document.getElementById("cart-note");
    if (noteEl) noteEl.textContent = "";
    wireConsult();
    return;
  }
  let total = 0;
  let anyInvalid = false;
  const rows = lines.map((l) => {
    const p = productById(l.id);
    const price = p ? p.priceCents : null;
    if (price === null) anyInvalid = true;
    const subtotal = price !== null ? price * l.qty : 0;
    total += subtotal;
    const title = p ? esc(p.title) : `<span class="cart-missing">Producto ya no disponible</span>`;
    const img = p?.imageUrl
      ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" />`
      : `<span class="cart-thumb-ph">📱</span>`;
    return `
      <div class="cart-line" data-id="${esc(l.id)}">
        <div class="cart-thumb">${img}</div>
        <div class="cart-line-info">
          <div class="cart-line-title">${title}</div>
          <div class="cart-line-price">${price !== null ? formatPrice(price, symbol) : ""}</div>
          <div class="cart-qty">
            <button type="button" class="cart-qty-btn" data-dec="${esc(l.id)}" aria-label="Quitar uno">−</button>
            <span class="cart-qty-n">${l.qty}</span>
            <button type="button" class="cart-qty-btn" data-inc="${esc(l.id)}" aria-label="Agregar uno">+</button>
          </div>
        </div>
        <div class="cart-line-right">
          <div class="cart-line-sub">${price !== null ? formatPrice(subtotal, symbol) : ""}</div>
          <button type="button" class="cart-remove" data-rm="${esc(l.id)}">Quitar</button>
        </div>
      </div>`;
  }).join("");
  // El total a cobrar lo recalcula el worker: esto es solo anticipación visual.
  const surchargePercent = Math.min(50, Math.max(0, Math.round(Number(init.settings.mpSurchargePercent ?? 0))));
  const totalSurcharge = surchargePercent > 0 ? total + Math.round((total * surchargePercent) / 100) : total;
  const discountPercent = Math.min(50, Math.max(0, Math.round(Number(init.settings.transferDiscountPercent ?? 0))));
  const transferNote = discountPercent > 0
    ? `<p class="cart-transfer">Pagando por transferencia tenés <b>${discountPercent}% de descuento</b>: total ${formatPrice(total - Math.round((total * discountPercent) / 100), symbol)}. Elegí "Consultar este pedido" y lo coordinamos por WhatsApp.</p>`
    : "";
  body.innerHTML = `
    <div class="cart-lines">${rows}</div>
    ${surchargePercent > 0 ? `<div class="cart-total cart-total-sub">Subtotal <b>${formatPrice(total, symbol)}</b></div>
    <div class="cart-total">Total con pago online <b>${formatPrice(totalSurcharge, symbol)}</b> <small class="muted">(incluye recargo de ${surchargePercent}%)</small></div>` : `<div class="cart-total">Total <b>${formatPrice(total, symbol)}</b></div>`}
    ${transferNote}
    ${anyInvalid ? `<p class="cart-warn">Hay productos que ya no están disponibles: se quitarán al confirmar.</p>` : ""}
    ${consult}`;
  if (checkout) checkout.hidden = false;
  const noteEl = document.getElementById("cart-note");
  if (noteEl) noteEl.textContent = init.settings.checkoutNote ?? "";
  wireConsult();
  // "Coordinar por transferencia" solo tiene sentido con descuento cargado:
  // si no hay descuento, transferir = pagar lo mismo sin el flujo del panel.
  const transferBtn = document.getElementById("cart-transfer") as HTMLButtonElement | null;
  if (transferBtn) transferBtn.hidden = discountPercent === 0;
  body.querySelectorAll<HTMLButtonElement>("[data-inc]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.inc ?? "";
      if (!cartAdd(id, 1)) flashLimit(id);
      renderCart();
    }));
  body.querySelectorAll<HTMLButtonElement>("[data-dec]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.dec ?? "";
      const line = cartLines().find((l) => l.id === id);
      if (line && line.qty <= 1) cartRemove(id);
      else if (line) cartSetQty(id, line.qty - 1);
      renderCart();
    }));
  body.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => {
      cartRemove(b.dataset.rm ?? "");
      renderCart();
    }));
}

// Aviso al llegar al tope por producto (inline y temporario, sin alert()).
function flashLimit(id: string): void {
  const line = document.querySelector(`.cart-line[data-id="${CSS.escape(id)}"] .cart-line-sub`);
  if (!line) return;
  const note = document.createElement("span");
  note.className = "cart-limit-note";
  note.textContent = `máx ${MAX_QTY_PER_ITEM}`;
  line.appendChild(note);
  setTimeout(() => note.remove(), 1800);
}

function wireConsult(): void {
  const btn = document.getElementById("cart-consult");
  if (!btn || !init) return;
  btn.addEventListener("click", () => {
    if (!init) return;
    const wa = init.settings.whatsappPhone.replace(/\D/g, "");
    const symbol = init.settings.currencySymbol || "$";
    const lines = cartLines();
    const items = lines.map((l) => {
      const p = productById(l.id);
      return p ? `• ${l.qty}x ${p.title} (${formatPrice(p.priceCents * l.qty, symbol)})` : "";
    }).filter(Boolean).join("\n");
    const total = lines.reduce((s, l) => {
      const p = productById(l.id);
      return s + (p ? p.priceCents * l.qty : 0);
    }, 0);
    const discount = Math.min(50, Math.max(0, Math.round(Number(init.settings.transferDiscountPercent ?? 0))));
    const transferTotal = discount > 0 ? total - Math.round((total * discount) / 100) : total;
    const text = `Hola! Quiero comprar:\n${items}\nTotal: ${formatPrice(total, symbol)}`
      + (discount > 0 ? `\nCon el ${discount}% de descuento por transferencia: ${formatPrice(transferTotal, symbol)}` : "");
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  });
}

/** Abre el modal del carrito (botón del header). */
export function openCart(): void {
  ensureModal();
  renderCart();
  const modal = document.getElementById("modal-cart");
  if (modal) {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }
}

/**
 * Compra directa ("Comprar" en card/ficha): si el producto no está en el
 * carrito lo agrega y abre el modal directo en el paso de checkout. No vacía
 * un carrito acumulado: el modal muestra la lista completa antes de pagar
 * (comprar un solo producto = carrito con solo ese ítem).
 */
export function buyNow(p: Product): void {
  ensureModal();
  const line = cartLines().find((l) => l.id === p.id);
  if (!line) cartAdd(p.id, 1);
  renderCart();
  const modal = document.getElementById("modal-cart");
  if (modal) {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelector<HTMLInputElement>("#cart-name")?.focus();
  }
}

/**
 * Inicializa la UI del carrito en la página actual: botón del header, badge y
 * delegación global de clicks para [data-add]/[data-buy] (cards y ficha).
 */
export function setupCartUI(settings: PublicSettings, products: Product[]): void {
  init = { settings, products };
  ensureModal();
  cacheProducts(products);
  const btn = document.getElementById("cart-btn");
  if (btn) {
    btn.hidden = false;
    btn.addEventListener("click", openCart);
  }
  updateBadge();
  onCartChange(updateBadge);

  // Delegación: los botones [data-add]/[data-buy] viven en cards y ficha,
  // que se re-renderizan con innerHTML (la delegación sobrevive a eso).
  document.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const addBtn = t.closest<HTMLButtonElement>("[data-add]");
    if (addBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const id = addBtn.dataset.add ?? "";
      if (cartAdd(id, 1)) {
        addBtn.classList.add("added");
        addBtn.textContent = "✓ Agregado";
      } else {
        addBtn.textContent = `Máx ${MAX_QTY_PER_ITEM}`;
      }
      setTimeout(() => {
        addBtn.classList.remove("added");
        addBtn.textContent = "Agregar";
      }, 1100);
      return;
    }
    const buyBtn = t.closest<HTMLButtonElement>("[data-buy]");
    if (buyBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const p = productById(buyBtn.dataset.buy ?? "");
      if (p) buyNow(p);
    }
  });

  // Escape cierra el carrito (igual que los otros modales).
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeCart();
  });
}
