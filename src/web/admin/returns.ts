// Pestaña Devoluciones: lista, detalle y cambio de estado.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import { normalizePhone } from "../../shared/whatsapp";
import { CONTACT_KIND_LABEL, KIND_LABEL, RETURN_STATUSES, STATUS_LABEL, type AdminReturn, type AdminReturnDetail, type ReturnStatus } from "../../shared/returns";
import { api, el, openModal, toast, updateTabBadge } from "./ui";

// ---- Devoluciones (ETAPA 3) ----
// Solicitudes que entran por /devoluciones. Acá sí se ven los datos de contacto:
// el comercio los necesita para responder y para cambiar el estado que el
// cliente sigue en /devoluciones/seguimiento/:token.

interface ReturnsPage {
  returns: AdminReturn[];
  total: number;
  page: number;
  pages: number;
  limit: number;
  counts: Record<string, number>;
}

const retState = { status: "" as "" | ReturnStatus, page: 1, q: "" };
let retFocus = false;

const RETURN_STATUS_CLS: Record<ReturnStatus, string> = {
  recibida: "ret-recibida",
  en_revision: "ret-revision",
  aprobada: "ret-aprobada",
  resuelta: "ret-resuelta",
  cerrada: "ret-cerrada",
};

function fechaCorta(ms: number): string {
  return new Date(ms).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export async function viewReturns(statusFilter = ""): Promise<void> {
  if (statusFilter !== retState.status) {
    retState.status = statusFilter as "" | ReturnStatus;
    retState.page = 1;
    retState.q = "";
  }
  el.view.innerHTML = `<div class="panel"><h2>↩ Devoluciones</h2><p class="muted">Cargando…</p></div>`;
  const fetchPage = async (): Promise<ReturnsPage> => {
    const params = new URLSearchParams({ page: String(retState.page), limit: "50", status: retState.status });
    if (retState.q !== "") params.set("q", retState.q);
    return api<ReturnsPage>(`/returns?${params.toString()}`);
  };
  let data = await fetchPage();
  let guard = 0;
  while (data.returns.length === 0 && retState.page > 1 && guard++ < 3) {
    retState.page = Math.max(1, Math.min(retState.page - 1, data.pages));
    data = await fetchPage();
  }
  const counts = data.counts ?? {};
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);
  updateTabBadge("returns", counts.recibida ?? 0, "solicitudes nuevas");

  const chip = (s: string, label: string, n: number): string =>
    `<button class="chip ${s === retState.status ? "on" : ""}" data-ret-filter="${s}">${label} <span class="muted">${n}</span></button>`;
  const rows = data.returns.map((r) => {
    const tel = r.contactKind === "wa" ? normalizePhone(r.contact) : "";
    const contact = r.contactKind === "wa"
      ? tel.length >= 8
        ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener">${esc(r.contact)}</a>`
        : esc(r.contact)
      : `<a href="mailto:${esc(r.contact)}">${esc(r.contact)}</a>`;
    return `
    <tr>
      <td><b class="ret-code">${esc(r.code)}</b><br><small class="muted">${fechaCorta(r.createdAt)}</small></td>
      <td>${esc(r.name)}<br><small class="muted">${contact}</small></td>
      <td><small>${esc(KIND_LABEL[r.kind])}</small><br><small class="muted">${r.orderRef ? `Pedido ${esc(r.orderRef)}` : ""}${r.orderRef && r.product ? " · " : ""}${r.product ? esc(r.product) : ""}</small></td>
      <td><span class="ord-badge ${RETURN_STATUS_CLS[r.status]}">${STATUS_LABEL[r.status]}</span>${r.response ? `<br><small class="muted" title="Respuesta publicada">✉ Ya respondida</small>` : ""}</td>
      <td class="ord-actions"><button class="btn" data-ret-open="${esc(r.id)}">Abrir</button></td>
    </tr>`;
  }).join("");

  el.view.innerHTML = `
    <div class="panel">
      <div class="stats-head">
        <h2>↩ Devoluciones</h2>
        <div class="stats-range">
          ${chip("", "Todas", totalAll)}
          ${RETURN_STATUSES.map((s) => chip(s, STATUS_LABEL[s], counts[s] ?? 0)).join("")}
        </div>
      </div>
      <p class="muted">Pedidos de cambio, devolución, garantía y arrepentimiento. El cliente sigue el estado con su código en <code>/devoluciones/seguimiento/…</code>; lo que escribas en «Respuesta» aparece en esa página.</p>
      <div class="row" style="margin-top:10px; align-items:center">
        <input id="ret-search" type="search" placeholder="Buscar por código, nombre, contacto, pedido o producto…" aria-label="Buscar solicitudes" autocomplete="off" value="${esc(retState.q)}" style="max-width:320px"/>
        <button class="btn" id="ret-refresh" style="margin-left:auto">⟳ Actualizar</button>
      </div>
      ${data.returns.length === 0
        ? `<p class="muted">No hay solicitudes${retState.status !== "" ? ` en estado «${STATUS_LABEL[retState.status as ReturnStatus]}»` : ""}${retState.q !== "" ? ` buscando "${esc(retState.q)}"` : ""}.</p>`
        : `<table class="table ord-table">
            <thead><tr><th>Código</th><th>Cliente</th><th>Tipo / producto</th><th>Estado</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`}
      ${data.returns.length > 0 ? `
      <div class="pager">
        <button class="btn" id="ret-prev" ${data.page <= 1 ? "disabled" : ""}>‹ Anterior</button>
        <span class="muted">Página ${data.page} de ${data.pages} — ${data.total} solicitud${data.total !== 1 ? "es" : ""}</span>
        <button class="btn" id="ret-next" ${data.page >= data.pages ? "disabled" : ""}>Siguiente ›</button>
      </div>` : ""}
    </div>`;

  el.view.querySelectorAll<HTMLButtonElement>("button[data-ret-filter]").forEach((b) => {
    b.addEventListener("click", () => void viewReturns(b.dataset.retFilter ?? ""));
  });
  el.view.querySelector("#ret-prev")?.addEventListener("click", () => {
    if (retState.page > 1) { retState.page -= 1; void viewReturns(retState.status); }
  });
  el.view.querySelector("#ret-next")?.addEventListener("click", () => {
    if (retState.page < data.pages) { retState.page += 1; void viewReturns(retState.status); }
  });
  el.view.querySelector("#ret-refresh")?.addEventListener("click", () => void viewReturns(retState.status));

  const search = el.view.querySelector("#ret-search") as HTMLInputElement | null;
  let searchTimer: number | undefined;
  search?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const q = (search.value ?? "").trim();
      if (q === retState.q) return;
      retState.q = q;
      retState.page = 1;
      retFocus = true;
      void viewReturns(retState.status);
    }, 350);
  });
  if (retFocus && search) {
    retFocus = false;
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }

  el.view.querySelectorAll<HTMLButtonElement>("button[data-ret-open]").forEach((b) => {
    b.addEventListener("click", () => void openReturnDetail(b.dataset.retOpen ?? ""));
  });
}

async function openReturnDetail(id: string): Promise<void> {
  let detail: AdminReturnDetail;
  try {
    const r = await api<{ request: AdminReturnDetail }>(`/returns/${encodeURIComponent(id)}`);
    detail = r.request;
  } catch (e) {
    toast(e instanceof Error ? e.message : "Error", false);
    return;
  }
  const tel = detail.contactKind === "wa" ? normalizePhone(detail.contact) : "";
  const contactLink = detail.contactKind === "wa"
    ? tel.length >= 8
      ? `<a class="btn" href="https://wa.me/${tel}" target="_blank" rel="noopener">💬 Abrir WhatsApp</a>`
      : esc(detail.contact)
    : `<a class="btn" href="mailto:${esc(detail.contact)}">✉ Enviar email</a>`;
  const hist = detail.history.length === 0
    ? `<p class="muted">Sin movimientos registrados.</p>`
    : `<ol class="ret-hist">${detail.history.map((h) => `<li><b>${esc(h.label)}</b> <span class="muted">${fechaCorta(h.at)}</span>${h.note ? `<br><small class="muted">${esc(h.note)}</small>` : ""}</li>`).join("")}</ol>`;

  const modal = openModal(`
    <div class="modal-card" style="max-width:620px">
      <h3>${esc(detail.code)} · ${esc(KIND_LABEL[detail.kind])}</h3>
      <p class="muted" style="margin:4px 0 12px">Recibida el ${fechaCorta(detail.createdAt)} · Última actualización ${fechaCorta(detail.updatedAt)}</p>
      <table class="table" style="margin-bottom:12px">
        <tbody>
          <tr><th style="width:130px">Cliente</th><td>${esc(detail.name)}</td></tr>
          <tr><th>${CONTACT_KIND_LABEL[detail.contactKind]}</th><td>${esc(detail.contact)}</td></tr>
          <tr><th>Pedido</th><td>${detail.orderRef ? esc(detail.orderRef) : "—"}</td></tr>
          <tr><th>Producto</th><td>${detail.product ? esc(detail.product) : "—"}</td></tr>
          <tr><th>Comentario</th><td style="white-space:pre-wrap">${detail.detail ? esc(detail.detail) : "—"}</td></tr>
        </tbody>
      </table>
      <div class="row" style="margin-bottom:14px">${contactLink}</div>
      <div class="field">
        <label for="ret-status">Estado</label>
        <select id="ret-status">${RETURN_STATUSES.map((s) => `<option value="${s}" ${s === detail.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label for="ret-response">Respuesta (se muestra en el seguimiento del cliente)</label>
        <textarea id="ret-response" rows="4" maxlength="1000" placeholder="Ej.: Aprobamos el cambio. Pasá por el local con el producto y el código.">${esc(detail.response ?? "")}</textarea>
      </div>
      <h4 style="margin:14px 0 6px; font-size:13px">Historial</h4>
      ${hist}
      <div class="row" style="margin-top:16px">
        <button class="btn btn-primary" id="ret-save">Guardar cambios</button>
        <button class="btn" id="ret-close">Cerrar</button>
      </div>
    </div>`);

  modal.querySelector("#ret-close")?.addEventListener("click", () => modal.remove());
  const save = modal.querySelector("#ret-save") as HTMLButtonElement;
  save.addEventListener("click", async () => {
    const status = (modal.querySelector("#ret-status") as HTMLSelectElement).value;
    const response = (modal.querySelector("#ret-response") as HTMLTextAreaElement).value;
    save.disabled = true;
    save.textContent = "Guardando…";
    try {
      await api(`/returns/${encodeURIComponent(detail.id)}`, { method: "PATCH", body: JSON.stringify({ status, response }) });
      toast("Solicitud actualizada");
      modal.remove();
      void viewReturns(retState.status);
    } catch (e) {
      save.disabled = false;
      save.textContent = "Guardar cambios";
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });
}

