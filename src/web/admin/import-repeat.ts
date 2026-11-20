// Piezas que comparten Importar y Auto-importaciones: regla elegida,
// grilla de horarios y box «Repetir automáticamente».
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import { api, el, toast } from "./ui";
import type { PreviewResponse } from "./import";

export function currentRuleId(): string | null {
  const sel = el.view.querySelector("#imp-rule") as HTMLSelectElement | null;
  return sel && sel.value !== "" ? sel.value : null;
}
/** Grilla de 24 horarios (hora Argentina) reutilizable: modal de auto-importaciones
 *  y box "Repetir automáticamente" de Importar. Marca los horarios de `times`. */
export function hourGridHtml(id: string, times: string[]): string {
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
export function renderRepeatBox(r: PreviewResponse, sourceUrl: string): string {
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
export function bindRepeatBox(scope: HTMLElement): void {
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
