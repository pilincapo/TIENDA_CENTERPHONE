// SEO: sitemap.xml dinámico + robots.txt.
// El sitemap se arma on-the-fly desde D1 (solo productos publicados: los
// ocultos/sin stock no deben indexarse) y se cachea 24h en el borde con la
// Cache API — los bots no generan consultas a D1 en cada rastreo.
import { Hono } from "hono";
import type { Env } from "./db";
import { listProductsForSitemap } from "./db";

export const seoApp = new Hono<{ Bindings: Env }>();

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

seoApp.get("/sitemap.xml", async (c) => {
  const cache = caches.default;
  if (c.req.method === "GET") {
    const hit = await cache.match(c.req.url);
    if (hit) return hit;
  }

  const origin = "https://centerphone.com.ar";
  const products = await listProductsForSitemap(c.env.DB);

  // Sin URLs de categoría (/?cat=...): son la home filtrada por JS, con el
  // mismo HTML y canonical hacia "/". Publicarlas en el sitemap hacía que
  // Google las rastree y las agrupara como «Página alternativa con etiqueta
  // canónica adecuada» por cada categoría, sumando ruido en Search Console sin
  // ganancia de indexación. Siguen accesibles desde los chips del menú.
  const urls: string[] = [
    `  <url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...products.map((p) =>
      `  <url><loc>${origin}/producto/${encodeURIComponent(p.id)}</loc>${lastmodTag(p.updatedAt)}<changefreq>weekly</changefreq><priority>0.8</priority></url>`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600, s-maxage=86400");
  const res = c.newResponse(xml, { headers: c.res.headers });
  if (c.req.method === "GET") {
    c.executionCtx.waitUntil(cache.put(c.req.url, res.clone()));
  }
  return res;
});

seoApp.get("/robots.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  // El feed del catálogo de WhatsApp queda fuera del rastreo: es una URL con token
  // para Meta y no una página del sitio.
  return c.body(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/whatsapp/feed.csv\n\nSitemap: https://centerphone.com.ar/sitemap.xml\n`);
});
