// SPA del panel de administración.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../shared/types";
import { formatPrice } from "../shared/format";
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

/** Contador ámbar genérico junto a una pestaña del menú (se quita en 0, tope 99+). */
function updateTabBadge(tab: string, count: number, title: string): void {
  const link = el.tabs.querySelector<HTMLAnchorElement>(`a[data-tab="${tab}"]`);
  if (!link) return;
  let badge = link.querySelector(".tab-badge");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "tab-badge";
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.setAttribute("title", `${count} ${title}`);
  } else if (badge) {
    badge.remove();
  }
}

/** Contador ámbar de pedidos pendientes junto a la pestaña Ventas → Pedidos. */
function updatePendingBadge(count: number): void {
  updateTabBadge("orders", count, "pedidos pendientes");
}

function route(): string {
  return location.hash.replace("#", "") || "dashboard";
}

// Guardia de edición: true cuando hay cambios sin guardar en Configuración.
// Se arma al tocar un campo, se desarma al guardar bien o al volver a los valores originales.
let dirtyGuardArmed = false;

async function render(): Promise<void> {
  // Aviso de cambios sin guardar: solo si la vista anterior era Configuración
  // (si el usuario ya confirmó o el DOM cambió, se deja ir sin preguntar).
  if (dirtyGuardArmed && el.view.querySelector("#s-form")) {
    const seguir = confirm("Hay cambios sin guardar en Configuración. Si cambiás de pestaña ahora, se pierden.\n\n¿Querés salir igual?");
    if (!seguir) {
      // La URL quedó en la pestaña elegida pero la vista sigue en Configuración:
      // se re-alinea el hash para que queden coherentes.
      if (route() !== "settings") {
        history.replaceState(null, "", "#settings");
        setTabHighlight("settings");
      }
      return;
    }
    dirtyGuardArmed = false;
  }
  const tab = route();
  setTabHighlight(tab);
  el.view.innerHTML = `<div class="state"><div class="spinner"></div></div>`;
  try {
    if (tab === "products") await viewProducts();
    // Compat: la pestaña "Sin stock" ahora vive como filtro dentro de Productos.
    else if (tab === "hidden") await viewProducts("hidden");
    else if (tab === "categories") await viewCategories();
    else if (tab === "import") await viewImport();
    else if (tab === "rules") await viewRules();
    else if (tab === "auto") await viewAutoImports();
    else if (tab === "stats") await viewStats();
    else if (tab === "orders") await viewOrders();
    else if (tab === "settings") await viewSettings();
    else if (tab === "changelog") await viewChangelog();
    else if (tab === "seguridad") await viewSeguridad();
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
  // Celda de cantidades: "161/175" con fallidos y sin-stock destacados si los hay.
  const cant = l.itemsImported != null
    ? `${l.itemsImported}${l.itemsTotal != null && l.itemsTotal !== l.itemsImported ? `/${l.itemsTotal}` : ""}${(l.itemsFailed ?? 0) > 0 ? ` <span class="err-detail">(${l.itemsFailed} fall.)</span>` : ""}${(l.itemsDeactivated ?? 0) > 0 ? ` <span class="warn-detail" title="Productos de la fuente que ya no vinieron en el listado: quedaron sin stock">· ${l.itemsDeactivated} sin stock</span>` : ""}`
    : "—";
  // Duración de la corrida (finished - started).
  const dur = l.finishedAt != null ? Math.max(1, Math.round((l.finishedAt - l.startedAt) / 100) / 10) : null;
  return `
    <tr>
      <td>${esc(new Date(l.startedAt).toLocaleString("es-AR"))}</td>
      <td>${triggerLabel(l.trigger)}</td>
      <td class="muted">${l.detail ? esc(l.detail.replace(/^https?:\/\//, "").slice(0, 40)) : "—"}</td>
      <td class="${l.status === "ok" ? "ok" : "err"}">${esc(l.status)}</td>
      <td>${cant}${dur != null ? ` <span class="muted" style="font-size:11px">· ${dur}s</span>` : ""}</td>
      <td class="muted">${l.error ? (l.status === "ok"
        ? `<span class="muted" title="Avisos de la corrida (los artículos inválidos se saltaron): ${esc(l.error)}">ⓘ ${esc(l.error.slice(0, 90))}${l.error.length > 90 ? "…" : ""}</span>`
        : `<span class="err-detail" title="${esc(l.error)}">⚠ ${esc(l.error.slice(0, 90))}${l.error.length > 90 ? "…" : ""}</span>`) : "—"}</td>
    </tr>`;
}

/** Actualiza estado + historial del dashboard in-place (sin re-render de la vista). */
/** Aviso destacado en el dashboard cuando la última sincronización falló. */
function dashErrorBanner(state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }): string {
  if (state.lastStatus === "error" && state.lastError) {
    const cuando = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("es-AR") : "";
    return `
    <div class="panel dash-error-banner" id="dash-error-banner" data-sync-at="${state.lastSyncAt ?? 0}">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1">
          <strong style="color:var(--danger)">⚠ La última sincronización falló</strong>
          <span class="muted" style="margin-left:8px">${esc(cuando)}</span>
          <p style="margin:6px 0 0; font-size:13px; word-break:break-word">${esc(state.lastError)}</p>
        </div>
        <button class="btn" id="dash-error-close" title="Descartar aviso">✕</button>
      </div>
    </div>`;
  }
  return "";
}

/** Interfaz de una fuente en /sync/log (estado del último intento de cada link). */
interface FuenteEstado {
  id: string;
  label: string;
  url: string;
  active: boolean;
  times: string[];
  lastRunAt: number | null;
  lastStatus: string | null;
}

/** Salud semanal de una fuente (respuesta de /sync/health). */
interface FuenteSaludUI {
  url: string;
  corridas: number;
  ok: number;
  errores: number;
  tasaExito: number;
  duracionMediaMs: number;
  ultimaCorrida: number | null;
  ultimoError: string | null;
}

interface SaludSemanalUI {
  totalCorridas: number;
  totalOk: number;
  totalErrores: number;
  tasaExitoGlobal: number;
  duracionMediaMs: number;
  fuentes: FuenteSaludUI[];
}

/** Color de la tasa de éxito: verde ≥90, naranja ≥70, rojo debajo. */
function tasaClass(tasa: number): string {
  return tasa >= 90 ? "ok" : tasa >= 70 ? "warn" : "err";
}

function fmtDuracion(ms: number): string {
  if (ms <= 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Panel de estadísticas de los últimos 7 días (antes "Salud del cron"), en
 *  lenguaje cotidiano y plegado para que el Dashboard quede resumido. */
function saludPanel(s: SaludSemanalUI): string {
  const filas = s.fuentes.length === 0
    ? '<tr><td colspan="6" class="muted">Sin actualizaciones en los últimos 7 días.</td></tr>'
    : s.fuentes.map((f) => {
        const nombre = f.url.replace(/^https?:\/\//, "").slice(0, 45);
        const errTitle = f.ultimoError ? ` title="Último problema: ${esc(f.ultimoError)}"` : "";
        return `
      <tr${f.tasaExito < 70 ? ' style="background:rgba(220,60,60,.08)"' : ""}>
        <td class="muted">${esc(nombre)}${errTitle ? ' <span class="err-detail">⚠</span>' : ""}</td>
        <td>${f.corridas}</td>
        <td>${f.ok}</td>
        <td class="${f.errores > 0 ? "err" : "muted"}">${f.errores}</td>
        <td class="${tasaClass(f.tasaExito)}">${f.tasaExito}%</td>
        <td class="muted">${esc(fmtDuracion(f.duracionMediaMs))}</td>
      </tr>`;
      }).join("");
  return `
    <details class="cfg-group dash-fold" id="dash-salud">
      <summary>Actualizaciones automáticas — últimos 7 días <span class="cfg-hint">cuántas se hicieron, cuántas fallaron y cómo viene cada link</span></summary>
      <div class="cfg-body">
        <div class="kv">
          <span class="k">Actualizaciones hechas</span><span>${s.totalCorridas}</span>
          <span class="k">Sin problemas / con problemas</span><span><span class="ok">${s.totalOk}</span> / <span class="${s.totalErrores > 0 ? "err" : "muted"}">${s.totalErrores}</span></span>
          <span class="k">Salieron bien el</span><span class="${tasaClass(s.tasaExitoGlobal)}">${s.tasaExitoGlobal}%</span>
          <span class="k">Tardan en promedio</span><span>${esc(fmtDuracion(s.duracionMediaMs))}</span>
        </div>
        ${s.fuentes.length > 0 ? `
        <div class="table-scroll">
        <table class="table" style="margin-top:12px">
          <thead><tr><th>Fuente</th><th>Actualizaciones</th><th>Bien</th><th>Con problema</th><th>% bien</th><th>Tardan</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
        </div>` : ""}
      </div>
    </details>`;
}

/** Panel "Estado por fuente": última corrida de cada link configurado.
 *  Se muestra entre el estado del catálogo y el historial; responde a la
 *  pregunta "¿los 7 links están sincronizando?" de un vistazo. */
/** Ventana de atraso: una fuente activa con horarios que no corre hace más de 24h es sospechosa. */
const STALE_MS = 24 * 60 * 60 * 1000;

function fuenteAtrasada(f: { active: boolean; times: string[]; lastRunAt: number | null }, now = Date.now()): boolean {
  return f.active && f.times.length > 0 && f.lastRunAt != null && now - f.lastRunAt > STALE_MS;
}

function fuentesPanel(fuentes: FuenteEstado[]): string {
  if (fuentes.length === 0) return "";
  const rows = fuentes.map((f) => {
    const st = f.lastStatus ?? "—";
    const cls = fuenteAtrasada(f) ? "err" : st === "ok" ? "ok" : st === "error" ? "err" : "muted";
    const cuando = f.lastRunAt ? new Date(f.lastRunAt).toLocaleString("es-AR") : "nunca corrió";
    const atrasada = fuenteAtrasada(f);
    const horarios = f.times.length > 0 ? f.times.join(", ") : "—";
    return `
      <tr${atrasada ? ' style="background:rgba(220,60,60,.08)"' : ""}>
        <td>${esc(f.label || f.url.replace(/^https?:\/\//, "").slice(0, 40))}${f.active ? "" : ' <span class="muted">(inactiva)</span>'}</td>
        <td class="muted">${esc(horarios)}</td>
        <td${atrasada ? ' class="err"' : ' class="muted"'}>${esc(cuando)}${atrasada ? ' <span class="badge" style="background:#7a1f1f;color:#fff" title="La fuente tiene horarios configurados pero no corre hace más de 24 horas">⚠ atrasada</span>' : ""}</td>
        <td class="${cls}">${esc(st)}</td>
      </tr>`;
  });
  return `
    <div class="panel">
      <h2>Estado por fuente</h2>
      <p class="muted" style="margin-top:4px">Último intento de cada link configurado en Auto-importaciones.</p>
      <div class="table-scroll">
      <table class="table">
        <thead><tr><th>Fuente</th><th>Horarios</th><th>Último intento</th><th>Estado</th></tr></thead>
        <tbody id="dash-fuentes-body">${rows.join("")}</tbody>
      </table>
      </div>
    </div>`;
}

async function refreshDashboardDynamic(): Promise<void> {
  const stateEl = document.getElementById("dash-state");
  const bodyEl = document.getElementById("dash-log-body");
  if (!stateEl || !bodyEl) return; // no estamos en el dashboard
  try {
    const { state, log, fuentes } = await api<{ state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }; log: SyncLogEntry[]; fuentes?: FuenteEstado[] }>(
      `/sync/log?limit=50${dashSyncFilter ? `&trigger=${encodeURIComponent(dashSyncFilter)}` : ""}`
    );
    stateEl.innerHTML = estadoCatalogoKv(state);
    bodyEl.innerHTML = log.length === 0
      ? '<tr><td colspan="6" class="muted">Todavía no hubo sincronizaciones.</td></tr>'
      : log.map(syncLogRow).join("");
    // Estado por fuente: re-render del panel si existe (o creación en caliente).
    const fuentesPrevio = document.getElementById("dash-fuentes-body");
    if (fuentes && fuentes.length > 0) {
      const nuevoPanel = fuentesPanel(fuentes);
      if (fuentesPrevio) {
        fuentesPrevio.closest(".panel")!.outerHTML = nuevoPanel;
      } else {
        document.getElementById("dash-state")?.closest(".panel")!.insertAdjacentHTML("afterend", nuevoPanel);
      }
    }
    // Aviso de error dinámico: insertarlo antes del primer panel si corresponde
    // (respetando el descarte de la sesión; un error nuevo tiene otro timestamp).
    const descartado = sessionStorage.getItem("dashErrorDismissed");
    const bannerHtml = descartado === String(state.lastSyncAt ?? 0) ? "" : dashErrorBanner(state);
    const existente = document.getElementById("dash-error-banner");
    if (bannerHtml !== "") {
      if (existente) {
        existente.outerHTML = bannerHtml;
      } else {
        document.querySelector(".admin-main")?.insertAdjacentHTML("afterbegin", bannerHtml);
      }
      bindBannerClose();
    } else if (existente) {
      existente.remove();
    }
  } catch {
    /* silencioso: el polling no debe molestar */
  }
}

/** Filas del bloque "Estado del catálogo" (compartido entre el render inicial y el polling).
 *  La fila de error solo aparece cuando hay un error real, para no mostrar "—" de relleno. */
function estadoCatalogoKv(state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }): string {
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("es-AR") : "nunca";
  const lastRow = state.lastStatus
    ? `<span class="${state.lastStatus === "ok" ? "ok" : "err"}">${esc(state.lastStatus)}</span>`
    : '<span class="muted">—</span>';
  const errRow = state.lastError ? `\n<span class="k">Error</span><span>${esc(state.lastError)}</span>` : "";
  return `<span class="k">Última sincronización</span><span>${esc(last)}</span>\n<span class="k">Resultado</span><span>${lastRow}</span>${errRow}`;
}

/** Conecta el botón de descartar del aviso (y recuerda el descarte por sesión).
 *  Si aparece un error NUEVO (otra corrida), el aviso vuelve a mostrarse. */
function bindBannerClose(): void {
  document.getElementById("dash-error-close")?.addEventListener("click", () => {
    const at = document.getElementById("dash-error-banner")?.getAttribute("data-sync-at") ?? "0";
    sessionStorage.setItem("dashErrorDismissed", at);
    document.getElementById("dash-error-banner")?.remove();
  });
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
  const [{ state, log, fuentes }, saludRes] = await Promise.all([
    api<{ state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }; log: SyncLogEntry[]; fuentes?: FuenteEstado[] }>(
      `/sync/log?limit=50${syncFilter ? `&trigger=${encodeURIComponent(syncFilter)}` : ""}`
    ),
    api<{ salud: SaludSemanalUI }>("/sync/health").catch(() => ({ salud: null as SaludSemanalUI | null })),
  ]);
  // Si el error mostrado es el mismo que el usuario ya descartó en esta sesión, no re-mostrar.
  const descartado = sessionStorage.getItem("dashErrorDismissed");
  const bannerVisible = state.lastStatus === "error" && state.lastError !== null && descartado !== String(state.lastSyncAt ?? 0);
  el.view.innerHTML = `
    ${bannerVisible ? dashErrorBanner(state) : ""}
    <div class="panel">
      <h2>Estado del catálogo</h2>
      <div class="kv" id="dash-state">${estadoCatalogoKv(state)}</div>
      <div class="row" style="margin-top:16px">
        <button class="btn btn-primary" id="sync-now">⟳ Sincronizar ahora</button>
        <button class="btn" id="rebuild">Regenerar snapshot</button>
      </div>
    </div>
    ${fuentesPanel(fuentes ?? [])}
    ${saludRes.salud ? saludPanel(saludRes.salud) : ""}
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Historial de sincronización</h2>
        <select id="sync-filter" style="margin-left:auto">
          <option value="" ${syncFilter === "" ? "selected" : ""}>Todas</option>
          <option value="cron" ${syncFilter === "cron" ? "selected" : ""}>Automáticas (cron)</option>
          <option value="manual" ${syncFilter === "manual" ? "selected" : ""}>Manuales</option>
        </select>
      </div>
      <p class="muted" style="margin-top:4px">Últimas 50 corridas.</p>
      <div class="table-scroll">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Origen</th><th>Detalle</th><th>Estado</th><th>Importados / Total</th><th>Error</th></tr></thead>
        <tbody id="dash-log-body">
          ${log.length === 0 ? '<tr><td colspan="6" class="muted">Todavía no hubo sincronizaciones.</td></tr>' : log.map(syncLogRow).join("")}
        </tbody>
      </table>
      </div>
    </div>`;
  el.view.querySelector("#sync-now")?.addEventListener("click", () => void doSync());
  el.view.querySelector("#rebuild")?.addEventListener("click", () => void rebuildSnapshot());
  if (bannerVisible) bindBannerClose();
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
  const btn = el.view.querySelector("#sync-now") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    // Encolamos las fuentes y las corremos DE A UNA POR REQUEST: cada request
    // procesa una única fuente para no exceder el límite de CPU del plan gratis
    // (7 fuentes grandes en un solo request mueren a los ~30s y solo entran 5).
    const { jobs } = await api<{ jobs: { id: string; url: string; active: boolean }[] }>("/sync/jobs");
    if (jobs.length === 0) {
      // Sin auto-importaciones cargadas: cae a la sync clásica.
      await syncClassic(box, progFallback(box));
    } else {
      const prog = showProgress(box, `Sincronizando ${jobs.length} fuente(s)…`, SYNC_STEPS);
      let imported = 0;
      const errores: string[] = [];
      const avisos: string[] = [];
      let deact = 0;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!;
        if (i > 0) {
          // Pausa entre fuentes: los primeros requests liberan CPU/cuota mientras
          // el siguiente arranca; evita los cortes por límite del plan gratis.
          prog.set(5 + Math.round((i / jobs.length) * 90), `Pausa antes de la fuente ${i + 1}/${jobs.length}…`, 0);
          await new Promise((r2) => setTimeout(r2, 2000));
        }
        const base = 5 + Math.round((i / jobs.length) * 90);
        prog.set(base, `Fuente ${i + 1}/${jobs.length}: ${job.url.replace(/^https?:\/\//, "").slice(0, 40)}`, 0);
        const r = await api<{ ok: boolean; result?: { imported: number; deactivated: number; warnings: string[]; error: string | null } }>(
          "/sync",
          { method: "POST", body: JSON.stringify({ jobId: job.id }) }
        );
        if (r.ok && r.result) {
          imported += r.result.imported;
          deact += r.result.deactivated;
          if (r.result.warnings.length > 0) avisos.push(...r.result.warnings);
        } else {
          errores.push(`${job.url}: ${r.result?.error ?? "Error"}`);
        }
      }
      prog.set(100, `${jobs.length} fuente(s) · ${imported} importados${deact ? ` · ${deact} sin stock` : ""}${errores.length > 0 ? ` · ${errores.length} con error` : " sin errores"}`, 3, errores.length > 0);
      const deactMsg = deact ? ` ${deact} producto(s) ya no están en las fuentes (sin stock).` : "";
      toast(
        errores.length === 0
          ? `Listo: ${jobs.length} fuente(s), ${imported} productos importados.${deactMsg}${avisos.length > 0 ? ` Avisos: ${avisos.length} salteado(s).` : ""}`
          : `Falló en ${errores.length} de ${jobs.length} fuentes. ${errores[0] ?? ""}`.trim(),
        errores.length === 0
      );
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : "Error de sync", false);
  }
  if (btn) btn.disabled = false;
  // Historial y estado se refrescan solos, sin recargar la vista.
  await refreshDashboardDynamic();
  setTimeout(() => box.remove(), 6000);
}

function progFallback(box: HTMLElement): ProgressCtl {
  const prog = showProgress(box, "Sincronizando catálogo…", SYNC_STEPS);
  prog.set(10, "Descargando la fuente…", 0);
  setTimeout(() => prog.set(55, "Importando productos…", 1), 1500);
  setTimeout(() => prog.set(80, "Generando snapshot público…", 2), 6000);
  return prog;
}

/** Sync clásica (cuando no hay auto-importaciones cargadas). */
async function syncClassic(box: HTMLElement, prog: ProgressCtl): Promise<void> {
  try {
    const r = await api<{ ok: boolean; imported: number; failed: number; errors?: string[] }>("/sync", { method: "POST" });
    prog.set(100, `${r.imported} importados, ${r.failed} fallidos`, 3, !r.ok);
    toast(`Listo: ${r.imported} importados, ${r.failed} fallidos`, r.ok);
  } catch (e) {
    prog.set(100, e instanceof Error ? e.message : "Error de sync", 1, true);
    toast(e instanceof Error ? e.message : "Error de sync", false);
  }
  void box;
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
  idleLoggedOut = false; // nueva sesión, reinicio el contador de inactividad
  lastActivity = Date.now();
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

// ---- Cierre de sesión por inactividad (1 hora) ----
// Con actividad (clic/tecla/scroll en el panel) el servidor renueva la sesión
// sola (sliding); el aviso aparece solo si de verdad pasaste 55 min sin tocar nada.
const IDLE_LIMIT_MS = 60 * 60 * 1000;      // logout a la hora de inactividad
const IDLE_WARN_MS = 55 * 60 * 1000;       // aviso 5 min antes
let lastActivity = Date.now();
let idleLoggedOut = false;
for (const ev of ["click", "keydown", "mousemove", "scroll", "touchstart"] as const) {
  document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true });
}
setInterval(async () => {
  if (idleLoggedOut || el.app.hidden) return;
  const idle = Date.now() - lastActivity;
  if (idle >= IDLE_LIMIT_MS) {
    idleLoggedOut = true;
    await api("/logout", { method: "POST" }).catch(() => null);
    await showLogin();
    el.loginError.textContent = "Cerramos tu sesión por inactividad (1 hora). Volvé a ingresar.";
    el.loginError.hidden = false;
  } else if (idle >= IDLE_WARN_MS) {
    const mins = Math.max(1, Math.round((IDLE_LIMIT_MS - idle) / 60000));
    el.loginError.textContent = `Tu sesión se va a cerrar en ~${mins} min por inactividad. Mové el mouse o tocá algo para seguir.`;
    el.loginError.hidden = false;
  }
}, 30_000);

window.addEventListener("hashchange", () => {
  if (!el.app.hidden) void render();
});

// ---- Productos (paginados: el panel ya no carga todos de una) ----

interface ProductsPage {
  products: Product[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  counts: { published: number; hidden: number };
}

// Estado que sobrevive a los re-renders: editar o borrar no te manda a la página 1.
const prodState = { status: "published" as "published" | "hidden", page: 1, q: "" };
let refocusSearch = false;

async function viewProducts(statusFilter?: "published" | "hidden"): Promise<void> {
  if (statusFilter) {
    if (prodState.status !== statusFilter) prodState.page = 1;
    prodState.status = statusFilter;
  }
  el.view.innerHTML = `<div class="panel"><h2>Productos</h2><p class="muted">Cargando…</p></div>`;
  const fetchPage = async (): Promise<ProductsPage> => {
    const params = new URLSearchParams({ page: String(prodState.page), limit: "50", status: prodState.status });
    if (prodState.q !== "") params.set("q", prodState.q);
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
  const chip = (v: "published" | "hidden", label: string, n: number): string =>
    `<button class="chip ${prodState.status === v ? "on" : ""}" data-pf="${v}">${label} <span class="muted">${n}</span></button>`;
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Productos</h2>
        <div class="row" style="margin-left:14px; gap:6px">
          ${chip("published", "Todos", data.counts.published)}
          ${chip("hidden", "Sin stock", data.counts.hidden)}
        </div>
        <input id="prod-search" type="search" placeholder="Buscar por título o código…" autocomplete="off"
          value="${esc(prodState.q)}" style="max-width:240px; margin-left:10px"/>
        <span class="muted" id="prod-search-count" ${prodState.q !== "" ? "" : "hidden"}>${prodState.q !== "" ? `${data.total} coincidencias` : ""}</span>
        <button class="btn btn-primary" id="new-product" style="margin-left:auto">+ Nuevo producto</button>
      </div>
      ${prodState.status === "hidden" ? `<p class="muted" style="margin:8px 0 0">No aparecen en el catálogo público porque la fuente ya no los trae (sin stock) o los ocultaste a mano. Si la fuente vuelve a traerlos, se re-publican solos.</p>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-primary" id="unhide-all" ${data.counts.hidden === 0 ? "disabled" : ""}>▶ Re-publicar todos</button>
      </div>` : `
      <div class="row" style="margin-top:10px; align-items:center">
        <select id="bulk-cat" style="max-width:260px">
          <option value="">Borrar una categoría entera…</option>
          ${catOptions}
        </select>
        <button class="btn btn-danger" id="bulk-cat-del">Vaciar categoría</button>
        <button class="btn btn-danger" id="bulk-del" hidden>🗑️ Borrar seleccionados</button>
        <span class="muted" id="bulk-count" hidden></span>
      </div>`}
      ${visible.length === 0 ? `<p class="muted" style="margin-top:14px">${prodState.q !== "" ? "Ningún producto coincide con la búsqueda." : prodState.status === "hidden" ? "No hay productos sin stock. 🎉" : "No hay productos todavía."}</p>` : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th><input type="checkbox" id="sel-all" title="Marcar todos (esta página)"/></th><th>Título</th><th>Precio</th><th>Categoría</th><th>Estado</th><th>Tags</th><th></th></tr></thead>
        <tbody>
          ${visible.map((p) => `
            <tr data-id="${esc(p.id)}">
              <td><input type="checkbox" class="prod-sel" data-id="${esc(p.id)}"/></td>
              <td>${p.imageUrl ? `<img class="thumb" src="${esc(p.imageUrl)}" alt=""/>` : '<div class="thumb"></div>'}${esc(p.title)}<br/><span class="muted">${esc(p.id)}</span></td>
              <td>${formatPriceAdmin(p.priceCents)}</td>
              <td>${esc(catName(p.categoryId))}</td>
              <td class="${p.status === "published" ? "ok" : "muted"}">${p.status === "published" ? "Publicado" : "Sin stock"}</td>
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
  // ---- Buscador: filtra en el servidor (título o código), con pausa al tipear ----
  const searchInput = el.view.querySelector("#prod-search") as HTMLInputElement | null;
  let searchTimer: number | undefined;
  searchInput?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const q = (searchInput.value ?? "").trim();
      if (q === prodState.q) return;
      prodState.q = q;
      prodState.page = 1;
      refocusSearch = true;
      void viewProducts();
    }, 350);
  });
  if (refocusSearch && searchInput) {
    refocusSearch = false;
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
        toast("Producto borrado");
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
      toast(`${r.deleted} producto${r.deleted !== 1 ? "s" : ""} borrado${r.deleted !== 1 ? "s" : ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
    void viewProducts();
  });

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
      toast(`${r.deleted} producto${r.deleted !== 1 ? "s" : ""} borrado${r.deleted !== 1 ? "s" : ""} de "${cat?.name ?? catId}"`);
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
      toast(`Re-publicado(s): ${ids.length}`);
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
      toast("Re-publicados todos los productos sin stock");
      await viewProducts();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al re-publicar", false);
    }
  });
  el.view.querySelectorAll(".btn-unhide").forEach((b) => {
    b.addEventListener("click", () => void republish([(b as HTMLElement).dataset.id ?? ""]));
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
      toast("Producto guardado");
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

/** Banner de error en Auto-importaciones: la última corrida del cron falló. */
function autoErrorBanner(entry: SyncLogEntry): string {
  const cuando = new Date(entry.startedAt).toLocaleString("es-AR");
  const url = entry.detail ? entry.detail.replace(/^https?:\/\//, "").slice(0, 60) : "";
  return `
  <div class="panel dash-error-banner" id="dash-error-banner" data-sync-at="${entry.startedAt}">
    <div class="row" style="align-items:flex-start">
      <div style="flex:1">
        <strong style="color:var(--danger)">⚠ La última sincronización automática falló</strong>
        <span class="muted" style="margin-left:8px">${esc(cuando)}${url ? ` · ${esc(url)}` : ""}</span>
        <p style="margin:6px 0 0; font-size:13px; word-break:break-word">${esc(entry.error ?? "Error desconocido")}</p>
      </div>
      <button class="btn" id="dash-error-close" title="Descartar aviso">✕</button>
    </div>
  </div>`;
}

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
  const [jobs, rules, logReciente] = await Promise.all([
    fetchAutoImports(),
    fetchRules().catch(() => [] as PriceRule[]),
    // Última corrida del cron y última manual: para el banner de error general.
    api<{ log: SyncLogEntry[] }>("/sync/log?limit=30")
      .then((r) => r.log)
      .catch(() => [] as SyncLogEntry[]),
  ]);
  // Última corrida de auto-importación (cron o manual): es la que esta pestaña gestiona.
  const lastCron = logReciente.find((l) => l.trigger === "cron" || l.trigger === "manual") ?? null;
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
  const staleMs = 24 * 60 * 60 * 1000;
  const rows = jobs
    .map((j) => {
      const atrasado = j.active && j.times.length > 0 && j.lastRunAt != null && Date.now() - j.lastRunAt > staleMs;
      return `
      <tr data-autourl="${esc(j.url)}"${atrasado ? ' style="background:rgba(220,60,60,.08)"' : ""}>
        <td>
          <label class="checks"><input type="checkbox" class="auto-active" data-id="${esc(j.id)}" ${j.active ? "checked" : ""}/> Activa</label>
        </td>
        <td><strong>${esc(j.label || j.url)}</strong><br/><span class="muted" style="font-size:12px">${esc(j.url)}</span></td>
        <td>${esc(ruleOrAutoLabel(j.priceRuleId, rules))}</td>
        <td>${j.times.length ? j.times.map((t) => `<span class="badge">${esc(t)}</span>`).join(" ") : '<span class="muted">sin horarios</span>'}</td>
        <td>${j.lastStatus ? `<span class="${j.lastStatus === "ok" && !atrasado ? "ok" : "err"}">${j.lastStatus}</span><br/><span class="${atrasado ? "err" : "muted"}" style="font-size:12px">${new Date(j.lastRunAt ?? 0).toLocaleString("es-AR")}${atrasado ? ' <span class="badge" style="background:#7a1f1f;color:#fff" title="El job tiene horarios configurados pero no corre hace más de 24 horas — verificá que siga activo y que el cron lo esté ejecutando">⚠ atrasado >24h</span>' : ""}</span>${lastErrHtml(j.url)}` : '<span class="muted">nunca</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-auto-edit" data-id="${esc(j.id)}">Editar</button>
          <button class="btn btn-danger btn-auto-del" data-id="${esc(j.id)}">Borrar</button>
        </td>
      </tr>`;
    })
    .join("");
  el.view.innerHTML = `
    ${lastCron && lastCron.status === "error" ? autoErrorBanner(lastCron) : ""}
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
  if (lastCron && lastCron.status === "error") bindBannerClose();
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
      const r = await api<{ ok: boolean; results: { url: string; ok: boolean; imported: number; deactivated?: number; error: string | null }[] }>("/auto-imports/run", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      clearTimeout(ph2); clearTimeout(ph3);
      const imported = r.results.reduce((n, x) => n + x.imported, 0);
      const deact = r.results.reduce((n, x) => n + (x.deactivated ?? 0), 0);
      const failed = r.results.filter((x) => !x.ok).length;
      // Resumen por fuente en la barra (más información, no solo %).
      const porFuente = r.results
        .map((x) => `${esc(x.url.replace(/^https?:\/\//, "").replace("www.", "").slice(0, 24))}: ${x.ok ? `+${x.imported}${x.deactivated ? `/-${x.deactivated}` : ""}` : "error"}`)
        .join(" · ");
      prog.set(100, `${r.results.length} fuente(s) · ${imported} importados${deact ? ` · ${deact} sin stock` : ""} · ${porFuente}`, 3, failed > 0);
      toast(`Listo: ${imported} productos, ${failed} con error${deact ? `. ${deact} ya no están en las fuentes (sin stock)` : ""}`, r.ok);
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

/** Grilla de 24 horarios (hora Argentina) reutilizable: modal de auto-importaciones
 *  y box "Repetir automáticamente" de Importar. Marca los horarios de `times`. */
function hourGridHtml(id: string, times: string[]): string {
  return `<div class="hour-list" id="${esc(id)}">
    ${Array.from({ length: 24 }, (_, h) => {
      const hh = String(h).padStart(2, "0");
      const on = times.some((t) => /^\d\d:(00|15|30|45)$/.test(t) && parseInt(t, 10) === h);
      return `<button type="button" class="hour-item ${on ? "on" : ""}" data-h="${hh}:00">${hh}:00</button>`;
    }).join("")}
  </div>`;
}

/** Box "Repetir automáticamente" en Importar: aparece debajo del resultado del análisis
 *  y crea una auto-importación del link analizado sin reescribir nada. */
function renderRepeatBox(r: PreviewResponse, sourceUrl: string): string {
  if (!sourceUrl) return "";
  return `
    <div id="imp-repeat">
      <div class="imp-repeat-toggle">
        <label class="checks"><input type="checkbox" id="imp-repeat-on"/> Repetir automáticamente todos los días</label>
      </div>
      <div id="imp-repeat-cfg" hidden>
        <div class="field"><label>Nombre (opcional)</label>
          <input id="imp-repeat-label" placeholder="ej: Catálogo principal" maxlength="80"/></div>
        <div class="field"><label>Horarios de actualización (hora Argentina — máximo 3)</label>
          ${hourGridHtml("imp-repeat-hours", ["09:00", "21:00"])}
          <p class="muted" id="imp-repeat-hint" style="margin-top:6px"></p>
        </div>
        <button class="btn btn-primary" id="imp-repeat-save">Guardar repetición diaria</button>
        <p class="muted" style="margin-top:6px">Queda configurada en la pestaña <a href="#auto">Auto-importaciones</a>, con la misma regla de precio elegida arriba.</p>
      </div>
    </div>`;
}

/** Conecta el box "Repetir automáticamente" (toggle, grilla con tope de 3 y guardado). */
function bindRepeatBox(scope: HTMLElement): void {
  const on = scope.querySelector<HTMLInputElement>("#imp-repeat-on");
  if (!on) return;
  const cfg = scope.querySelector<HTMLElement>("#imp-repeat-cfg");
  const hint = scope.querySelector<HTMLElement>("#imp-repeat-hint");
  const refreshHint = (): void => {
    const n = scope.querySelectorAll("#imp-repeat-hours .hour-item.on").length;
    if (hint) {
      hint.textContent = n === 0
        ? "Elegí hasta 3 horarios de actualización (ej: 08:00 y 20:00)."
        : `${n} de 3 horarios seleccionados.`;
      hint.style.color = n >= 3 ? "var(--brand)" : "";
    }
  };
  refreshHint();
  on.addEventListener("change", () => { if (cfg) cfg.hidden = !on.checked; });
  scope.querySelectorAll<HTMLButtonElement>("#imp-repeat-hours .hour-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!btn.classList.contains("on") && scope.querySelectorAll("#imp-repeat-hours .hour-item.on").length >= 3) {
        if (hint) { hint.textContent = "Máximo 3 horarios — deseleccioná uno para cambiarlo."; hint.style.color = "var(--danger)"; }
        return;
      }
      btn.classList.toggle("on");
      refreshHint();
    });
  });
  scope.querySelector("#imp-repeat-save")?.addEventListener("click", () => void repeatAsk());
}

/** Crea la auto-importación con el link analizado (misma regla elegida en Importar). */
async function repeatAsk(): Promise<void> {
  const scope = el.view.querySelector("#imp-repeat");
  if (!scope) return;
  const url = (el.view.querySelector("#imp-url") as HTMLInputElement | null)?.value.trim() ?? "";
  if (!url) {
    toast("Primero escribí el link a repetir", false);
    return;
  }
  const label = (scope.querySelector<HTMLInputElement>("#imp-repeat-label")?.value ?? "").trim();
  const times = [...scope.querySelectorAll<HTMLButtonElement>("#imp-repeat-hours .hour-item.on")].map((b) => b.dataset.h ?? "").sort();
  if (times.length === 0) {
    toast("Elegí al menos un horario", false);
    return;
  }
  try {
    await api("/auto-imports", {
      method: "POST",
      body: JSON.stringify({ url, label, times, active: true, priceRuleId: currentRuleId() }),
    });
    toast(`Listo: se repite todos los días a las ${times.join(" y ")}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : "Error", false);
  }
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
        ${hourGridHtml("a-hours", job?.times ?? [])}
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

// ---- Pedidos (pago online) ----

const ORDER_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "ord-pending" },
  paid: { label: "Pagado", cls: "ord-paid" },
  cancelled: { label: "Cancelado", cls: "ord-cancelled" },
  rejected: { label: "Rechazado", cls: "ord-rejected" },
  archived: { label: "Archivados", cls: "ord-archived" },
};

interface OrdersPage {
  orders: Order[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  counts: Record<string, number>;
}

// Estado que sobrevive a los re-renders: filtrar o buscar no te manda a la página 1
// (a menos que cambies el chip de estado, que sí reinicia la página).
const ordState = { status: "" as "" | OrderStatus, page: 1, q: "" };
// Ids seleccionados para la accion masiva de archivar (se limpia al cambiar de vista/filtro)
const ordSelected = new Set<string>();

async function viewOrders(statusFilter = ""): Promise<void> {
  // Cambiar de chip de estado siempre reinicia a la página 1 (y borra búsqueda).
  if (statusFilter !== ordState.status) {
    ordState.status = statusFilter as "" | OrderStatus;
    ordState.page = 1;
    ordState.q = "";
  }
  el.view.innerHTML = `<div class="panel"><h2>🧾 Pedidos</h2><p class="muted">Cargando…</p></div>`;
  const fetchPage = async (): Promise<OrdersPage> => {
    const params = new URLSearchParams({ page: String(ordState.page), limit: "50", status: ordState.status });
    if (ordState.q !== "") params.set("q", ordState.q);
    return api<OrdersPage>(`/orders?${params.toString()}`);
  };
  let data = await fetchPage();
  // Si la página quedó vacía (borré el último de la página 3, por ejemplo), retrocedo.
  let guard = 0;
  while (data.orders.length === 0 && ordState.page > 1 && guard++ < 3) {
    ordState.page = Math.max(1, Math.min(ordState.page - 1, data.pages));
    data = await fetchPage();
  }
  const orders = data.orders;
  const [payments, { settings }] = await Promise.all([
    api<{ configured: boolean; enabled: boolean }>("/payments/status").catch(() => ({ configured: false, enabled: false })),
    api<{ settings: StoreSettings }>("/settings"),
  ]);
  const symbol = settings.currencySymbol || "$";
  // Counter de la pestaña: pedidos pendientes (de los totales del servidor, sin request extra).
  updatePendingBadge(data.counts.pending ?? 0);
  const chips = ["", "pending", "paid", "cancelled", "rejected", "archived"];
  const chipLabels: Record<string, string> = { "": "Todos", pending: "Pendientes", paid: "Pagados", cancelled: "Cancelados", rejected: "Rechazados", archived: "Archivados" };
  const chip = (s: string, label: string, n: number): string =>
    `<button class="chip ${s === ordState.status ? "on" : ""}" data-ord-filter="${s}">${label} <span class="muted">${n}</span></button>`;
  const totalAll = (data.counts.pending ?? 0) + (data.counts.paid ?? 0) + (data.counts.cancelled ?? 0) + (data.counts.rejected ?? 0);
  const rows = orders.map((o) => {
    const meta = ORDER_STATUS_META[o.status] ?? ORDER_STATUS_META["pending"]!;
    const items = o.items.map((i) => `${i.qty}x ${esc(i.title)}`).join(" · ");
    const fecha = new Date(o.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `
    <tr>
      <td><span class="ord-id" title="${esc(o.id)}">${esc(o.id.slice(0, 10))}…</span><br>
          <small class="muted">${fecha}</small></td>
      <td>${esc(o.buyerName)}<br><small class="muted">${esc(o.buyerPhone)}</small>${o.payerEmail ? `<br><small class="muted">${esc(o.payerEmail)}</small>` : ""}</td>
      <td class="ord-items" title="${esc(items)}">${items}</td>
      <td class="num"><b>${formatPrice(o.totalCents, symbol)}</b></td>
      <td><span class="ord-badge ${meta.cls}">${meta.label}</span>${o.status === "archived" && o.archiveNote ? `<br><small class="muted" title="Motivo del archivo">📝 ${esc(o.archiveNote)}</small>` : ""}${o.mpPaymentId ? `<br><small class="muted">MP ${esc(o.mpPaymentId)}</small>` : ""}${o.mpPreferenceId ? `<br><small class="ord-meta" title="${esc(o.mpPreferenceId)}">Pref ${esc(o.mpPreferenceId.length > 22 ? `${o.mpPreferenceId.slice(0, 22)}…` : o.mpPreferenceId)}</small>` : ""}</td>
      <td class="ord-actions">
        ${o.status === "pending" ? `<button class="btn" data-ord-pay="${esc(o.id)}" title="Marcar pagado (verificado fuera de la web)">✓ Pagado</button>` : ""}
        ${o.status !== "cancelled" && o.status !== "paid" && o.status !== "archived" ? `<button class="btn" data-ord-cancel="${esc(o.id)}">✕ Cancelar</button>` : ""}
        ${o.status === "paid" && !o.notifiedWa ? `<button class="btn" data-ord-wa="${esc(o.id)}" data-wa-phone="${esc(o.buyerPhone)}">💬 Ya avisé</button>` : ""}
        <a class="btn" href="/pedido/${esc(o.id)}" target="_blank" rel="noopener">Ver</a>
        ${o.status === "archived"
          ? `<button class="btn" data-ord-archive="${esc(o.id)}" title="Restaurar a la lista de pedidos">↩ Restaurar</button>`
          : `<button class="btn btn-archive" data-ord-archive="${esc(o.id)}" title="Archivar este pedido">🗂️ Archivar</button>`}
      </td>
    </tr>`;
  }).join("");
  el.view.innerHTML = `
    <div class="panel">
      <div class="stats-head">
        <h2>🧾 Pedidos</h2>
        <div class="stats-range">
          ${chip("", "Todos", totalAll)}
          ${chips.slice(1).map((s) => chip(s, chipLabels[s] ?? s, data.counts[s] ?? 0)).join("")}
        </div>
      </div>
      <div class="row" style="margin-top:10px; align-items:center">
        <input id="ord-search" type="search" placeholder="Buscar por nombre de comprador o id de pedido…" autocomplete="off"
          value="${esc(ordState.q)}" style="max-width:260px"/>
        <span class="muted" id="ord-search-count" ${ordState.q !== "" ? "" : "hidden"}>${ordState.q !== "" ? `${data.total} coincidencia${data.total !== 1 ? "s" : ""} en ${data.total} pedido${data.total !== 1 ? "s" : ""} (de ${totalAll})` : ""}</span>
        <button class="btn" id="ord-bulk" style="margin-left:auto" hidden>🗂️ Archivar seleccionados</button>
      </div>
      ${payments.configured && payments.enabled
        ? `<p class="muted">Pago online activo: MercadoPago confirma solo vía webhook.</p>`
        : `<p class="muted">Pago online ${payments.configured ? "configurado pero <b>desactivado</b> en Configuración → Pagos" : "<b>sin token</b>: configurá el secret <code>MERCADOPAGO_ACCESS_TOKEN</code> (ver Configuración → Pagos)"}. Los pedidos que veas acá se confirman a mano.</p>`}
      ${orders.length === 0
        ? `<p class="muted">Todavía no hay pedidos${ordState.status !== "" ? " con este estado" : ""}${ordState.q !== "" ? ` buscando "${esc(ordState.q)}"` : ""}.</p>`
        : `<table class="table ord-table">
            <thead><tr><th>Pedido</th><th>Comprador</th><th>Productos</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`}
      ${orders.length > 0 ? `
      <div class="pager">
        <button class="btn" id="pg-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Anterior</button>
        <span class="muted">Página ${data.page} de ${data.pages} — ${data.total} pedido${data.total !== 1 ? "s" : ""}${ordState.q !== "" ? ` buscando "${esc(ordState.q)}"` : ""}</span>
        <button class="btn" id="pg-next" ${data.page >= data.pages ? "disabled" : ""}>Siguiente ›</button>
      </div>` : ""}
    </div>`;
  el.view.querySelectorAll<HTMLButtonElement>("button[data-ord-filter]").forEach((b) => {
    b.addEventListener("click", () => {
      ordSelected.clear(); // la seleccion de otra vista no debe colarse
      void viewOrders(b.dataset.ordFilter ?? "");
    });
  });
  // ---- Paginación: cambia de página sin recargar el resto del panel ----
  el.view.querySelector("#pg-prev")?.addEventListener("click", () => {
    if (ordState.page > 1) {
      ordState.page -= 1;
      void viewOrders(ordState.status);
    }
  });
  el.view.querySelector("#pg-next")?.addEventListener("click", () => {
    if (ordState.page < data.pages) {
      ordState.page += 1;
      void viewOrders(ordState.status);
    }
  });
  // ---- Buscador: filtra en el servidor (nombre de comprador o id de pedido) ----
  const searchInput = el.view.querySelector("#ord-search") as HTMLInputElement | null;
  let searchTimer: number | undefined;
  searchInput?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const q = (searchInput.value ?? "").trim();
      if (q === ordState.q) return;
      ordState.q = q;
      ordState.page = 1;
      refocusSearch = true;
      void viewOrders(ordState.status);
    }, 350);
  });
  if (refocusSearch && searchInput) {
    refocusSearch = false;
    searchInput.focus();
    const len = searchInput.value.length;
    searchInput.setSelectionRange(len, len);
  }
  el.view.querySelectorAll<HTMLButtonElement>("button[data-ord-pay]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await api(`/orders/${encodeURIComponent(b.dataset.ordPay ?? "")}`, { method: "PATCH", body: JSON.stringify({ status: "paid" }) });
        toast("Pedido marcado como pagado");
        void viewOrders(ordState.status);
      } catch (e) { toast(e instanceof Error ? e.message : "Error", false); }
    });
  });
  el.view.querySelectorAll<HTMLButtonElement>("button[data-ord-cancel]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await api(`/orders/${encodeURIComponent(b.dataset.ordCancel ?? "")}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
        toast("Pedido cancelado");
        void viewOrders(ordState.status);
      } catch (e) { toast(e instanceof Error ? e.message : "Error", false); }
    });
  });
  // Botón "Ya avisé": abre WhatsApp con mensaje pre-cargado al comprador y
  // marca el pedido como notificado (fire-and-forget). El mensaje sigue el
  // mismo estilo que el de la página /pedido/:id: saludo por nombre, tienda,
  // detalle del pedido y total — cero texto genérico.
  el.view.querySelectorAll<HTMLButtonElement>("button[data-ord-wa]").forEach((b) => {

  // Botón "🗂️ Archivar": con confirmación. Si el pedido ya está archivado,
  // restaurar (sin confirmación).
  el.view.querySelectorAll<HTMLButtonElement>("button[data-ord-archive]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.ordArchive;
      if (!id) return;
      // Determinar el estado actual del pedido
      const row = orders.find((o: { id: string }) => o.id === id);
      const archived = row?.status === "archived";
      if (archived) {
        // Restaurar: sin confirmación, directo.
        try {
          await api(`/orders/${encodeURIComponent(id)}/unarchive`, { method: "POST" });
          toast("Pedido restaurado");
          void viewOrders(ordState.status);
        } catch (e) { toast(e instanceof Error ? e.message : "Error", false); }
        return;
      }
      // Abrir modal de confirmación para archivar.
      const modal = openModal(`
        <div class="modal-card" style="max-width:400px">
          <h3 id="a-title">Archivar pedido</h3>
          <p id="a-msg" class="muted" style="margin:8px 0">
            ¿Archivar este pedido? Se guardará en el historial y no aparecerá en la tabla principal de pedidos.
          </p>
          <p id="a-info" class="muted" style="margin:8px 0 12px">
            ID del pedido: <code id="a-id">${esc(id)}</code>
          </p>
          <div class="field" style="margin:0 0 4px">
            <label for="a-note">Motivo (opcional, queda en el historial)</label>
            <textarea id="a-note" rows="2" maxlength="200"
              placeholder="Ej.: pedido de prueba, error de carga, cliente pidió cancelar…"></textarea>
          </div>
          <div class="row" style="margin-top:12px">
            <button class="btn btn-archive-ok" id="a-ok" style="margin-right:8px">Archivar</button>
            <button class="btn btn-cancel" id="a-cancel">Cancelar</button>
          </div>
        </div>
      `);
      const okBtn = modal.querySelector("#a-ok") as HTMLButtonElement;
      const cancelBtn = modal.querySelector("#a-cancel") as HTMLButtonElement;
      cancelBtn.addEventListener("click", () => {
        // Si se cancela, verificar que el pedido no esté en otro estado
        if (okBtn) { okBtn.textContent = "Archivar"; }
        modal.remove();
      });
      okBtn.addEventListener("click", async () => {
        okBtn.disabled = true;
        okBtn.textContent = "Archivando…";
        const note = (modal.querySelector("#a-note") as HTMLTextAreaElement | null)?.value.trim() ?? "";
        try {
          await api(`/orders/${encodeURIComponent(id)}/archive`, {
            method: "POST",
            body: JSON.stringify({ note: note === "" ? null : note }),
          });
          toast("Pedido archivado");
          modal.remove();
          void viewOrders(ordState.status);
        } catch (e) {
          okBtn.disabled = false;
          okBtn.textContent = "Archivar";
          toast(e instanceof Error ? e.message : "Error", false);
        }
      });
    });
  });

    b.addEventListener("click", () => {
      const phone = (b.dataset.waPhone ?? "").replace(/\D/g, "");
      const dest = phone.length > 0 ? (phone.startsWith("54") || phone.startsWith("9") ? phone : `549${phone}`) : "";
      const order = orders.find((x) => x.id === (b.dataset.ordWa ?? ""));
      const lines = order
        ? [
            `Hola ${order.buyerName}! Te confirmo que tu pago en ${settings.storeName || "la tienda"} quedó acreditado ✅`,
            `Pedido: ${order.id.slice(0, 8)}…`,
            ...order.items.filter((i) => i.priceCents > 0).map((i) => `• ${i.qty}x ${i.title}`),
            `Total: ${formatPrice(order.totalCents, symbol)}`,
            "¿Coordinamos la entrega cuando quieras?",
          ]
        : ["Hola! Te confirmo que tu pago quedó acreditado. Coordinamos la entrega cuando quieras."];
      const text = encodeURIComponent(lines.filter(Boolean).join("\n"));
      if (dest !== "") window.open(`https://wa.me/${dest}?text=${text}`, "_blank", "noopener");
      void api(`/orders/${encodeURIComponent(b.dataset.ordWa ?? "")}/notified`, { method: "POST", body: "{}" })
        .then(() => viewOrders(ordState.status))
        .catch(() => { /* no crítico */ });
    });
  });

  // ---- Seleccion masiva: archivar varios pedidos con una sola confirmacion ----
  const bulkBtn = el.view.querySelector("#ord-bulk") as HTMLButtonElement | null;
  const refreshBulk = (): void => {
    const n = ordSelected.size;
    if (bulkBtn) {
      bulkBtn.hidden = n === 0;
      bulkBtn.textContent = `🗂️ Archivar seleccionados (${n})`;
    }
    const selAll = el.view.querySelector("#ord-sel-all") as HTMLInputElement | null;
    const visibles = [...el.view.querySelectorAll<HTMLInputElement>(".ord-sel")];
    if (selAll) selAll.checked = visibles.length > 0 && visibles.every((cb) => cb.checked);
  };
  el.view.querySelectorAll<HTMLInputElement>(".ord-sel").forEach((cb) => {
    const id = cb.dataset.id ?? "";
    cb.checked = ordSelected.has(id);
    cb.addEventListener("change", () => {
      if (cb.checked) ordSelected.add(id);
      else ordSelected.delete(id);
      refreshBulk();
    });
  });
  (el.view.querySelector("#ord-sel-all") as HTMLInputElement | null)?.addEventListener("change", (ev) => {
    const on = (ev.target as HTMLInputElement).checked;
    el.view.querySelectorAll<HTMLInputElement>(".ord-sel").forEach((cb) => {
      cb.checked = on;
      const id = cb.dataset.id ?? "";
      if (on) ordSelected.add(id);
      else ordSelected.delete(id);
    });
    refreshBulk();
  });
  bulkBtn?.addEventListener("click", () => {
    if (ordSelected.size === 0) return;
    const n = ordSelected.size;
    // UNA sola confirmacion para todo el lote, con motivo opcional compartido.
    const modal = openModal(`
      <div class="modal-card" style="max-width:440px">
        <h3>Archivar ${n} pedido${n !== 1 ? "s" : ""}</h3>
        <p class="muted" style="margin:8px 0">Se guardarán en el historial con el mismo motivo y dejarán de aparecer en la tabla principal. Después podés restaurarlos desde el chip «Archivados».</p>
        <div class="field" style="margin:0 0 4px">
          <label for="ab-note">Motivo (opcional, queda en el historial)</label>
          <textarea id="ab-note" rows="2" maxlength="200" placeholder="Ej.: pedidos de prueba, error de carga…"></textarea>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-archive-ok" id="ab-ok" style="margin-right:8px">Archivar ${n}</button>
          <button class="btn btn-cancel" id="ab-cancel">Cancelar</button>
        </div>
      </div>`);
    const okBtn = modal.querySelector("#ab-ok") as HTMLButtonElement;
    modal.querySelector("#ab-cancel")?.addEventListener("click", () => modal.remove());
    okBtn.addEventListener("click", async () => {
      okBtn.disabled = true;
      okBtn.textContent = "Archivando…";
      const note = (modal.querySelector("#ab-note") as HTMLTextAreaElement | null)?.value.trim() ?? "";
      try {
        const r = await api<{ archived: number; notFound: number }>("/orders/archive-bulk", {
          method: "POST",
          body: JSON.stringify({ ids: [...ordSelected], note: note === "" ? null : note }),
        });
        toast(
          `${r.archived} pedido${r.archived !== 1 ? "s" : ""} archivado${r.archived !== 1 ? "s" : ""}` +
          (r.notFound > 0 ? ` · ${r.notFound} no encontrado${r.notFound !== 1 ? "s" : ""}` : ""),
        );
        ordSelected.clear();
        modal.remove();
        void viewOrders(ordState.status);
      } catch (e) {
        okBtn.disabled = false;
        okBtn.textContent = `Archivar ${n}`;
        toast(e instanceof Error ? e.message : "Error", false);
      }
    });
  });
  refreshBulk();
}

async function viewSettings(): Promise<void> {
  const { settings } = await api<{ settings: StoreSettings }>("/settings");
  el.view.innerHTML = `
    <div class="panel">
      <h2>Configuración de la tienda</h2>
      <p class="muted">Tocá una sección para abrirla o cerrarla. Los cambios se guardan todos juntos con el botón «Guardar configuración».</p>
      <form id="s-form">
        <details class="cfg-group" open>
          <summary>Tienda <span class="cfg-hint">nombre, dirección, horarios, redes y link de seguimiento</span></summary>
          <div class="cfg-body">
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
            <div class="field"><label>Link de Seguimiento (botón del header)</label>
              <input name="trackUrl" value="${esc(settings.trackUrl)}" placeholder="https://repairpro.centerphone.com.ar/track-lite"/></div>
          </div>
        </details>
        <details class="cfg-group">
          <summary>Ventas <span class="cfg-hint">WhatsApp, moneda y texto «Cómo comprar»</span></summary>
          <div class="cfg-body">
            <div class="field"><label>Número de WhatsApp (con código de país, sin + ni espacios)</label>
              <input name="whatsappPhone" value="${esc(settings.whatsappPhone)}" placeholder="5491100000000"/></div>
            <div class="field"><label>Símbolo de moneda</label>
              <input name="currencySymbol" value="${esc(settings.currencySymbol)}" maxlength="3"/></div>
            <div class="field"><label>Título del modal "Cómo comprar"</label>
              <input name="howTitle" value="${esc(settings.howTitle)}" placeholder="Cómo comprar"/></div>
            <div class="field">
              <label>Pasos de "Cómo comprar" — un paso por fila; **texto** sale en negrita</label>
              <input type="hidden" name="howSteps"/>
              <ol class="how-list" id="how-list"></ol>
              <div class="row" style="margin-top:8px">
                <button type="button" class="btn" id="how-add">+ Agregar paso</button>
              </div>
              <p class="muted" style="margin-top:10px">Así se ve en la tienda:</p>
              <ol class="modal-steps how-preview" id="how-preview"></ol>
            </div>
            <div class="field"><label>Nota de retiro del modal (vacía = "Retiro en el local: {dirección}")</label>
              <input name="howPickupNote" value="${esc(settings.howPickupNote)}" placeholder="📍 Retiro en el local: Mendoza 2974"/></div>
            <div class="field"><label>Badge "Nuevo" automático (productos cargados hace menos de…)</label>
              <select name="freshHours">
                <option value="24" ${settings.freshHours === 24 ? "selected" : ""}>24 horas</option>
                <option value="48" ${settings.freshHours === 48 || settings.freshHours === 0 ? "selected" : ""}>48 horas</option>
                <option value="168" ${settings.freshHours === 168 ? "selected" : ""}>7 días</option>
                <option value="0" ${settings.freshHours !== 24 && settings.freshHours !== 48 && settings.freshHours !== 168 ? "selected" : ""}>Desactivado</option>
              </select></div>
          </div>
        </details>
        <details class="cfg-group">
          <summary>Pagos online (MercadoPago) <span class="cfg-hint">toggle, recargo, descuento y CBU</span></summary>
          <div class="cfg-body">
            <div class="field field--check">
              <label><input type="checkbox" name="paymentsEnabled" ${settings.paymentsEnabled ? "checked" : ""}/> Activar pago online con MercadoPago (botones "Comprar" y "Agregar" en el catálogo)</label>
            </div>
            <div class="field"><label>Nota de envío/retiro (se muestra en el carrito y en la página del pedido)</label>
              <input name="checkoutNote" value="${esc(settings.checkoutNote)}" placeholder="Coordinamos envío o retiro por WhatsApp después del pago."/></div>
            <div class="field"><label>Recargo por pagar con MercadoPago (%) — 0 = sin recargo</label>
              <input name="mpSurchargePercent" type="number" min="0" max="50" step="1" value="${settings.mpSurchargePercent}" placeholder="0"/></div>
            <div class="field"><label>Descuento por pagar con transferencia (%) — 0 = sin descuento</label>
              <input name="transferDiscountPercent" type="number" min="0" max="50" step="1" value="${settings.transferDiscountPercent}" placeholder="0"/></div>
            <div class="field"><label>CBU / alias para transferencias (opcional; va pre-cargado en el mensaje del pedido por transferencia)</label>
              <input name="transferCbu" value="${esc(settings.transferCbu ?? "")}" maxlength="120" placeholder="Alias: CENTERPHONE.AR"/></div>
            <p class="muted">El recargo se suma al total de MercadoPago al confirmar el pedido. El descuento por transferencia es informativo: se muestra en el carrito y en el cierre por WhatsApp (el cobro lo coordinás vos).</p>
            <p class="muted" id="payments-status">Verificando credenciales…</p>
            <p class="muted">El token <strong>no</strong> se configura acá: es un secret del worker.<br>
            • Local: agregá <code>MERCADOPAGO_ACCESS_TOKEN=TEST-…</code> a <code>.dev.vars</code>.<br>
            • Producción: <code>npx wrangler secret put MERCADOPAGO_ACCESS_TOKEN</code>.<br>
            • Webhook a configurar en MercadoPago (Tus integraciones → Webhooks): <code>https://tu-dominio/api/payments/webhook</code> — evento <em>Pagos</em>.</p>
          </div>
        </details>
        <details class="cfg-group">
          <summary>Mantenimiento <span class="cfg-hint">cerrar la tienda al público</span></summary>
          <div class="cfg-body">
            <div class="field field--check">
              <label><input type="checkbox" name="maintenanceMode" ${settings.maintenanceMode ? "checked" : ""}/> Cerrar el catálogo al público (pantalla con WhatsApp y redes); el panel y los pedidos siguen funcionando</label>
            </div>
            <div class="field"><label>Mensaje para los clientes (opcional)</label>
              <input name="maintenanceMessage" value="${esc(settings.maintenanceMessage ?? "")}" maxlength="300" placeholder="Estamos actualizando la tienda para atenderte mejor. En un rato volvemos 🙌"/></div>
          </div>
        </details>
        <p class="muted">La sincronización del catálogo se gestiona desde la pestaña <strong>Auto-importaciones</strong>: cargás los links, les asignás horarios (hora Argentina) y el cron los actualiza solo. El historial de cada corrida queda en el Dashboard.</p>
        <button type="submit" class="btn btn-primary">Guardar configuración</button>
      </form>
      <details class="cfg-group" style="margin-top:24px">
        <summary>Seguridad <span class="cfg-hint">cambiar la contraseña del panel</span></summary>
        <div class="cfg-body">
          <form id="pw-form">
            <div class="field"><label>Contraseña actual</label>
              <input name="current" type="password" autocomplete="current-password"/></div>
            <div class="field"><label>Nueva contraseña (mínimo 8 caracteres)</label>
              <input name="next" type="password" autocomplete="new-password" minlength="8"/></div>
            <div class="field"><label>Repetir nueva contraseña</label>
              <input name="next2" type="password" autocomplete="new-password" minlength="8"/></div>
            <button type="submit" class="btn">Cambiar contraseña</button>
          </form>
        </div>
      </details>
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
          trackUrl: fd.get("trackUrl"),
          howSteps: fd.get("howSteps"),
          howTitle: fd.get("howTitle"),
          howPickupNote: fd.get("howPickupNote"),
          freshHours: Number(fd.get("freshHours")),
          paymentsEnabled: (fd.get("paymentsEnabled") ?? "") === "on",
          checkoutNote: fd.get("checkoutNote"),
          mpSurchargePercent: Number(fd.get("mpSurchargePercent") ?? 0),
          transferDiscountPercent: Number(fd.get("transferDiscountPercent") ?? 0),
          transferCbu: fd.get("transferCbu"),
          maintenanceMode: (fd.get("maintenanceMode") ?? "") === "on",
          maintenanceMessage: fd.get("maintenanceMessage"),
        }),
      });
      toast("Configuración guardada");
      dirtyGuardArmed = false; // guardado OK: salir de la pestaña ya no avisa
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });

  // Guardia de cambios sin guardar: compara el formulario contra cómo cargó.
  // Volviendo a los valores originales también se desarma (no molesta de más).
  const valoresForm = (): string => JSON.stringify([...new FormData(form).entries()]);
  // Se llena después del primer render del editor (abajo): el campo oculto howSteps
  // nace vacío en la plantilla y el editor lo llena; capturarlo antes marcaba
  // "cambios sin guardar" apenas se abría la pestaña.
  let valoresBase = "";
  form.addEventListener("input", () => { dirtyGuardArmed = valoresBase !== "" && valoresForm() !== valoresBase; });
  // WhatsApp: al pegar/tipear se limpia al vuelo (solo dígitos, sin + ni espacios).
  const waInput = form.querySelector<HTMLInputElement>('[name="whatsappPhone"]');
  waInput?.addEventListener("input", () => {
    const limpio = waInput.value.replace(/\D/g, "").slice(0, 15);
    if (waInput.value !== limpio) {
      const pos = Math.min(waInput.selectionStart ?? limpio.length, limpio.length);
      waInput.value = limpio;
      waInput.setSelectionRange(pos, pos);
    }
  });

  // Editor visual de "Cómo comprar": filas reordenables con vista previa.
  // Guarda el mismo formato de siempre (una línea por paso, **negrita** opcional)
  // en el campo howSteps, así la tienda sigue mostrando exactamente lo mismo.
  const howHidden = form.querySelector<HTMLInputElement>('[name="howSteps"]')!;
  const howList = el.view.querySelector("#how-list") as HTMLElement;
  const howPreview = el.view.querySelector("#how-preview") as HTMLElement;
  let howSteps: string[] = settings.howSteps ? settings.howSteps.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  if (howSteps.length === 0) howSteps = [""];
  const boldHtml = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const renderHow = (): void => {
    // Dibuja SIEMPRE todas las filas, incluso vacías: filtrarlas acá hacía que
    // el paso nuevo de "Agregar" no apareciera y se pisara el último real.
    if (howSteps.length === 0) howSteps = [""];
    howList.innerHTML = howSteps.map((s, i) => `
      <li class="how-row" data-i="${i}" draggable="true">
        <span class="how-grip" title="Arrastrá para reordenar" aria-hidden="true">⠿</span>
        <span class="how-idx">${i + 1}</span>
        <input class="how-txt" value="${esc(s)}" placeholder="Tocá **Consultar** para preguntarnos por WhatsApp"/>
        <span class="how-ops">
          <button type="button" class="btn how-up" title="Subir" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn how-down" title="Bajar" ${i === howSteps.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn btn-danger how-del" title="Quitar paso">✕</button>
        </span>
      </li>`).join("");
  };
  const refreshHow = (): void => {
    howHidden.value = howSteps.filter((s) => s !== "").join("\n");
    howPreview.innerHTML = howSteps.map((s) => `<li>${boldHtml(s) || '<span class="muted">—</span>'}</li>`).join("");
    // El editor toca campos por código (que FormData sí ve): comparar contra el base.
    dirtyGuardArmed = valoresForm() !== valoresBase;
  };
  // Mientras se tipea NO se re-dibuja la fila (perdería el foco): solo preview + valor.
  howList.addEventListener("input", (ev) => {
    const input = ev.target as HTMLInputElement;
    if (!input.classList.contains("how-txt")) return;
    const i = Number(input.closest(".how-row")?.getAttribute("data-i") ?? -1);
    if (i >= 0) howSteps[i] = input.value.trim();
    refreshHow();
  });
  howList.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button");
    if (!btn || btn.classList.contains("how-txt")) return;
    // Sincroniza con lo tipeado (conservando filas vacías para no romper índices).
    howSteps = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")].map((i) => i.value.trim());
    const i = Number(btn.closest(".how-row")?.getAttribute("data-i") ?? -1);
    if (btn.classList.contains("how-del")) {
      howSteps.splice(i, 1);
    } else if (btn.classList.contains("how-up") && i > 0) {
      const prev = howSteps[i - 1] ?? "";
      howSteps[i - 1] = howSteps[i] ?? "";
      howSteps[i] = prev;
    } else if (btn.classList.contains("how-down") && i < howSteps.length - 1) {
      const next = howSteps[i + 1] ?? "";
      howSteps[i + 1] = howSteps[i] ?? "";
      howSteps[i] = next;
    } else return;
    renderHow();
    refreshHow();
  });
  // Reordenar arrastrando (HTML5 DnD; en touch quedan los botones ↑/↓).
  let dragIdx = -1;
  howList.addEventListener("dragstart", (ev) => {
    const row = (ev.target as HTMLElement).closest(".how-row");
    if (!row) return;
    // Lo tipeado entra al array antes de mover, para no perder ediciones.
    howSteps = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")].map((i) => i.value.trim());
    dragIdx = Number(row.getAttribute("data-i") ?? -1);
    row.classList.add("dragging");
    ev.dataTransfer?.setData("text/plain", String(dragIdx));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  });
  howList.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const over = (ev.target as HTMLElement).closest(".how-row");
    howList.querySelectorAll(".how-row").forEach((r) => r.classList.remove("drop-before", "drop-after"));
    if (!over || over.classList.contains("dragging")) return;
    const rect = over.getBoundingClientRect();
    over.classList.add(ev.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
  });
  howList.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const over = (ev.target as HTMLElement).closest(".how-row");
    howList.querySelectorAll(".how-row").forEach((r) => r.classList.remove("dragging", "drop-before", "drop-after"));
    if (!over || dragIdx < 0) { dragIdx = -1; return; }
    const target = Number(over.getAttribute("data-i") ?? -1);
    if (target < 0 || target === dragIdx) { dragIdx = -1; return; }
    const rect = over.getBoundingClientRect();
    let to = ev.clientY < rect.top + rect.height / 2 ? target : target + 1;
    if (to > dragIdx) to -= 1; // al sacar el elemento, los índices se corren
    const [moved] = howSteps.splice(dragIdx, 1);
    howSteps.splice(Math.max(0, Math.min(howSteps.length, to)), 0, moved ?? "");
    dragIdx = -1;
    renderHow();
    refreshHow();
  });
  howList.addEventListener("dragend", () => {
    howList.querySelectorAll(".how-row").forEach((r) => r.classList.remove("dragging", "drop-before", "drop-after"));
    dragIdx = -1;
  });
  el.view.querySelector("#how-add")?.addEventListener("click", () => {
    howSteps = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")].map((i) => i.value.trim());
    howSteps.push("");
    renderHow();
    refreshHow();
    const inputs = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")];
    inputs[inputs.length - 1]?.focus();
  });
  renderHow();
  refreshHow();
  valoresBase = valoresForm(); // el hidden howSteps ya está lleno acá
  dirtyGuardArmed = false;     // recién cargado: ningún cambio todavía

  // Indicador de credenciales de pago (configurado sí/no, sin exponer nada).
  void api<{ configured: boolean; enabled: boolean }>("/payments/status").then((st) => {
    const p = el.view.querySelector("#payments-status");
    if (p) p.innerHTML = st.configured
      ? `✅ Token de MercadoPago configurado. Toggle activo: <strong>${st.enabled ? "sí" : "no"}</strong>.`
      : `⚠️ <strong>Sin token</strong>: el pago online no funciona aunque el toggle esté activo. Configurá el secret <code>MERCADOPAGO_ACCESS_TOKEN</code> (instrucciones abajo).`;
  }).catch(() => {});

  // Cambio de contraseña del panel.
  const pwForm = el.view.querySelector("#pw-form") as HTMLFormElement;
  pwForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(pwForm);
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("next2") ?? "")) {
      toast("Las nuevas contraseñas no coinciden", false);
      return;
    }
    try {
      const res = await api<{ ok: boolean; persisted: boolean }>("/password", {
        method: "POST",
        body: JSON.stringify({ current: fd.get("current"), next }),
      });
      toast(res.persisted
        ? "Contraseña cambiada y guardada. Las otras sesiones activas quedaron cerradas."
        : "Contraseña cambiada en esta sesión solamente (no se pudo persistir)");
      pwForm.reset();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });
}

// ---- Changelog (pestaña "Cambios") ----

/** Markdown mínimo → HTML seguro: títulos ##, ítems -, **negrita**, `código`.
 *  El contenido viene del changelog.md propio (texto confiable), pero se escapa
 *  igual por si algún día se pega algo con caracteres especiales. */
function changelogMarkdownToHtml(md: string): string {
  const inline = (s: string): string => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) {
      out.push(`<h3 class="cl-title">${inline(line.replace(/^##\s+/, ""))}</h3>`);
    } else if (/^-\s+/.test(line)) {
      out.push(`<li>${inline(line.replace(/^-\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      // Cierre de lista: los <li> sueltos se agrupan al final por el navegador,
      // pero mejor cerrar manualmente cuando la línea anterior era un ítem.
      if (out.length > 0 && out[out.length - 1]!.startsWith("<li>")) out.push("</ul>");
    } else {
      if (out.length > 0 && out[out.length - 1]!.startsWith("<li>") && !out.includes("</ul>")) out.push("</ul>");
      out.push(`<p class="cl-p">${inline(line)}</p>`);
    }
  }
  // Convertir los <li> sueltos en listas: envolver cada tanda.
  const html: string[] = [];
  let inList = false;
  for (const piece of out) {
    if (piece.startsWith("<li>")) {
      if (!inList) { html.push("<ul class=\"cl-list\">"); inList = true; }
      html.push(piece);
    } else if (piece === "</ul>") {
      if (inList) { html.push("</ul>"); inList = false; }
    } else {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(piece);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

async function viewChangelog(): Promise<void> {
  el.view.innerHTML = `<div class="panel"><h2>Cambios de la página</h2><p class="muted">Cargando…</p></div>`;
  try {
    const { markdown } = await api<{ markdown: string }>("/changelog");
    const entries = markdown
      .split(/^##\s+/m)
      .slice(1) // antes del primer ## solo suele haber nada
      .map((bloque) => {
        const nl = bloque.indexOf("\n");
        const titulo = bloque.slice(0, nl).trim();
        const cuerpo = bloque.slice(nl + 1);
        return { titulo, cuerpo };
      });
    el.view.innerHTML = `
      <div class="panel">
        <div class="row">
          <h2 style="margin:0">Cambios de la página</h2>
          <span class="muted" style="margin-left:auto">${entries.length} entradas — la más nueva arriba</span>
        </div>
        <div class="cl-entries">
          ${entries.map((e) => `
            <details class="cfg-group cl-entry" ${e === entries[0] ? "open" : ""}>
              <summary>${esc(e.titulo)}</summary>
              <div class="cfg-body">${changelogMarkdownToHtml(e.cuerpo)}</div>
            </details>`).join("")}
        </div>
      </div>`;
  } catch (e) {
    el.view.innerHTML = `<div class="panel"><p class="error">No se pudo cargar el changelog: ${esc(e instanceof Error ? e.message : "Error")}</p></div>`;
  }
}

// ---- Seguridad (eventos del worker, última 24h) ----

interface SecurityEventUi { time: number; level: string; message: string }
interface SecurityLogUi { configured: boolean; hint?: string; error?: string; events: SecurityEventUi[] }

function viewSeguridadNoConfigurada(hint: string): void {
  el.view.innerHTML = `
    <div class="panel">
      <h2>Seguridad</h2>
      <p>El registro de seguridad ya está grabándose, pero el panel todavía no puede leerlo — falta un paso de configuración:</p>
      ${hint ? `<p class="error">${esc(hint)}</p>` : ""}
      <div class="sec-howto">
        <ol>
          <li>Crear un <b>API Token</b> en el dashboard de Cloudflare (esquina arriba a la derecha → Mi perfil → Tokens de API → <b>Crear token</b>): plantilla personalizada, permiso <b>Account · Workers Observability · Read</b>, recursos limitados a esta cuenta.</li>
          <li>Guardarlo en el worker: <code>npx wrangler secret put CF_LOGS_TOKEN</code> (y pegar el token cuando lo pida). Sin deploy extra: el secret aplica en el próximo deploy.</li>
        </ol>
      </div>
      <p class="muted">La cuenta ya está configurada (CF_ACCOUNT_ID). Después de crear el token, esta pestaña muestra los eventos sola. Mientras tanto, los eventos igual se están grabando en Cloudflare.</p>
    </div>`;
}

function viewSeguridadPanel(out: SecurityLogUi): void {
  const filas = out.events.map((e) => {
    const msg = e.message.replace(/^seguridad:\s*/, "");
    const hora = new Date(e.time).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const warn = e.level === "warn";
    return `<div class="sec-row">
      <span class="sec-time">${esc(hora)}</span>
      <span class="sec-badge ${warn ? "warn" : "info"}" title="${warn ? "Advertencia" : "Información"}">${warn ? "⚠" : "ℹ"}</span>
      <span class="sec-msg">${esc(msg)}</span>
    </div>`;
  }).join("");
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Seguridad</h2>
        <span class="muted" style="margin-left:auto">últimas 24 h — ${out.events.length} eventos</span>
        <button id="seg-refresh" class="btn">Actualizar</button>
      </div>
      <p class="muted">Intentos de login fallidos, salidas sin sesión y avisos del webhook de pago. Sin contraseñas ni datos de compradores.</p>
      <div class="sec-entries">${filas || `<p class="muted">Sin eventos en las últimas 24 h. Tranquilo: acá solo aparecen intentos de acceso fallidos y avisos del pago online.</p>`}</div>
    </div>`;
}

async function viewSeguridad(): Promise<void> {
  el.view.innerHTML = `<div class="panel"><h2>Seguridad</h2><p class="muted">Cargando…</p></div>`;
  try {
    const out = await api<SecurityLogUi>("/security-events");
    if (!out.configured) {
      viewSeguridadNoConfigurada(out.hint ?? "");
      return;
    }
    if (out.error) {
      el.view.innerHTML = `<div class="panel"><h2>Seguridad</h2><p class="error">${esc(out.error)}</p><button id="seg-refresh" class="btn">Reintentar</button></div>`;
    } else {
      viewSeguridadPanel(out);
    }
    document.getElementById("seg-refresh")?.addEventListener("click", () => { void render(); });
  } catch (e) {
    el.view.innerHTML = `<div class="panel"><p class="error">No se pudieron leer los eventos de seguridad: ${esc(e instanceof Error ? e.message : "Error")}</p></div>`;
  }
}

// Gráfico de líneas SVG por día: sin librerías, path con puntos + labels cada N días.
function dayChart(byDay: { day: string; views: number }[]): string {
  const W = 720, H = 160, PADL = 8, PADB = 22, PADT = 10;
  const max = Math.max(1, ...byDay.map((d) => d.views));
  const n = byDay.length;
  if (n < 2) return `<p class="muted">Sin datos suficientes todavía.</p>`;
  const x = (i: number): number => PADL + (i / (n - 1)) * (W - PADL * 2);
  const y = (v: number): number => PADT + (1 - v / max) * (H - PADT - PADB);
  const pts = byDay.map((d, i) => `${x(i).toFixed(1)},${y(d.views).toFixed(1)}`).join(" ");
  const area = `${PADL},${y(0)} ${pts} ${x(n - 1).toFixed(1)},${y(0)}`;
  const step = Math.max(1, Math.ceil(n / 8));
  const labels = byDay.map((d, i) => (i % step === 0 || i === n - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="st-xlabel">${d.day.slice(8)}/${d.day.slice(5, 7)}</text>` : "").join("");
  const dots = byDay.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.views).toFixed(1)}" r="2.5" class="st-dot"><title>${d.day}: ${d.views} visitas</title></circle>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="st-daychart" role="img" aria-label="Visitas por día">
    <polygon points="${area}" class="st-area" />
    <polyline points="${pts}" class="st-line" />
    ${dots}${labels}
  </svg>`;
}

// ---- Estadísticas ----

interface StatsSummary {
  since: number;
  totals: { productViews: number; searches: number; waClicks: number; homeViews: number; trackViews: number };
  topProducts: { id: string; title: string; category: string; views: number }[];
  topWa: { id: string; title: string; clicks: number }[];
  topSearches: { query: string; count: number }[];
  emptySearches: { query: string; count: number }[];
  byHour: { hour: number; views: number }[];
  byDay: { day: string; views: number }[];
  byCountry: { country: string; count: number }[];
  byCity: { city: string; region: string; count: number }[];
  byReferrer: { referrer: string; count: number }[];
  trackByCity: { city: string; region: string; count: number }[];
  trackByHour: { hour: number; count: number }[];
}

const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina", BR: "Brasil", CL: "Chile", PY: "Paraguay", UY: "Uruguay",
  BO: "Bolivia", PE: "Perú", US: "Estados Unidos", ES: "España", MX: "México",
};

async function viewStats(days = 7): Promise<void> {
  const { summary } = await api<{ summary: StatsSummary }>(`/stats?days=${days}`);
  const t = summary.totals;
  const maxHour = Math.max(1, ...summary.byHour.map((h) => h.views));
  const bar = (n: number): string => {
    const w = Math.round((n / maxHour) * 100);
    return `<span class="st-bar" style="width:${Math.max(w, n > 0 ? 4 : 0)}%"></span><span class="st-bar-n">${n > 0 ? n : ""}</span>`;
  };
  const rows = (arr: string[]): string => arr.join("") || `<tr><td colspan="3" class="muted">Sin datos todavía.</td></tr>`;
  el.view.innerHTML = `
    <div class="panel">
      <div class="stats-head">
        <h2>📊 Estadísticas</h2>
        <div class="stats-range">
          ${[7, 30, 90].map((d) => `<button class="chip ${d === days ? "on" : ""}" data-days="${d}">${d} días</button>`).join("")}
        </div>
      </div>
      <p class="muted">Datos desde el ${new Date(summary.since).toLocaleDateString("es-AR")}. Una ficha cuenta 1 vez por sesión (refrescar no infla los números).</p>
      <div class="stat-cards">
        <div class="stat-card"><b>${t.productViews}</b><span>vistas a fichas</span></div>
        <div class="stat-card"><b>${t.searches}</b><span>búsquedas</span></div>
        <div class="stat-card"><b>${t.waClicks}</b><span>consultas WhatsApp</span></div>
        <div class="stat-card"><b>${t.homeViews}</b><span>visitas al home</span></div>
        <div class="stat-card"><b>${t.trackViews}</b><span>usos de /seguimiento</span></div>
      </div>
    </div>
    <div class="panel">
      <h3>📈 Visitas por día</h3>
      ${dayChart(summary.byDay)}
    </div>
    <div class="panel">
      <h3>🕒 Visitas por hora (Argentina)</h3>
      <div class="st-hours">${summary.byHour.map((h) => `<div class="st-hour" title="${h.views} visitas"><span class="st-hlabel">${String(h.hour).padStart(2, "0")}h</span>${bar(h.views)}</div>`).join("")}</div>
    </div>
    <div class="st-cols">
      <div class="panel">
        <h3>🔥 Artículos más visitados</h3>
        <table class="table"><tbody>${rows(summary.topProducts.map((p) => `<tr><td><a href="/producto/${esc(p.id)}" target="_blank">${esc(p.title)}</a><br><small class="muted">${esc(p.category || "—")}</small></td><td class="num"><b>${p.views}</b></td></tr>`))}</tbody></table>
      </div>
      <div class="panel">
        <h3>💬 Más consultados por WhatsApp</h3>
        <table class="table"><tbody>${rows(summary.topWa.map((p) => `<tr><td><a href="/producto/${esc(p.id)}" target="_blank">${esc(p.title)}</a></td><td class="num"><b>${p.clicks}</b></td></tr>`))}</tbody></table>
      </div>
    </div>
    <div class="st-cols">
      <div class="panel">
        <h3>🔍 Búsquedas más frecuentes</h3>
        <table class="table"><tbody>${rows(summary.topSearches.map((s) => `<tr><td>${esc(s.query)}</td><td class="num"><b>${s.count}</b></td></tr>`))}</tbody></table>
      </div>
      <div class="panel">
        <h3>❓ Búsquedas sin resultados <span class="muted">(stock faltante)</span></h3>
        <table class="table"><tbody>${rows(summary.emptySearches.map((s) => `<tr><td>${esc(s.query)}</td><td class="num"><b>${s.count}</b></td></tr>`))}</tbody></table>
      </div>
    </div>
    <div class="st-cols">
      <div class="panel">
        <h3>🌎 Por país</h3>
        <table class="table"><tbody>${rows(summary.byCountry.map((c) => `<tr><td>${esc(COUNTRY_NAMES[c.country] ?? c.country)}</td><td class="num"><b>${c.count}</b></td></tr>`))}</tbody></table>
      </div>
      <div class="panel">
        <h3>📍 Principales ciudades</h3>
        <table class="table"><tbody>${rows(summary.byCity.map((c) => `<tr><td>${esc(c.city)}${c.region ? ` <small class="muted">(${esc(c.region)})</small>` : ""}</td><td class="num"><b>${c.count}</b></td></tr>`))}</tbody></table>
      </div>
    </div>
    ${t.trackViews > 0 ? `
    <div class="panel">
      <h3>📦 Seguimiento de envíos (/seguimiento)</h3>
      <div class="st-cols">
        <div>
          <h4 class="muted">Por ciudad</h4>
          <table class="table"><tbody>${rows(summary.trackByCity.map((c) => `<tr><td>${esc(c.city)}${c.region ? ` <small class="muted">(${esc(c.region)})</small>` : ""}</td><td class="num"><b>${c.count}</b></td></tr>`))}</tbody></table>
        </div>
        <div>
          <h4 class="muted">Por hora (Argentina)</h4>
          <div class="st-hours">${summary.trackByHour.map((h) => `<div class="st-hour" title="${h.count} usos"><span class="st-hlabel">${String(h.hour).padStart(2, "0")}h</span>${bar(h.count)}</div>`).join("")}</div>
        </div>
      </div>
    </div>
    ` : ""}
    <div class="panel">
      <h3>🔗 Origen de las visitas</h3>
      <table class="table"><tbody>${rows(summary.byReferrer.map((r) => `<tr><td>${esc(r.referrer)}</td><td class="num"><b>${r.count}</b></td></tr>`))}</tbody></table>
    </div>
  `;
  el.view.querySelectorAll<HTMLButtonElement>("button[data-days]").forEach((b) => {
    b.addEventListener("click", () => void viewStats(Number(b.dataset.days)));
  });
}

void boot();
