// Página pública /devoluciones/seguimiento/:token.
//
// Se renderiza en el worker (igual que /pedido/:id) porque el token es la
// credencial: no se puede resolver desde un asset estático. Muestra SOLO lo
// público (código, tipo, estado, fechas, producto, respuesta e historial):
// nunca nombre, WhatsApp, email ni notas internas.

import { Hono } from "hono";
import type { Env } from "./db";
import { getSettings } from "./settings";
import { getPublicReturn, STATUS_LABEL } from "./returns";
import { esc } from "../shared/html";
import { newNonce } from "./security";

export const returnsPageApp = new Hono<{ Bindings: Env }>();

function fecha(ms: number): string {
  return new Date(ms).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STYLE = `
  :root{--bg:#0b0f14;--panel:#10161d;--panel-2:#161e27;--border:#223041;--border-bright:#33475e;
        --text:#d7e2ea;--muted:#7d8f9f;--brand:#3fb950;--amber:#e3b341;
        --shadow:4px 4px 0 rgb(0 0 0 / .55);
        --font:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;padding:24px;display:flex;justify-content:center}
  body::before{content:"";position:fixed;inset:0;z-index:9;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgb(0 0 0/.12) 3px,transparent 4px);mix-blend-mode:multiply}
  .card{background:var(--panel);border:1px solid var(--border-bright);box-shadow:var(--shadow);padding:28px 24px;max-width:640px;width:100%;position:relative;z-index:10}
  .eyebrow{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin:0 0 6px}
  h1{font-size:19px;margin:0 0 4px;font-weight:800}
  .code{font-size:22px;font-weight:800;color:var(--amber);letter-spacing:.08em;margin:6px 0 0}
  .badge{display:inline-block;padding:3px 10px;font-size:12px;font-weight:700;border:1px solid var(--brand);color:var(--brand);margin:12px 0 0}
  .badge.en_revision,.badge.aprobada{color:var(--amber);border-color:var(--amber)}
  .badge.cerrada{color:var(--muted);border-color:var(--border-bright)}
  .meta{color:var(--muted);font-size:12.5px;margin:10px 0 0;line-height:1.6}
  hr{border:none;border-top:1px solid var(--border-bright);margin:18px 0}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 10px}
  .respuesta{background:var(--panel-2);border-left:3px solid var(--brand);padding:12px 14px;font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0}
  ol.hist{list-style:none;margin:0;padding:0}
  ol.hist li{position:relative;padding:0 0 14px 22px;font-size:13.5px;line-height:1.5}
  ol.hist li::before{content:"›";position:absolute;left:0;top:-1px;color:var(--brand);font-weight:800}
  ol.hist li:last-child{padding-bottom:0}
  ol.hist time{display:block;color:var(--muted);font-size:12px}
  a{color:var(--brand);text-decoration:underline}
  .actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:20px;font-size:13.5px}
  .note{color:var(--muted);font-size:12.5px;line-height:1.6;margin:18px 0 0}
  .empty{color:var(--muted);font-size:13.5px;margin:0}
`;

// /devoluciones/seguimiento sin token: no hay nada que mostrar, se vuelve al
// formulario (donde está la explicación) en vez de caer en la 404 del sitio.
returnsPageApp.get("/devoluciones/seguimiento", (c) => c.redirect("/devoluciones", 302));

returnsPageApp.get("/devoluciones/seguimiento/:token", async (c) => {
  const token = c.req.param("token");
  const nonce = newNonce();
  c.header("Content-Security-Policy", `default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`);
  const settings = await getSettings(c.env.KV).catch(() => null);
  const storeName = settings?.storeName || "CenterPhone Celulares";
  const data = await getPublicReturn(c.env.DB, token);

  if (!data) {
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Seguimiento no encontrado — ${esc(storeName)}</title>
<link rel="icon" type="image/png" href="/favicon.png"><style>${STYLE}</style></head>
<body><div class="card">
  <p class="eyebrow">${esc(storeName)}</p>
  <h1>Solicitud no encontrada</h1>
  <p class="meta">Revisá el enlace: el código de seguimiento forma parte de la dirección. Si recién enviaste el formulario, copiala de la pantalla de confirmación.</p>
  <div class="actions"><a href="/devoluciones">Iniciar una solicitud</a><a href="/politica-de-cambios-y-devoluciones">Política</a><a href="/">Ir al catálogo</a></div>
</div></body></html>`;
    return c.html(html, 404, { "Cache-Control": "no-store" });
  }

  const historial = data.history.length
    ? `<ol class="hist">${data.history
        .map((h) => `<li>${esc(h.label)}<time>${esc(fecha(h.at))}</time></li>`)
        .join("")}</ol>`
    : `<p class="empty">Sin movimientos registrados todavía.</p>`;

  const respuesta = data.response
    ? `<h2>Respuesta del comercio</h2><p class="respuesta">${esc(data.response)}</p>`
    : `<h2>Respuesta del comercio</h2><p class="empty">Todavía no hay una respuesta. El plazo para informarte el código y el estado es de 24 horas.</p>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Seguimiento ${esc(data.code)} — ${esc(storeName)}</title>
<link rel="icon" type="image/png" href="/favicon.png"><style>${STYLE}</style></head>
<body><div class="card">
  <p class="eyebrow">${esc(storeName)} · Seguimiento de solicitud</p>
  <h1>${esc(data.kindLabel)}</h1>
  <p class="code" id="codigo">${esc(data.code)}</p>
  <p class="badge ${esc(data.status)}">${esc(data.statusLabel)}</p>
  <p class="meta">
    Iniciada el ${esc(fecha(data.createdAt))}<br>
    Última actualización: ${esc(fecha(data.updatedAt))}${data.product ? `<br>Producto: ${esc(data.product)}` : ""}
  </p>
  <hr>
  ${respuesta}
  <hr>
  <h2>Historial</h2>
  ${historial}
  <p class="note">
    Esta página no muestra tus datos de contacto ni notas internas. Para consultas sobre esta
    solicitud respondé por el mismo medio en el que la iniciaste e indicá el código
    <strong>${esc(data.code)}</strong>.
  </p>
  <div class="actions">
    <a href="/politica-de-cambios-y-devoluciones">Política de cambios y devoluciones</a>
    <a href="/devoluciones">Iniciar otra solicitud</a>
    <a href="/">Volver al catálogo</a>
  </div>
</div></body></html>`;

  return c.html(html, 200, { "Cache-Control": "no-store" });
});

export { STATUS_LABEL };
