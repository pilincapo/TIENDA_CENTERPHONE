// SPA del catálogo público.

import type { CatalogSnapshot, Category, Product, Tag } from "../shared/types";
import type { PublicSettings } from "./types-web";
import { formatPrice, tagLabel } from "../shared/format";
import { waLinkText } from "../shared/whatsapp";
import { fillStoreInfo, setupModals } from "./store-modals";
import { track } from "./track";

type SortMode = "default" | "price-asc" | "price-desc" | "random";

const PAGE_SIZE = 20;

const state = {
  snapshot: null as CatalogSnapshot | null,
  settings: null as PublicSettings | null,
  search: "",
  category: "",
  tags: new Set<Tag>(),
  // Orden por defecto: aleatorio, para que todos los productos se promocionen.
  // El seed cambia en cada visita: cada carga muestra el catálogo en otro orden.
  sort: "random" as SortMode,
  seed: Math.floor(Math.random() * 1e9),
  shown: PAGE_SIZE,
};

const el = {
  search: document.getElementById("search") as HTMLInputElement,
  toolbar: document.getElementById("toolbar") as HTMLElement,
  content: document.getElementById("content") as HTMLElement,
  waFloat: document.getElementById("wa-float") as HTMLAnchorElement,
  how: document.getElementById("how") as HTMLElement,
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

async function init(): Promise<void> {
  setContent(`<div class="state"><div class="spinner"></div><p>Cargando catálogo…</p></div>`);
  try {
    const res = await fetch("/api/catalog");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.snapshot = (await res.json()) as CatalogSnapshot;
    const sres = await fetch("/api/public/settings");
    state.settings = sres.ok ? ((await sres.json()) as PublicSettings) : null;
    setupWaFloat();
    const catParam = new URLSearchParams(location.search).get("cat");
    if (catParam) state.category = catParam;
    el.search.addEventListener("input", () => {
      state.search = el.search.value;
      resetPager();
      render();
    });
    // Búsqueda: un evento por término estable (debounce 1.2s tras dejar de tipear).
    let searchTimer = 0;
    el.search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = el.search.value.trim();
        if (q.length >= 3) track("search", { query: q });
      }, 1200);
    });
    setupHowObserver();
    if (state.settings) {
      setupModals(state.settings);
      fillStoreInfo(state.settings);
      if (state.settings.storeName) {
        // El nombre del panel manda: title + og:title/og:description dinámicos.
        const fullTitle = `${state.settings.storeName} — Catálogo`;
        document.title = fullTitle;
        for (const sel of ['meta[property="og:title"]', 'meta[itemprop="og:title"]']) {
          const m = document.querySelector<HTMLMetaElement>(sel);
          if (m) m.content = fullTitle;
        }
        const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
        if (ogDesc && state.settings.howTitle) ogDesc.content = state.settings.howTitle;
      }
    }
    // Stats de la línea terminal del hero (se muestran cuando hay catálogo)
    const published = (state.snapshot?.products ?? []).length;
    const statCount = document.getElementById("stat-count");
    const statWrap = document.getElementById("hero-stats");
    if (statCount && published > 0) statCount.textContent = String(published);
    if (statWrap && published > 0) statWrap.hidden = false;
    render();
    track("home_view", {}, true);
  } catch (e) {
    renderError(e instanceof Error ? e : new Error(String(e)));
  }
}

function setContent(html: string): void {
  el.content.innerHTML = html;
}

function renderError(err: Error): void {
  setContent(
    `<div class="state"><p>⚠️ No se pudo cargar el catálogo.</p>
     <p class="error">${esc(err.message)}</p>
     <button class="btn btn-primary" id="retry">Reintentar</button></div>`
  );
  document.getElementById("retry")?.addEventListener("click", () => void init());
}

function setupWaFloat(): void {
  if (!state.settings?.whatsappOk) return;
  el.waFloat.href = waLinkText(state.settings, "Hola! Quiero hacer una consulta.");
  el.waFloat.hidden = false;
}

// Sección "Cómo comprar": las imágenes se cargan recién cuando está por verse.
function setupHowObserver(): void {
  if (!("IntersectionObserver" in window)) {
    el.how.setAttribute("loading", "eager");
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        el.how.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
          img.src = img.dataset.src ?? "";
          delete img.dataset.src;
        });
        io.disconnect();
      }
    }
  }, { rootMargin: "400px" });
  io.observe(el.how);
}

// ---- Filtros ----

function rootCategories(): Category[] {
  const cats = state.snapshot?.categories ?? [];
  return cats.filter((c) => c.parentId === null);
}

function subcategoriesOf(parentId: string): Category[] {
  return (state.snapshot?.categories ?? []).filter((c) => c.parentId === parentId);
}

function sortLabel(): string {
  switch (state.sort) {
    case "price-asc": return "Menor precio";
    case "price-desc": return "Mayor precio";
    case "random": return "Aleatorio";
    default: return "Más recientes";
  }
}

function activeFilterCount(): number {
  return (state.category ? 1 : 0) + state.tags.size;
}

function renderToolbar(): void {
  const cats = rootCategories();
  const subs = state.category ? subcategoriesOf(state.category) : [];
  const n = activeFilterCount();
  // El select "Ordenar" vive en una fila fija propia (NO scrolleable): si las
  // categorías llenan la fila de chips, antes quedaba fuera de pantalla.
  el.toolbar.innerHTML = `
    <div class="tb-top">
      <label class="tb-sort">Ordenar
        <select id="sort-sel">
          <option value="default" ${state.sort === "default" ? "selected" : ""}>Más recientes</option>
          <option value="price-asc" ${state.sort === "price-asc" ? "selected" : ""}>Menor precio</option>
          <option value="price-desc" ${state.sort === "price-desc" ? "selected" : ""}>Mayor precio</option>
          <option value="random" ${state.sort === "random" ? "selected" : ""}>Aleatorio</option>
        </select>
      </label>
      <span class="tb-count" id="tb-count" hidden></span>
    </div>
    <div class="tb-row">
      <button class="chip ${state.category === "" ? "on" : ""}" data-cat="">Todos</button>
      ${cats.map((c) => `
        <button class="chip ${state.category === c.id ? "on" : ""}" data-cat="${esc(c.id)}">${esc(c.name)}</button>
      `).join("")}
    </div>
    ${subs.length ? `
    <div class="tb-row tb-row--sub">
      ${subs.map((s) => `
        <button class="chip chip--sub ${state.category === s.id ? "on" : ""}" data-cat="${esc(s.id)}">↳ ${esc(s.name)}</button>
      `).join("")}
    </div>` : ""}
    <div class="tb-row">
      ${(["new", "featured", "offer"] as Tag[]).map((t) => `
        <button class="chip ${state.tags.has(t) ? "on" : ""}" data-tag="${t}">${tagLabel(t)}</button>
      `).join("")}
      ${n > 0 ? `<button class="chip chip--clear" id="clear-filters">✕ Limpiar (${n})</button>` : ""}
    </div>
  `;

  el.toolbar.querySelectorAll<HTMLButtonElement>("button[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.cat ?? "";
      resetPager();
      render();
    });
  });
  el.toolbar.querySelector("#sort-sel")?.addEventListener("change", (ev) => {
    const v = (ev.target as HTMLSelectElement).value as SortMode;
    if (v === "random" && state.sort !== "random") state.seed = Math.floor(Math.random() * 1e9);
    state.sort = v;
    resetPager();
    render();
  });
  el.toolbar.querySelectorAll<HTMLButtonElement>("button[data-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tag as Tag;
      if (state.tags.has(t)) state.tags.delete(t);
      else state.tags.add(t);
      resetPager();
      render();
    });
  });
  el.toolbar.querySelector("#clear-filters")?.addEventListener("click", clearFilters);
  updateToolbarMasks();
  setupToolbarMaskScroll();
}

// ---- Degradado "hay más chips" ----

// Marca cada fila con .has-more si queda contenido por scrollear a la derecha.
function updateToolbarMasks(): void {
  for (const row of el.toolbar.querySelectorAll<HTMLElement>(".tb-row")) {
    const hasMore = row.scrollWidth > row.clientWidth + 2 &&
      row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
    row.classList.toggle("has-more", hasMore);
  }
}

// Un solo listener de scroll (delegado) que refresca las máscaras.
let maskScrollWired = false;
function setupToolbarMaskScroll(): void {
  if (maskScrollWired) return;
  maskScrollWired = true;
  el.toolbar.addEventListener("scroll", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.classList?.contains("tb-row")) {
      const hasMore = t.scrollLeft + t.clientWidth < t.scrollWidth - 2;
      t.classList.toggle("has-more", hasMore);
    }
  }, true);
  // Resize también puede cambiar si hay overflow
  window.addEventListener("resize", updateToolbarMasks);
}

function clearFilters(): void {
  state.category = "";
  state.tags.clear();
  // Volver al orden por defecto: aleatorio, con seed nuevo.
  state.sort = "random";
  state.seed = Math.floor(Math.random() * 1e9);
  state.search = "";
  el.search.value = "";
  resetPager();
  render();
}

// ---- Listado ----

function collectCategoryIds(): Set<string> {
  const ids = new Set<string>();
  if (state.category === "") return ids;
  ids.add(state.category);
  for (const s of subcategoriesOf(state.category)) ids.add(s.id);
  return ids;
}

function applyFilters(products: Product[]): Product[] {
  const term = state.search.trim().toLowerCase();
  const catIds = collectCategoryIds();
  return products.filter((p) => {
    if (term !== "" && !`${p.title} ${p.description}`.toLowerCase().includes(term)) return false;
    if (catIds.size > 0 && (!p.categoryId || !catIds.has(p.categoryId))) return false;
    for (const t of state.tags) {
      if (!p.tags.includes(t)) return false;
    }
    return true;
  });
}

// Orden estable determinístico: mismo seed = mismo orden (si no, el orden
// cambia con cada re-render y las tarjetas "saltan" al hacer scroll).
function shuffled<T>(list: T[], seed: number): T[] {
  const arr = [...list];
  let s = seed || 1;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

function sortedProducts(): Product[] {
  const filtered = applyFilters(state.snapshot?.products ?? []);
  switch (state.sort) {
    case "price-asc": return [...filtered].sort((a, b) => a.priceCents - b.priceCents);
    case "price-desc": return [...filtered].sort((a, b) => b.priceCents - a.priceCents);
    case "random": return shuffled(filtered, state.seed);
    default: return filtered;
  }
}

/** Ventana del badge "Nuevo" automático (fresco, no confundir con el tag).
 * Configurable desde el panel vía settings.freshHours (horas; 0 = desactivado).
 * hours=undefined usa el default de 48h para el title del tooltip. */
export function isFresh(p: Product, hours?: number): boolean {
  const h = hours ?? 48;
  if (h <= 0) return false;
  return p.createdAt > 0 && Date.now() - p.createdAt < h * 60 * 60 * 1000;
}

function freshTitle(hours: number): string {
  if (hours === 24) return "Cargado en las últimas 24 horas";
  if (hours === 48) return "Cargado en las últimas 48 horas";
  if (hours === 168) return "Cargado en los últimos 7 días";
  return `Cargado hace menos de ${hours} horas`;
}

// URL de imagen con parámetros de resize del CDN de tiendanegocio (soporta
// ?width=&format=webp; verificado: 373KB PNG -> 32KB WebP a 640px).
// El original suele ser 1024px; las cards se muestran a ~220-308px así que
// 320/640px cubren 1x/2x. Si la URL no es de ese CDN, se devuelve vacío.
export function cdnSrcset(url: string | null): string {
  if (!url || !url.includes("tiendanegocio.com")) return "";
  const base = url.split("?")[0];
  return `${base}?width=320&format=webp 320w, ${base}?width=640&format=webp 640w, ${url} 1024w`;
}

function cardHtml(p: Product, eager = false): string {
  const symbol = state.settings?.currencySymbol ?? "$";
  const srcset = p.imageUrl ? cdnSrcset(p.imageUrl) : "";
  const loading = eager ? "eager" : "lazy";
  const prio = eager ? ` fetchpriority="high"` : "";
  // Fallback: si la variante del CDN falla (ráfaga de requests nuevas al recargar con
  // caché fría — el CDN del proveedor a veces rechaza algunas), reintentos en cascada:
  // webp640 -> original. Queda fijo en el src para no reintentar en bucle.
  const img = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}"${srcset ? ` srcset="${esc(srcset)}" sizes="(max-width: 800px) 46vw, 308px"` : ""} alt="${esc(p.title)}" loading="${loading}"${prio} decoding="async" data-fallback="${esc(p.imageUrl)}" />`
    : "📱";
  const freshHours = state.settings?.freshHours ?? 48;
  const badges = [
    isFresh(p, freshHours) ? `<span class="badge badge--fresh" title="${esc(freshTitle(freshHours))}">Nuevo</span>` : "",
    ...p.tags.map((t) => `<span class="badge badge--${t}">${tagLabel(t)}</span>`),
    p.availability === "out_of_stock" ? `<span class="badge badge--stock-out">Sin stock</span>` : "",
    p.availability === "preorder" ? `<span class="badge badge--stock-pre">Bajo pedido</span>` : "",
  ].join("");
  const wa = state.settings?.whatsappOk
    ? `<button class="card-wa" data-wa="${esc(p.id)}" title="Consultar por WhatsApp">Consultar</button>`
    : "";
  return `
    <div class="card-wrap">
      <a class="card" href="/producto/${esc(p.id)}">
        <div class="card-img">${img}</div>
        <div class="card-body">
          ${badges ? `<div class="badges">${badges}</div>` : ""}
          <h3 class="card-title">${esc(p.title)}</h3>
          <div class="card-foot">
            <span class="card-price">${formatPrice(p.priceCents, symbol)}</span>
            ${wa}
          </div>
        </div>
      </a>
    </div>`;
}

// Consultas por WhatsApp desde la tarjeta (sin abrir la ficha).
function productById(id: string): Product | undefined {
  return state.snapshot?.products.find((p) => p.id === id);
}

function waLinkForProduct(p: Product): string {
  const symbol = state.settings?.currencySymbol ?? "$";
  const price = formatPrice(p.priceCents, symbol);
  const text = `Hola! Me interesa "${p.title}" (${price}). ¿Sigue disponible?`;
  return `https://wa.me/${(state.settings?.whatsappPhone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

// Fallback de imágenes: si una variante del CDN falla, reintenta el original.
// Se ejecuta una sola vez por img (data-fallback se limpia) para no reintentar en bucle.
function bindImgFallbacks(): void {
  el.content.querySelectorAll<HTMLImageElement>("img[data-fallback]").forEach((img) => {
    img.addEventListener("error", () => {
      const fallback = img.dataset.fallback;
      if (!fallback || !img.src) return;
      delete img.dataset.fallback;
      img.srcset = ""; // anula los candidatos del srcset que fallaron
      img.src = fallback;
    }, { once: true });
  });
}

function bindWaButtons(): void {
  el.content.querySelectorAll<HTMLButtonElement>(".card-wa").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const p = productById(btn.dataset.wa ?? "");
      if (p && state.settings) {
        track("wa_click", { productId: p.id });
        window.open(waLinkForProduct(p), "_blank", "noopener");
      }
    });
  });
}

// ---- Paginación con botón "Cargar más" ----

function resetPager(): void {
  state.shown = PAGE_SIZE;
}

// Contador "X de Y" en la toolbar (visible cuando hay productos filtrados).
function updateCount(total: number, shown: number): void {
  const c = document.getElementById("tb-count");
  if (!c) return;
  c.textContent = `${shown} de ${total}`;
  c.hidden = total === 0;
}

function renderGrid(): void {
  const products = state.snapshot?.products ?? [];
  if (products.length === 0) {
    setContent(
      `<div class="state"><p>El catálogo todavía no tiene productos publicados.</p>
       <p class="muted">Entrá al <a class="topbar-link" href="/admin/">panel de administración</a> para cargar el catálogo.</p></div>`
    );
    return;
  }
  const sorted = sortedProducts();
  if (sorted.length === 0) {
    setContent(
      `<div class="state"><p>No hay productos que coincidan con los filtros.</p>
       <button class="btn btn-primary" id="clear">Limpiar filtros</button></div>`
    );
    document.getElementById("clear")?.addEventListener("click", clearFilters);
    return;
  }
  const visible = sorted.slice(0, state.shown);
  const more = sorted.length > visible.length;
  updateCount(sorted.length, visible.length);
  // Las primeras 4 imágenes son candidatos a LCP: eager + fetchpriority high
  // (lazy en las above-fold retrasa el LCP porque el preload scanner las ignora).
  const card = (p: Product, i: number): string => cardHtml(p, i < 4);
  setContent(`
    <div class="grid">${visible.map(card).join("")}</div>
    ${more ? `<div class="load-more-wrap"><button class="btn load-more" id="load-more">Cargar más <span class="lm-count">(${sorted.length - visible.length} restantes)</span></button></div>` : ""}
  `);
  document.getElementById("load-more")?.addEventListener("click", () => {
    state.shown += PAGE_SIZE;
    renderGrid();
  });
  bindWaButtons();
  bindImgFallbacks();
}

function render(): void {
  renderToolbar();
  renderGrid();
}

void init();
