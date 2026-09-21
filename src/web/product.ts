// SPA de ficha de producto.

import type { Category, Product } from "../shared/types";
import type { CatalogSnapshot } from "../shared/types";
import type { PublicSettings } from "./types-web";
import { formatPrice, availabilityLabel } from "../shared/format";
import { waLink } from "../shared/whatsapp";
import { setupModals, fillStoreInfo } from "./store-modals";
import { isFresh } from "./catalog";

interface DetailResponse {
  product: Product;
  related: Product[];
  settings: PublicSettings;
}

const el = {
  app: document.getElementById("app") as HTMLElement,
  breadcrumbs: document.getElementById("breadcrumbs") as HTMLElement,
  related: document.getElementById("related") as HTMLElement,
  waFloat: document.getElementById("wa-float") as HTMLAnchorElement,
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

function productIdFromUrl(): string {
  const parts = location.pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts[1] ?? "");
}

async function loadSnapshot(): Promise<CatalogSnapshot | null> {
  try {
    const res = await fetch("/api/catalog");
    return res.ok ? ((await res.json()) as CatalogSnapshot) : null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  const id = productIdFromUrl();
  el.app.innerHTML = `<div class="state"><div class="spinner"></div><p>Cargando producto…</p></div>`;
  try {
    const res = await fetch(`/api/products/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      el.app.innerHTML = `<div class="state"><p>Producto no encontrado.</p><a class="btn btn-primary" href="/">Volver al catálogo</a></div>`;
      el.related.innerHTML = "";
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DetailResponse;
    render(data, await loadSnapshot());
  } catch (e) {
    el.app.innerHTML = `<div class="state"><p>⚠️ No se pudo cargar el producto.</p>
      <p class="error">${esc(e instanceof Error ? e.message : String(e))}</p>
      <a class="btn btn-primary" href="/">Volver al catálogo</a></div>`;
  }
}

function render(data: DetailResponse, snapshot: CatalogSnapshot | null): void {
  const { product, related, settings } = data;
  document.title = settings.storeName ? `${product.title} — ${settings.storeName}` : `${product.title}`;
  // La marca del footer también sigue al storeName (lo aplica fillStoreInfo).
  const symbol = settings.currencySymbol || "$";
  const cat = snapshot?.categories.find((c) => c.id === product.categoryId);

  el.breadcrumbs.innerHTML =
    `<a href="/">Inicio</a>` +
    (cat ? ` › <a href="/?cat=${encodeURIComponent(cat.id)}">${esc(cat.name)}</a>` : "") +
    ` › <span>${esc(product.title)}</span>`;

  const img = product.imageUrl
    ? `<img src="${esc(product.imageUrl)}" alt="${esc(product.title)}" />`
    : "📱";
  const stockBadge = product.hiddenNoStock
    ? `<span class="badge badge--stock-out" title="Este producto ya no está disponible (la fuente de importación ya no lo trae)">Sin stock</span>`
    : product.availability === "out_of_stock"
      ? `<span class="badge badge--stock-out">Sin stock</span>`
      : product.availability === "preorder"
        ? `<span class="badge badge--stock-pre">Bajo pedido</span>`
        : `<span class="badge badge--stock-pre ok">En stock</span>`;
  const hiddenNotice = product.hiddenNoStock
    ? `<p class="muted" style="color:var(--danger)">⚠️ Este producto ya no está disponible. Te puede interesar alguno de los relacionados de abajo.</p>`
    : "";
  const freshHours = settings.freshHours ?? 48;
  const freshBadge = isFresh(product, freshHours) ? `<span class="badge badge--fresh" title="Cargado recientemente">Nuevo</span>` : "";
  const tags = product.tags
    .map((t) => `<span class="badge badge--${t}">${t === "new" ? "Nuevo" : t === "featured" ? "Destacado" : "Oferta"}</span>`)
    .join("");

  const wa = settings.whatsappOk
    ? waLink(settings, product, location.origin)
    : null;

  el.app.innerHTML = `
    <div class="product-detail">
      <div class="img">${img}</div>
      <div>
        <div class="badges">${freshBadge} ${tags} ${stockBadge}</div>
        <h1>${esc(product.title)}</h1>
        <div class="price">${formatPrice(product.priceCents, symbol)}</div>
        <p class="desc">${esc(product.description || "Sin descripción.")}</p>
        ${hiddenNotice}
        <p class="muted">Disponibilidad: ${esc(availabilityLabel(product.availability))}</p>
        <div class="actions">
          ${wa ? `<a class="btn btn-wa" href="${esc(wa)}" target="_blank" rel="noopener">💬 Consultar por WhatsApp</a>` : ""}
          <a class="btn" href="/">← Seguir viendo</a>
        </div>
      </div>
    </div>`;

  // El botón flotante de WhatsApp no tiene sentido en un producto sin stock.
  if (wa && !product.hiddenNoStock) {
    el.waFloat.href = wa;
    el.waFloat.hidden = false;
  }

  // Botón "Cómo comprar" del header: modal compartido con el home.
  setupModals(settings);
  fillStoreInfo(settings);

  el.related.innerHTML = related
    .map((p) => {
      const thumb = p.imageUrl
        ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" loading="lazy" />`
        : "📱";
      return `<a class="card" href="/producto/${esc(p.id)}">
        <div class="card-img">${thumb}</div>
        <div class="card-body">
          <h3 class="card-title">${esc(p.title)}</h3>
          <div class="card-foot"><span class="card-price">${formatPrice(p.priceCents, symbol)}</span></div>
        </div>
      </a>`;
    })
    .join("");
  document.querySelector(".related")?.classList.toggle("related--empty", related.length === 0);
}

void init();
