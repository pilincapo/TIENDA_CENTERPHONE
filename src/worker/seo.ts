// SEO: sitemap.xml + robots.txt.
//
// El sitemap se arma desde D1 (solo productos publicados: los ocultos/sin stock
// no deben indexarse) y se guarda en dos capas para que los bots no consulten la
// base en cada rastreo: el caché del PoP (Cache API) y una copia en KV.
//
// Medido el 18/11: una descacheada costaba 1.371 filas y la clave era
// `c.req.url`, así que cada variante con query string (`?utm=...`, `?x=1`)
// creaba una entrada nueva y volvía a leer el catálogo. Ahora la clave es
// `${origen del sitio}/sitemap.xml`: sin query y sin depender del host del
// request, así las variantes y el espejo workers.dev comparten una sola entrada.
import { Hono } from "hono";
import type { Env } from "./db";
import { listProductsForSitemap } from "./db";
import { getSettings } from "./settings";

export const seoApp = new Hono<{ Bindings: Env }>();

/** Origen que se publica en el XML (canonical del sitio). */
const ORIGEN_DEFECTO = "https://centerphone.com.ar";

/** Copia en KV del XML, para que un descache de PoP no vuelva a D1. */
export const SITEMAP_KV_KEY = "seo:sitemap:xml";
/** Mismo TTL que el caché de borde: el sitemap se rearma como mucho una vez al día. */
const SITEMAP_TTL_S = 86_400;

function origenSitio(env: Env): string {
  return env.CF_SITE_ORIGIN || ORIGEN_DEFECTO;
}

/**
 * `lastmod` con la fecha REAL de modificación de cada ficha. Antes se emitía
 * la fecha del día para las 1365 URLs, así que Google veía "todo cambió hoy"
 * en cada descarga y terminaba ignorando la señal; ahora solo se mueve lo que
 * de verdad se tocó (importación, precio, estado, renombre).
 * Si la fila no tiene fecha válida se omite la etiqueta en vez de inventarla.
 */
function lastmodTag(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return `<lastmod>${new Date(ms).toISOString().slice(0, 10)}</lastmod>`;
}

/** Arma el XML desde D1. Solo se llama cuando no hay copia en KV. */
async function armarSitemap(env: Env): Promise<string> {
  const [products, settings] = await Promise.all([listProductsForSitemap(env.DB), getSettings(env.KV)]);
  const origen = origenSitio(env);

  // Sin URLs de categoría (/?cat=...): son la home filtrada por JS, con el
  // mismo HTML y canonical hacia "/". Publicarlas en el sitemap hacía que
  // Google las rastreé y las agrupara como «Página alternativa con etiqueta
  // canónica adecuada» por cada categoría, sumando ruido en Search Console sin
  // ganancia de indexación. Siguen accesibles desde los chips del menú.
  // Páginas fijas del sitio (legales). Sin `lastmod`: no tienen fecha propia
  // confiable y una fecha inventada es justo lo que se corrigió arriba.
  // /club y /resenas solo se publican mientras su bloque está prendido en el
  // panel: apagados son páginas en pausa y no deben competir en el índice.
  const paginas = [
    ...(settings.loyaltyEnabled ? [{ path: "/club", priority: "0.6" }] : []),
    ...(settings.googleReviewsEnabled ? [{ path: "/resenas", priority: "0.5" }] : []),
    { path: "/politica-de-cambios-y-devoluciones", priority: "0.4" },
    { path: "/politica-de-privacidad", priority: "0.3" },
  ];
  const urls: string[] = [
    `  <url><loc>${origen}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...paginas.map((p) =>
      `  <url><loc>${origen}${p.path}</loc><changefreq>yearly</changefreq><priority>${p.priority}</priority></url>`,
    ),
    ...products.map((p) =>
      `  <url><loc>${origen}/producto/${encodeURIComponent(p.id)}</loc>${lastmodTag(p.updatedAt)}<changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

seoApp.get("/sitemap.xml", async (c) => {
  const cache = caches.default;
  const clave = `${origenSitio(c.env)}/sitemap.xml`;
  const guardar = c.req.method === "GET";

  const hit = await cache.match(clave);
  if (hit) return hit;

  // Segunda línea: el XML guardado. Si no está, es la única vez del día que se
  // recorren los publicados.
  let xml = await c.env.KV.get(SITEMAP_KV_KEY);
  if (xml === null) {
    xml = await armarSitemap(c.env);
    if (guardar) c.executionCtx.waitUntil(c.env.KV.put(SITEMAP_KV_KEY, xml, { expirationTtl: SITEMAP_TTL_S }));
  }

  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600, s-maxage=86400");
  const res = c.newResponse(xml, { headers: c.res.headers });
  if (guardar) c.executionCtx.waitUntil(cache.put(clave, res.clone()));
  return res;
});

/**
 * Suelta el sitemap cacheado: la copia en KV y la del PoP que atiende el
 * request. Se usa cuando cambia algo que decide qué URLs entran (el club o las
 * reseñas), para que no quede una versión vieja hasta el TTL.
 */
export async function invalidarSitemap(env: Env): Promise<void> {
  try {
    await env.KV.delete(SITEMAP_KV_KEY);
  } catch {
    // KV ausente (tests): el TTL lo corrige solo.
  }
  try {
    await caches.default.delete(`${origenSitio(env)}/sitemap.xml`);
  } catch {
    // Cache API ausente (tests): el TTL lo corrige solo.
  }
}

seoApp.get("/robots.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  // El feed del catálogo de WhatsApp queda fuera del rastreo: es una URL con token
  // para Meta y no una página del sitio.
  return c.body(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/whatsapp/feed.csv\n\nSitemap: https://centerphone.com.ar/sitemap.xml\n`);
});
