// Pestaña Importar: preview y ejecución de la importación por URL y de Tecnova.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { esc } from "../../shared/html";
import type { PriceRule } from "../../shared/pricing";
import { findOverlaps, groupNames } from "../../shared/pricing";
import { api, el, formatPriceAdmin, mostrarBannerPendiente, refrescarEstadoCatalogo, showProgress, toast } from "./ui";
import { render } from "./router";
import { bindRepeatBox, currentRuleId, renderRepeatBox } from "./import-repeat";
import { fetchRules } from "./rules";
import { uiState } from "./ui-state";

// ---- Importación ----

export async function viewImport(): Promise<void> {
  el.view.innerHTML = `
    <div class="panel">
      <h2>Importar productos</h2>
      <p class="muted">Pegá el link de tu catálogo o de un producto: se descarga y se extraen los productos
      automáticamente. De la lista, elegís qué importar.</p>
      <div class="field"><label>URL de la tienda o catálogo</label><input id="imp-url" placeholder="https://latienda.com/productos o /products/samsung-s24"/></div>
      <div class="field"><label>Regla de precio a aplicar</label><select id="imp-rule"></select></div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" id="imp-preview">Analizar</button>
        <button class="btn" id="imp-tecnova" style="margin-left:8px">📥 Importar de Tecnova (catálogo completo)</button>
        <button class="btn" id="imp-tecnova-auto" style="margin-left:8px" title="Programa la actualización diaria del catálogo de Tecnova en la pestaña Auto-importaciones">⏰ Programar actualización</button>
      </div>
      <div id="imp-tecnova-result"></div>
      <div id="imp-result"></div>
    </div>`;
  const urlInput = el.view.querySelector("#imp-url") as HTMLInputElement;
  // Selector de regla de precio (opcional: fuerza una regla concreta).
  const rules = await fetchRules().catch(() => [] as PriceRule[]);
  const ruleSel = el.view.querySelector("#imp-rule") as HTMLSelectElement | null;
  if (ruleSel) {
    const groups = groupNames(rules);
    ruleSel.innerHTML = '<option value="">Automático (rangos de reglas activas)</option>' +
      groups.map((g) => `<option value="group:${esc(g)}">🗂️ Grupo: ${esc(g)} (escala completa)</option>`).join("") +
      rules.map((r) => `<option value="${esc(r.id)}">${esc(r.name)} (${r.percent >= 0 ? "+" : ""}${r.percent}%)</option>`).join("");
  }
  // Auto-análisis al pegar un link (no al tipear).
  urlInput.addEventListener("paste", () => {
    setTimeout(() => {
      if (urlInput.value.trim().startsWith("http")) void doImportPreview();
    }, 150);
  });
  el.view.querySelector("#imp-preview")?.addEventListener("click", () => void doImportPreview());
  el.view.querySelector("#imp-tecnova")?.addEventListener("click", () => void doTecnovaPreview());
  // Atajo exclusivo de Tecnova: va a Auto-importaciones con la fuente ya elegida.
  el.view.querySelector("#imp-tecnova-auto")?.addEventListener("click", () => {
    uiState.pendingAutoFuente = "tecnova";
    location.hash = "#auto";
  });
}

export interface PreviewResponse {
  source: string;
  found: number;
  products: Product[];
  applications?: { productId: string; baseCents: number; finalCents: number; ruleName: string | null; percent: number }[];
  errors: string[];
}
async function doImportPreview(): Promise<void> {
  const url = (el.view.querySelector("#imp-url") as HTMLInputElement)?.value ?? "";
  const out = el.view.querySelector("#imp-result") as HTMLElement;
  const prog = showProgress(out, "Analizando la fuente…");
  prog.set(8, "Descargando la página…", 0);
  const phase = setTimeout(() => prog.set(45, "Buscando productos en la página…", 1), 1200);
  try {
    const r = await api<PreviewResponse>("/import/preview", {
      method: "POST",
      body: JSON.stringify({ url, priceRuleId: currentRuleId() }),
    });
    clearTimeout(phase);
    prog.set(100, r.products.length > 0 ? `${r.products.length} productos encontrados` : "Sin productos", 3);
    await new Promise((res) => setTimeout(res, 450)); // deja ver el 100%
    prog.done();
    renderImportPreview(out, r, url);
  } catch (e) {
    clearTimeout(phase);
    prog.done();
    out.innerHTML = `<div class="panel"><p class="err">${esc(e instanceof Error ? e.message : "Error")}</p></div>`;
  }
}

function renderImportPreview(out: HTMLElement, r: PreviewResponse, sourceUrl = ""): void {
  const sourceLabel =
    r.source === "ldjson" ? "JSON-LD de la página"
    : r.source === "shopify" ? "catálogo Shopify"
    : r.source === "json" ? "JSON"
    : "selección";
  const apps = new Map((r.applications ?? []).map((a) => [a.productId, a]));
  const rows = r.products
    .map((p, i) => {
      const a = apps.get(p.id);
      const ruleInfo = a && a.ruleName
        ? `<span class="muted">${esc(a.ruleName)} (${a.percent >= 0 ? "+" : ""}${a.percent}%)</span>`
        : '<span class="muted">sin regla</span>';
      const priceCell = a && a.finalCents !== a.baseCents
        ? `<strong>${formatPriceAdmin(a.finalCents)}</strong><br/><span class="muted" style="text-decoration:line-through">${formatPriceAdmin(a.baseCents)}</span>`
        : `<strong>${formatPriceAdmin(p.priceCents)}</strong>`;
      return `
      <tr>
        <td><input type="checkbox" class="imp-check" data-idx="${i}" checked /></td>
        <td>${p.imageUrl ? `<img class="thumb" src="${esc(p.imageUrl)}" alt=""/>` : '<div class="thumb"></div>'}</td>
        <td><strong>${esc(p.title)}</strong><br/><span class="muted">${esc(p.id)}</span></td>
        <td>${priceCell}</td>
        <td>${ruleInfo}</td>
        <td>${esc(p.categoryId ?? "—")}</td>
      </tr>`;
    })
    .join("");
  out.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Lista a importar</h2>
        <span class="muted" style="margin-left:auto">fuente: ${esc(sourceLabel)}</span>
      </div>
      <div class="kv" style="margin-top:10px">
        <span class="k">Encontrados</span><span>${r.found}</span>
        <span class="k">Importables</span><span class="ok">${r.products.length}</span>
        <span class="k">Con errores</span><span class="err">${r.errors.length}</span>
      </div>
      ${r.errors.length ? `<p class="err">${r.errors.map(esc).join("<br/>")}</p>` : ""}
      ${r.products.length === 0 ? '<p class="muted">No se detectaron productos importables en esa URL.</p>' + renderRepeatBox(r, sourceUrl) : `
      <div class="imp-actions">
        <button class="btn" id="imp-all">Marcar todos</button>
        <button class="btn" id="imp-none">Desmarcar todos</button>
        <span class="muted" id="imp-count"></span>
        <button class="btn btn-primary" id="imp-confirm-top" style="margin-left:auto">Importar seleccionados</button>
      </div>
      ${renderRepeatBox(r, sourceUrl)}
      <div class="table-scroll">
      <table class="table" style="margin-top:8px">
        <thead><tr><th></th><th></th><th>Título</th><th>Precio a importar</th><th>Regla aplicada</th><th>Categoría</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <div class="row" style="margin-top:12px">
        <span class="muted" id="imp-count-bottom"></span>
        <button class="btn btn-primary" id="imp-confirm" style="margin-left:auto">Importar seleccionados</button>
      </div>`}
    </div>`;
  if (r.products.length === 0) return;
  const checkedIdx = (): number[] =>
    [...out.querySelectorAll<HTMLInputElement>(".imp-check")]
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.dataset.idx));
  out.querySelector("#imp-all")?.addEventListener("click", () => {
    out.querySelectorAll<HTMLInputElement>(".imp-check").forEach((cb) => (cb.checked = true));
    updateCount();
  });
  out.querySelector("#imp-none")?.addEventListener("click", () => {
    out.querySelectorAll<HTMLInputElement>(".imp-check").forEach((cb) => (cb.checked = false));
    updateCount();
  });
  const updateCount = (): void => {
    const n = checkedIdx().length;
    const txt = n === 0 ? "Ninguno seleccionado" : `${n} seleccionado${n > 1 ? "s" : ""}`;
    for (const s of out.querySelectorAll<HTMLSpanElement>("#imp-count, #imp-count-bottom")) s.textContent = txt;
  };
  out.querySelectorAll<HTMLInputElement>(".imp-check").forEach((cb) => cb.addEventListener("change", updateCount));
  updateCount();
  // El botón de arriba y el de abajo comparten la misma acción.
  const doConfirm = async (): Promise<void> => {
    const idx = checkedIdx();
    if (idx.length === 0) {
      toast("No hay productos seleccionados", false);
      return;
    }
    // Manda los items normalizados con precios ya ajustados por la regla.
    // En CHUNKS de 50 con pausa entre requests: un request chico no se acerca al
    // límite de CPU del plan gratis, que era lo que cortaba las listas grandes (522).
    const selected = idx.map((i) => r.products[i]).filter(Boolean);
    const CHUNK = 50;
    const PAUSA_MS = 800;
    const chunks: unknown[][] = [];
    for (let i = 0; i < selected.length; i += CHUNK) chunks.push(selected.slice(i, i + CHUNK));
    const prog = showProgress(out, `Importando ${selected.length} producto${selected.length > 1 ? "s" : ""}…`);
    prog.set(5, `Preparando ${chunks.length} lote(s)…`, 0);
    const sleep = (ms: number): Promise<void> => new Promise((r2) => setTimeout(r2, ms));
    let imported = 0;
    let failed = 0;
    try {
      for (let ci = 0; ci < chunks.length; ci++) {
        if (ci > 0) {
          prog.set(5 + Math.round((ci / chunks.length) * 90), `Pausa antes del lote ${ci + 1}/${chunks.length}…`, 0);
          await sleep(PAUSA_MS);
        }
        prog.set(5 + Math.round(((ci + 0.5) / chunks.length) * 90), `Lote ${ci + 1}/${chunks.length} · ${imported} importados hasta ahora`, 1);
        const res = await api<{ imported: number; failed: number; ok: boolean }>("/import", {
          method: "POST",
          body: JSON.stringify({
            items: chunks[ci],
            url: sourceUrl || undefined,
            priceRuleId: currentRuleId(),
            chunkIndex: ci,
            chunkTotal: chunks.length,
          }),
        });
        imported += res.imported;
        failed += res.failed;
      }
      prog.set(100, `Listo: ${imported} importados en ${chunks.length} lote(s)`, 3);
      await new Promise((res2) => setTimeout(res2, 450));
      prog.done();
      toast(`Importados ${imported}, fallidos ${failed}`, failed === 0);
      // La importación publica el catálogo (el worker regenera al último lote).
      mostrarBannerPendiente(false);
      void refrescarEstadoCatalogo();
      void render();
    } catch (e) {
      prog.set(100, e instanceof Error ? e.message : "Error", 1, true);
      await new Promise((res2) => setTimeout(res2, 800));
      prog.done();
      toast(`${e instanceof Error ? e.message : "Error"} (importados hasta ahora: ${imported})`, false);
    }
  };
  out.querySelector("#imp-confirm-top")?.addEventListener("click", () => void doConfirm());
  out.querySelector("#imp-confirm")?.addEventListener("click", () => void doConfirm());
  bindRepeatBox(out);
}

// ---- Importador de Tecnova (panel) ----
// Descarga el catálogo completo de tecnova.com.ar vía su API pública y lo muestra
// con el mapping de categorías editable. Al confirmar, importa por chunks con la
// regla de precio elegida (misma mecánica que el importador por URL).

interface TecnovaPreview {
  total: number;
  importables: number;
  skipped: string[];
  sample: { id: string; title: string; price_cents: number; categoryId: string; subcategoryId?: string; image_url?: string }[];
  mappingSuggestions: Record<string, string>;
  ownRoots: { id: string; name: string }[];
  ownSubs: Record<string, { id: string; name: string }[]>;
  rules: PriceRule[];
}

let tecnovaPreviewData: TecnovaPreview | null = null;

async function doTecnovaPreview(): Promise<void> {
  const out = el.view.querySelector("#imp-tecnova-result") as HTMLElement;
  const prog = showProgress(out, "Consultando el catálogo de Tecnova…");
  prog.set(10, "Descargando productos de la API…", 0);
  try {
    const r = await api<TecnovaPreview>("/import/tecnova/preview", {
      method: "POST",
      body: JSON.stringify({}),
    });
    tecnovaPreviewData = r;
    prog.set(100, `${r.importables} de ${r.total} productos importables`, 2);
    await new Promise((res) => setTimeout(res, 400));
    prog.done();
    renderTecnovaPreview(out, r);
  } catch (e) {
    prog.done();
    out.innerHTML = `<div class="panel"><p class="err">${esc(e instanceof Error ? e.message : "Error")}</p></div>`;
  }
}

function tecnovaCatOptions(preview: TecnovaPreview, selected: string): string {
  const opts = ['<option value="">— Saltar categoría —</option>'];
  for (const root of preview.ownRoots) {
    opts.push(`<option value="${esc(root.id)}"${root.id === selected ? " selected" : ""}>${esc(root.name)}</option>`);
    for (const sub of preview.ownSubs[root.id] ?? []) {
      opts.push(`<option value="${esc(sub.id)}"${sub.id === selected ? " selected" : ""}>&nbsp;&nbsp;↳ ${esc(sub.name)}</option>`);
    }
  }
  return opts.join("");
}

function renderTecnovaPreview(out: HTMLElement, r: TecnovaPreview): void {
  const rows = Object.entries(r.mappingSuggestions).map(([cat, target]) => {
    const count = r.sample.filter((p) => (p.categoryId ?? "") === target).length;
    return `
      <tr>
        <td><strong>${esc(cat)}</strong></td>
        <td>
          <select class="tj-map" data-cat="${esc(cat)}" aria-label="Categoría de tu catálogo para «${esc(cat)}»">${tecnovaCatOptions(r, target)}</select>
        </td>
        <td><span class="muted">${count > 0 ? `${count} en la muestra` : ""}</span></td>
      </tr>`;
  }).join("");
  const sampleRows = r.sample.slice(0, 20).map((p) => `
    <tr>
      <td>${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt=""/>` : '<div class="thumb"></div>'}</td>
      <td><strong>${esc(p.title)}</strong></td>
      <td>${formatPriceAdmin(p.price_cents)}</td>
      <td>${esc(p.categoryId)}${p.subcategoryId ? ` › ${esc(p.subcategoryId)}` : ""}</td>
    </tr>`).join("");
  out.innerHTML = `
    <div class="panel">
      <div class="row"><h2 style="margin:0">Tecnova — catálogo completo</h2>
        <span class="muted" style="margin-left:auto">${r.importables} importables de ${r.total} productos</span></div>
      ${r.skipped.length ? `<p class="muted" style="margin-top:6px">${r.skipped.length} productos salteados (sin precio o categoría sin mapear):<br/>${r.skipped.slice(0, 5).map(esc).join("<br/>")}</p>` : ""}
      <h3 style="margin-top:14px">Mapeo de categorías</h3>
      <p class="muted">Elegí a qué categoría de tu catálogo va cada una. «Saltar categoría» no importa esos productos.</p>
      <div class="table-scroll">
      <table class="table" style="margin-top:8px">
        <thead><tr><th>Categoría en Tecnova</th><th>Categoría en tu catálogo</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <h3 style="margin-top:14px">Regla de precio</h3>
      <p class="muted">El precio base es el minorista de la fuente. Elegí una <strong>escala</strong> (grupo de rangos, ej: 40-30-20) según la fuente, o «Automático» para usar tus reglas activas por rango.</p>
      <select id="tj-rule" aria-label="Regla de precio a aplicar en la importación de Tecnova" style="margin-top:6px">
        <option value="">Automático (rangos de reglas activas)</option>
        ${groupNames(r.rules).map((g) => {
          const escalas = r.rules.filter((x) => (x.groupName ?? "") === g).sort((a, b) => a.minCents - b.minCents);
          const detalle = escalas.map((x) => `${x.percent >= 0 ? "+" : ""}${x.percent}%`).join(" · ");
          return `<option value="group:${esc(g)}">🗂️ ${esc(g)} (${escalas.length} rangos: ${detalle})</option>`;
        }).join("")}
        <optgroup label="Reglas sueltas (fuera de escala)">
          ${r.rules.filter((x) => !x.groupName).map((rule) => `<option value="${esc(rule.id)}">${esc(rule.name)} (${rule.percent >= 0 ? "+" : ""}${rule.percent}%)</option>`).join("") || '<option disabled>Sin reglas sueltas</option>'}
        </optgroup>
      </select>
      <h3 style="margin-top:14px">Muestra de productos</h3>
      <div class="table-scroll">
      <table class="table" style="margin-top:8px">
        <thead><tr><th></th><th>Título</th><th>Precio base</th><th>Categoría destino</th></tr></thead>
        <tbody>${sampleRows}</tbody>
      </table>
      </div>
      <div class="row" style="margin-top:12px">
        <span class="muted" id="tj-total"></span>
        <button class="btn btn-primary" id="tj-import" style="margin-left:auto">Importar todo con este mapeo</button>
      </div>
    </div>`;
  out.querySelector("#tj-import")?.addEventListener("click", () => void doTecnovaImport());
}

async function doTecnovaImport(): Promise<void> {
  const preview = tecnovaPreviewData;
  if (!preview) return;
  const out = el.view.querySelector("#imp-tecnova-result") as HTMLElement;
  // Arma el mapping desde los selects del preview (incluye los «saltar» como "").
  const targets: Record<string, string> = {};
  out.querySelectorAll<HTMLSelectElement>(".tj-map").forEach((sel) => {
    targets[sel.dataset.cat ?? ""] = sel.value;
  });
  const skippedCats = Object.entries(targets).filter(([, v]) => v === "").map(([k]) => k);
  if (skippedCats.length > 0) {
    const ok = confirm(`${skippedCats.length} categoría(s) quedan sin importar:\n${skippedCats.join("\n")}\n\n¿Continuar?`);
    if (!ok) return;
  }
  const priceRuleId = (out.querySelector("#tj-rule") as HTMLSelectElement | null)?.value ?? null;
  const chunkSize = 50;
  const chunkTotal = Math.max(1, Math.ceil(preview.importables / chunkSize));
  const prog = showProgress(out, `Importando ${preview.importables} productos en ${chunkTotal} lote(s)…`);
  const sleep = (ms: number): Promise<void> => new Promise((r2) => setTimeout(r2, ms));
  let imported = 0;
  let failed = 0;
  try {
    for (let ci = 0; ci < chunkTotal; ci++) {
      if (ci > 0) {
        prog.set(5 + Math.round((ci / chunkTotal) * 90), `Pausa antes del lote ${ci + 1}/${chunkTotal}…`, 0);
        await sleep(800);
      }
      prog.set(5 + Math.round(((ci + 0.5) / chunkTotal) * 90), `Lote ${ci + 1}/${chunkTotal} · ${imported} importados hasta ahora`, 1);
      const res = await api<{ imported: number; failed: number; ok: boolean }>("/import/tecnova/import", {
        method: "POST",
        body: JSON.stringify({ targets, subs: {}, priceRuleId, chunkIndex: ci, chunkTotal }),
      });
      imported += res.imported;
      failed += res.failed;
    }
    prog.set(100, `Listo: ${imported} importados en ${chunkTotal} lote(s)`, 2);
    await new Promise((res2) => setTimeout(res2, 500));
    prog.done();
    toast(`Importados ${imported} de Tecnova, fallidos ${failed}`, failed === 0);
    mostrarBannerPendiente(false);
    void refrescarEstadoCatalogo();
    void render();
  } catch (e) {
    prog.set(100, e instanceof Error ? e.message : "Error", 1, true);
    await new Promise((res3) => setTimeout(res3, 800));
    prog.done();
    toast(`${e instanceof Error ? e.message : "Error"} (importados hasta ahora: ${imported})`, false);
  }
}
