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

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name} — Volvemos en un rato</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1c1e21;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
  .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:440px;width:100%;
        box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .emoji{font-size:44px}
  h1{font-size:20px;margin:16px 0 8px}
  p{color:#65676b;margin:0 0 8px;font-size:14px;line-height:1.5}
  a.wa{display:block;background:#25d366;color:#fff;text-decoration:none;border-radius:10px;
       padding:14px;font-weight:600;font-size:15px;margin-top:20px}
  .socials{display:flex;gap:12px;justify-content:center;margin-top:14px}
  a.social{color:#2563eb;text-decoration:none;font-size:14px;font-weight:500;
           border:1px solid #e5e7eb;border-radius:999px;padding:8px 16px}
  small{display:block;margin-top:20px;color:#9ca3af;font-size:12px}
</style>
</head>
<body>
<div class="card">
  <div class="emoji">🛠️</div>
  <h1>${name} está en mantenimiento</h1>
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
    c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    c.header("Retry-After", "3600");
    return c.html(maintenanceHtml(settings, settings.storeName), 503);
  };
}
