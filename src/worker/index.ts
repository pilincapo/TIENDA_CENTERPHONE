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
  // Registro el uso del atajo (interés en envíos/seguimiento de pedidos).
  const cf = c.req.raw.cf as Record<string, string> | undefined;
  const ref = c.req.header("referer");
  const refHost = ref ? (() => { try { return new URL(ref).host; } catch { return null; } })() : null;
  try {
    await trackEvent(c.env, {
      type: "track_view",
      country: cf?.country ?? null,
      city: cf?.city ?? null,
      region: cf?.region ?? null,
      referrer: refHost !== c.req.header("host") ? refHost : null,
    });
  } catch {
    // La medición nunca debe romper el redirect.
  }
  const settings = await getSettings(c.env.KV);
  const dest = settings.trackUrl || "https://repairpro.centerphone.com.ar/track-lite";
  // Página intermedia en vez de redirect puro: muestra "Volver al catálogo"
  // y auto-deriva al seguimiento a los 3 segundos (el destino está en data-attr
  // para que la página funcione también sin JS).
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Redirigiendo al seguimiento…</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1c1e21;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
  .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;
        box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .emoji{font-size:44px}
  h1{font-size:20px;margin:16px 0 8px}
  p{color:#65676b;margin:0 0 24px;font-size:14px}
  a.btn{display:block;background:#25d366;color:#fff;text-decoration:none;border-radius:10px;
        padding:14px;font-weight:600;font-size:15px}
  a.back{display:block;margin-top:12px;color:#65676b;text-decoration:underline;font-size:14px}
</style>
</head>
<body>
<div class="card">
  <div class="emoji">📦</div>
  <h1>Te llevamos al seguimiento</h1>
  <p>Continuando en <b id="count">3</b> segundos… Si no ocurre nada, tocá el botón.</p>
  <a class="btn" id="go" href="${esc(dest)}">Ir al seguimiento ahora</a>
  <a class="back" href="/">← Volver al catálogo</a>
</div>
<script>
  // Auto-redirect con cuenta visible; cancelado si el usuario navega por su cuenta.
  var n = 3;
  var t = setInterval(function () {
    n--;
    var el = document.getElementById("count");
    if (el) el.textContent = String(n);
    if (n <= 0) { clearInterval(t); location.replace(document.getElementById("go").href); }
  }, 1000);
</script>
</body>
</html>`;
  return c.html(html, 200, { "Cache-Control": "no-store" });
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
