// Pestaña Visitas: resumen de tráfico, gráfico por día y tooltips.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import { api, el } from "./ui";

// ---- Tooltip de gráficos ----
// Antes cada dato del gráfico dependía del <title> nativo del SVG: hay que
// apuntar justo a un punto de 2,5 px y esperar un segundo a que aparezca. Con
// esto el valor sale al instante al pasar por la zona del dato, y las barras
// muestran su número también al posarse encima.
let tipEl: HTMLElement | null = null;

function tipNode(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "st-tip";
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function placeTip(clientX: number, clientY: number): void {
  const t = tipNode();
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const x = clientX + 14 + r.width > window.innerWidth ? clientX - r.width - 14 : clientX + 14;
  const y = Math.min(Math.max(8, clientY - r.height - 12), window.innerHeight - r.height - 8);
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}

function hideTip(): void {
  if (tipEl) tipEl.hidden = true;
}

/** Conecta el tooltip a todo lo que traiga `data-tip` dentro de `root`. */
function bindTips(root: ParentNode): void {
  for (const n of Array.from(root.querySelectorAll<HTMLElement>("[data-tip]"))) {
    const txt = n.dataset.tip ?? "";
    n.addEventListener("mouseenter", (e) => {
      const t = tipNode();
      t.textContent = txt;
      placeTip(e.clientX, e.clientY);
    });
    n.addEventListener("mousemove", (e) => placeTip(e.clientX, e.clientY));
    n.addEventListener("mouseleave", hideTip);
  }
}

/** Máximo "redondo" para el eje: 27 visitas → 30, 124 → 150 (si no, 125). */
function niceMax(v: number): number {
  if (v <= 5) return Math.max(1, v);
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const s of [1, 1.5, 2, 3, 4, 5, 7.5, 10]) {
    if (v <= s * mag) return Math.round(s * mag);
  }
  return 10 * mag;
}

/** "2026-09-26" → "sáb 26/09" */
function diaCorto(d: string): string {
  const f = new Date(`${d}T00:00:00`);
  return Number.isNaN(f.getTime())
    ? d
    : f.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// Datos de cada gráfico por id (el SVG va serializado a HTML: los números en un
// dataset JSON sería más frágil que guardar un mapa en memoria).
const chartData = new Map<string, { txt: string; x: number; y: number }[]>();
let chartSeq = 0;

// Gráfico de líneas SVG por día: sin librerías. Cada día tiene una columna
// invisible que dispara el tooltip (es imposible acertarle a un punto de
// 2,5 px) y el eje Y va rotulado, así se sabe qué altura representa cada línea.
const DAY_W = 720, DAY_H = 170, DAY_PADL = 36, DAY_PADB = 22, DAY_PADT = 12;

function dayChart(byDay: { day: string; views: number }[]): string {
  const W = DAY_W, H = DAY_H, PADL = DAY_PADL, PADB = DAY_PADB, PADT = DAY_PADT;
  const n = byDay.length;
  if (n < 2) return `<p class="muted">Sin datos suficientes todavía.</p>`;
  const max = niceMax(Math.max(1, ...byDay.map((d) => d.views)));
  const x = (i: number): number => PADL + (i / (n - 1)) * (W - PADL - 8);
  const y = (v: number): number => PADT + (1 - v / max) * (H - PADT - PADB);
  const pts = byDay.map((d, i) => `${x(i).toFixed(1)},${y(d.views).toFixed(1)}`).join(" ");
  const area = `${PADL},${y(0)} ${pts} ${x(n - 1).toFixed(1)},${y(0)}`;
  const step = Math.max(1, Math.ceil(n / 8));
  // El primer y el último rótulo se anclan a los bordes: con text-anchor middle
  // el de la derecha se salía del viewBox y quedaba cortado ("02/1").
  const labels = byDay
    .map((d, i) => {
      if (!(i % step === 0 || i === n - 1)) return "";
      const txt = `${d.day.slice(8)}/${d.day.slice(5, 7)}`;
      const anchor = i === n - 1 ? " end" : i === 0 ? " start" : "";
      return `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="st-xlabel" style="text-anchor:${anchor.trim() || "middle"}">${txt}</text>`;
    })
    .join("");
  const dots = byDay
    .map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d.views).toFixed(1)}" r="2.5" class="st-dot"/>`)
    .join("");
  const grid = [max, max / 2]
    .map((v) => `<line x1="${PADL}" y1="${y(v).toFixed(1)}" x2="${W - 8}" y2="${y(v).toFixed(1)}" class="st-grid"/>
      <text x="${PADL - 6}" y="${(y(v) + 4).toFixed(1)}" class="st-ylabel">${Math.round(v)}</text>`)
    .join("");
  const id = `stc${++chartSeq}`;
  chartData.set(
    id,
    byDay.map((d, i) => ({
      txt: `${diaCorto(d.day)} · ${d.views} visita${d.views === 1 ? "" : "s"}`,
      x: x(i),
      y: y(d.views),
    }))
  );
  const aria = byDay.map((d) => `${diaCorto(d.day)}: ${d.views}`).join("; ");
  return `<svg viewBox="0 0 ${W} ${H}" class="st-daychart" data-chart="${id}" role="img"
      aria-label="Visitas por día. ${esc(aria)}">
    ${grid}
    <line x1="${PADL}" y1="${y(0).toFixed(1)}" x2="${W - 8}" y2="${y(0).toFixed(1)}" class="st-grid"/>
    <text x="${PADL - 6}" y="${(y(0) + 4).toFixed(1)}" class="st-ylabel">0</text>
    <polygon points="${area}" class="st-area"/>
    <polyline points="${pts}" class="st-line"/>
    ${dots}${labels}
    <g class="st-hover" hidden>
      <line class="st-cross" y1="${PADT}" y2="${y(0).toFixed(1)}"/>
      <circle class="st-focus" r="4.5"/>
    </g>
  </svg>`;
}

/** Al mover el mouse sobre el gráfico: marca el día más cercano y muestra su valor. */
function bindDayChart(root: ParentNode): void {
  const svg = root.querySelector<SVGSVGElement & HTMLElement>(".st-daychart");
  if (!svg) return;
  const datos = chartData.get(svg.dataset.chart ?? "");
  const grupo = svg.querySelector<HTMLElement>(".st-hover");
  const cross = svg.querySelector<HTMLElement>(".st-cross");
  const focus = svg.querySelector<HTMLElement>(".st-focus");
  const lectura = svg.closest<HTMLElement>(".panel")?.querySelector<HTMLElement>(".st-dayrow");
  if (!datos || datos.length === 0 || !grupo || !cross || !focus) return;
  const locate = (clientX: number, clientY: number): number => {
    const m = svg.getScreenCTM();
    if (!m) return -1;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    let mejor = 0;
    let dist = Infinity;
    for (let i = 0; i < datos.length; i++) {
      const d = Math.abs(datos[i]!.x - p.x);
      if (d < dist) {
        dist = d;
        mejor = i;
      }
    }
    return mejor;
  };
  const pick = (i: number): void => {
    const d = datos[i];
    if (!d) return;
    grupo.hidden = false;
    cross.setAttribute("x1", d.x.toFixed(1));
    cross.setAttribute("x2", d.x.toFixed(1));
    focus.setAttribute("cx", d.x.toFixed(1));
    focus.setAttribute("cy", d.y.toFixed(1));
    if (lectura) lectura.textContent = d.txt;
  };
  svg.addEventListener("mousemove", (e) => {
    const i = locate(e.clientX, e.clientY);
    if (i < 0) return;
    pick(i);
    const t = tipNode();
    t.textContent = datos[i]!.txt;
    placeTip(e.clientX, e.clientY);
  });
  svg.addEventListener("mouseleave", () => {
    grupo.hidden = true;
    hideTip();
    if (lectura) lectura.textContent = "";
  });
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

export async function viewStats(days = 7): Promise<void> {
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
      <p class="muted">Cada punto es un día y la altura de la línea son las visitas de ese día (eje izquierdo). Pasá el mouse por el gráfico para ver el número exacto.</p>
      ${dayChart(summary.byDay)}
      <p class="muted st-dayrow" style="min-height:18px;margin:6px 0 0"></p>
    </div>
    <div class="panel">
      <h3>🕒 Visitas por hora (Argentina)</h3>
      <p class="muted">La barra más larga es la hora con más visitas (${maxHour}). Pasá el mouse por una barra para ver el número.</p>
      <div class="st-hours">${summary.byHour.map((h) => `<div class="st-hour" data-tip="${String(h.hour).padStart(2, "0")}:00–${String(h.hour).padStart(2, "0")}:59 · ${h.views} visita${h.views === 1 ? "" : "s"}"><span class="st-hlabel">${String(h.hour).padStart(2, "0")}h</span>${bar(h.views)}</div>`).join("")}</div>
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
  // Hover del gráfico por día y tooltip de todas las barras.
  bindDayChart(el.view);
  bindTips(el.view);
}
