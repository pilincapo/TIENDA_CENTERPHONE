// SPA del catálogo público.

import type { CatalogSnapshot, Category, Product, Tag } from "../shared/types";
import { formatPrice, tagLabel } from "../shared/format";
import { waLinkText } from "../shared/whatsapp";

interface PublicSettings {
  whatsappPhone: string;
  currencySymbol: string;
  whatsappOk: boolean;
}

const state = {
  snapshot: null as CatalogSnapshot | null,
  settings: null as PublicSettings | null,
  search: "",
  category: "",
  tags: new Set<Tag>(),
  priceMin: "",
  priceMax: "",
};

const el = {
  search: document.getElementById("search") as HTMLInputElement,
  filters: document.getElementById("filters") as HTMLElement,
  content: document.getElementById("content") as HTMLElement,
  waFloat: document.getElementById("wa-float") as HTMLAnchorElement,
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
      render();
    });
    render();
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

// ---- Filtros ----

function rootCategories(): Category[] {
  const cats = state.snapshot?.categories ?? [];
  return cats.filter((c) => c.parentId === null);
}

function subcategoriesOf(parentId: string): Category[] {
  return (state.snapshot?.categories ?? []).filter((c) => c.parentId === parentId);
}

function renderFilters(): void {
  const cats = rootCategories();
  const subs = state.category ? subcategoriesOf(state.category) : [];
  el.filters.innerHTML = `
    <div>
      <h3>Categorías</h3>
      <label><input type="radio" name="cat" value="" ${state.category === "" ? "checked" : ""}/> Todas</label>
      ${cats.map((c) => `
        <label><input type="radio" name="cat" value="${esc(c.id)}" ${state.category === c.id ? "checked" : ""}/> ${esc(c.name)}</label>
        ${state.category === c.id ? subs.map((s) => `
          <label class="sub"><input type="radio" name="cat" value="${esc(s.id)}"/> ↳ ${esc(s.name)}</label>`).join("") : ""}
      `).join("")}
    </div>
    <div>
      <h3>Precio</h3>
      <div class="price-row">
        <input id="price-min" type="number" min="0" placeholder="Mín" value="${esc(state.priceMin)}" />
        <span>–</span>
        <input id="price-max" type="number" min="0" placeholder="Máx" value="${esc(state.priceMax)}" />
      </div>
    </div>
    <div>
      <h3>Etiquetas</h3>
      ${(["new", "featured", "offer"] as Tag[]).map((t) => `
        <label><input type="checkbox" data-tag="${t}" ${state.tags.has(t) ? "checked" : ""}/> ${tagLabel(t)}</label>
      `).join("")}
    </div>
    <button class="btn" id="clear-filters">Limpiar filtros</button>
  `;

  el.filters.querySelectorAll('input[name="cat"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.category = (input as HTMLInputElement).value;
      render();
    });
  });
  el.filters.querySelectorAll("input[data-tag]").forEach((input) => {
    input.addEventListener("change", () => {
      const t = (input as HTMLInputElement).dataset.tag as Tag;
      if ((input as HTMLInputElement).checked) state.tags.add(t);
      else state.tags.delete(t);
      render();
    });
  });
  const min = el.filters.querySelector("#price-min") as HTMLInputElement | null;
  const max = el.filters.querySelector("#price-max") as HTMLInputElement | null;
  min?.addEventListener("change", () => { state.priceMin = min.value; render(); });
  max?.addEventListener("change", () => { state.priceMax = max.value; render(); });
  el.filters.querySelector("#clear-filters")?.addEventListener("click", clearFilters);
}

function clearFilters(): void {
  state.category = "";
  state.tags.clear();
  state.priceMin = "";
  state.priceMax = "";
  state.search = "";
  el.search.value = "";
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
  const min = state.priceMin === "" ? null : Number(state.priceMin) * 100;
  const max = state.priceMax === "" ? null : Number(state.priceMax) * 100;
  return products.filter((p) => {
    if (term !== "" && !`${p.title} ${p.description}`.toLowerCase().includes(term)) return false;
    if (catIds.size > 0 && (!p.categoryId || !catIds.has(p.categoryId))) return false;
    if (min !== null && p.priceCents < min) return false;
    if (max !== null && p.priceCents > max) return false;
    for (const t of state.tags) {
      if (!p.tags.includes(t)) return false;
    }
    return true;
  });
}

function cardHtml(p: Product): string {
  const symbol = state.settings?.currencySymbol ?? "$";
  const img = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.title)}" loading="lazy" />`
    : "📱";
  const badges = [
    ...p.tags.map((t) => `<span class="badge badge--${t}">${tagLabel(t)}</span>`),
    p.availability === "out_of_stock" ? `<span class="badge badge--stock-out">Sin stock</span>` : "",
    p.availability === "preorder" ? `<span class="badge badge--stock-pre">Bajo pedido</span>` : "",
  ].join("");
  return `
    <a class="card" href="/producto/${esc(p.id)}">
      <div class="card-img">${img}</div>
      <div class="card-body">
        ${badges ? `<div class="badges">${badges}</div>` : ""}
        <h3 class="card-title">${esc(p.title)}</h3>
        <div class="card-foot">
          <span class="card-price">${formatPrice(p.priceCents, symbol)}</span>
        </div>
      </div>
    </a>`;
}

function render(): void {
  renderFilters();
  const products = state.snapshot?.products ?? [];
  const filtered = applyFilters(products);
  if (products.length === 0) {
    setContent(
      `<div class="state"><p>El catálogo todavía no tiene productos publicados.</p>
       <p class="muted">Entrá al <a class="topbar-link" href="/admin/">panel de administración</a> para cargar el catálogo.</p></div>`
    );
    return;
  }
  if (filtered.length === 0) {
    setContent(
      `<div class="state"><p>No hay productos que coincidan con los filtros.</p>
       <button class="btn btn-primary" id="clear">Limpiar filtros</button></div>`
    );
    document.getElementById("clear")?.addEventListener("click", clearFilters);
    return;
  }
  setContent(`<div class="grid">${filtered.map(cardHtml).join("")}</div>`);
}

void init();
