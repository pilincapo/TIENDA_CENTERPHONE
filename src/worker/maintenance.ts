// Modo mantenimiento: cierra el catálogo mientras se actualiza el sistema,
// pero mantiene el canal con los clientes (WhatsApp + redes sociales).
// El panel, el seguimiento de pedidos y el webhook de MP siguen funcionando.

import type { Context, Next } from "hono";
import type { Env } from "./db";
import { getSettings } from "./settings";
import { waLinkText } from "../shared/whatsapp";
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
  // Estáticos que podrían quedar referenciados (favicon, 404, assets).
  "/assets/",
  "/_app/",
  "/favicon.png",
  "/logo.jpg",
  "/404.html",
];

export function isMaintenanceBypass(path: string): boolean {
  // /api/orders/transfer es una ruta de COMPRA (crea pedidos): se bloquea en
  // mantenimiento aunque comparta prefijo con la consulta de estado.
  if (path === "/api/orders/transfer") return false;
  return BYPASS_PREFIXES.some((p) => path === p || path.startsWith(p));
}

const DEFAULT_MESSAGE = "Estamos actualizando la tienda para atenderte mejor. En un rato volvemos 🙌";

export function maintenanceHtml(s: StoreSettings, storeName: string): string {
  const esc = (x: string): string =>
    x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

  // Mismo tema terminal/CRT del sitio principal (tokens de styles.css).
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>${name} — Volvemos en un rato</title>
<style>
  :root{--bg:#0b0f14;--panel:#10161d;--panel-2:#161e27;--border:#223041;--border-bright:#33475e;
        --text:#d7e2ea;--muted:#7d8f9f;--brand:#3fb950;--brand-dark:#2e9e3f;
        --shadow:4px 4px 0 rgb(0 0 0 / .55);
        --font:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  body::before{content:"";position:fixed;inset:0;z-index:9;pointer-events:none;
       background:repeating-linear-gradient(to bottom,transparent 0 2px,rgb(0 0 0/.12) 3px,transparent 4px);mix-blend-mode:multiply}
  .card{background:var(--panel);border:1px solid var(--border-bright);box-shadow:var(--shadow);
        padding:36px 28px;max-width:460px;width:100%;position:relative;z-index:10}
  .emoji{font-size:44px}
  h1{font-size:18px;margin:16px 0 10px;font-weight:800}
  h1 .accent{color:var(--brand)}
  p{color:var(--muted);margin:0 0 8px;font-size:14px;line-height:1.6}
  a.wa{display:block;background:var(--brand);color:#04180a;text-decoration:none;
       padding:14px;font-weight:700;font-size:14px;margin-top:20px;
       border:1px solid var(--brand);box-shadow:2px 2px 0 rgb(0 0 0/.45)}
  a.wa:hover{background:var(--brand-dark);border-color:var(--brand-dark)}
  .socials{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap}
  a.social{color:var(--text);text-decoration:none;font-size:13px;font-weight:600;
           border:1px solid var(--border-bright);padding:8px 16px;background:var(--panel-2)}
  a.social:hover{border-color:var(--brand);color:var(--brand)}
  small{display:block;margin-top:20px;color:var(--muted);font-size:12px;line-height:1.5}
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
    // Google Fonts permitido: misma tipografía que el sitio principal.
    c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'none'; frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    c.header("Retry-After", "3600");
    return c.html(maintenanceHtml(settings, settings.storeName), 503);
  };
}
