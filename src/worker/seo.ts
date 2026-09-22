// SEO: sitemap.xml dinámico + robots.txt.
// El sitemap se arma on-the-fly desde D1 (solo productos publicados: los
// ocultos/sin stock no deben indexarse) y se cachea 24h en el borde con la
// Cache API — los bots no generan consultas a D1 en cada rastreo.
import { Hono } from "hono";
import type { Env } from "./db";
import { listCategories, listProducts } from "./db";

export const seoApp = new Hono<{ Bindings: Env }>();

seoApp.get("/sitemap.xml", async (c) => {
  const cache = caches.default;
  if (c.req.method === "GET") {
    const hit = await cache.match(c.req.url);
    if (hit) return hit;
  }

  const origin = "https://centerphone.com.ar";
  const [products, categories] = await Promise.all([listProducts(c.env.DB), listCategories(c.env.DB)]);
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls: string[] = [
    `  <url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...categories.filter((cat) => cat.active).map((cat) =>
      `  <url><loc>${origin}/?cat=${encodeURIComponent(cat.id)}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`),
    ...products.filter((p) => p.status === "published").map((p) =>
      `  <url><loc>${origin}/producto/${encodeURIComponent(p.id)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
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
  return c.body(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: https://centerphone.com.ar/sitemap.xml\n`);
});
