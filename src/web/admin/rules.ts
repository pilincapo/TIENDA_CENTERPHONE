// Pestaña Reglas de precio: listado, formulario de regla y de escala.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import type { PriceRule } from "../../shared/pricing";
import { findOverlaps, groupNames } from "../../shared/pricing";
import { api, el, formatPriceAdmin, openModal, toast } from "./ui";
import { render } from "./router";

// ---- Reglas de precios ----

export async function fetchRules(): Promise<PriceRule[]> {
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

export async function viewRules(): Promise<void> {
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
  const grupos = groupNames(rules);
  const sueltas = rules.filter((r) => !r.groupName);
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Reglas de precios</h2>
        <button class="btn" id="new-rule" style="margin-left:auto">+ Regla suelta</button>
        <button class="btn btn-primary" id="new-escala" style="margin-left:8px">+ Nueva escala (grupo)</button>
      </div>
      <p class="muted" style="margin-bottom:0">Durante cada importación, si el precio del producto cae dentro del rango de una regla activa,
      se le aplica el recargo automáticamente. Las <strong>escalas</strong> (grupos de rangos, ej: 40-30-20) se eligen completas en Importar
      — así cada fuente puede usar su propia escala. Si varias reglas coinciden, gana la de mayor prioridad.</p>
      ${overlaps.length > 0 ? `<div class="panel" style="border:1px solid #e5a50a; margin-top:12px">
        <strong style="color:#e5a50a">⚠️ Rangos superpuestos (${overlaps.length})</strong>
        <ul style="margin:8px 0 0 18px" class="muted">${overlapWarnings}</ul>
        <p class="muted" style="margin:8px 0 0">Recomendación: ajustá los rangos para que no se pisen (los límites deben quedar contiguos: $0–$10.000, $10.001–…),
        o desactivá la regla que sobra.</p>
      </div>` : ""}
      ${rules.length === 0 ? '<p class="muted">Todavía no hay reglas. Creá una escala, ej: 40-30-20 con tres rangos.</p>' : `
      ${grupos.map((g) => {
        const escala = rules.filter((x) => (x.groupName ?? "") === g).sort((a, b) => a.minCents - b.minCents);
        const activa = escala.every((x) => x.active);
        return `
        <div class="panel" style="margin-top:14px">
          <div class="row">
            <h3 style="margin:0">🗂️ ${esc(g)} <span class="muted" style="font-weight:normal">(${escala.length} rangos)</span></h3>
            <span class="muted" style="margin-left:12px">Escala elegible completa en Importar</span>
            <span class="${activa ? "ok" : "muted"}" style="margin-left:12px">${activa ? "Activa" : "Con rangos inactivos"}</span>
            <button class="btn btn-escala-edit" data-g="${esc(g)}" style="margin-left:auto">Editar escala</button>
            <button class="btn btn-danger btn-escala-del" data-g="${esc(g)}" style="margin-left:8px">Borrar escala</button>
          </div>
          <div class="table-scroll" style="margin-top:8px">
          <table class="table">
            <thead><tr><th>Rango</th><th>Recargo</th><th>Activo</th><th></th></tr></thead>
            <tbody>
              ${escala.map((r) => `
              <tr${conflictedIds.has(r.id) ? ' style="background:rgba(229,165,10,0.08)"' : ""}>
                <td>${esc(r.name)}</td>
                <td class="${r.percent >= 0 ? "ok" : "err"}">${r.percent >= 0 ? "+" : ""}${r.percent}%</td>
                <td class="${r.active ? "ok" : "muted"}">${r.active ? "Sí" : "No"}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-rule-edit" data-id="${esc(r.id)}">Editar</button>
                  <button class="btn btn-danger btn-rule-del" data-id="${esc(r.id)}">Borrar</button>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
          </div>
        </div>`;
      }).join("")}
      ${sueltas.length > 0 ? `
      <div class="panel" style="margin-top:14px">
        <div class="row"><h3 style="margin:0">Reglas sueltas <span class="muted" style="font-weight:normal">(fuera de escala)</span></h3></div>
        <div class="table-scroll" style="margin-top:8px">
        <table class="table">
          <thead><tr><th>Regla</th><th>Rango</th><th>Recargo</th><th>Prioridad</th><th>Activa</th><th></th></tr></thead>
          <tbody>
            ${sueltas.map((r) => `
              <tr${conflictedIds.has(r.id) ? ' style="background:rgba(229,165,10,0.08)"' : ""}>
                <td><strong>${esc(r.name)}</strong></td>
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
        </table>
        </div>
      </div>` : ""}
      `}
    </div>`;
  el.view.querySelector("#new-rule")?.addEventListener("click", () => void openRuleForm(null));
  el.view.querySelector("#new-escala")?.addEventListener("click", () => void openEscalaForm(null));
  el.view.querySelectorAll(".btn-escala-edit").forEach((b) => {
    b.addEventListener("click", () => void openEscalaForm((b as HTMLElement).dataset.g ?? ""));
  });
  el.view.querySelectorAll(".btn-escala-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const g = (b as HTMLElement).dataset.g ?? "";
      const miembros = rules.filter((x) => (x.groupName ?? "") === g);
      if (!g || !confirm(`¿Borrar la escala "${g}" con sus ${miembros.length} rangos?`)) return;
      try {
        for (const m of miembros) {
          await api(`/price-rules/${encodeURIComponent(m.id)}`, { method: "DELETE" });
        }
        toast(`Escala "${g}" borrada (${miembros.length} rangos)`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void render();
    });
  });
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

/**
 * Formulario de escala (grupo de reglas por rangos): crea o edita todos los
 * rangos de una vez. Ej: "Escala Tecnova" con $0–$5.000 → +50%, $5.000–$10.000
 * → +40%, $10.000+ → +30%. Al guardar hace POST/PUT de cada rango en serie.
 */
async function openEscalaForm(groupName: string | null): Promise<void> {
  const existente = groupName !== null ? rulesCache.filter((r) => (r.groupName ?? "") === groupName) : [];
  const nombre = groupName ?? "";
  const back = openModal(`
    <h2>${existente.length > 0 ? `Editar escala: ${esc(nombre)}` : "Nueva escala (grupo de rangos)"}</h2>
    <form id="e-form">
      <div class="field"><label>Nombre de la escala (ej: Tecnova, Mayorista 2026)</label>
        <input name="gname" required value="${esc(nombre)}" ${existente.length > 0 ? "readonly" : ""}/></div>
      <p class="muted">Cada fila es un rango de precio con su recargo. El último puede quedar sin máximo («en adelante»).
      Al importar con esta escala, cada producto toma el recargo del rango donde cae su precio.</p>
      <div id="e-rows">
        ${(existente.length > 0 ? existente : []).map((r) => `
        <div class="e-row row" style="gap:8px; margin-bottom:8px">
          <input class="e-min" type="number" min="0" step="1" placeholder="mín $" value="${r.minCents / 100}" style="width:110px" required/>
          <input class="e-max" type="number" min="0" step="1" placeholder="máx $ (vacío = ∞)" value="${r.maxCents != null ? r.maxCents / 100 : ""}" style="width:150px"/>
          <input class="e-pct" type="number" step="0.1" placeholder="recargo %" value="${r.percent}" style="width:110px" required/>
          <input class="e-name" type="text" placeholder="nombre del rango (opcional)" value="${esc(r.name)}" style="flex:1"/>
          <button type="button" class="btn btn-danger e-del">✕</button>
        </div>`).join("")}
      </div>
      <button type="button" class="btn" id="e-add">+ Agregar rango</button>
      <p class="error" id="e-error" hidden></p>
      <div class="row" style="margin-top:10px">
        <button type="submit" class="btn btn-primary">Guardar escala</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);
  const form = back.querySelector("#e-form") as HTMLFormElement;
  const rowsEl = back.querySelector("#e-rows") as HTMLElement;
  const addRow = (min = "", max = "", pct = ""): void => {
    const div = document.createElement("div");
    div.className = "e-row row";
    div.style.cssText = "gap:8px; margin-bottom:8px";
    div.innerHTML = `
      <input class="e-min" type="number" min="0" step="1" placeholder="mín $" value="${min}" style="width:110px" required/>
      <input class="e-max" type="number" min="0" step="1" placeholder="máx $ (vacío = ∞)" value="${max}" style="width:150px"/>
      <input class="e-pct" type="number" step="0.1" placeholder="recargo %" value="${pct}" style="width:110px" required/>
      <input class="e-name" type="text" placeholder="nombre del rango (opcional)" style="flex:1"/>
      <button type="button" class="btn btn-danger e-del">✕</button>`;
    rowsEl.appendChild(div);
  };
  back.querySelector("#e-add")?.addEventListener("click", () => addRow());
  rowsEl.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.classList.contains("e-del")) t.closest(".e-row")?.remove();
  });
  // Precargar una fila vacía si es nueva y no hay ninguna
  if (existente.length === 0 && rowsEl.children.length === 0) addRow("0", "", "40");
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const gname = String((form.querySelector('[name="gname"]') as HTMLInputElement).value).trim();
    const errEl = back.querySelector("#e-error") as HTMLElement;
    const filas = [...back.querySelectorAll(".e-row")].map((row) => {
      const min = Number((row.querySelector(".e-min") as HTMLInputElement).value);
      const maxRaw = (row.querySelector(".e-max") as HTMLInputElement).value.trim();
      const max = maxRaw === "" ? null : Number(maxRaw);
      const pct = Number((row.querySelector(".e-pct") as HTMLInputElement).value);
      const name = (row.querySelector(".e-name") as HTMLInputElement).value.trim();
      return { min, max, pct, name };
    }).filter((f) => Number.isFinite(f.min) && Number.isFinite(f.pct));
    if (gname === "" || filas.length === 0) {
      errEl.textContent = "Ponele nombre a la escala y al menos un rango con recargo.";
      errEl.hidden = false;
      return;
    }
    try {
      // Editar: borrar los rangos viejos que ya no están y actualizar/crear los nuevos.
      const viejos = groupName !== null ? rulesCache.filter((r) => (r.groupName ?? "") === groupName) : [];
      const bodyFor = (f: (typeof filas)[number], i: number) => ({
        name: f.name !== "" ? f.name : `${gname}: ${formatPriceAdmin(f.min * 100)}${f.max != null ? `–${formatPriceAdmin(f.max * 100)}` : " en adelante"}`,
        groupName: gname,
        minCents: Math.round(f.min * 100),
        maxCents: f.max != null ? Math.round(f.max * 100) : null,
        percent: f.pct,
        priority: i + 1,
        active: true,
      });
      if (viejos.length > 0) {
        for (const v of viejos) await api(`/price-rules/${encodeURIComponent(v.id)}`, { method: "DELETE" });
      }
      for (let i = 0; i < filas.length; i++) {
        await api("/price-rules", { method: "POST", body: JSON.stringify(bodyFor(filas[i]!, i)) });
      }
      back.remove();
      toast(`Escala "${gname}" guardada (${filas.length} rangos)`);
      void render();
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}
