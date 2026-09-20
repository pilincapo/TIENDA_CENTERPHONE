// SPA del panel de administración.

import type { Category, Product, StoreSettings, SyncLogEntry } from "../shared/types";
import type { AutoImport } from "../shared/autoimport";
import type { PriceRule } from "../shared/pricing";
import { findOverlaps, groupNames } from "../shared/pricing";

const el = {
  login: document.getElementById("login") as HTMLElement,
  loginForm: document.getElementById("login-form") as HTMLFormElement,
  loginPassword: document.getElementById("login-password") as HTMLInputElement,
  loginError: document.getElementById("login-error") as HTMLElement,
  app: document.getElementById("app") as HTMLElement,
  tabs: document.getElementById("tabs") as HTMLElement,
  view: document.getElementById("view") as HTMLElement,
  logout: document.getElementById("logout") as HTMLButtonElement,
};

type Dict = Record<string, unknown>;

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (res.status === 401) throw new Error("unauthorized");
  const data = (await res.json().catch(() => ({}))) as Dict;
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `HTTP ${res.status}`));
  return data as T;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

function toast(msg: string, ok = true): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.style.borderColor = ok ? "#2e7d32" : "#b91c1c";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function setTabHighlight(name: string): void {
  el.tabs.querySelectorAll("a").forEach((a) => {
    a.classList.toggle("active", a.dataset.tab === name);
  });
}

function route(): string {
  return location.hash.replace("#", "") || "dashboard";
}

async function render(): Promise<void> {
  const tab = route();
  setTabHighlight(tab);
  el.view.innerHTML = `<div class="state"><div class="spinner"></div></div>`;
  try {
    if (tab === "products") await viewProducts();
    else if (tab === "categories") await viewCategories();
    else if (tab === "import") await viewImport();
    else if (tab === "rules") await viewRules();
    else if (tab === "auto") await viewAutoImports();
    else if (tab === "settings") await viewSettings();
    else await viewDashboard();
  } catch (e) {
    if (e instanceof Error && e.message === "unauthorized") return showLogin();
    el.view.innerHTML = `<div class="panel"><p class="error">${esc(e instanceof Error ? e.message : String(e))}</p></div>`;
  }
}

// Filtro activo del historial del dashboard (compartido entre renders dinámicos).
let dashSyncFilter = "";

function triggerLabel(t: string): string {
  return t === "cron" ? "⟳ Automática" : t === "manual" ? "✋ Manual" : "⤓ Importación";
}

/** Fila del historial (compartida entre render inicial y actualización dinámica). */
function syncLogRow(l: SyncLogEntry): string {
  return `
    <tr>
      <td>${esc(new Date(l.startedAt).toLocaleString("es-AR"))}</td>
      <td>${triggerLabel(l.trigger)}</td>
      <td class="muted">${l.detail ? esc(l.detail.replace(/^https?:\/\//, "").slice(0, 40)) : "—"}</td>
      <td class="${l.status === "ok" ? "ok" : "err"}">${esc(l.status)}</td>
      <td>${l.itemsImported ?? "—"}</td>
      <td class="muted">${l.error ? (l.status === "ok"
        ? `<span class="muted" title="Avisos de la corrida (los artículos inválidos se saltaron): ${esc(l.error)}">ⓘ ${esc(l.error.slice(0, 90))}${l.error.length > 90 ? "…" : ""}</span>`
        : `<span class="err-detail" title="${esc(l.error)}">⚠ ${esc(l.error.slice(0, 90))}${l.error.length > 90 ? "…" : ""}</span>`) : "—"}</td>
    </tr>`;
}

/** Actualiza estado + historial del dashboard in-place (sin re-render de la vista). */
async function refreshDashboardDynamic(): Promise<void> {
  const stateEl = document.getElementById("dash-state");
  const bodyEl = document.getElementById("dash-log-body");
  if (!stateEl || !bodyEl) return; // no estamos en el dashboard
  try {
    const { state, log } = await api<{ state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }; log: SyncLogEntry[] }>(
      `/sync/log?limit=50${dashSyncFilter ? `&trigger=${encodeURIComponent(dashSyncFilter)}` : ""}`
    );
    const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("es-AR") : "nunca";
    const lastRow = state.lastStatus
      ? `<span class="${state.lastStatus === "ok" ? "ok" : "err"}">${esc(state.lastStatus)}</span>`
      : '<span class="muted">—</span>';
    stateEl.innerHTML = `
      <span class="k">Última sincronización</span><span>${esc(last)}</span>
      <span class="k">Resultado</span><span>${lastRow}</span>
      <span class="k">Error</span><span>${esc(state.lastError ?? "—")}</span>`;
    bodyEl.innerHTML = log.length === 0
      ? '<tr><td colspan="6" class="muted">Todavía no hubo sincronizaciones.</td></tr>'
      : log.map(syncLogRow).join("");
  } catch {
    /* silencioso: el polling no debe molestar */
  }
}

/** Polling del historial mientras la pestaña dashboard está visible. */
function scheduleDashRefresh(): void {
  setTimeout(() => {
    if (document.getElementById("dash-log-body")) {
      void refreshDashboardDynamic();
      scheduleDashRefresh();
    }
  }, 15000);
}

async function viewDashboard(syncFilter = ""): Promise<void> {
  dashSyncFilter = syncFilter;
  const { state, log } = await api<{ state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }; log: SyncLogEntry[] }>(
    `/sync/log?limit=50${syncFilter ? `&trigger=${encodeURIComponent(syncFilter)}` : ""}`
  );
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("es-AR") : "nunca";
  const lastRow = state.lastStatus
    ? `<span class="${state.lastStatus === "ok" ? "ok" : "err"}">${esc(state.lastStatus)}</span>`
    : '<span class="muted">—</span>';
  el.view.innerHTML = `
    <div class="panel">
      <h2>Estado del catálogo</h2>
      <div class="kv" id="dash-state">
        <span class="k">Última sincronización</span><span>${esc(last)}</span>
        <span class="k">Resultado</span><span>${lastRow}</span>
        <span class="k">Error</span><span>${esc(state.lastError ?? "—")}</span>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn btn-primary" id="sync-now">⟳ Sincronizar ahora</button>
        <button class="btn" id="rebuild">Regenerar snapshot</button>
      </div>
    </div>
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Historial de sincronización</h2>
        <select id="sync-filter" style="margin-left:auto">
          <option value="" ${syncFilter === "" ? "selected" : ""}>Todas</option>
          <option value="cron" ${syncFilter === "cron" ? "selected" : ""}>Automáticas (cron)</option>
          <option value="manual" ${syncFilter === "manual" ? "selected" : ""}>Manuales</option>
        </select>
      </div>
      <p class="muted" style="margin-top:4px">Últimas 50 corridas — se actualiza solo cada 15 segundos.</p>
      <div class="table-scroll">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Origen</th><th>Detalle</th><th>Estado</th><th>Importados</th><th>Error</th></tr></thead>
        <tbody id="dash-log-body">
          ${log.length === 0 ? '<tr><td colspan="6" class="muted">Todavía no hubo sincronizaciones.</td></tr>' : log.map(syncLogRow).join("")}
        </tbody>
      </table>
      </div>
    </div>`;
  el.view.querySelector("#sync-now")?.addEventListener("click", () => void doSync());
  el.view.querySelector("#rebuild")?.addEventListener("click", () => void rebuildSnapshot());
  el.view.querySelector("#sync-filter")?.addEventListener("change", (ev) => {
    dashSyncFilter = (ev.target as HTMLSelectElement).value;
    void refreshDashboardDynamic();
  });
  scheduleDashRefresh();
}

async function doSync(): Promise<void> {
  // Contenedor de progreso junto a los botones del dashboard.
  const box = document.createElement("div");
  el.view.querySelector(".panel .row")?.after(box);
  const prog = showProgress(box, "Sincronizando catálogo…", SYNC_STEPS);
  prog.set(10, "Descargando la fuente…", 0);
  const ph2 = setTimeout(() => prog.set(55, "Importando productos…", 1), 1500);
  const ph3 = setTimeout(() => prog.set(80, "Generando snapshot público…", 2), 6000);
  const btn = el.view.querySelector("#sync-now") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    const r = await api<{ ok: boolean; imported: number; failed: number; total?: number; mode?: string; errors?: string[]; warnings?: string[] }>(
      "/sync",
      { method: "POST" }
    );
    clearTimeout(ph2); clearTimeout(ph3);
    if (r.mode === "auto-imports") {
      const j = r.total ?? 0;
      const fails = r.errors ?? [];
      const resumen = fails.length > 0
        ? fails.slice(0, 3).map((e) => esc(e.replace(/^https?:\/\//, "").slice(0, 50))).join(" · ")
        : (r.warnings && r.warnings.length > 0
          ? `${r.warnings.length} artículo(s) salteado(s) por precio inválido`
          : "sin errores");
      prog.set(100, `${j} fuente(s) · ${r.imported} importados · ${resumen}`, 3, !r.ok);
      const warn = r.warnings && r.warnings.length > 0 ? ` Avisos: ${r.warnings.length} salteado(s).` : "";
      toast(
        r.ok
          ? `Listo: ${j} fuente(s), ${r.imported} productos importados.${warn}`
          : `Falló en ${r.failed} de ${j} links. ${r.errors?.join(" · ") ?? ""}`.trim(),
        r.ok
      );
    } else {
      prog.set(100, `${r.imported} importados, ${r.failed} fallidos`, 3, !r.ok);
      toast(`Listo: ${r.imported} importados, ${r.failed} fallidos`, r.ok);
    }
  } catch (e) {
    clearTimeout(ph2); clearTimeout(ph3);
    prog.set(100, e instanceof Error ? e.message : "Error de sync", 1, true);
    toast(e instanceof Error ? e.message : "Error de sync", false);
  }
  prog.done();
  if (btn) btn.disabled = false;
  // Historial y estado se refrescan solos, sin recargar la vista.
  await refreshDashboardDynamic();
  setTimeout(() => box.remove(), 6000);
}

async function rebuildSnapshot(): Promise<void> {
  try {
    const r = await api<{ products: number }>("/snapshot", { method: "POST" });
    toast(`Snapshot regenerado (${r.products} productos)`);
  } catch (e) {
    toast(e instanceof Error ? e.message : "Error", false);
  }
}

async function showLogin(): Promise<void> {
  el.login.hidden = false;
  el.app.hidden = true;
  await applyStoreName();
}

// Nombre de la tienda desde la config pública: título de la pestaña + login.
async function applyStoreName(): Promise<void> {
  try {
    const res = await fetch("/api/public/settings");
    if (!res.ok) return;
    const s = (await res.json()) as { storeName?: string };
    if (s.storeName) {
      document.title = `Admin — ${s.storeName}`;
      const span = document.getElementById("login-store");
      if (span) span.textContent = s.storeName;
    }
  } catch {
    /* sin nombre: quedan los textos genéricos */
  }
}

async function checkSession(): Promise<boolean> {
  try {
    await api("/session");
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  await applyStoreName();
  if (await checkSession()) {
    el.login.hidden = true;
    el.app.hidden = false;
    void render();
  } else {
    await showLogin();
  }
}

el.loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  el.loginError.hidden = true;
  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({ password: el.loginPassword.value }),
    });
    el.loginPassword.value = "";
    el.login.hidden = true;
    el.app.hidden = false;
    void render();
  } catch {
    el.loginError.textContent = "Contraseña incorrecta";
    el.loginError.hidden = false;
  }
});

el.logout.addEventListener("click", async () => {
  await api("/logout", { method: "POST" }).catch(() => null);
  await showLogin();
});

window.addEventListener("hashchange", () => {
  if (!el.app.hidden) void render();
});

// ---- Productos ----

async function viewProducts(): Promise<void> {
  const [{ products }, { categories }] = await Promise.all([
    api<{ products: Product[] }>("/products"),
    api<{ categories: Category[] }>("/categories"),
  ]);
  const catName = (id: string | null): string =>
    id ? (categories.find((c) => c.id === id)?.name ?? id) : "—";
  const catOptions = categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Productos (${products.length})</h2>
        <button class="btn btn-primary" id="new-product" style="margin-left:auto">+ Nuevo producto</button>
      </div>
      <div class="row" style="margin-top:10px; align-items:center">
        <select id="bulk-cat" style="max-width:260px">
          <option value="">Borrar una categoría entera…</option>
          ${catOptions}
        </select>
        <button class="btn btn-danger" id="bulk-cat-del">Vaciar categoría</button>
        <button class="btn btn-danger" id="bulk-del" hidden>🗑️ Borrar seleccionados</button>
        <span class="muted" id="bulk-count" hidden></span>
      </div>
      ${products.length === 0 ? '<p class="muted">No hay productos todavía.</p>' : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th><input type="checkbox" id="sel-all" title="Marcar todos"/></th><th>Título</th><th>Precio</th><th>Categoría</th><th>Estado</th><th>Tags</th><th></th></tr></thead>
        <tbody>
          ${products.map((p) => `
            <tr data-id="${esc(p.id)}">
              <td><input type="checkbox" class="prod-sel" data-id="${esc(p.id)}"/></td>
              <td>${p.imageUrl ? `<img class="thumb" src="${esc(p.imageUrl)}" alt=""/>` : '<div class="thumb"></div>'}${esc(p.title)}<br/><span class="muted">${esc(p.id)}</span></td>
              <td>${formatPriceAdmin(p.priceCents)}</td>
              <td>${esc(catName(p.categoryId))}</td>
              <td class="${p.status === "published" ? "ok" : "muted"}">${p.status === "published" ? "Publicado" : "Oculto"}</td>
              <td>${p.tags.map((t) => `<span class="badge badge--${t}">${t === "new" ? "Nuevo" : t === "featured" ? "Destacado" : "Oferta"}</span>`).join(" ") || "—"}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-edit" data-id="${esc(p.id)}">Editar</button>
                <button class="btn btn-danger btn-del" data-id="${esc(p.id)}">Borrar</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`}
      </div>
    </div>`;
  el.view.querySelector("#new-product")?.addEventListener("click", () => void openProductForm(null, categories));
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
        toast("Producto borrado");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void render();
    });
  });

  // ---- Selección múltiple ----
  const selAll = el.view.querySelector("#sel-all") as HTMLInputElement | null;
  const bulkBtn = el.view.querySelector("#bulk-del") as HTMLButtonElement | null;
  const bulkCount = el.view.querySelector("#bulk-count") as HTMLElement | null;
  const selected = (): string[] =>
    [...el.view.querySelectorAll<HTMLInputElement>(".prod-sel:checked")].map((cb) => cb.dataset.id ?? "").filter(Boolean);
  const refreshBulk = (): void => {
    const n = selected().length;
    if (bulkBtn) bulkBtn.hidden = n === 0;
    if (bulkCount) {
      bulkCount.textContent = n > 0 ? `${n} seleccionado${n > 1 ? "s" : ""}` : "";
      bulkCount.hidden = n === 0;
    }
    if (selAll) selAll.checked = products.length > 0 && n === products.length;
  };
  selAll?.addEventListener("change", () => {
    el.view.querySelectorAll<HTMLInputElement>(".prod-sel").forEach((cb) => (cb.checked = selAll.checked));
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
      toast(`${r.deleted} producto${r.deleted !== 1 ? "s" : ""} borrado${r.deleted !== 1 ? "s" : ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    void render();
  });

  // ---- Vaciar categoría entera ----
  el.view.querySelector("#bulk-cat-del")?.addEventListener("click", async () => {
    const sel = el.view.querySelector("#bulk-cat") as HTMLSelectElement | null;
    const catId = sel?.value ?? "";
    if (catId === "") {
      toast("Elegí una categoría primero", false);
      return;
    }
    const cat = categories.find((c) => c.id === catId);
    const inCat = products.filter((p) => p.categoryId === catId || p.subcategoryId === catId);
    if (inCat.length === 0) {
      toast(`La categoría "${cat?.name ?? catId}" no tiene productos`, false);
      return;
    }
    if (!confirm(`¿Borrar los ${inCat.length} producto${inCat.length > 1 ? "s" : ""} de "${cat?.name ?? catId}"? La categoría NO se borra. Esta acción no se puede deshacer.`)) return;
    try {
      const r = await api<{ deleted: number }>("/products/bulk", {
        method: "POST",
        body: JSON.stringify({ categoryId: catId }),
      });
      toast(`${r.deleted} producto${r.deleted !== 1 ? "s" : ""} borrado${r.deleted !== 1 ? "s" : ""} de "${cat?.name ?? catId}"`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    void render();
  });
}

function formatPriceAdmin(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("es-AR");
}

function openModal(html: string): HTMLElement {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal-card">${html}</div>`;
  back.addEventListener("click", (e) => {
    if (e.target === back) back.remove();
  });
  document.body.appendChild(back);
  return back;
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
          <option value="hidden" ${p?.status === "hidden" ? "selected" : ""}>Oculto</option>
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
      toast("Producto guardado");
      void render();
    } catch (e) {
      const errEl = back.querySelector("#p-error") as HTMLElement;
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}

// ---- Categorías ----

async function viewCategories(): Promise<void> {
  const { categories, counts } = await api<{ categories: Category[]; counts: Record<string, { total: number; published: number }> }>("/categories");
  const roots = categories.filter((c) => c.parentId === null);
  const nameOf = (id: string | null): string =>
    id ? (categories.find((c) => c.id === id)?.name ?? id) : "—";
  // Conteo por categoría; las categorías padre suman también sus subcategorías.
  const countOf = (id: string): { total: number; published: number } => {
    const own = counts[id] ?? { total: 0, published: 0 };
    const children = categories.filter((c) => c.parentId === id);
    const sub = children.reduce(
      (acc, ch) => {
        const s = counts[ch.id] ?? { total: 0, published: 0 };
        return { total: acc.total + s.total, published: acc.published + s.published };
      },
      { total: 0, published: 0 }
    );
    return { total: own.total + sub.total, published: own.published + sub.published };
  };
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Categorías (${categories.length})</h2>
        <button class="btn btn-primary" id="new-cat" style="margin-left:auto">+ Nueva categoría</button>
      </div>
      ${categories.length === 0 ? '<p class="muted">No hay categorías.</p>' : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th>Nombre</th><th>Productos</th><th>Padre</th><th>Activa</th><th></th></tr></thead>
        <tbody>
          ${categories.map((c) => {
            const n = countOf(c.id);
            return `
            <tr>
              <td><strong>${esc(c.name)}</strong> <span class="muted">(${esc(c.id)})</span></td>
              <td><span class="badge">${n.total}</span>${n.published !== n.total ? ` <span class="muted" style="font-size:12px" title="Publicados de ${n.total}">${n.published} pub.</span>` : ""}</td>
              <td>${esc(nameOf(c.parentId))}</td>
              <td class="${c.active ? "ok" : "muted"}">${c.active ? "Sí" : "No"}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-cat-edit" data-id="${esc(c.id)}">Editar</button>
                <button class="btn btn-danger btn-cat-del" data-id="${esc(c.id)}">Borrar</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`}
      </div>
    </div>`;
  el.view.querySelector("#new-cat")?.addEventListener("click", () => void openCategoryForm(null, roots));
  el.view.querySelectorAll(".btn-cat-edit").forEach((b) => {
    b.addEventListener("click", () => {
      const c = categories.find((x) => x.id === (b as HTMLElement).dataset.id);
      if (c) void openCategoryForm(c, roots);
    });
  });
  el.view.querySelectorAll(".btn-cat-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.id;
      if (!id || !confirm("¿Borrar esta categoría? Los productos quedarán sin categoría.")) return;
      try {
        await api(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Categoría borrada");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void render();
    });
  });
}

async function openCategoryForm(c: Category | null, roots: Category[]): Promise<void> {
  const back = openModal(`
    <h2>${c ? "Editar categoría" : "Nueva categoría"}</h2>
    <form id="c-form">
      <div class="field"><label>Nombre</label><input name="name" required value="${esc(c?.name ?? "")}"/></div>
      <div class="field"><label>Padre</label>
        <select name="parentId"><option value="">— (raíz)</option>
          ${roots.filter((r) => r.id !== c?.id).map((r) => `<option value="${esc(r.id)}" ${c?.parentId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
        </select></div>
      <div class="field"><label class="checks"><input type="checkbox" name="active" ${c?.active !== false ? "checked" : ""}/> Activa (visible en filtros)</label></div>
      <p class="error" id="c-error" hidden></p>
      <div class="row">
        <button type="submit" class="btn btn-primary">Guardar</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);
  const form = back.querySelector("#c-form") as HTMLFormElement;
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = {
      name: String(fd.get("name") ?? ""),
      parentId: String(fd.get("parentId") ?? "") || null,
      active: fd.get("active") === "on",
    };
    try {
      if (c) await api(`/categories/${encodeURIComponent(c.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/categories", { method: "POST", body: JSON.stringify(body) });
      back.remove();
      toast("Categoría guardada");
      void render();
    } catch (e) {
      const errEl = back.querySelector("#c-error") as HTMLElement;
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}

// ---- Importación ----

async function viewImport(): Promise<void> {
  el.view.innerHTML = `
    <div class="panel">
      <h2>Importar productos</h2>
      <p class="muted">Pegá el link de tu catálogo o de un producto: se descarga y se extraen los productos
      automáticamente. De la lista, elegís qué importar.</p>
      <div class="field"><label>URL de la tienda o catálogo</label><input id="imp-url" placeholder="https://latienda.com/productos o /products/samsung-s24"/></div>
      <div class="field"><label>Regla de precio a aplicar</label><select id="imp-rule"></select></div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" id="imp-preview">Analizar</button>
      </div>
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
}

interface PreviewResponse {
  source: string;
  found: number;
  products: Product[];
  applications?: { productId: string; baseCents: number; finalCents: number; ruleName: string | null; percent: number }[];
  errors: string[];
}

function currentRuleId(): string | null {
  const sel = el.view.querySelector("#imp-rule") as HTMLSelectElement | null;
  return sel && sel.value !== "" ? sel.value : null;
}

// ---- Barra de progreso (importar, sincronizar, auto-importaciones) ----

const IMPORT_STEPS = ["Descargando", "Extrayendo", "Calculando precios"] as const;
const SYNC_STEPS = ["Descargando", "Importando", "Generando snapshot"] as const;
const AUTO_STEPS = ["Descargando", "Extrayendo", "Importando"] as const;

type ProgressCtl = {
  set: (pct: number, label?: string, stepIdx?: number, stepErr?: boolean) => void;
  done: () => void;
};

function showProgress(container: HTMLElement, title: string, steps: readonly string[] = IMPORT_STEPS): ProgressCtl {
  container.innerHTML = `
    <div class="panel progress-wrap">
      <strong>${esc(title)}</strong>
      <div class="progress-track"><div class="progress-fill" style="width:5%"></div></div>
      <div class="progress-label"><span class="progress-pct">5%</span> — <span class="progress-text">Preparando…</span></div>
      <div class="progress-steps">
        ${steps.map((s) => `<span class="progress-step">${s}</span>`).join("")}
      </div>
    </div>`;
  const fill = container.querySelector(".progress-fill") as HTMLElement;
  const pctEl = container.querySelector(".progress-pct") as HTMLElement;
  const textEl = container.querySelector(".progress-text") as HTMLElement;
  const stepEls = [...container.querySelectorAll(".progress-step")] as HTMLElement[];
  let timer: ReturnType<typeof setInterval> | null = null;
  const ctl: ProgressCtl = {
    set: (pct, label, stepIdx, stepErr) => {
      if (timer) { clearInterval(timer); timer = null; }
      fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      pctEl.textContent = `${Math.round(pct)}%`;
      if (label) textEl.textContent = label;
      stepEls.forEach((s, i) => {
        s.classList.toggle("done", stepIdx !== undefined && i < stepIdx);
        s.classList.toggle("active", stepIdx === i);
        s.classList.toggle("err", stepErr === true && stepIdx === i);
      });
    },
    done: () => {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
  // Avance lento y suave mientras esperamos la respuesta del worker.
  let virtual = 5;
  timer = setInterval(() => {
    virtual = Math.min(90, virtual + 1.5);
    fill.style.width = `${virtual}%`;
    pctEl.textContent = `${Math.round(virtual)}%`;
  }, 300);
  return ctl;
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
      ${r.products.length === 0 ? '<p class="muted">No se detectaron productos importables en esa URL.</p>' : `
      <div class="imp-actions">
        <button class="btn" id="imp-all">Marcar todos</button>
        <button class="btn" id="imp-none">Desmarcar todos</button>
        <span class="muted" id="imp-count"></span>
        <button class="btn btn-primary" id="imp-confirm-top" style="margin-left:auto">Importar seleccionados</button>
      </div>
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
    const selected = idx.map((i) => r.products[i]).filter(Boolean);
    const prog = showProgress(out, `Importando ${selected.length} producto${selected.length > 1 ? "s" : ""}…`);
    prog.set(10, "Guardando productos…", 1);
    const phase = setTimeout(() => prog.set(70, "Actualizando catálogo y snapshot…", 2), 800);
    try {
      const res = await api<{ imported: number; failed: number; ok: boolean; source: string }>("/import", {
        method: "POST",
        body: JSON.stringify({ items: selected, url: sourceUrl || undefined, priceRuleId: currentRuleId() }),
      });
      clearTimeout(phase);
      prog.set(100, res.ok ? `Listo: ${res.imported} importados` : "Terminó con errores", 3);
      await new Promise((res2) => setTimeout(res2, 450));
      prog.done();
      toast(`Importados ${res.imported}, fallidos ${res.failed}`, res.ok);
      void render();
    } catch (e) {
      clearTimeout(phase);
      prog.done();
      toast(e instanceof Error ? e.message : "Error", false);
    }
  };
  out.querySelector("#imp-confirm-top")?.addEventListener("click", () => void doConfirm());
  out.querySelector("#imp-confirm")?.addEventListener("click", () => void doConfirm());
}

// ---- Reglas de precios ----

async function fetchRules(): Promise<PriceRule[]> {
  const { rules } = await api<{ rules: PriceRule[] }>("/price-rules");
  rulesCache = rules;
  return rules;
}

let rulesCache: PriceRule[] = [];

function ruleLabel(r: PriceRule): string {
  const min = formatPriceAdmin(r.minCents);
  const max = r.maxCents === null ? "en adelante" : `a ${formatPriceAdmin(r.maxCents)}`;
  const sign = r.percent >= 0 ? "+" : "";
  return `${min} ${max} → ${sign}${r.percent}%`;
}

async function viewRules(): Promise<void> {
  const rules = await fetchRules();
  const overlaps = findOverlaps(rules);
  const conflictedIds = new Set<string>();
  for (const o of overlaps) {
    conflictedIds.add(o.a.id);
    conflictedIds.add(o.b.id);
  }
  const overlapWarnings = overlaps
    .map(
      (o) => `<li>⚠️ <strong>${esc(o.a.name)}</strong> y <strong>${esc(o.b.name)}</strong> se superponen en
      <strong>${formatPriceAdmin(o.fromCents)}${o.toCents === null ? " en adelante" : ` — ${formatPriceAdmin(o.toCents)}`}</strong>:
      gana <strong>${esc(o.winner.name)}</strong> (${o.winner.percent >= 0 ? "+" : ""}${o.winner.percent}%).
      La otra regla no tiene efecto en esa zona.</li>`
    )
    .join("");
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Reglas de precios</h2>
        <button class="btn btn-primary" id="new-rule" style="margin-left:auto">+ Nueva regla</button>
      </div>
      <p class="muted" style="margin-bottom:0">Durante cada importación, si el precio del producto cae dentro del rango de una regla activa,
      se le aplica el recargo automáticamente. Si varias reglas coinciden, gana la de mayor prioridad (y a igual prioridad, el rango más específico).</p>
      ${overlaps.length > 0 ? `<div class="panel" style="border:1px solid #e5a50a; margin-top:12px">
        <strong style="color:#e5a50a">⚠️ Rangos superpuestos (${overlaps.length})</strong>
        <ul style="margin:8px 0 0 18px" class="muted">${overlapWarnings}</ul>
        <p class="muted" style="margin:8px 0 0">Recomendación: ajustá los rangos para que no se pisen (los límites deben quedar contiguos: $0–$10.000, $10.001–…),
        o desactivá la regla que sobra.</p>
      </div>` : ""}
      ${rules.length === 0 ? '<p class="muted">Todavía no hay reglas. Creá una, ej: "Entre $0 y $10.000 → +40%".</p>' : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th>Regla</th><th>Grupo</th><th>Rango</th><th>Recargo</th><th>Prioridad</th><th>Activa</th><th></th></tr></thead>
        <tbody>
          ${rules.map((r) => `
            <tr${conflictedIds.has(r.id) ? ' style="background:rgba(229,165,10,0.08)"' : ""}>
              <td><strong>${esc(r.name)}</strong>${conflictedIds.has(r.id) ? ' <span title="Se superpone con otra regla activa" style="color:#e5a50a">⚠️</span>' : ""}</td>
              <td>${r.groupName ? esc(r.groupName) : '<span class="muted">—</span>'}</td>
              <td>${formatPriceAdmin(r.minCents)} — ${r.maxCents === null ? "∞" : formatPriceAdmin(r.maxCents)}</td>
              <td class="${r.percent >= 0 ? "ok" : "err"}">${r.percent >= 0 ? "+" : ""}${r.percent}%</td>
              <td>${r.priority}</td>
              <td class="${r.active ? "ok" : "muted"}">${r.active ? "Sí" : "No"}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-rule-edit" data-id="${esc(r.id)}">Editar</button>
                <button class="btn btn-danger btn-rule-del" data-id="${esc(r.id)}">Borrar</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`}
      </div>
    </div>`;
  el.view.querySelector("#new-rule")?.addEventListener("click", () => void openRuleForm(null));
  el.view.querySelectorAll(".btn-rule-edit").forEach((b) => {
    b.addEventListener("click", () => {
      const r = rules.find((x) => x.id === (b as HTMLElement).dataset.id);
      if (r) void openRuleForm(r);
    });
  });
  el.view.querySelectorAll(".btn-rule-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.id;
      if (!id || !confirm("¿Borrar esta regla?")) return;
      try {
        await api(`/price-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Regla borrada");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void render();
    });
  });
}

async function openRuleForm(rule: PriceRule | null): Promise<void> {
  const back = openModal(`
    <h2>${rule ? "Editar regla" : "Nueva regla"}</h2>
    <form id="r-form">
      <div class="field"><label>Nombre (ej: "Recarga baratos")</label>
        <input name="name" required value="${esc(rule?.name ?? "")}"/></div>
      <div class="field"><label>Grupo (opcional — reglas con el mismo grupo forman una escala seleccionable en Importar)</label>
        <input name="groupName" list="rule-groups" value="${esc(rule?.groupName ?? "")}" placeholder="ej: Escala 2026"/>
        <datalist id="rule-groups">${groupNames(rulesCache).map((g) => `<option value="${esc(g)}"></option>`).join("")}</datalist></div>
      <div class="field"><label>Precio mínimo ($) — número entero</label>
        <input name="min" type="number" min="0" step="1" required value="${rule ? rule.minCents / 100 : 0}"/></div>
      <div class="field"><label>Precio máximo ($ — vacío = sin límite, entero)</label>
        <input name="max" type="number" min="0" step="1" value="${rule?.maxCents != null ? rule.maxCents / 100 : ""}"/></div>
      <div class="field"><label>Recargo (%) — puede ser negativo para rebajar</label>
        <input name="percent" type="number" step="0.1" required value="${rule?.percent ?? 40}"/></div>
      <div class="field"><label>Prioridad (mayor gana si varias coinciden)</label>
        <input name="priority" type="number" value="${rule?.priority ?? 0}"/></div>
      <div class="field"><label class="checks"><input type="checkbox" name="active" ${rule?.active !== false ? "checked" : ""}/> Activa</label></div>
      <p class="error" id="r-error" hidden></p>
      <div class="row">
        <button type="submit" class="btn btn-primary">Guardar</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);
  const form = back.querySelector("#r-form") as HTMLFormElement;
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = {
      name: String(fd.get("name") ?? ""),
      groupName: String(fd.get("groupName") ?? "").trim() || null,
      minCents: Math.round(Number(fd.get("min") ?? 0) * 100),
      maxCents: String(fd.get("max") ?? "") === "" ? null : Math.round(Number(fd.get("max")) * 100),
      percent: Number(fd.get("percent") ?? 0),
      priority: Number(fd.get("priority") ?? 0),
      active: fd.get("active") === "on",
    };
    try {
      if (rule) await api(`/price-rules/${encodeURIComponent(rule.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/price-rules", { method: "POST", body: JSON.stringify(body) });
      back.remove();
      toast("Regla guardada");
      void render();
    } catch (e) {
      const errEl = back.querySelector("#r-error") as HTMLElement;
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}

// ---- Auto-importaciones programadas ----

async function fetchAutoImports(): Promise<AutoImport[]> {
  const { jobs } = await api<{ jobs: AutoImport[] }>("/auto-imports");
  return jobs;
}

function ruleOrAutoLabel(priceRuleId: string | null, rules: PriceRule[]): string {
  if (!priceRuleId) return "Automático";
  if (priceRuleId.startsWith("group:")) return `Grupo: ${priceRuleId.slice(6)}`;
  const r = rules.find((x) => x.id === priceRuleId);
  return r ? r.name : priceRuleId;
}

/** Re-consulta el último run de cada auto-importación y actualiza las filas in-place. */
async function refreshAutoLastRuns(): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>("tr[data-autourl]")];
  await Promise.all(rows.map(async (row) => {
    const url = row.dataset.autourl ?? "";
    if (!url) return;
    try {
      const { entry } = await api<{ entry: SyncLogEntry | null }>(`/auto-imports/last-run?url=${encodeURIComponent(url)}`);
      const cell = row.querySelectorAll("td")[4];
      if (!cell) return;
      if (!entry) { cell.innerHTML = '<span class="muted">nunca</span>'; return; }
      const err = entry.error ?? "";
      const errHtml = !err ? "" : entry.status === "ok"
        ? `<br/><span class="muted" style="font-size:12px;display:inline-block;max-width:280px;white-space:normal" title="Avisos de la corrida (los artículos inválidos se saltaron): ${esc(err)}">ⓘ ${esc(err.slice(0, 90))}${err.length > 90 ? "…" : ""}</span>`
        : `<br/><span class="err-detail" style="font-size:12px;display:inline-block;max-width:280px;white-space:normal" title="${esc(err)}">⚠ ${esc(err.slice(0, 90))}${err.length > 90 ? "…" : ""}</span>`;
      cell.innerHTML = `<span class="${entry.status === "ok" ? "ok" : "err"}">${esc(entry.status)}</span><br/><span class="muted" style="font-size:12px">${new Date(entry.startedAt).toLocaleString("es-AR")}</span>${errHtml}`;
    } catch { /* silencioso */ }
  }));
}

async function viewAutoImports(): Promise<void> {
  const [jobs, rules] = await Promise.all([fetchAutoImports(), fetchRules().catch(() => [] as PriceRule[])]);
  const groups = groupNames(rules);
  // Última corrida por URL: trae el error completo (causa) de cada job.
  const lastRuns = await Promise.all(
    jobs.map(async (j) => {
      try {
        const r = await api<{ entry: SyncLogEntry | null }>(`/auto-imports/last-run?url=${encodeURIComponent(j.url)}`);
        return r.entry;
      } catch {
        return null;
      }
    })
  );
  const lastByUrl: Record<string, SyncLogEntry | null> = {};
  jobs.forEach((j, i) => { lastByUrl[j.url] = lastRuns[i] ?? null; });
  // Detalle del último error de cada job (causa completa en el tooltip).
  const lastErrHtml = (url: string): string => {
    const entry = lastByUrl[url];
    const err = entry?.error;
    if (!err) return "";
    if (entry.status === "ok") {
      return `<br/><span class="muted" style="font-size:12px;display:inline-block;max-width:280px;white-space:normal" title="Avisos de la corrida (los artículos inválidos se saltaron): ${esc(err)}">ⓘ ${esc(err.slice(0, 90))}${err.length > 90 ? "…" : ""}</span>`;
    }
    return `<br/><span class="err-detail" style="font-size:12px;display:inline-block;max-width:280px;white-space:normal" title="${esc(err)}">⚠ ${esc(err.slice(0, 90))}${err.length > 90 ? "…" : ""}</span>`;
  };
  const rows = jobs
    .map((j) => `
      <tr data-autourl="${esc(j.url)}">
        <td>
          <label class="checks"><input type="checkbox" class="auto-active" data-id="${esc(j.id)}" ${j.active ? "checked" : ""}/> Activa</label>
        </td>
        <td><strong>${esc(j.label || j.url)}</strong><br/><span class="muted" style="font-size:12px">${esc(j.url)}</span></td>
        <td>${esc(ruleOrAutoLabel(j.priceRuleId, rules))}</td>
        <td>${j.times.length ? j.times.map((t) => `<span class="badge">${esc(t)}</span>`).join(" ") : '<span class="muted">sin horarios</span>'}</td>
        <td>${j.lastStatus ? `<span class="${j.lastStatus === "ok" ? "ok" : "err"}">${j.lastStatus}</span><br/><span class="muted" style="font-size:12px">${new Date(j.lastRunAt ?? 0).toLocaleString("es-AR")}</span>${lastErrHtml(j.url)}` : '<span class="muted">nunca</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-auto-edit" data-id="${esc(j.id)}">Editar</button>
          <button class="btn btn-danger btn-auto-del" data-id="${esc(j.id)}">Borrar</button>
        </td>
      </tr>`)
    .join("");
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Auto-importaciones</h2>
        <button class="btn btn-primary" id="new-auto" style="margin-left:auto">+ Nueva</button>
        <button class="btn" id="run-auto">Ejecutar ahora</button>
      </div>
      <p class="muted" style="margin-bottom:0">Los links que importaste manualmente quedan anotados acá.
      Activá uno, elegile regla o grupo de precios y horarios (hora Argentina): el sistema lo vuelve a
      importar solo en esos momentos, todos los días.</p>
      ${jobs.length === 0 ? '<p class="muted">Todavía no hay links. Importá uno desde la pestaña Importar y va a aparecer acá.</p>' : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th></th><th>Link</th><th>Regla / Grupo</th><th>Horarios</th><th>Última corrida</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`}
      </div>
    </div>`;
  el.view.querySelector("#new-auto")?.addEventListener("click", () => void openAutoForm(null, rules, groups));
  el.view.querySelector("#run-auto")?.addEventListener("click", async () => {
    const box = document.createElement("div");
    el.view.querySelector(".panel .row")?.after(box);
    const prog = showProgress(box, "Ejecutando auto-importaciones…", AUTO_STEPS);
    prog.set(8, "Descargando fuentes…", 0);
    const ph2 = setTimeout(() => prog.set(50, "Extrayendo productos…", 1), 1500);
    const ph3 = setTimeout(() => prog.set(78, "Importando y aplicando reglas…", 2), 6000);
    const btn = el.view.querySelector("#run-auto") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      const r = await api<{ ok: boolean; results: { url: string; ok: boolean; imported: number; error: string | null }[] }>("/auto-imports/run", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      clearTimeout(ph2); clearTimeout(ph3);
      const imported = r.results.reduce((n, x) => n + x.imported, 0);
      const failed = r.results.filter((x) => !x.ok).length;
      // Resumen por fuente en la barra (más información, no solo %).
      const porFuente = r.results
        .map((x) => `${esc(x.url.replace(/^https?:\/\//, "").replace("www.", "").slice(0, 24))}: ${x.ok ? `+${x.imported}` : "error"}`)
        .join(" · ");
      prog.set(100, `${r.results.length} fuente(s) · ${imported} importados · ${porFuente}`, 3, failed > 0);
      toast(`Listo: ${imported} productos, ${failed} con error`, r.ok);
      // Refrescar los lastRun de las filas sin re-render completo.
      await refreshAutoLastRuns();
    } catch (e) {
      clearTimeout(ph2); clearTimeout(ph3);
      prog.set(100, e instanceof Error ? e.message : "Error", 1, true);
      toast(e instanceof Error ? e.message : "Error", false);
    }
    prog.done();
    if (btn) btn.disabled = false;
    setTimeout(() => box.remove(), 8000);
  });
  el.view.querySelectorAll(".auto-active").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const id = (cb as HTMLInputElement).dataset.id;
      if (!id) return;
      try {
        await api(`/auto-imports/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ active: (cb as HTMLInputElement).checked }),
        });
        toast((cb as HTMLInputElement).checked ? "Activada" : "Desactivada");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
        void render();
      }
    });
  });
  el.view.querySelectorAll(".btn-auto-edit").forEach((b) => {
    b.addEventListener("click", () => {
      const j = jobs.find((x) => x.id === (b as HTMLElement).dataset.id);
      if (j) void openAutoForm(j, rules, groups);
    });
  });
  el.view.querySelectorAll(".btn-auto-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.id;
      if (!id || !confirm("¿Borrar esta auto-importación?")) return;
      try {
        await api(`/auto-imports/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Borrada");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void render();
    });
  });
}

function openAutoForm(job: AutoImport | null, rules: PriceRule[], groups: string[]): void {
  const back = openModal(`
    <h2>${job ? "Editar auto-importación" : "Nueva auto-importación"}</h2>
    <form id="a-form">
      <div class="field"><label>Link del catálogo o producto</label>
        <input name="url" required value="${esc(job?.url ?? "")}" placeholder="https://…"/></div>
      <div class="field"><label>Nombre (opcional)</label>
        <input name="label" value="${esc(job?.label ?? "")}" placeholder="ej: Mascotas hacetupedido"/></div>
      <div class="field"><label>Regla de precio</label>
        <select name="priceRuleId">
          <option value="">Automático (rangos de reglas activas)</option>
          ${groups.map((g) => `<option value="group:${esc(g)}" ${job?.priceRuleId === `group:${g}` ? "selected" : ""}>🗂️ Grupo: ${esc(g)} (escala completa)</option>`).join("")}
          ${rules.map((r) => `<option value="${esc(r.id)}" ${job?.priceRuleId === r.id ? "selected" : ""}>${esc(r.name)} (${r.percent >= 0 ? "+" : ""}${r.percent}%)</option>`).join("")}
        </select></div>
      <div class="field"><label>Horarios de actualización (hora Argentina — máximo 3)</label>
        <div class="hour-list" id="a-hours">
          ${Array.from({ length: 24 }, (_, h) => {
            const hh = String(h).padStart(2, "0");
            const on = (job?.times ?? []).some((t) => /^\d\d:(00|15|30|45)$/.test(t) && parseInt(t, 10) === h);
            return `<button type="button" class="hour-item ${on ? "on" : ""}" data-h="${hh}:00">${hh}:00</button>`;
          }).join("")}
        </div>
        <p class="muted" id="a-hours-hint" style="margin-top:6px">Elegí hasta 3 horarios de actualización (ej: 08:00 y 20:00).</p>
      </div>
      <div class="field"><label class="checks"><input type="checkbox" name="active" ${job?.active !== false ? "checked" : ""}/> Activa</label></div>
      <p class="error" id="a-error" hidden></p>
      <div class="row">
        <button type="submit" class="btn btn-primary">Guardar</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);
  const form = back.querySelector("#a-form") as HTMLFormElement;
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  // Límite de 3 horarios seleccionados, con contador en vivo.
  const hint = back.querySelector("#a-hours-hint") as HTMLElement;
  const refreshHint = (): void => {
    const n = back.querySelectorAll(".hour-item.on").length;
    hint.textContent = n === 0
      ? "Elegí hasta 3 horarios de actualización (ej: 08:00 y 20:00)."
      : `${n} de 3 horarios seleccionados.`;
    hint.style.color = n >= 3 ? "var(--brand)" : "";
  };
  refreshHint();
  back.querySelectorAll<HTMLButtonElement>(".hour-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!btn.classList.contains("on") && back.querySelectorAll(".hour-item.on").length >= 3) {
        hint.textContent = "Máximo 3 horarios — deseleccioná uno para cambiarlo.";
        hint.style.color = "var(--danger)";
        return;
      }
      btn.classList.toggle("on");
      refreshHint();
    });
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const times = [...back.querySelectorAll<HTMLButtonElement>("#a-hours .hour-item.on")].map((b) => b.dataset.h ?? "").sort();
    const body = {
      url: String(fd.get("url") ?? "").trim(),
      label: String(fd.get("label") ?? "").trim(),
      priceRuleId: String(fd.get("priceRuleId") ?? "") || null,
      times,
      active: fd.get("active") === "on",
    };
    try {
      if (job) await api(`/auto-imports/${encodeURIComponent(job.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/auto-imports", { method: "POST", body: JSON.stringify(body) });
      back.remove();
      toast("Auto-importación guardada");
      void render();
    } catch (e) {
      const errEl = back.querySelector("#a-error") as HTMLElement;
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}

// ---- Configuración ----

async function viewSettings(): Promise<void> {
  const { settings } = await api<{ settings: StoreSettings }>("/settings");
  el.view.innerHTML = `
    <div class="panel">
      <h2>Configuración de la tienda</h2>
      <form id="s-form">
        <div class="field"><label>Número de WhatsApp (con código de país, sin + ni espacios)</label>
          <input name="whatsappPhone" value="${esc(settings.whatsappPhone)}" placeholder="5491100000000"/></div>
        <div class="field"><label>Símbolo de moneda</label>
          <input name="currencySymbol" value="${esc(settings.currencySymbol)}" maxlength="3"/></div>
        <h2 style="margin-top:24px">Datos del comercio (popups y footer)</h2>
        <div class="field"><label>Nombre de la tienda</label>
          <input name="storeName" value="${esc(settings.storeName)}" placeholder="Mi Tienda"/></div>
        <div class="field"><label>Dirección del local</label>
          <input name="storeAddress" value="${esc(settings.storeAddress)}" placeholder="Mendoza 2974 · Santa Fe"/></div>
        <div class="field"><label>Link de Google Maps</label>
          <input name="storeMapUrl" value="${esc(settings.storeMapUrl)}" placeholder="https://maps.google.com/?q=…"/></div>
        <div class="field"><label>Horarios (una línea por rango)</label>
          <textarea name="storeHours" rows="2" placeholder="Lunes a viernes: 9:00 a 19:00 hs">${esc(settings.storeHours)}</textarea></div>
        <div class="field"><label>Instagram (URL)</label>
          <input name="instagramUrl" value="${esc(settings.instagramUrl)}" placeholder="https://www.instagram.com/…"/></div>
        <div class="field"><label>Facebook (URL)</label>
          <input name="facebookUrl" value="${esc(settings.facebookUrl)}" placeholder="https://www.facebook.com/…"/></div>
        <h2 style="margin-top:24px">Sincronización</h2>
        <p class="muted">La sincronización se gestiona desde la pestaña <strong>Auto-importaciones</strong>: cargás los links, les asignás horarios (hora Argentina) y el cron los actualiza solo. El historial de cada corrida queda en el Dashboard.</p>
        <button type="submit" class="btn btn-primary">Guardar configuración</button>
      </form>
    </div>`;
  const form = el.view.querySelector("#s-form") as HTMLFormElement;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          whatsappPhone: fd.get("whatsappPhone"),
          currencySymbol: fd.get("currencySymbol"),
          storeName: fd.get("storeName"),
          storeAddress: fd.get("storeAddress"),
          storeMapUrl: fd.get("storeMapUrl"),
          storeHours: fd.get("storeHours"),
          instagramUrl: fd.get("instagramUrl"),
          facebookUrl: fd.get("facebookUrl"),
        }),
      });
      toast("Configuración guardada");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });
}

void boot();
