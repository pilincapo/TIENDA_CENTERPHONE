// Pestaña Seguridad: eventos del registro del worker.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import { api, el } from "./ui";
import { render } from "./router";

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

export async function viewSeguridad(): Promise<void> {
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
