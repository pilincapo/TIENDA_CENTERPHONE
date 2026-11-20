// Piezas compartidas del panel: elementos fijos del HTML, fetch al API,
// avisos, insignias de pestaña, banner de «sin publicar» y barra de progreso.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";

export const el = {
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
export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    // charset explícito: los settings llevan tildes, emoji y «·»; así el cuerpo
    // se interpreta como UTF-8 sin depender del default del navegador.
    headers: { "Content-Type": "application/json; charset=utf-8" },
    ...opts,
  });
  if (res.status === 401) throw new Error("unauthorized");
  const data = (await res.json().catch(() => ({}))) as Dict;
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `HTTP ${res.status}`));
  return data as T;
}

export function toast(msg: string, ok = true): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.style.borderColor = ok ? "#2e7d32" : "#b91c1c";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

export function setTabHighlight(name: string): void {
  el.tabs.querySelectorAll("a").forEach((a) => {
    a.classList.toggle("active", a.dataset.tab === name);
  });
}

/** Contador ámbar genérico junto a una pestaña del menú (se quita en 0, tope 99+). */
export function updateTabBadge(tab: string, count: number, title: string): void {
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
export function updatePendingBadge(count: number): void {
  updateTabBadge("orders", count, "pedidos pendientes");
}

// ---- Publicación del catálogo público ----
// Las escrituras del panel (alta, edición, baja, categorías) ya NO regeneran el
// snapshot: leer TODO el catálogo en D1 por cada edición come la cuota de filas
// del free tier. El worker deja una marca y este banner avisa hasta que se publica
// (al sincronizar o con el botón).
export const pendiente = {
  banner: document.getElementById("pending-banner") as HTMLElement | null,
  detail: document.getElementById("pending-detail") as HTMLElement | null,
  publish: document.getElementById("pending-publish") as HTMLButtonElement | null,
  dismiss: document.getElementById("pending-dismiss") as HTMLButtonElement | null,
};

export function mostrarBannerPendiente(activo: boolean, detalle = ""): void {
  if (!pendiente.banner) return;
  pendiente.banner.hidden = !activo;
  if (activo && detalle && pendiente.detail) pendiente.detail.textContent = detalle;
}

/** Marca localmente que hay cambios sin publicar (no espera al servidor: el
 *  worker ya respondió 200 y la marca ya está puesta). */
export function marcarSinPublicar(): void {
  mostrarBannerPendiente(
    true,
    "Último cambio recién guardado. El sitio público lo muestra al sincronizar o al publicar ahora."
  );
}

/** Consulta el estado real de publicación (al entrar al panel y tras publicar). */
export async function refrescarEstadoCatalogo(): Promise<void> {
  try {
    const s = await api<{ pending: boolean; pendingAt: number | null; generatedAt: number | null }>("/catalog-status");
    const detalle =
      s.pending && s.pendingAt
        ? `Último cambio sin publicar: ${new Date(s.pendingAt).toLocaleString("es-AR")}. Se publica solo cada 15 minutos (o al instante con «Publicar ahora»).`
        : "Los productos que editaste acá se ven al sincronizar o al publicar ahora.";
    mostrarBannerPendiente(s.pending, detalle);
  } catch {
    /* sin estado: el panel sigue funcionando */
  }
}

/** Publica el catálogo al sitio (lo mismo que hace la sincronización). */
export async function publicarAhora(): Promise<void> {
  const btn = pendiente.publish;
  if (btn) btn.disabled = true;
  try {
    const r = await api<{ products: number }>("/snapshot", { method: "POST" });
    toast(`Sitio actualizado (${r.products} productos)`);
    mostrarBannerPendiente(false);
  } catch (e) {
    toast(e instanceof Error ? e.message : "Error al publicar", false);
  }
  if (btn) btn.disabled = false;
}
export function formatPriceAdmin(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("es-AR");
}

export function openModal(html: string): HTMLElement {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal-card">${html}</div>`;
  back.addEventListener("click", (e) => {
    if (e.target === back) back.remove();
  });
  document.body.appendChild(back);
  return back;
}
// ---- Barra de progreso (importar, sincronizar, auto-importaciones) ----

const IMPORT_STEPS = ["Descargando", "Extrayendo", "Calculando precios"] as const;
export const SYNC_STEPS = ["Descargando", "Importando", "Generando snapshot"] as const;
export const AUTO_STEPS = ["Descargando", "Extrayendo", "Importando"] as const;

export type ProgressCtl = {
  set: (pct: number, label?: string, stepIdx?: number, stepErr?: boolean) => void;
  done: () => void;
};

export function showProgress(container: HTMLElement, title: string, steps: readonly string[] = IMPORT_STEPS): ProgressCtl {
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
