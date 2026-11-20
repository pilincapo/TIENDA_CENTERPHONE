// Pestaña Resumen: estado del catálogo, salud del sync y última corrida.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { esc } from "../../shared/html";
import { SYNC_STEPS, api, el, mostrarBannerPendiente, publicarAhora, refrescarEstadoCatalogo, showProgress, toast } from "./ui";
import type { ProgressCtl } from "./ui";
import { render } from "./router";

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
    // También el estado de publicación: sin esto el polling borraba la fila
    // "Sitio público" del render inicial.
    const [{ state, log, fuentes }, catalogo] = await Promise.all([
      api<{ state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }; log: SyncLogEntry[]; fuentes?: FuenteEstado[] }>(
        `/sync/log?limit=50${dashSyncFilter ? `&trigger=${encodeURIComponent(dashSyncFilter)}` : ""}`
      ),
      api<CatalogStatus>("/catalog-status").catch(() => null as CatalogStatus | null),
    ]);
    stateEl.innerHTML = estadoCatalogoKv(state, catalogo);
    mostrarBannerPendiente(
      Boolean(catalogo?.pending),
      catalogo?.pending && catalogo.pendingAt
        ? `Ultimo cambio sin publicar: ${new Date(catalogo.pendingAt).toLocaleString("es-AR")}. Se publica solo cada 15 minutos (o al instante con publicar ahora).`
        : ""
    );
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
function estadoCatalogoKv(state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }, cat?: CatalogStatus | null): string {
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("es-AR") : "nunca";
  const lastRow = state.lastStatus
    ? `<span class="${state.lastStatus === "ok" ? "ok" : "err"}">${esc(state.lastStatus)}</span>`
    : '<span class="muted">—</span>';
  const errRow = state.lastError ? `\n<span class="k">Error</span><span>${esc(state.lastError)}</span>` : "";
  // Sitio publico: cuando se publico el catalogo y si hay cambios sin publicar.
  const pubRow = (() => {
    if (!cat) return "";
    if (cat.pending && cat.pendingAt) {
      return `\n<span class="k">Sitio público</span><span class="err">Cambios sin publicar (${esc(new Date(cat.pendingAt).toLocaleString("es-AR"))})</span>`;
    }
    const gen = cat.generatedAt ? esc(new Date(cat.generatedAt).toLocaleString("es-AR")) : "nunca";
    return `\n<span class="k">Sitio público</span><span>Publicado ${gen}</span>`;
  })();
  return `<span class="k">Última sincronización</span><span>${esc(last)}</span>\n<span class="k">Resultado</span><span>${lastRow}</span>${errRow}${pubRow}`;
}

/** Estado de publicacion del catalogo publico (lo devuelve /catalog-status). */
interface CatalogStatus {
  pending: boolean;
  pendingAt: number | null;
  generatedAt: number | null;
}


/** Conecta el botón de descartar del aviso (y recuerda el descarte por sesión).
 *  Si aparece un error NUEVO (otra corrida), el aviso vuelve a mostrarse. */
export function bindBannerClose(): void {
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

export async function viewDashboard(syncFilter = ""): Promise<void> {
  dashSyncFilter = syncFilter;
  const [{ state, log, fuentes }, saludRes, catalogo] = await Promise.all([
    api<{ state: { lastSyncAt: number | null; lastStatus: string | null; lastError: string | null }; log: SyncLogEntry[]; fuentes?: FuenteEstado[] }>(
      `/sync/log?limit=50${syncFilter ? `&trigger=${encodeURIComponent(syncFilter)}` : ""}`
    ),
    api<{ salud: SaludSemanalUI }>("/sync/health").catch(() => ({ salud: null as SaludSemanalUI | null })),
    api<CatalogStatus>("/catalog-status").catch(() => null as CatalogStatus | null),
  ]);
  // Si hay cambios sin publicar, el banner global se ve aunque el usuario entre
  // directo al dashboard (o vuelva de otra pestaña).
  mostrarBannerPendiente(
    Boolean(catalogo?.pending),
    catalogo?.pending && catalogo.pendingAt
      ? `Ultimo cambio sin publicar: ${new Date(catalogo.pendingAt).toLocaleString("es-AR")}. Se publica solo cada 15 minutos (o al instante con publicar ahora).`
      : ""
  );
  // Si el error mostrado es el mismo que el usuario ya descartó en esta sesión, no re-mostrar.
  const descartado = sessionStorage.getItem("dashErrorDismissed");
  const bannerVisible = state.lastStatus === "error" && state.lastError !== null && descartado !== String(state.lastSyncAt ?? 0);
  el.view.innerHTML = `
    ${bannerVisible ? dashErrorBanner(state) : ""}
    <div class="panel">
      <h2>Estado del catálogo</h2>
      <div class="kv" id="dash-state">${estadoCatalogoKv(state, catalogo)}</div>
      <div class="row" style="margin-top:16px">
        <button class="btn btn-primary" id="sync-now">⟳ Sincronizar ahora</button>
        <button class="btn" id="rebuild">Publicar catálogo</button>
      </div>
    </div>
    ${fuentesPanel(fuentes ?? [])}
    ${saludRes.salud ? saludPanel(saludRes.salud) : ""}
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Historial de sincronización</h2>
        <select id="sync-filter" aria-label="Filtrar el historial por origen de la sincronización" style="margin-left:auto">
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
  el.view.querySelector("#rebuild")?.addEventListener("click", () => void publicarAhora());
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
  // La sincronización publica el catálogo: el aviso de "sin publicar" ya no aplica.
  mostrarBannerPendiente(false);
  await refrescarEstadoCatalogo();
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
