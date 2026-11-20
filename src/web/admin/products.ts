// Pestaña Productos: lista paginada, filtros, acciones masivas de WhatsApp
// y formulario de alta/edición.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { esc } from "../../shared/html";
import { avisoCatalogoVacio, feedResultante } from "../../shared/wa-feed";
import { mountLiveSearch, LIVE_LIMIT } from "../search-live";
import { api, el, formatPriceAdmin, marcarSinPublicar, openModal, toast, updateTabBadge } from "./ui";
import { render } from "./router";
import { uiState } from "./ui-state";

// ---- Productos (paginados: el panel ya no carga todos de una) ----

interface ProductsPage {
  products: Product[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  counts: { published: number; hidden: number };
  srcCounts?: { tecnova: number; hacetupedido: number; manual: number };
  /**
   * Tamaño del feed del catálogo de WhatsApp: marcados, publicados y con foto (lo que
   * descarga Meta de verdad). Ver Ajustes → Catálogo de WhatsApp.
   */
  waCount?: number;
}

// Estado que sobrevive a los re-renders: editar o borrar no te manda a la página 1.
const prodState = { status: "published" as "published" | "hidden", page: 1, q: "", src: "" as "" | "tecnova" | "hacetupedido" | "manual" };
// Alcance elegido en los selectores de WhatsApp (categoría y origen): sobrevive al
// re-render de la lista (al marcar/quitar se recarga la vista y no tiene que volver a
// elegir el alcance).
const waElegido = { cat: "", src: "" };
// Los orígenes de la acción masiva: los mismos del filtro "Origen:" de la lista.
const ORIGENES_WA: { value: string; label: string }[] = [
  { value: "tecnova", label: "🛰️ Tecnova" },
  { value: "hacetupedido", label: "🛰️ Hacetupedido" },
  { value: "manual", label: "✍️ Manuales" },
];
// Ayuda de cada selector de WhatsApp (también es el texto cuando no hay nada elegido).
const AYUDA_ALCANCE: Record<"cat" | "src", string> = {
  cat: "Elegí una categoría para ver cuántos productos se marcarían.",
  src: "Elegí un origen (Tecnova, Hacetupedido o manuales) para ver cuántos productos se marcarían.",
};
// Pedido de abrir el formulario de auto-importación ya con la fuente elegida
// ("Programar actualización" en Importar salta a la pestaña Auto-importaciones).

/** Insignia de origen del producto (fuente de importación) para la lista del panel. */
function sourceBadge(sourceUrl: string | null | undefined): string {
  // El nombre va en .badge-src-name: en pantallas angostas el CSS lo oculta y
  // queda solo el ícono, para que la columna Origen no desalinee la fila.
  if (!sourceUrl) return '<span class="badge badge--src" title="Alta manual">✍️<span class="badge-src-name"> Manual</span></span>';
  const u = sourceUrl.toLowerCase();
  if (u.includes("tecnova")) return '<span class="badge badge--src badge--src-tecnova" title="Importado de tecnova.com.ar">🛰️<span class="badge-src-name"> Tecnova</span></span>';
  if (u.includes("hacetupedido")) return '<span class="badge badge--src badge--src-hetu" title="Importado de hacetupedido.com">🛰️<span class="badge-src-name"> Hacetupedido</span></span>';
  if (u.includes("tiendanegocio")) return '<span class="badge badge--src badge--src-tn" title="Importado de TiendaNegocio">🛰️<span class="badge-src-name"> TiendaNegocio</span></span>';
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    return `<span class="badge badge--src" title="Importado de ${esc(host)}">🛰️<span class="badge-src-name"> ${esc(host.slice(0, 20))}</span></span>`;
  } catch {
    return '<span class="badge badge--src" title="Importado">🛰️<span class="badge-src-name"> Importado</span></span>';
  }
}

export async function viewProducts(statusFilter?: "published" | "hidden"): Promise<void> {
  if (statusFilter) {
    if (prodState.status !== statusFilter) prodState.page = 1;
    prodState.status = statusFilter;
  }
  el.view.innerHTML = `<div class="panel"><h2>Productos</h2><p class="muted">Cargando…</p></div>`;
  const fetchPage = async (): Promise<ProductsPage> => {
    const params = new URLSearchParams({ page: String(prodState.page), limit: "50", status: prodState.status });
    if (prodState.q !== "") params.set("q", prodState.q);
    if (prodState.src !== "") params.set("src", prodState.src);
    return api<ProductsPage>(`/products?${params.toString()}`);
  };
  let data = await fetchPage();
  // Si la página quedó vacía (borré el último de la página 3, por ejemplo), retrocedo.
  let guard = 0;
  while (data.products.length === 0 && prodState.page > 1 && guard++ < 3) {
    prodState.page = Math.max(1, Math.min(prodState.page - 1, data.pages));
    data = await fetchPage();
  }
  const products = data.products;
  const { categories } = await api<{ categories: Category[] }>("/categories");
  updateTabBadge("products", data.counts.hidden, "productos sin stock");
  const visible = products;
  const catName = (id: string | null): string =>
    id ? (categories.find((c) => c.id === id)?.name ?? id) : "—";
  const catOptions = categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  // Los selectores de WhatsApp conservan el alcance elegido (ver waElegido).
  const opcionesSel = (valor: string, pares: { value: string; label: string }[]): string =>
    pares
      .map((o) => `<option value="${esc(o.value)}"${valor === o.value ? " selected" : ""}>${esc(o.label)}</option>`)
      .join("");
  const waCatOptions = opcionesSel(waElegido.cat, categories.map((c) => ({ value: c.id, label: c.name })));
  // Fila de acción masiva por alcance: el mismo bloque para la categoría y para el origen.
  const filaAlcance = (o: { key: "cat" | "src"; titulo: string; articulo: string; opciones: string; on: string; off: string }): string => `
      <div class="row" style="margin-top:8px; align-items:center">
        <span class="muted" style="font-size:12px">📱 WhatsApp por ${o.titulo}:</span>
        <select id="wa-${o.key}" aria-label="Seleccionar ${o.titulo} para el catálogo de WhatsApp" style="max-width:260px">
          <option value="">Elegí ${o.articulo} ${o.titulo}…</option>
          ${o.opciones}
        </select>
        <button class="btn" id="wa-${o.key}-on" disabled>${o.on}</button>
        <button class="btn" id="wa-${o.key}-off" disabled>${o.off}</button>
      </div>
      <p class="muted" id="wa-${o.key}-info" style="margin:6px 0 0; font-size:12px">${AYUDA_ALCANCE[o.key]}</p>`;
  const chip = (v: "published" | "hidden", label: string, n: number): string =>
    `<button class="chip ${prodState.status === v ? "on" : ""}" data-pf="${v}">${label} <span class="muted">${n}</span></button>`;
  const srcCounts = (data as { srcCounts?: { tecnova: number; hacetupedido: number; manual: number } }).srcCounts ?? { tecnova: 0, hacetupedido: 0, manual: 0 };
  const srcChip = (v: "" | "tecnova" | "hacetupedido" | "manual", label: string, n: number): string =>
    `<button class="chip ${prodState.src === v ? "on" : ""}" data-sf="${v}" title="Filtrar por origen">${label} <span class="muted">${n}</span></button>`;
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Productos</h2>
        <div class="row" style="margin-left:14px; gap:6px">
          ${chip("published", "Todos", data.counts.published)}
          ${chip("hidden", "Sin stock", data.counts.hidden)}
        </div>
        <div class="live-anchor prod-search-wrap">
          <input id="prod-search" type="search" placeholder="Buscar por título o código…" aria-label="Buscar productos por título o código" autocomplete="off"
            value="${esc(prodState.q)}"/>
        </div>
        <span class="muted" id="prod-search-count" ${prodState.q !== "" ? "" : "hidden"}>${prodState.q !== "" ? `${data.total} coincidencias` : ""}</span>
        <button class="btn btn-primary" id="new-product" style="margin-left:auto">+ Nuevo producto</button>
      </div>
      <div class="row" style="margin-top:8px; gap:6px">
        <span class="muted" style="font-size:12px">Origen:</span>
        ${srcChip("", "Todos", data.counts.published + data.counts.hidden)}
        ${srcChip("tecnova", "🛰️ Tecnova", srcCounts.tecnova)}
        ${srcChip("hacetupedido", "🛰️ Hacetupedido", srcCounts.hacetupedido)}
        ${srcChip("manual", "✍️ Manuales", srcCounts.manual)}
      </div>
      <p class="muted" style="margin:8px 0 0; font-size:12px">📱 Catálogo de WhatsApp: <strong>${data.waCount ?? 0}</strong> producto${(data.waCount ?? 0) === 1 ? "" : "s"} en el feed (marcados, publicados y con foto) — seleccioná filas y usá «Publicar en WhatsApp», o marcá una categoría o un origen enteros en las filas de abajo. La URL del feed se configura en Ajustes.</p>
      ${prodState.status === "hidden" ? `<p class="muted" style="margin:8px 0 0">No aparecen en el catálogo público porque la fuente ya no los trae (sin stock) o los ocultaste a mano. Si la fuente vuelve a traerlos, se re-publican solos.</p>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-primary" id="unhide-all" ${data.counts.hidden === 0 ? "disabled" : ""}>▶ Re-publicar todos</button>
      </div>` : `
      <div class="row" style="margin-top:10px; align-items:center">
        <select id="bulk-cat" aria-label="Categoría a vaciar" style="max-width:260px">
          <option value="">Borrar una categoría entera…</option>
          ${catOptions}
        </select>
        <button class="btn btn-danger" id="bulk-cat-del">Vaciar categoría</button>
        <button class="btn btn-danger" id="bulk-del" hidden>🗑️ Borrar seleccionados</button>
        <button class="btn" id="bulk-wa-on" hidden>📱 Publicar en WhatsApp</button>
        <button class="btn" id="bulk-wa-off" hidden>📱 Quitar de WhatsApp</button>
        <span class="muted" id="bulk-count" hidden></span>
      </div>
      ${filaAlcance({ key: "cat", titulo: "categoría", articulo: "una", opciones: waCatOptions, on: "📱 Marcar la categoría", off: "Quitar la categoría" })}
      ${filaAlcance({ key: "src", titulo: "origen", articulo: "un", opciones: opcionesSel(waElegido.src, ORIGENES_WA), on: "📱 Marcar el origen", off: "Quitar el origen" })}`}
      ${visible.length === 0 ? `<p class="muted" style="margin-top:14px">${prodState.q !== "" ? "Ningún producto coincide con la búsqueda." : prodState.status === "hidden" ? "No hay productos sin stock. 🎉" : "No hay productos todavía."}</p>` : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th><input type="checkbox" id="sel-all" title="Marcar todos (esta página)"/></th><th>Título</th><th>Origen</th><th>Precio</th><th>Categoría</th><th>Estado</th><th>Tags</th><th></th></tr></thead>
        <tbody>
          ${visible.map((p) => `
            <tr data-id="${esc(p.id)}">
              <td><input type="checkbox" class="prod-sel" data-id="${esc(p.id)}"/></td>
              <td>${p.imageUrl ? `<img class="thumb" src="${esc(p.imageUrl)}" alt=""/>` : '<div class="thumb"></div>'}${esc(p.title)}<br/><span class="muted">${esc(p.id)}</span></td>
              <td>${sourceBadge(p.sourceUrl)}</td>
              <td>${formatPriceAdmin(p.priceCents)}</td>
              <td>${esc(catName(p.categoryId))}</td>
              <td class="${p.status === "published" ? "ok" : "muted"}">${p.status === "published" ? "Publicado" : "Sin stock"}${p.waPublish ? `<br/><span class="badge badge--wa" title="Se publica en el catálogo de WhatsApp">📱 WhatsApp</span>` : ""}</td>
              <td>${p.tags.map((t) => `<span class="badge badge--${t}">${t === "new" ? "Nuevo" : t === "featured" ? "Destacado" : "Oferta"}</span>`).join(" ") || "—"}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-edit" data-id="${esc(p.id)}">Editar</button>
                ${p.status === "hidden" ? `<button class="btn btn-primary btn-unhide" data-id="${esc(p.id)}">Re-publicar</button>` : ""}
                <button class="btn btn-danger btn-del" data-id="${esc(p.id)}">Borrar</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`}
      </div>
      ${visible.length > 0 ? `
      <div class="pager">
        <button class="btn" id="pg-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Anterior</button>
        <span class="muted">Página ${data.page} de ${data.pages} — ${data.total} producto${data.total !== 1 ? "s" : ""}${prodState.q !== "" ? ` buscando "${esc(prodState.q)}"` : ""}</span>
        <button class="btn" id="pg-next" ${data.page >= data.pages ? "disabled" : ""}>Siguiente ›</button>
      </div>` : ""}
    </div>`;
  el.view.querySelectorAll<HTMLButtonElement>("[data-pf]").forEach((b) => {
    b.addEventListener("click", () => void viewProducts((b.dataset.pf as "published" | "hidden") ?? "published"));
  });
  el.view.querySelectorAll<HTMLButtonElement>("[data-sf]").forEach((b) => {
    b.addEventListener("click", () => {
      prodState.src = (b.dataset.sf as typeof prodState.src) ?? "";
      prodState.page = 1;
      void viewProducts();
    });
  });
  // ---- Paginación: cambia de página sin recargar el resto del panel ----
  el.view.querySelector("#pg-prev")?.addEventListener("click", () => {
    if (prodState.page > 1) {
      prodState.page -= 1;
      void viewProducts();
    }
  });
  el.view.querySelector("#pg-next")?.addEventListener("click", () => {
    if (prodState.page < data.pages) {
      prodState.page += 1;
      void viewProducts();
    }
  });
  // ---- Buscador: resultados en línea mientras se escribe (mismo panel que el
  // catálogo) y la tabla se filtra al elegir «Ver los N resultados», con Enter o
  // al abrir una fila. Antes la tabla se recargaba en cada pausa, lo que además
  // destruía el panel a mitad de la búsqueda.
  const searchInput = el.view.querySelector("#prod-search") as HTMLInputElement | null;
  const aplicarBusqueda = (q: string): void => {
    const limpio = q.trim();
    if (limpio === prodState.q) return;
    prodState.q = limpio;
    prodState.page = 1;
    uiState.refocusSearch = true;
    void viewProducts();
  };
  const searchAnchor = searchInput?.closest<HTMLElement>(".live-anchor") ?? null;
  if (searchInput && searchAnchor) {
    mountLiveSearch({
      input: searchInput,
      host: searchAnchor,
      getProducts: () => products,
      getCategories: () => categories,
      getSymbol: () => "$",
      fetchResults: async (q, signal) => {
        const params = new URLSearchParams({ page: "1", limit: String(LIVE_LIMIT), status: prodState.status });
        if (q !== "") params.set("q", q);
        if (prodState.src !== "") params.set("src", prodState.src);
        const r = await api<ProductsPage>(`/products?${params.toString()}`, { signal });
        return { products: r.products, total: r.total };
      },
      onOpen: (p) => void openProductForm(p, categories),
      onSeeAll: (q) => aplicarBusqueda(q),
      onReset: () => aplicarBusqueda(""),
    });
  }
  // Enter sin fila elegida aplica la búsqueda a la tabla (el panel ya marcó el
  // evento cuando abrió un producto, y en ese caso no se filtra).
  searchInput?.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.defaultPrevented) return;
    ev.preventDefault();
    aplicarBusqueda(searchInput.value);
  });
  if (uiState.refocusSearch && searchInput) {
    uiState.refocusSearch = false;
    searchInput.focus();
    const len = searchInput.value.length;
    searchInput.setSelectionRange(len, len);
  }
  el.view.querySelectorAll(".btn-edit").forEach((b) => {
    b.addEventListener("click", () => {
      const p = products.find((x) => x.id === (b as HTMLElement).dataset.id);
      if (p) void openProductForm(p, categories);
    });
  });
  el.view.querySelectorAll(".btn-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.id;
      if (!id || !confirm("¿Borrar este producto?")) return;
      try {
        await api(`/products/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Producto borrado (se publica al sincronizar)");
        marcarSinPublicar();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void viewProducts(); // recarga la MISMA página (no te manda al inicio)
    });
  });

  // ---- Selección múltiple ----
  const selAll = el.view.querySelector("#sel-all") as HTMLInputElement | null;
  const bulkBtn = el.view.querySelector("#bulk-del") as HTMLButtonElement | null;
  const bulkCount = el.view.querySelector("#bulk-count") as HTMLElement | null;
  const waOnBtn = el.view.querySelector("#bulk-wa-on") as HTMLButtonElement | null;
  const waOffBtn = el.view.querySelector("#bulk-wa-off") as HTMLButtonElement | null;
  const selected = (): string[] =>
    [...el.view.querySelectorAll<HTMLInputElement>(".prod-sel:checked")].map((cb) => cb.dataset.id ?? "").filter(Boolean);
  const refreshBulk = (): void => {
    const n = selected().length;
    if (bulkBtn) bulkBtn.hidden = n === 0;
    if (waOnBtn) waOnBtn.hidden = n === 0;
    if (waOffBtn) waOffBtn.hidden = n === 0;
    if (bulkCount) {
      bulkCount.textContent = n > 0 ? `${n} seleccionado${n > 1 ? "s" : ""}` : "";
      bulkCount.hidden = n === 0;
    }
    if (selAll) selAll.checked = products.length > 0 && n === products.length;
  };
  // "Marcar todos" respeta el filtro del buscador: solo marca las filas visibles.
  selAll?.addEventListener("change", () => {
    el.view.querySelectorAll<HTMLTableRowElement>("table.table tbody tr[data-id]").forEach((tr) => {
      if (tr.style.display !== "none") {
        const cb = tr.querySelector<HTMLInputElement>(".prod-sel");
        if (cb) cb.checked = selAll.checked;
      }
    });
    refreshBulk();
  });
  el.view.querySelectorAll(".prod-sel").forEach((cb) => cb.addEventListener("change", refreshBulk));
  bulkBtn?.addEventListener("click", async () => {
    const ids = selected();
    if (ids.length === 0) return;
    if (!confirm(`¿Borrar ${ids.length} producto${ids.length > 1 ? "s" : ""}? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await api<{ deleted: number }>("/products/bulk", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      toast(`${r.deleted} producto${r.deleted !== 1 ? "s" : ""} borrado${r.deleted !== 1 ? "s" : ""} (se publica al sincronizar)`);
      marcarSinPublicar();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    void viewProducts();
  });

  // ---- Catálogo de WhatsApp: marcar/quitar los productos seleccionados ----
  // No cambia nada del sitio: Meta descarga el feed (ver Ajustes → Catálogo de
  // WhatsApp) y recién ahí se refleja en el catálogo de WhatsApp.
  const marcarWhatsApp = async (publish: boolean): Promise<void> => {
    const ids = selected();
    if (ids.length === 0) return;
    try {
      const r = await api<{ updated: number }>("/products/whatsapp", {
        method: "POST",
        body: JSON.stringify({ ids, publish }),
      });
      const n = r.updated;
      toast(
        publish
          ? `${n} producto${n !== 1 ? "s" : ""} marcado${n !== 1 ? "s" : ""} para WhatsApp (Meta los baja en la próxima descarga del feed)`
          : `${n} producto${n !== 1 ? "s" : ""} fuera del catálogo de WhatsApp`
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    // Se recarga la página actual: los badges 📱 y el contador salen del servidor.
    void viewProducts();
  };
  waOnBtn?.addEventListener("click", () => void marcarWhatsApp(true));
  waOffBtn?.addEventListener("click", () => void marcarWhatsApp(false));

  // ---- WhatsApp por alcance: vista previa + marcar/quitar una categoría o un origen ----
  // La vista previa la calcula el servidor al elegir el alcance (cuántos se marcarían,
  // cuántos entran al catálogo y cuántos están hoy en el feed), así no se confirma a
  // ciegas y el aviso de "catálogo casi vacío" sale de números reales.
  interface WaScopePreview {
    total: number;
    yaMarcados: number;
    aMarcar: number;
    conFoto: number;
    sinStock: number;
    sinFoto: number;
    enFeed: number;
  }
  interface FilaAlcance {
    /** Sufijo de los ids del DOM (`wa-cat` / `wa-src`) y clave del alcance elegido. */
    key: "cat" | "src";
    /** Nombre del parámetro con el que el alcance viaja al servidor. */
    param: "categoryId" | "src";
    /** Cómo se llama lo elegido, para los textos. */
    nombre: (valor: string) => string;
  }
  const plural = (n: number): string => (n === 1 ? "" : "s");
  const filasAlcance: FilaAlcance[] = [
    { key: "cat", param: "categoryId", nombre: (v) => catName(v) },
    { key: "src", param: "src", nombre: (v) => ORIGENES_WA.find((o) => o.value === v)?.label ?? v },
  ];
  const previewsAlcance: Record<string, WaScopePreview | null> = { cat: null, src: null };
  // Los números que importan: cuántos cambiarían de marca y cuántos entran al catálogo
  // (con stock y con foto). Se cuentan sobre el alcance ENTERO, así el texto sigue
  // diciendo la verdad después de aplicar la acción.
  const textoAlcance = (nombre: string, p: WaScopePreview): string =>
    `${nombre}: ${p.total} producto${plural(p.total)} (${p.yaMarcados} ya marcado${plural(p.yaMarcados)}). ` +
    (p.aMarcar === 0 ? "No queda ninguno por marcar. " : `Se marcarían ${p.aMarcar}. `) +
    `Entrarían al catálogo de WhatsApp ${p.conFoto} (con stock y foto); quedan afuera ${p.sinStock} sin stock y ${p.sinFoto} sin foto. ` +
    `Hoy están en el feed ${p.enFeed}.`;

  /**
   * Aviso cuando la acción dejaría el catálogo de WhatsApp vacío o casi. Se calcula con
   * los mismos números que el feed: `enFeed` son los productos del alcance que están hoy
   * en el archivo y el contador del panel es el tamaño del archivo, así que la cuenta es
   * exacta sin pedirle nada más al servidor. La aritmética vive en shared/wa-feed.ts
   * (función pura, con tests) porque es la parte que no puede estar mal.
   */
  const avisoDeAccion = (publish: boolean, p: WaScopePreview): string => {
    const hoy = data.waCount ?? 0;
    return avisoCatalogoVacio(feedResultante(publish, hoy, p.enFeed, p.conFoto), hoy);
  };

  const pedirPreview = async (fila: FilaAlcance): Promise<void> => {
    const sel = el.view.querySelector(`#wa-${fila.key}`) as HTMLSelectElement | null;
    const info = el.view.querySelector(`#wa-${fila.key}-info`) as HTMLElement | null;
    const on = el.view.querySelector(`#wa-${fila.key}-on`) as HTMLButtonElement | null;
    const off = el.view.querySelector(`#wa-${fila.key}-off`) as HTMLButtonElement | null;
    const valor = sel?.value ?? "";
    waElegido[fila.key] = valor;
    previewsAlcance[fila.key] = null;
    if (on) on.disabled = valor === "";
    if (off) off.disabled = valor === "";
    if (valor === "") {
      if (info) info.textContent = AYUDA_ALCANCE[fila.key];
      return;
    }
    if (info) info.textContent = "Contando…";
    try {
      const r = await api<{ preview: WaScopePreview }>(
        `/products/whatsapp/scope?${fila.param}=${encodeURIComponent(valor)}`
      );
      previewsAlcance[fila.key] = r.preview;
      if (info) info.textContent = textoAlcance(fila.nombre(valor), r.preview);
    } catch (e) {
      if (info) info.textContent = e instanceof Error ? e.message : "No se pudieron contar los productos";
    }
  };
  const aplicarAlcance = async (fila: FilaAlcance, publish: boolean): Promise<void> => {
    const sel = el.view.querySelector(`#wa-${fila.key}`) as HTMLSelectElement | null;
    const valor = sel?.value ?? "";
    if (valor === "") return;
    const nombre = fila.nombre(valor);
    const p = previewsAlcance[fila.key];
    const detalle = p ? `\n\n${textoAlcance(nombre, p)}` : "";
    const pregunta = publish
      ? `¿Marcar para el catálogo de WhatsApp TODOS los productos de «${nombre}»?${detalle}`
      : `¿Quitar del catálogo de WhatsApp TODOS los productos de «${nombre}»?${detalle}`;
    if (!confirm(pregunta)) return;
    // El aviso va en un segundo confirm: es el que evita desarmar el catálogo sin querer.
    const aviso = p ? avisoDeAccion(publish, p) : "";
    if (aviso !== "" && !confirm(`${aviso}\n\n¿Confirmás que querés seguir?`)) return;
    try {
      const r = await api<{ updated: number }>("/products/whatsapp/scope", {
        method: "POST",
        body: JSON.stringify({ [fila.param]: valor, publish }),
      });
      toast(
        publish
          ? `${r.updated} producto${plural(r.updated)} de «${nombre}» marcado${plural(r.updated)} para WhatsApp`
          : `${r.updated} producto${plural(r.updated)} de «${nombre}» fuera del catálogo de WhatsApp`
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    // La lista se recarga del servidor: los badges 📱 y el contador salen de ahí.
    void viewProducts();
  };
  for (const fila of filasAlcance) {
    el.view.querySelector(`#wa-${fila.key}`)?.addEventListener("change", () => void pedirPreview(fila));
    el.view.querySelector(`#wa-${fila.key}-on`)?.addEventListener("click", () => void aplicarAlcance(fila, true));
    el.view.querySelector(`#wa-${fila.key}-off`)?.addEventListener("click", () => void aplicarAlcance(fila, false));
    // Si ya había un alcance elegido, la vista previa se recalcula sola tras el render.
    if (waElegido[fila.key] !== "") void pedirPreview(fila);
  }

  // ---- Vaciar categoría entera (borra en el servidor, de todas las páginas) ----
  el.view.querySelector("#bulk-cat-del")?.addEventListener("click", async () => {
    const sel = el.view.querySelector("#bulk-cat") as HTMLSelectElement | null;
    const catId = sel?.value ?? "";
    if (catId === "") {
      toast("Elegí una categoría primero", false);
      return;
    }
    const cat = categories.find((c) => c.id === catId);
    // Con paginación el conteo exacto lo da el servidor después del borrado.
    if (!confirm(`¿Borrar TODOS los productos de "${cat?.name ?? catId}" (de todas las páginas)? La categoría NO se borra. Esta acción no se puede deshacer.`)) return;
    try {
      const r = await api<{ deleted: number }>("/products/bulk", {
        method: "POST",
        body: JSON.stringify({ categoryId: catId }),
      });
      toast(`${r.deleted} producto${r.deleted !== 1 ? "s" : ""} borrado${r.deleted !== 1 ? "s" : ""} de "${cat?.name ?? catId}" (se publica al sincronizar)`);
      marcarSinPublicar();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    void viewProducts();
  });

  // ---- Re-publicar (vista "Sin stock", ex vista oculta) ----
  const republish = async (ids: string[]): Promise<void> => {
    try {
      for (const id of ids) {
        await api("/products/unhide", { method: "POST", body: JSON.stringify({ id }) });
      }
      toast(`Re-publicado(s): ${ids.length} (se publica al sincronizar)`);
      marcarSinPublicar();
      await viewProducts();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al re-publicar", false);
    }
  };
  el.view.querySelector("#unhide-all")?.addEventListener("click", async () => {
    // El servidor re-publica TODOS los sin stock (de todas las páginas) de una.
    if (!confirm(`¿Re-publicar TODOS los productos sin stock (${data.counts.hidden}, de todas las páginas)?`)) return;
    try {
      await api("/products/unhide", { method: "POST", body: JSON.stringify({ all: true }) });
      toast("Re-publicados todos los productos sin stock (se publica al sincronizar)");
      marcarSinPublicar();
      await viewProducts();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al re-publicar", false);
    }
  });
  el.view.querySelectorAll(".btn-unhide").forEach((b) => {
    b.addEventListener("click", () => void republish([(b as HTMLElement).dataset.id ?? ""]));
  });
}

async function openProductForm(p: Product | null, categories: Category[]): Promise<void> {
  const roots = categories.filter((c) => c.parentId === null);
  const subsOf = (id: string): Category[] => categories.filter((c) => c.parentId === id);
  const back = openModal(`
    <h2>${p ? "Editar producto" : "Nuevo producto"}</h2>
    <form id="p-form">
      <div class="field"><label>Título</label><input name="title" required value="${esc(p?.title ?? "")}"/></div>
      <div class="field"><label>Precio ($) — número entero, sin decimales</label><input name="price" type="number" step="1" min="0" required value="${p ? p.priceCents / 100 : ""}"/></div>
      <div class="field"><label>Descripción</label><textarea name="description">${esc(p?.description ?? "")}</textarea></div>
      <div class="field"><label>Imagen (URL)</label><input name="imageUrl" value="${esc(p?.imageUrl ?? "")}"/></div>
      <div class="field"><label>Categoría</label>
        <select name="categoryId"><option value="">—</option>
          ${roots.map((c) => `<option value="${esc(c.id)}" ${p?.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></div>
      <div class="field"><label>Subcategoría</label>
        <select name="subcategoryId"><option value="">—</option></select></div>
      <div class="field"><label>Estado</label>
        <select name="status">
          <option value="published" ${p?.status !== "hidden" ? "selected" : ""}>Publicado</option>
          <option value="hidden" ${p?.status === "hidden" ? "selected" : ""}>Sin stock</option>
        </select></div>
      <div class="field"><label>Disponibilidad</label>
        <select name="availability">
          <option value="in_stock" ${p?.availability !== "out_of_stock" && p?.availability !== "preorder" ? "selected" : ""}>En stock</option>
          <option value="out_of_stock" ${p?.availability === "out_of_stock" ? "selected" : ""}>Sin stock</option>
          <option value="preorder" ${p?.availability === "preorder" ? "selected" : ""}>Bajo pedido</option>
        </select></div>
      <div class="field"><label>Etiquetas</label>
        <div class="checks">
          <label><input type="checkbox" name="tag" value="new" ${p?.tags.includes("new") ? "checked" : ""}/> Nuevo</label>
          <label><input type="checkbox" name="tag" value="featured" ${p?.tags.includes("featured") ? "checked" : ""}/> Destacado</label>
          <label><input type="checkbox" name="tag" value="offer" ${p?.tags.includes("offer") ? "checked" : ""}/> Oferta</label>
        </div></div>
      <div class="field"><label>Orden</label><input name="sortOrder" type="number" value="${p?.sortOrder ?? 0}"/></div>
      <p class="error" id="p-error" hidden></p>
      <div class="row">
        <button type="submit" class="btn btn-primary">Guardar</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);

  const form = back.querySelector("#p-form") as HTMLFormElement;
  const catSel = form.querySelector('select[name="categoryId"]') as HTMLSelectElement;
  const subSel = form.querySelector('select[name="subcategoryId"]') as HTMLSelectElement;
  const fillSubs = (): void => {
    const subs = subsOf(catSel.value);
    const current = p?.subcategoryId ?? "";
    subSel.innerHTML = '<option value="">—</option>' +
      subs.map((s) => `<option value="${esc(s.id)}" ${current === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  };
  fillSubs();
  catSel.addEventListener("change", () => {
    p = p;
    subSel.innerHTML = '<option value="">—</option>' +
      subsOf(catSel.value).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  });
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = {
      title: String(fd.get("title") ?? ""),
      priceCents: Math.round(Number(fd.get("price") ?? 0) * 100),
      description: String(fd.get("description") ?? ""),
      imageUrl: String(fd.get("imageUrl") ?? ""),
      categoryId: String(fd.get("categoryId") ?? "") || null,
      subcategoryId: String(fd.get("subcategoryId") ?? "") || null,
      status: String(fd.get("status") ?? "published"),
      availability: String(fd.get("availability") ?? "in_stock"),
      tags: fd.getAll("tag"),
      sortOrder: Number(fd.get("sortOrder") ?? 0),
    };
    try {
      if (p && "priceCents" in p && el.view.querySelector(`tr[data-id="${p.id}"]`)) {
        await api(`/products/${encodeURIComponent(p.id)}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/products", { method: "POST", body: JSON.stringify(body) });
      }
      back.remove();
      toast("Producto guardado (se publica al sincronizar)");
      marcarSinPublicar();
      if (p && "priceCents" in p) {
        void viewProducts(); // edición: vuelve a la MISMA página
      } else {
        prodState.page = 1;
        prodState.status = "published";
        prodState.q = "";
        void viewProducts(); // nuevo: arranca limpio en la página 1
      }
    } catch (e) {
      const errEl = back.querySelector("#p-error") as HTMLElement;
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}

