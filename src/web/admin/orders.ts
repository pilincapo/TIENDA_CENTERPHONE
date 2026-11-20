// Pestaña Pedidos: lista paginada, filtros por estado y acciones por pedido.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { formatPrice } from "../../shared/format";
import { esc } from "../../shared/html";
import { normalizePhone } from "../../shared/whatsapp";
import { api, el, openModal, toast, updatePendingBadge } from "./ui";
import { uiState } from "./ui-state";

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
  /** Pedidos cuyos avisos de venta frenaron hoy los topes anti-abuso (puede venir ausente). */
  salesBlockedIds?: string[];
}

// Estado que sobrevive a los re-renders: filtrar o buscar no te manda a la página 1
// (a menos que cambies el chip de estado, que sí reinicia la página).
const ordState = { status: "" as "" | OrderStatus, page: 1, q: "" };
// Ids seleccionados para la accion masiva de archivar (se limpia al cambiar de vista/filtro)
const ordSelected = new Set<string>();

export async function viewOrders(statusFilter = ""): Promise<void> {
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
  // Pedidos cuyos avisos hoy no salieron por los topes anti-abuso (vacío = todo normal).
  const blockedIds = data.salesBlockedIds ?? [];
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
    // Teléfono del comprador como link de WhatsApp (si hay número valido).
    const tel = normalizePhone(o.buyerPhone);
    const wa = tel.length >= 8 ? `https://wa.me/${tel}` : null;
    return `
    <tr>
      <td>${o.status === "archived" ? "" : `<input type="checkbox" class="ord-sel" data-id="${esc(o.id)}" title="Seleccionar para archivar"/>`}<span class="ord-id" title="${esc(o.id)}">${esc(o.id.slice(0, 10))}…</span><br>
          <small class="muted">${fecha}</small></td>
      <td>${esc(o.buyerName)}<br><small class="muted">${wa ? `<a class="ord-wa" href="${wa}" target="_blank" rel="noopener" title="Escribir por WhatsApp">${esc(o.buyerPhone)}</a>` : esc(o.buyerPhone)}</small>${o.payerEmail ? `<br><small class="muted">${esc(o.payerEmail)}</small>` : ""}</td>
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
        <input id="ord-search" type="search" placeholder="Buscar por nombre, teléfono, email o id…" aria-label="Buscar pedidos por nombre, teléfono, email o id" autocomplete="off"
          value="${esc(ordState.q)}" style="max-width:260px"/>
        <span class="muted" id="ord-search-count" ${ordState.q !== "" ? "" : "hidden"}>${ordState.q !== "" ? `${data.total} coincidencia${data.total !== 1 ? "s" : ""} en ${data.total} pedido${data.total !== 1 ? "s" : ""} (de ${totalAll})` : ""}</span>
        <button class="btn" id="ord-refresh" style="margin-left:auto" title="Volver a pedir la lista al servidor (manténe filtros y página)">⟳ Actualizar</button>
        <button class="btn" id="ord-bulk" hidden>🗂️ Archivar seleccionados</button>
      </div>
      ${payments.configured && payments.enabled
        ? `<p class="muted">Pago online activo: MercadoPago confirma solo vía webhook.</p>`
        : `<p class="muted">Pago online ${payments.configured ? "configurado pero <b>desactivado</b> en Configuración → Pagos" : "<b>sin token</b>: configurá el secret <code>MERCADOPAGO_ACCESS_TOKEN</code> (ver Configuración → Pagos)"}. Los pedidos que veas acá se confirman a mano.</p>`}
      ${blockedIds.length > 0
        ? `<p class="muted" id="ord-sales-blocked">⚠️ Hoy se frenaron <b>${blockedIds.length}</b> aviso${blockedIds.length !== 1 ? "s" : ""} de venta por los topes anti-abuso: el pedido se guardó igual, pero <b>no salió el email</b>. Revisalos uno por uno: ${blockedIds.map((id) => `<a href="/pedido/${esc(id)}" target="_blank" rel="noopener" title="Ver el pedido ${esc(id)}">${esc(id.slice(0, 8).toUpperCase())}</a>`).join(" · ")}</p>`
        : ""}
      ${orders.length === 0
        ? `<p class="muted">Todavía no hay pedidos${ordState.status !== "" ? " con este estado" : ""}${ordState.q !== "" ? ` buscando "${esc(ordState.q)}"` : ""}.</p>`
        : `<table class="table ord-table">
            <thead><tr><th><input type="checkbox" id="ord-sel-all" title="Marcar todos (esta página)"/></th><th>Pedido</th><th>Comprador</th><th>Productos</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
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
      uiState.refocusSearch = true;
      void viewOrders(ordState.status);
    }, 350);
  });
  if (uiState.refocusSearch && searchInput) {
    uiState.refocusSearch = false;
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

  // Botón "Ya avisé": abre WhatsApp con mensaje pre-cargado al comprador y
  // marca el pedido como notificado (fire-and-forget). El mensaje sigue el
  // mismo estilo que el de la página /pedido/:id: saludo por nombre, tienda,
  // detalle del pedido y total — cero texto genérico.
  el.view.querySelectorAll<HTMLButtonElement>("button[data-ord-wa]").forEach((b) => {
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

  // ---- Actualizar: re-pide la lista al servidor sin perder filtros/página/búsqueda ----
  el.view.querySelector<HTMLButtonElement>("#ord-refresh")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    b.textContent = "⟳ Actualizando…";
    try {
      await viewOrders(ordState.status);
      toast("Lista actualizada");
    } catch (e) {
      b.disabled = false;
      b.textContent = "⟳ Actualizar";
      toast(e instanceof Error ? e.message : "Error al actualizar", false);
    }
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
