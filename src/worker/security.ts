// Cabeceras de seguridad para todas las respuestas del worker.
// Aplicadas vía middleware en index.ts: cubren las rutas del worker (API, HTML
// dinámico). Los assets estáticos se sirven directo (sin worker) pero son
// inmutables y sin contenido dinámico, así que el riesgo está en las rutas HTML.

// nonce por request para el único <script> inline del sitio (página /seguimiento).
export function newNonce(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// CSP: sin 'unsafe-inline' en scripts (el inline de /seguimiento va con nonce).
// styles: 'unsafe-inline' necesario (los templates de las vistas setean style="").
// img: https: porque las imágenes de productos vienen de CDNs externos.
// script: static.cloudflareinsights.com = beacon de Cloudflare Web Analytics
// (inyectado por el proxy de Cloudflare en producción).
// frame-ancestors 'none': no se puede embeber el sitio en iframes (clickjacking).
export const CSP_TEMPLATE = `default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'nonce-%NONCE%' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;

export function securityHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Security-Policy": CSP_TEMPLATE.replace("%NONCE%", nonce),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

/**
 * Aplica las cabeceras a la respuesta saliente (middleware de Hono), después
 * de next(): cubre también handlers que devuelven una Response cruda (ej:
 * c.env.ASSETS.fetch en "/"). Las cabeceras que el handler ya haya seteado
 * tienen prioridad (no se pisan).
 */
export function applySecurityHeaders(c: { res: { headers: Headers } }): void {
  const nonce = newNonce();
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    if (!c.res.headers.has(name)) c.res.headers.set(name, value);
  }
}

// ---- A2: validación de origen del beacon de tracking ----

// Dominios propios que pueden enviar /api/track. El tracking es anónimo y
// agregado, pero sin esta validación cualquiera puede inflar las métricas
// (visitas, clicks de WhatsApp) y quemar la cuota D1 del free tier.
const ALLOWED_TRACK_HOSTS = new Set([
  "centerphone.com.ar",
  "www.centerphone.com.ar",
]);

/**
 * Extrae el host de Origin o (fallback) Referer.
 * Retorna null si no hay ninguno o si la URL es inválida.
 */
export function trackRequestHost(originHeader: string | undefined, refererHeader: string | undefined): string | null {
  const raw = originHeader ?? refererHeader ?? "";
  if (raw === "") return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

/** Host local (dev server): localhost o 127.0.0.1 con cualquier puerto. */
export function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

/** true si el request de track proviene de un dominio propio. */
export function isAllowedTrackOrigin(originHeader: string | undefined, refererHeader: string | undefined, requestHost: string | undefined): boolean {
  const host = trackRequestHost(originHeader, refererHeader);
  if (host !== null) {
    // Con Origin/Referer presente manda ese host (no el request): así un curl
    // con Host spoofeado pero Origin externo queda rechazado.
    return ALLOWED_TRACK_HOSTS.has(host) || isLocalHost(host);
  }
  // Sin Origin ni Referer (algunos navegadores viejos, o curl sin cabeceras):
  // en producción se rechaza; en local se acepta para no romper el desarrollo
  // y los tests manuales.
  return requestHost !== undefined && isLocalHost(requestHost);
}
