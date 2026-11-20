// Pestaña Auto-importaciones: fuentes programadas, corrida con progreso
// y formulario de alta/edición.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { esc } from "../../shared/html";
import type { AutoImport } from "../../shared/autoimport";
import type { PriceRule } from "../../shared/pricing";
import { findOverlaps, groupNames } from "../../shared/pricing";
import { isTecnovaSourceUrl, TECNOVA_PUBLIC_URL } from "../../shared/tecnova-url";
import { AUTO_STEPS, api, el, openModal, showProgress, toast } from "./ui";
import type { ProgressCtl } from "./ui";
import { render, route } from "./router";
import { bindBannerClose } from "./dashboard";
import { hourGridHtml } from "./import-repeat";
import { fetchRules } from "./rules";
import { uiState } from "./ui-state";

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

/**
 * Estado de "Ejecutar ahora" que sobrevive al cambio de pestaña: la corrida es una
 * promesa viva en el navegador, así que aunque el usuario se vaya a otra vista y
 * vuelva, la barra se vuelve a pintar con el progreso que tenía.
 */
const autoRun = {
  running: false,
  startedAt: 0,
  pct: 5,
  label: "Preparando…",
  step: 0,
  stepErr: false,
  ctl: null as ProgressCtl | null,
  cancel: false,
  /** Resumen de la corrida terminada, para mostrarlo al volver a la vista. */
  done: null as { text: string; ok: boolean; at: number } | null,
};

/** Actualiza el estado y la barra montada (si la hay). */
function setAutoRun(pct: number, label: string, step: number, stepErr = false): void {
  autoRun.pct = pct;
  autoRun.label = label;
  autoRun.step = step;
  autoRun.stepErr = stepErr;
  autoRun.ctl?.set(pct, label, step, stepErr);
}

/** Pinta (o repinta) la barra de la corrida en curso en el contenedor dado. */
function showAutoRunBox(box: HTMLElement): void {
  box.className = "auto-run-box";
  box.innerHTML = "";
  const prog = showProgress(box, "Ejecutando auto-importaciones…", AUTO_STEPS);
  // Botón de cancelar: con muchas fuentes la corrida dura varios minutos y el
  // usuario necesita poder cortarla sin recargar.
  const wrap = box.querySelector(".progress-wrap") as HTMLElement | null;
  if (wrap) {
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.id = "auto-run-cancel";
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    cancel.style.marginTop = "10px";
    cancel.addEventListener("click", () => {
      autoRun.cancel = true;
      cancel.disabled = true;
      setAutoRun(autoRun.pct, "Cancelando al terminar la fuente actual…", autoRun.step);
    });
    wrap.appendChild(cancel);
  }
  autoRun.ctl = prog;
  prog.set(Math.max(5, autoRun.pct), autoRun.label, autoRun.step, autoRun.stepErr);
}

/** El resumen de una corrida terminada se muestra hasta que el usuario lo ve. */
const AUTO_RUN_DONE_TTL = 5 * 60 * 1000;

/** Al volver a la vista: barra en curso o resumen de lo que terminó. */
function restoreAutoRun(): void {
  // Resumen demasiado viejo (el usuario no volvió en horas): no se muestra.
  if (autoRun.done && Date.now() - autoRun.done.at > AUTO_RUN_DONE_TTL) autoRun.done = null;
  if (!autoRun.running && !autoRun.done) return; // nada que restaurar: no se crea caja
  const anchor = el.view.querySelector(".panel .row");
  if (!anchor) return;
  const box = document.createElement("div");
  box.id = "auto-run-box";
  anchor.after(box);
  if (autoRun.running) {
    showAutoRunBox(box);
    const btn = el.view.querySelector("#run-auto") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    return;
  }
  const done = autoRun.done;
  if (!done) return;
  box.innerHTML = `
    <div class="panel progress-wrap">
      <strong>${done.ok ? "✓ Sincronización terminada" : "⚠ Sincronización terminada con errores"}</strong>
      <div class="progress-label"><span class="${done.ok ? "ok" : "err"}" style="white-space:normal">${esc(done.text)}</span></div>
    </div>`;
  autoRun.done = null; // ya lo vio
}

async function startAutoRun(jobs: AutoImport[]): Promise<void> {
  if (autoRun.running) return;
  const box = document.createElement("div");
  box.id = "auto-run-box";
  el.view.querySelector(".panel .row")?.after(box);
  autoRun.running = true;
  autoRun.cancel = false;
  autoRun.startedAt = Date.now();
  autoRun.done = null;
  autoRun.ctl = null;
  autoRun.pct = 5;
  showAutoRunBox(box);
  setAutoRun(3, "Preparando…", 0);
  const btn = el.view.querySelector("#run-auto") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  const desglose: string[] = [];
  let imported = 0;
  let deact = 0;
  let failed = 0;
  try {
    // Una fuente por request: un único request con todas las fuentes puede morirse
    // por el límite de CPU del plan gratis y dejar la sincronización a medias.
    for (let i = 0; i < jobs.length; i++) {
      if (autoRun.cancel) break;
      const job = jobs[i]!;
      const n = i + 1;
      const frac = i / Math.max(1, jobs.length);
      // Paso 0 = descargando, 1 = extrayendo, 2 = importando (escala sobre la corrida).
      const paso = frac < 0.15 ? 0 : frac < 0.45 ? 1 : 2;
      setAutoRun(Math.round(frac * 96) + 2, `(${n}/${jobs.length}) ${job.label || job.url}…`, paso);
      try {
        const r = await api<{ ok: boolean; result: { ok: boolean; imported: number; deactivated?: number; error: string | null } }>(
          "/sync",
          // skipSnapshot: cada fuente regeneraría el catálogo entero (5.000+ lecturas).
          // Con 21 fuentes seguidas son 21 lecturas completas: al final se regenera una.
          { method: "POST", body: JSON.stringify({ jobId: job.id, skipSnapshot: true }) },
        );
        const res = r.result;
        imported += res.imported;
        deact += res.deactivated ?? 0;
        if (!res.ok) failed++;
        desglose.push(`${corto(job)}: ${res.ok ? `+${res.imported}${res.deactivated ? `/-${res.deactivated}` : ""}` : "error"}`);
      } catch {
        failed++;
        desglose.push(`${corto(job)}: error`);
      }
      // Ir mostrando el avance real: al volver a la vista se ve hasta dónde llegó.
      setAutoRun(Math.round(((i + 1) / Math.max(1, jobs.length)) * 96) + 2,
        `(${n}/${jobs.length}) ${corto(job)} · ${imported} importados`, paso);
    }
    const cancelada = autoRun.cancel;
    const hechas = cancelada ? desglose.length : jobs.length;
    const resumen = `${hechas} de ${jobs.length} fuente(s) · ${imported} importados${deact ? ` · ${deact} sin stock` : ""}${desglose.length ? ` · ${desglose.join(" · ")}` : ""}`;
    const ok = !cancelada && failed === 0;
    setAutoRun(100, resumen, 3, failed > 0 || cancelada);
    autoRun.done = { text: cancelada ? `Cancelada — ${resumen}` : resumen, ok, at: Date.now() };
    if (!cancelada) {
      toast(`Listo: ${imported} productos, ${failed} con error${deact ? `. ${deact} ya no están en las fuentes (sin stock)` : ""}`, ok);
    } else {
      toast(`Sincronización cancelada (${hechas}/${jobs.length} fuentes)`, false);
    }
    // Refrescar los lastRun de las filas sin re-render completo (si seguimos en esta vista).
    if (route() === "auto") await refreshAutoLastRuns();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    setAutoRun(100, msg, 1, true);
    toast(msg, false);
    autoRun.done = { text: msg, ok: false, at: Date.now() };
  } finally {
    // Aunque se haya cancelado o alguna fuente haya fallado, el catálogo tiene que
    // quedar consistente con lo que se importó: se regenera una sola vez.
    if (desglose.length > 0) {
      try {
        await api("/snapshot", { method: "POST", body: "{}" });
      } catch { /* el snapshot se regenera igual en la próxima importación */ }
    }
    autoRun.running = false;
    autoRun.ctl = null;
    document.getElementById("auto-run-cancel")?.remove();
    const btn2 = el.view.querySelector("#run-auto") as HTMLButtonElement | null;
    if (btn2) btn2.disabled = false;
    // La caja visible se va sola si el usuario sigue en esta vista; el resumen
    // guardado (autoRun.done) se conserva para mostrarlo si vuelve más tarde.
    setTimeout(() => { if (box.isConnected) box.remove(); }, 12_000);
  }
}

/** Etiqueta corta de un job para el texto de progreso y el resumen. */
function corto(job: AutoImport): string {
  return (job.label || job.url.replace(/^https?:\/\//, "").replace("www.", "")).slice(0, 22);
}

export async function viewAutoImports(): Promise<void> {
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
  // Insignia de la fuente exclusiva de Tecnova (su web no se puede leer por URL).
  const tecnovaBadge = (url: string): string => isTecnovaSourceUrl(url)
    ? ' <span class="badge badge--src badge--src-tecnova" title="Fuente exclusiva: se sincroniza con la API oficial de Tecnova (catálogo completo)">🛰️<span class="badge-src-name"> Tecnova</span></span>'
    : "";
  const rows = jobs
    .map((j) => {
      const atrasado = j.active && j.times.length > 0 && j.lastRunAt != null && Date.now() - j.lastRunAt > staleMs;
      return `
      <tr data-autourl="${esc(j.url)}"${atrasado ? ' style="background:rgba(220,60,60,.08)"' : ""}>
        <td>
          <label class="checks"><input type="checkbox" class="auto-active" data-id="${esc(j.id)}" ${j.active ? "checked" : ""}/> Activa</label>
        </td>
        <td><strong>${esc(j.label || j.url)}</strong>${tecnovaBadge(j.url)}<br/><span class="muted" style="font-size:12px">${esc(j.url)}</span></td>
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
      importar solo en esos momentos, todos los días. También podés dar de alta la fuente exclusiva de
      <strong>Tecnova</strong> (catálogo completo vía su API oficial): con <strong>+ Nueva → Fuente: Tecnova</strong> o desde
      el botón ⏰ de la pestaña Importar.</p>
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
  el.view.querySelector("#run-auto")?.addEventListener("click", () => void startAutoRun(jobs));
  // Si había una corrida en curso y el usuario volvió a la pestaña, se repinta la barra.
  restoreAutoRun();
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
  // Vinimos de Importar con "⏰ Programar actualización": se abre el formulario
  // con la fuente de Tecnova ya elegida.
  if (uiState.pendingAutoFuente) {
    const f = uiState.pendingAutoFuente;
    uiState.pendingAutoFuente = null;
    openAutoForm(null, rules, groups, f);
  }
}

/** Grilla de 24 horarios (hora Argentina) reutilizable: modal de auto-importaciones
 *  y box "Repetir automáticamente" de Importar. Marca los horarios de `times`. */
function openAutoForm(job: AutoImport | null, rules: PriceRule[], groups: string[], fuenteInicial?: "url" | "tecnova"): void {
  const fuentePre = fuenteInicial ?? (isTecnovaSourceUrl(job?.url ?? "") ? "tecnova" : "url");
  const back = openModal(`
    <h2>${job ? "Editar auto-importación" : "Nueva auto-importación"}</h2>
    <form id="a-form">
      <div class="field"><label>Fuente</label>
        <select name="fuente" id="a-fuente">
          <option value="url" ${fuentePre === "url" ? "selected" : ""}>🔗 Link de catálogo (cualquier URL)</option>
          <option value="tecnova" ${fuentePre === "tecnova" ? "selected" : ""}>🛰️ Tecnova — catálogo completo (API oficial)</option>
        </select></div>
      <div class="field"><label>Link del catálogo o producto</label>
        <input name="url" required value="${esc(job?.url ?? "")}" placeholder="https://…"/>
        <p class="muted" id="a-url-hint" hidden style="margin-top:6px"></p></div>
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
  // Fuente exclusiva de Tecnova: la URL se fija y queda en solo lectura (su web es
  // una SPA sin productos en el HTML; el worker la ejecuta contra la API oficial).
  const urlInput = back.querySelector('input[name="url"]') as HTMLInputElement;
  const fuenteSel = back.querySelector("#a-fuente") as HTMLSelectElement;
  const urlHint = back.querySelector("#a-url-hint") as HTMLElement;
  const aplicarFuente = (): void => {
    const tecnova = fuenteSel.value === "tecnova";
    urlInput.readOnly = tecnova;
    if (tecnova) {
      urlInput.value = TECNOVA_PUBLIC_URL;
      urlHint.textContent = "Se sincroniza con la API oficial de Tecnova (catálogo completo): su web no publica los productos en el HTML, por eso esta fuente no usa una URL genérica.";
      urlHint.hidden = false;
    } else {
      if (urlInput.value === TECNOVA_PUBLIC_URL) urlInput.value = "";
      urlHint.hidden = true;
      urlHint.textContent = "";
    }
  };
  fuenteSel.addEventListener("change", aplicarFuente);
  aplicarFuente();
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
