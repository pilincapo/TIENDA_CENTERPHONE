// Pestaña Club de socios: lista de miembros, alta y edición.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { formatPrice } from "../../shared/format";
import { esc } from "../../shared/html";
import { MEMBER_TIERS, birthdayLabel, type Member } from "../../shared/loyalty";
import { api, el, openModal, toast } from "./ui";

// ---- Club de socios ----

const clubState = { status: "" as "" | "active" | "inactive", q: "", page: 1 };

interface MemberRow extends Member {
  /** Pedidos con estado "paid" (plata cobrada, no pedidos pendientes). */
  ordersCount: number;
  spentCents: number;
}

interface MembersPageData {
  members: MemberRow[];
  total: number;
  page: number;
  pages: number;
  counts: { all: number; active: number; inactive: number };
  birthdaysThisMonth: number;
  month: string;
}

function openMemberForm(basePercent: number): void {
  const back = openModal(`
    <h2>Agregar socio</h2>
    <p class="muted">Alta manual: el socio entra con el nivel que elijas (se puede cambiar después desde la tabla). El WhatsApp es la clave para recuperar el código.</p>
    <form id="club-new-form">
      <div class="field"><label>Nombre y apellido</label>
        <input name="name" maxlength="80" required autocomplete="off"/></div>
      <div class="field"><label>WhatsApp</label>
        <input name="phone" maxlength="24" required inputmode="tel" placeholder="342 581 9402"/></div>
      <div class="field"><label>Email <span class="opt">(opcional)</span></label>
        <input name="email" type="email" maxlength="120" autocomplete="off"/></div>
      <div class="field"><label>Cumpleaños <span class="opt">(opcional)</span></label>
        <input name="birthday" type="date"/>
        <p class="field-hint">Solo se guardan el día y el mes: el año no se usa.</p></div>
      <div class="field"><label>Nivel de descuento</label>
        <select name="discountPercent">${MEMBER_TIERS.map((t) => `<option value="${t}"${t === basePercent ? " selected" : ""}>${t}%</option>`).join("")}</select>
        <p class="field-hint">Niveles del club: 5, 10 o 15 %. El nivel base configurado es ${basePercent}%.</p></div>
      <p class="error" id="club-new-error" hidden></p>
      <div class="row">
        <button type="submit" class="btn btn-primary">Agregar socio</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);
  const form = back.querySelector<HTMLFormElement>("#club-new-form");
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const err = back.querySelector<HTMLElement>("#club-new-error");
    if (err) err.hidden = true;
    try {
      await api("/members", {
        method: "POST",
        body: JSON.stringify({
          name: fd.get("name"),
          phone: fd.get("phone"),
          email: fd.get("email"),
          birthday: fd.get("birthday"),
          discountPercent: fd.get("discountPercent"),
        }),
      });
      back.remove();
      toast("Socio agregado");
      await viewClub();
    } catch (e) {
      if (err) {
        err.textContent = e instanceof Error ? e.message : "No se pudo agregar el socio";
        err.hidden = false;
      }
    }
  });
}

export async function viewClub(statusFilter?: "" | "active" | "inactive"): Promise<void> {
  if (statusFilter !== undefined && statusFilter !== clubState.status) {
    clubState.status = statusFilter;
    clubState.page = 1;
  }
  el.view.innerHTML = `<div class="panel"><h2>🎁 Club de socios</h2><p class="muted">Cargando…</p></div>`;
  const params = new URLSearchParams({ page: String(clubState.page), limit: "50", status: clubState.status });
  if (clubState.q !== "") params.set("q", clubState.q);
  const [data, settingsData] = await Promise.all([
    api<MembersPageData>(`/members?${params.toString()}`),
    api<{ settings: StoreSettings }>("/settings"),
  ]);
  const clubOn = settingsData.settings.loyaltyEnabled;
  const symbol = settingsData.settings.currencySymbol || "$";
  // Nivel con el que entran los socios nuevos (y el que usan los que no tienen
  // nivel propio, dados de alta antes de los niveles).
  const basePercent = MEMBER_TIERS.find((t) => t === Number(settingsData.settings.loyaltyDiscountPercent ?? 0)) ?? MEMBER_TIERS[0];
  const rows = data.members.map((m) => {
    const alta = new Date(m.createdAt).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const ultimo = m.lastOrderAt
      ? new Date(m.lastOrderAt).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })
      : "—";
    const cumple = birthdayLabel(m.birthday);
    const cumpleMes = m.birthday !== null && m.birthday.slice(0, 2) === data.month;
    const wa = m.phone.length >= 8 ? `https://wa.me/54${m.phone}` : null;
    const tier = m.discountPercent ?? basePercent;
    const tierSelect = `<select class="club-tier" data-club-tier="${esc(m.id)}" aria-label="Descuento de ${esc(m.name)}">${
      MEMBER_TIERS.map((t) => `<option value="${t}"${t === tier ? " selected" : ""}>${t}%</option>`).join("")
    }</select>${m.discountPercent === null ? `<br><small class="muted">base</small>` : ""}`;
    return `
      <tr>
        <td>${esc(m.name)}${m.email ? `<br><small class="muted">${esc(m.email)}</small>` : ""}</td>
        <td><code class="club-code">${esc(m.code)}</code>
          <button type="button" class="btn club-copy" data-club-copy="${esc(m.code)}" title="Copiar código">📋</button></td>
        <td>${tierSelect}</td>
        <td>${cumple ? `${esc(cumple)}${cumpleMes ? ' <span class="club-bday">🎂 este mes</span>' : ""}` : "—"}</td>
        <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener">${esc(m.phone)}</a>` : esc(m.phone)}</td>
        <td>${alta}</td>
        <td>${ultimo}</td>
        <td class="num">${m.ordersCount}</td>
        <td class="num">${m.spentCents > 0 ? formatPrice(m.spentCents, symbol) : "—"}</td>
        <td><span class="ord-badge ${m.active ? "ok" : "off"}">${m.active ? "Activo" : "Inactivo"}</span></td>
        <td class="ord-actions">
          <button type="button" class="btn" data-club-toggle="${esc(m.id)}" data-active="${m.active ? "1" : "0"}">
            ${m.active ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>`;
  }).join("");
  const chip = (s: "" | "active" | "inactive", label: string, n: number): string =>
    `<button class="chip ${s === clubState.status ? "on" : ""}" data-club-filter="${s}">${label} <span class="muted">${n}</span></button>`;
  el.view.innerHTML = `
    <div class="panel">
      <div class="row" style="align-items:center;gap:12px">
        <h2 style="margin:0">🎁 Club de socios</h2>
        <a class="btn" href="/club" target="_blank" rel="noopener">Ver página pública</a>
      </div>
      <p class="muted" style="margin-top:8px">Suscripción gratuita: el cliente deja su WhatsApp y recibe un código con descuento. Cada socio tiene un nivel de <strong>5, 10 o 15 %</strong> que se cambia desde la columna Descuento. Se aplica en el carrito (primero el del club y después el de transferencia) y queda congelado en cada pedido.</p>
      <div class="club-switch ${clubOn ? "on" : "off"}">
        <div class="club-switch-text">
          <strong>${clubOn ? "Club activo en todo el sitio" : "Club apagado en todo el sitio"}</strong>
          <p class="muted">${clubOn
            ? "Se publica /club, el carrito pide el código y el descuento se aplica en cada compra."
            : "/club sigue visible con el aviso de suspensión temporal, pero no ofrece el alta; el carrito no pide código, no se aplica descuento y la página sale del sitemap."}</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="club-enabled" ${clubOn ? "checked" : ""} aria-label="Activar el club de socios"/>
          <span class="switch-ui" aria-hidden="true"></span>
          <span class="switch-text">${clubOn ? "Activo" : "Apagado"}</span>
        </label>
      </div>
      <div class="club-kpis">
        <div class="club-kpi"><span class="club-kpi-n">${data.counts.all}</span><span class="club-kpi-l">Socios</span></div>
        <div class="club-kpi"><span class="club-kpi-n">${data.counts.active}</span><span class="club-kpi-l">Activos</span></div>
        <div class="club-kpi"><span class="club-kpi-n">${data.birthdaysThisMonth}</span><span class="club-kpi-l">Cumplen este mes</span></div>
      </div>
      <div class="row" style="gap:8px;margin:14px 0">
        <input id="club-q" type="search" value="${esc(clubState.q)}" placeholder="Buscar por nombre, código, WhatsApp o email…" style="flex:1;min-width:200px"/>
        <button class="btn" id="club-search">Buscar</button>
        <button class="btn btn-primary" id="club-new">+ Agregar socio</button>
      </div>
      <div class="row" style="gap:8px;margin-bottom:12px">
        ${chip("", "Todos", data.counts.all)}
        ${chip("active", "Activos", data.counts.active)}
        ${chip("inactive", "Inactivos", data.counts.inactive)}
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Socio</th><th>Código</th><th title="Nivel del club">Descuento</th><th>Cumpleaños</th><th>WhatsApp</th><th>Alta</th><th>Último pedido</th><th title="Pedidos pagados">Compras</th><th title="Total pagado por el socio">Gastado</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="11" class="muted">${data.counts.all === 0 ? "Todavía no hay socios. Compartí /club para empezar." : "No hay socios que coincidan con la búsqueda."}</td></tr>`}</tbody>
      </table></div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px">
        <button class="btn" id="club-prev" ${data.page <= 1 ? "disabled" : ""}>← Anterior</button>
        <span class="muted">Página ${data.page} de ${data.pages} · ${data.total} resultado${data.total === 1 ? "" : "s"}</span>
        <button class="btn" id="club-next" ${data.page >= data.pages ? "disabled" : ""}>Siguiente →</button>
      </div>
    </div>`;

  const qInput = el.view.querySelector<HTMLInputElement>("#club-q");
  const buscar = (): void => {
    clubState.q = (qInput?.value ?? "").trim();
    clubState.page = 1;
    void viewClub();
  };
  el.view.querySelector("#club-search")?.addEventListener("click", buscar);
  qInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") buscar();
  });
  el.view.querySelector("#club-new")?.addEventListener("click", () => openMemberForm(basePercent));
  const clubToggle = el.view.querySelector<HTMLInputElement>("#club-enabled");
  clubToggle?.addEventListener("change", async () => {
    const enabled = clubToggle.checked;
    clubToggle.disabled = true;
    try {
      await api("/club", { method: "PATCH", body: JSON.stringify({ enabled }) });
      toast(enabled ? "Club activado en todo el sitio" : "Club desactivado en todo el sitio");
      await viewClub();
    } catch (e) {
      clubToggle.checked = !enabled;
      clubToggle.disabled = false;
      toast(e instanceof Error ? e.message : "No se pudo cambiar el club", false);
    }
  });
  el.view.querySelector("#club-prev")?.addEventListener("click", () => {
    if (clubState.page > 1) {
      clubState.page -= 1;
      void viewClub();
    }
  });
  el.view.querySelector("#club-next")?.addEventListener("click", () => {
    if (clubState.page < data.pages) {
      clubState.page += 1;
      void viewClub();
    }
  });
  el.view.querySelectorAll<HTMLButtonElement>("[data-club-filter]").forEach((b) =>
    b.addEventListener("click", () => void viewClub((b.dataset.clubFilter as "" | "active" | "inactive") ?? "")));
  el.view.querySelectorAll<HTMLButtonElement>("[data-club-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const activo = b.dataset.active === "1";
      b.disabled = true;
      try {
        await api(`/members/${encodeURIComponent(b.dataset.clubToggle ?? "")}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !activo }),
        });
        toast(activo ? "Socio desactivado" : "Socio activado");
        await viewClub();
      } catch (e) {
        b.disabled = false;
        toast(e instanceof Error ? e.message : "Error", false);
      }
    }));
  el.view.querySelectorAll<HTMLSelectElement>("[data-club-tier]").forEach((s) =>
    s.addEventListener("change", async () => {
      const percent = Number(s.value);
      s.disabled = true;
      try {
        await api(`/members/${encodeURIComponent(s.dataset.clubTier ?? "")}`, {
          method: "PATCH",
          body: JSON.stringify({ discountPercent: percent }),
        });
        toast(`Nivel actualizado: ${percent}% de descuento`);
        await viewClub();
      } catch (e) {
        s.disabled = false;
        toast(e instanceof Error ? e.message : "No se pudo cambiar el descuento", false);
      }
    }));
  el.view.querySelectorAll<HTMLButtonElement>("[data-club-copy]").forEach((b) =>
    b.addEventListener("click", () => {
      const code = b.dataset.clubCopy ?? "";
      void navigator.clipboard.writeText(code).then(() => toast("Código copiado")).catch(() => toast(code, true));
    }));
}
