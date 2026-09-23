// Entrada del worker: rutas públicas + cron.

import { Hono } from "hono";
import type { CatalogSnapshot } from "../shared/types";
import type { Env } from "./db";
import { adminApp } from "./admin";
import { getSettings } from "./settings";
import { getProduct, listProducts } from "./db";
import { getSnapshot, isSyncDue, regenerateSnapshot, runSync } from "./sync";
import { runAutoImports } from "./autoimport";
import { seoApp } from "./seo";
import { trackEvent, pruneStats, type StatEventType } from "./stats";
import { isValidPhone } from "../shared/whatsapp";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/admin", adminApp);
app.route("/", seoApp);

// Snapshot público (servido desde KV, con regeneración de emergencia).
// Caché edge real vía Cache API del propio worker (funciona en workers.dev y en
// dominio propio, sin Cache Rules): la primera visita ejecuta el handler y guarda
// la respuesta en el cache del PoP; las siguientes las sirve el borde sin tocar
// D1/KV. Invalidación doble: TTL de 5 min + purge en cada regenerateSnapshot.
app.get("/api/catalog", async (c) => {
  const cache = caches.default;
  const url = new URL(c.req.url);
  const cacheable = c.req.method === "GET" && !url.search;
  if (cacheable) {
    // La clave incluye la versión del snapshot (un KV.get chico, ~1ms): al
    // regenerar el catálogo cambia la versión y el cache viejo queda huérfano.
    const version = (await c.env.KV.get("catalog:v")) || "0";
    const cacheKey = `${url.origin}/api/catalog?v=${version}`;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    let snapshot: CatalogSnapshot | null = await getSnapshot(c.env);
    if (!snapshot) snapshot = await regenerateSnapshot(c.env);
    c.header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    const res = c.newResponse(JSON.stringify(snapshot), { headers: c.res.headers });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }
  let snapshot: CatalogSnapshot | null = await getSnapshot(c.env);
  if (!snapshot) snapshot = await regenerateSnapshot(c.env);
  c.header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return c.json(snapshot);
});

// Ficha de producto + relacionadas. Los ocultos (sin stock) se sirven con una
// marca para que la ficha muestre el badge correspondiente si alguien entra por
// link directo; siguen excluidos del catálogo y del snapshot público.
app.get("/api/products/:id", async (c) => {
  const product = await getProduct(c.env.DB, c.req.param("id"));
  if (!product) {
    return c.json({ error: "Producto no encontrado" }, 404);
  }
  const settings = await getSettings(c.env.KV);
  if (product.status === "hidden") {
    return c.json({ product: { ...product, availability: "out_of_stock" as const, hiddenNoStock: true }, related: [], settings: publicSettings(settings) });
  }
  const related = product.categoryId
    ? (await listProducts(c.env.DB))
        .filter((p) => p.id !== product.id && p.categoryId === product.categoryId)
        .slice(0, 8)
    : [];
  return c.json({ product, related, settings: publicSettings(settings) });
});

function publicSettings(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    whatsappPhone: s.whatsappPhone,
    currencySymbol: s.currencySymbol,
    whatsappOk: isValidPhone(s.whatsappPhone),
    storeName: s.storeName,
    storeAddress: s.storeAddress,
    storeMapUrl: s.storeMapUrl,
    storeHours: s.storeHours,
    instagramUrl: s.instagramUrl,
    facebookUrl: s.facebookUrl,
    trackUrl: s.trackUrl,
    howSteps: s.howSteps,
    howTitle: s.howTitle,
    howPickupNote: s.howPickupNote,
    freshHours: s.freshHours,
  };
}

// Settings públicos para el frontend (sin exponer tokens ni URLs de sync).
app.get("/api/public/settings", async (c) => {
  return c.json(publicSettings(await getSettings(c.env.KV)));
});

// Tracking de estadísticas (beacon del frontend). La geo viene de request.cf,
// que Cloudflare provee gratis en cada request — no se usa ninguna API externa.
// Respuesta vacía 204: el beacon no espera cuerpo.
app.post("/api/track", async (c) => {
  const cf = c.req.raw.cf as Record<string, string> | undefined;
  const ref = c.req.header("referer");
  const refHost = ref ? (() => { try { return new URL(ref).host; } catch { return null; } })() : null;
  try {
    const body = await c.req.json<{ type?: string; productId?: string; query?: string }>();
    await trackEvent(c.env, {
      type: body.type as StatEventType,
      productId: body.productId ?? null,
      query: body.query ?? null,
      country: cf?.country ?? null,
      city: cf?.city ?? null,
      region: cf?.region ?? null,
      referrer: refHost !== c.req.header("host") ? refHost : null,
    });
  } catch {
    // Un beacon inválido no debe loguear error ni romper nada: se ignora.
  }
  return c.body(null, 204);
});

// Redirect 301 de www al dominio sin www (SEO: evita contenido duplicado y
// consolida las señales de ranking en un solo host).
app.use("*", async (c, next) => {
  if (c.req.header("host") === "www.centerphone.com.ar") {
    const dest = new URL(c.req.url);
    dest.host = "centerphone.com.ar";
    return c.redirect(dest.toString(), 301);
  }
  await next();
});

// Rutas de página: / (home, explícito porque el montaje de seoApp en la raíz
// consume el path y el fallback * no lo alcanzaría); /producto/* sirve el shell
// de ficha; /admin sin slash redirige.
app.get("/", (c) => c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url))));
app.get("/producto/*", (c) =>
  c.env.ASSETS.fetch(new Request(new URL("/product.html", c.req.url)))
);
app.get("/admin", (c) => c.redirect("/admin/", 301));
// Atajo a la página de seguimiento de envíos: redirige a la URL configurada
// en el panel (302 temporal, así siempre respeta el valor actual) con fallback
// al track-lite de RepairPro si el campo está vacío.
app.get("/seguimiento", async (c) => {
  const settings = await getSettings(c.env.KV);
  const dest = settings.trackUrl || "https://repairpro.centerphone.com.ar/track-lite";
  return c.redirect(dest, 302);
});

// Fallback: 404.html para páginas, JSON para la API.
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "No encontrado" }, 404);
  return c.env.ASSETS.fetch(new Request(new URL("/404.html", c.req.url)));
});
app.onError((err, c) => {
  console.error("worker error:", err);
  return c.json({ error: "Error interno" }, 500);
});

export default {
  fetch: app.fetch,
  // Cron cada 15 min: sync por URL configurada + auto-importaciones por horario.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoImports(env));
    ctx.waitUntil(pruneStats(env));
    const settings = await getSettings(env.KV);
    if (settings.syncUrl === "") return;
    if (!(await isSyncDue(env.KV, settings))) return;
    ctx.waitUntil(runSync(env, "cron"));
  },
} satisfies ExportedHandler<Env>;
