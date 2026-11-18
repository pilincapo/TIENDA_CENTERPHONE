// Modo mantenimiento: cierra el catálogo mientras se actualiza el sistema,
// pero mantiene el canal con los clientes (WhatsApp + redes sociales).
// El panel, el seguimiento de pedidos y el webhook de MP siguen funcionando.

import type { Context, Next } from "hono";
import type { Env } from "./db";
import { getSettings } from "./settings";
import { waLinkText } from "../shared/whatsapp";
import { esc } from "../shared/html";
import type { StoreSettings } from "../shared/types";

// Rutas que NUNCA se bloquean: el vendedor tiene que poder entrar al panel
// para desactivar el modo, un comprador tiene que poder ver su pedido ya
// pagado, y MercadoPago tiene que poder notificar pagos pendientes.
const BYPASS_PREFIXES = [
  "/admin",
  "/api/admin",
  "/pedido/",
  "/api/orders/",
  "/api/payments/webhook",
  "/seguimiento",
  // El feed del catálogo de WhatsApp se sigue sirviendo en mantenimiento: el sitio
  // puede estar cerrado, pero el catálogo de WhatsApp es el mismo canal de venta y
  // no debe quedar desactualizado (ni vaciarse si la fuente es de reemplazo).
  "/api/whatsapp/feed.csv",
  // Estáticos que podrían quedar referenciados (favicon, 404, assets).
  "/assets/",
  "/_app/",
  "/favicon.png",
  "/logo.jpg",
  "/404.html",
  "/404",
];

export function isMaintenanceBypass(path: string): boolean {
  // /api/orders/transfer es una ruta de COMPRA (crea pedidos): se bloquea en
  // mantenimiento aunque comparta prefijo con la consulta de estado.
  if (path === "/api/orders/transfer") return false;
  return BYPASS_PREFIXES.some((p) => path === p || path.startsWith(p));
}

const DEFAULT_MESSAGE = "Estamos actualizando la tienda para atenderte mejor. En un rato volvemos 🙌";

export function maintenanceHtml(s: StoreSettings, storeName: string): string {
  const name = storeName.trim() !== "" ? esc(storeName) : "La tienda";
  const msg = s.maintenanceMessage.trim() !== "" ? esc(s.maintenanceMessage) : DEFAULT_MESSAGE;
  const wa = s.whatsappPhone !== "" && isValid(s.whatsappPhone)
    ? waLinkText(s, "Hola! Vi que la tienda está en mantenimiento y quería hacer una consulta 🙌")
    : "";
  const ig = forceHttps(s.instagramUrl);
  const fb = forceHttps(s.facebookUrl);
  const social = [
    ig !== "" ? `<a class="social" href="${esc(ig)}" target="_blank" rel="noopener">📷 Instagram</a>` : "",
    fb !== "" ? `<a class="social" href="${esc(fb)}" target="_blank" rel="noopener">👍 Facebook</a>` : "",
  ].filter(Boolean).join("");
  const socialBlock = social !== "" ? `<div class="socials">${social}</div>` : "";

  // Mismos tokens que styles.css (versión oscura ordenada), sin webfonts.
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d1319">
<title>${name} — Volvemos en un rato</title>
<style>
  :root{--bg:#0d1319;--panel:#151d26;--panel-2:#1b242e;--border:#26333f;--border-bright:#38495a;
        --text:#e2e9ef;--muted:#93a4b3;--brand:#4cc45e;--brand-dark:#3fae51;--on-brand:#04180a;
        --radius:10px;--radius-sm:8px;
        --shadow:0 12px 26px rgb(0 0 0 / .38);
        --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,system-ui,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);
        box-shadow:var(--shadow);padding:38px 28px;max-width:460px;width:100%}
  .emoji{font-size:44px}
  h1{font-size:19px;margin:16px 0 10px;font-weight:800;letter-spacing:-.01em}
  h1 .accent{color:var(--brand)}
  p{color:var(--muted);margin:0 0 8px;font-size:14.5px;line-height:1.6}
  a.wa{display:block;background:var(--brand);color:var(--on-brand);text-decoration:none;
       padding:14px;font-weight:700;font-size:14px;margin-top:22px;border-radius:var(--radius-sm);
       border:1px solid var(--brand);transition:background-color .15s,border-color .15s}
  a.wa:hover{background:var(--brand-dark);border-color:var(--brand-dark)}
  .socials{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap}
  a.social{color:var(--text);text-decoration:none;font-size:13px;font-weight:600;
           border:1px solid var(--border-bright);border-radius:var(--radius-sm);
           padding:9px 16px;background:var(--panel-2)}
  a.social:hover{border-color:var(--brand);color:var(--brand)}
  small{display:block;margin-top:22px;color:var(--muted);font-size:12.5px;line-height:1.55}
</style>
</head>
<body>
<div class="card">
  <div class="emoji">🛠️</div>
  <h1><span class="accent">${name}</span> está en mantenimiento</h1>
  <p>${msg}</p>
  ${wa !== "" ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener">💬 Escribinos por WhatsApp</a>` : ""}
  ${socialBlock}
  <small>El WhatsApp y las redes siguen abiertos: consultas, seguimientos y coordinaciones normales.</small>
</div>
</body></html>`;
}

function isValid(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function forceHttps(url: string): string {
  const t = url.trim();
  if (t === "") return "";
  if (t.startsWith("https://")) return t;
  if (t.startsWith("http://")) return `https://${t.slice(7)}`;
  return `https://${t}`;
}

/** Middleware a montar antes de todas las rutas públicas. */
export function maintenanceMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const settings = await getSettings(c.env.KV);
    if (!settings.maintenanceMode || isMaintenanceBypass(new URL(c.req.url).pathname)) {
      return next();
    }
    // Sin scripts: la página es solo HTML/CSS (no hace falta nonce en CSP).
    // Sin webfonts externas: la CSP ya no necesita habilitar Google Fonts.
    c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    c.header("Retry-After", "3600");
    return c.html(maintenanceHtml(settings, settings.storeName), 503);
  };
}
