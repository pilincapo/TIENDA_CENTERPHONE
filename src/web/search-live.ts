// Resultados en línea del buscador (variante «lista compacta»): mientras se
// escribe, muestra debajo de la barra hasta LIVE_LIMIT artículos con foto,
// nombre y precio, sin obligar a salir de la página. Lo comparten el catálogo
// y la ficha de producto.

import type { Category, Product } from "../shared/types";
import { matchesSearch } from "../shared/search";
import { formatPrice } from "../shared/format";
import { esc } from "../shared/html";

export const LIVE_LIMIT = 5;

/** Minúsculas y sin tildes, para comparar y resaltar sin depender del acento. */
function plano(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * HTML del texto con las coincidencias de la consulta resaltadas.
 *
 * Compara sobre la versión sin tildes, pero recorta el texto original: quitar
 * las marcas diacríticas no cambia la cantidad de caracteres, así que los
 * índices sirven para los dos. Si por algún carácter raro las longitudes no
 * coinciden, devuelve el texto escapado sin resaltar (nunca HTML sin escapar).
 */
export function highlightHtml(text: string, query: string): string {
  const q = query.trim();
  if (q === "") return esc(text);

  const terms = plano(q).match(/[\p{L}\p{N}]+/gu) ?? [];
  const flat = plano(text);
  if (terms.length === 0 || flat.length !== text.length) return esc(text);

  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(term, from);
      if (at < 0) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (ranges.length === 0) return esc(text);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  let out = "";
  let pos = 0;
  for (const [start, end] of merged) {
    out += esc(text.slice(pos, start)) + "<mark>" + esc(text.slice(start, end)) + "</mark>";
    pos = end;
  }
  return out + esc(text.slice(pos));
}

/** 0 = el título arranca con lo buscado, 1 = empieza una palabra, 2 = resto. */
function relevancia(product: Product, query: string): number {
  const title = plano(product.title);
  const q = plano(query.trim());
  if (q === "") return 2;
  if (title.startsWith(q)) return 0;
  if (title.includes(" " + q)) return 1;
  return 2;
}

/** Nombre de la categoría del producto, o "" si no tiene o no está en la lista. */
function nombreCategoria(product: Product, nombres: Map<string, string>): string {
  return product.categoryId ? nombres.get(product.categoryId) ?? "" : "";
}

/**
 * Productos que coinciden con la consulta, ya ordenados por relevancia.
 * Busca en todo el catálogo (no solo en lo filtrado) y devuelve [] sin texto.
 */
export function liveResults(products: Product[], categories: Category[], query: string): Product[] {
  const q = query.trim();
  if (q === "") return [];
  const nombres = new Map(categories.map((c) => [c.id, c.name]));
  return products
    .filter((p) => matchesSearch(q, `${p.title} ${nombreCategoria(p, nombres)}`))
    .sort((a, b) => relevancia(a, query) - relevancia(b, query));
}

export interface LiveSearchOptions {
  input: HTMLInputElement;
  /** Contenedor posicionado (`position: relative`) donde se ancla el panel. */
  host: HTMLElement;
  getProducts: () => Product[];
  getCategories: () => Category[];
  getSymbol: () => string;
  /** Por defecto navega a la ficha; el catálogo puede interceptarlo. */
  onOpen?: (product: Product) => void;
  /** El pie «Ver los N resultados»; por defecto navega a /?q=… */
  onSeeAll?: (query: string) => void;
  /**
   * Trae los resultados del servidor en vez de filtrar `getProducts()`.
   * Lo usa el panel para buscar más allá de las filas ya cargadas; el
   * `AbortSignal` corta la petición anterior cuando se sigue tipeando.
   */
  fetchResults?: (query: string, signal: AbortSignal) => Promise<{ products: Product[]; total: number }>;
  /** Tras «Ver todo el catálogo»: el panel no puede reponer la tabla por sí solo. */
  onReset?: () => void;
  limit?: number;
}

function imagenHtml(url: string | null): string {
  if (!url) return "📱";
  return `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" />`;
}

function filaHtml(product: Product, categoria: string, query: string, symbol: string): string {
  const href = "/producto/" + encodeURIComponent(product.id);
  return `<a class="live-row" role="option" aria-selected="false" href="${esc(href)}" data-id="${esc(product.id)}">
    <span class="live-thumb">${imagenHtml(product.imageUrl)}</span>
    <span class="live-name">
      <span class="live-title">${highlightHtml(product.title, query)}</span>
      <span class="live-cat">${esc(categoria)}</span>
    </span>
    <span class="live-price">${esc(formatPrice(product.priceCents, symbol))}</span>
  </a>`;
}

/**
 * Monta el panel de resultados en línea sobre `input`. Idempotente por input:
 * el panel se crea una vez y se refresca en cada tecla.
 */
export function mountLiveSearch(opts: LiveSearchOptions): void {
  const { input, host } = opts;
  if (input.dataset.liveMounted === "1") return;
  input.dataset.liveMounted = "1";

  const limit = opts.limit ?? LIVE_LIMIT;
  let rows: Product[] = [];
  let sel = -1;
  // Modo remoto: cada respuesta se numera para descartar las que llegan tarde.
  let seq = 0;
  let ctrl: AbortController | null = null;
  let deb: number | undefined;

  const abortarRemoto = (): void => {
    seq += 1;
    ctrl?.abort();
    ctrl = null;
    window.clearTimeout(deb);
  };

  const panel = document.createElement("div");
  panel.className = "live-search";
  panel.id = `live-${Math.random().toString(36).slice(2, 9)}`;
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "Resultados de búsqueda");
  panel.hidden = true;
  host.appendChild(panel);

  input.setAttribute("aria-controls", panel.id);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  const close = (): void => {
    abortarRemoto();
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    sel = -1;
  };

  /** Pinta el panel con lo ya resuelto (búsqueda local o respuesta del servidor). */
  const pintar = (list: Product[], total: number, query: string): void => {
    rows = list.slice(0, limit);
    sel = -1;

    if (total === 0) {
      panel.innerHTML = `
        <div class="live-empty">Sin resultados para <b>«${esc(query.trim())}»</b>.</div>
        <div class="live-foot"><span></span><button class="live-all" type="button" data-all="reset">Ver todo el catálogo →</button></div>`;
    } else {
      const nombres = new Map(opts.getCategories().map((c) => [c.id, c.name]));
      const symbol = opts.getSymbol();
      panel.innerHTML = `
        <div class="live-head">
          <span>Buscando «${esc(query.trim())}»</span>
          <span><b>${total}</b> resultado${total === 1 ? "" : "s"}</span>
        </div>
        ${rows.map((p) => filaHtml(p, nombreCategoria(p, nombres), query, symbol)).join("")}
        <div class="live-foot">
          <span>${rows.length} de ${total}</span>
          <button class="live-all" type="button" data-all>Ver los ${total} resultados →</button>
        </div>`;
    }

    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const abrir = (): void => {
    const query = input.value;
    if (!opts.fetchResults) {
      const all = liveResults(opts.getProducts(), opts.getCategories(), query);
      pintar(all, all.length, query);
      return;
    }

    abortarRemoto();
    const mine = seq;
    ctrl = new AbortController();
    rows = [];
    sel = -1;
    panel.innerHTML = `<div class="live-empty">Buscando «${esc(query.trim())}»…</div>`;
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");

    opts.fetchResults(query.trim(), ctrl.signal)
      .then(({ products, total }) => {
        if (mine !== seq) return;
        pintar(products, total, query);
      })
      .catch((err: unknown) => {
        if (mine !== seq || (err instanceof DOMException && err.name === "AbortError")) return;
        rows = [];
        sel = -1;
        panel.innerHTML = `<div class="live-empty">No se pudo buscar. Probá de nuevo.</div>`;
      });
  };

  const abrirProducto = (product: Product): void => {
    close();
    if (opts.onOpen) opts.onOpen(product);
    else location.assign(`/producto/${encodeURIComponent(product.id)}`);
  };

  const verTodos = (): void => {
    const query = input.value.trim();
    close();
    if (opts.onSeeAll) opts.onSeeAll(query);
    else location.assign(`/?q=${encodeURIComponent(query)}`);
  };

  const marcar = (): void => {
    panel.querySelectorAll<HTMLElement>(".live-row").forEach((row, i) => {
      const on = i === sel;
      row.classList.toggle("is-sel", on);
      row.setAttribute("aria-selected", String(on));
      if (on) row.scrollIntoView({ block: "nearest" });
    });
  };

  input.addEventListener("input", () => {
    if (input.value.trim() === "") {
      close();
      return;
    }
    // Remoto: una petición por pausa, no una por tecla.
    if (!opts.fetchResults) {
      abrir();
      return;
    }
    window.clearTimeout(deb);
    deb = window.setTimeout(abrir, 180);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim() !== "" && panel.hidden) abrir();
  });
  input.addEventListener("blur", () => {
    // Delay corto: da tiempo a que el click entre en el panel.
    setTimeout(() => {
      if (!host.contains(document.activeElement)) close();
    }, 120);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!panel.hidden) {
        ev.preventDefault();
        close();
      }
      return;
    }
    if (panel.hidden) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (rows.length === 0) return;
      ev.preventDefault();
      sel = ev.key === "ArrowDown"
        ? (sel + 1) % rows.length
        : (sel <= 0 ? rows.length - 1 : sel - 1);
      marcar();
      return;
    }
    const elegido = rows[sel];
    if (ev.key === "Enter" && sel >= 0 && elegido) {
      ev.preventDefault();
      abrirProducto(elegido);
    }
  });

  // Evita que el click en una fila dispare el blur antes de navegar.
  panel.addEventListener("mousedown", (ev) => ev.preventDefault());
  panel.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const all = target.closest<HTMLElement>("[data-all]");
    if (all) {
      ev.preventDefault();
      // Sin resultados, el botón repone el catálogo completo en vez de repetir
      // la búsqueda fallida; dispara `input` para que la grilla se redibuje.
      if (all.dataset.all === "reset") {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        close();
        opts.onReset?.();
      } else {
        verTodos();
      }
      return;
    }
    const row = target.closest<HTMLAnchorElement>("a.live-row");
    if (!row) return;
    const product = rows.find((p) => p.id === row.dataset.id);
    if (!product) return;
    if (opts.onOpen) {
      ev.preventDefault();
      abrirProducto(product);
    } else {
      close();
    }
  });
}
