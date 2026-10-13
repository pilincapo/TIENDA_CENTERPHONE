// Entrada del worker: rutas públicas + cron.

import { Hono } from "hono";
import { type CatalogSnapshot, KV_CATALOG_VERSION_KEY } from "../shared/types";
import type { Env } from "./db";
import { adminApp } from "./admin";
import { tecnovaApp } from "./tecnova";
import { forceHttpsUrl, getSettings } from "./settings";
import { getProduct, listProducts } from "./db";
import { getSnapshot, isSyncDue, regenerateSnapshot, runSync } from "./sync";
import { runAutoImports } from "./autoimport";
import { seoApp } from "./seo";
import { trackEvent, pruneStats, type StatEventType } from "./stats";
import { isValidPhone } from "../shared/whatsapp";
import { applySecurityHeaders, isAllowedTrackOrigin } from "./security";
import { checkoutApp } from "./checkout";
import { armarBulto, andreaniQuote } from "./andreani";
import { ogTagsHtml } from "./og";
import { validateCart, type CartInput } from "./orders";
import { orderPageApp } from "./orders-page";
import { maintenanceMiddleware } from "./maintenance";
import { runWeeklyDigest } from "./digest";

const app = new Hono<{ Bindings: Env }>();

// Cabeceras de seguridad en todas las respuestas (CSP con nonce por request,
// X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy). Se aplican
// después de next() para cubrir también handlers que devuelven la Response
// cruda de ASSETS.fetch (como "/").
app.use("*", async (c, next) => {
  await next();
  try {
    applySecurityHeaders(c);
  } catch {
    // Respuesta con headers inmutables (ej: la Response cruda de ASSETS.fetch
    // en "/"): se recrea con headers copiados y ahora mutables.
    const r = c.res;
    c.res = new Response(r.body, { status: r.status, statusText: r.statusText, headers: new Headers(r.headers) });
    applySecurityHeaders(c);
  }
});

// Modo mantenimiento: antes de todas las rutas públicas. Excepciones dentro
// (panel, pedidos, webhook de MP) en maintenance.ts.
app.use("*", maintenanceMiddleware());

app.route("/api/admin", adminApp);
app.route("/api/admin/import/tecnova", tecnovaApp);
app.route("/", checkoutApp);
app.route("/", orderPageApp);
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
    const version = (await c.env.KV.get(KV_CATALOG_VERSION_KEY)) || "0";
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
    storeMode: s.storeMode,
    paymentsEnabled: s.paymentsEnabled,
    checkoutNote: s.checkoutNote,
    mpSurchargePercent: s.mpSurchargePercent,
    transferDiscountPercent: s.transferDiscountPercent,
    transferCbu: s.transferCbu,
    maintenanceMode: s.maintenanceMode,
    // Cinta de anuncio configurable (texto plano; el frontend lo escapa).
    announcementBar: s.announcementBar,
    // Envíos (cotizador Andreani): solo los campos que el frontend necesita.
    shippingAndreaniEnabled: s.shippingAndreaniEnabled,
    shippingPostalCode: s.shippingPostalCode,
    shippingPackageKilos: s.shippingPackageKilos,
    shippingPackageVolumen: s.shippingPackageVolumen,
  };
}

// Settings públicos para el frontend (sin exponer tokens ni URLs de sync).
app.get("/api/public/settings", async (c) => {
  return c.json(publicSettings(await getSettings(c.env.KV)));
});

// ---- Cotizador de envíos (Andreani) ----
// GET /api/shipping/quote?cp=3000&items=id:qty,id2:qty2
// El cliente SOLO manda CP + {id, qty} del carrito: los productos se re-verifican
// en D1 (misma regla anti-fraude del checkout) y el peso/volumen/contrato salen
// de settings. Solo muestra el precio: nunca entra al total que cobra el worker.
// Rate limit simple en memoria por isolate (igual que checkout).
const quoteAttempts = new Map<string, { count: number; resetAt: number }>();

app.get("/api/shipping/quote", async (c) => {
  const settings = await getSettings(c.env.KV);
  if (!settings.shippingAndreaniEnabled) return c.json({ ok: false, error: "Cotizador de envíos deshabilitado", disabled: true });
  const user = c.env.ANDREANI_USER ?? "";
  const password = c.env.ANDREANI_PASSWORD ?? "";
  if (user === "" || password === "") return c.json({ ok: false, error: "Cotizador no configurado", disabled: true });

  // Rate limit: 20 cotizaciones por minuto por IP (el modal re-cotiza al editar el CP).
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const now = Date.now();
  const entry = quoteAttempts.get(ip);
  if (entry && entry.resetAt >= now && entry.count >= 20) {
    return c.json({ ok: false, error: "Demasiadas cotizaciones. Probá en un minuto." });
  }
  if (!entry || entry.resetAt < now) quoteAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  else entry.count += 1;

  // CP destino: 4-8 dígitos (solo Argentina, ej 3000 o B1655 como número).
  const cp = (c.req.query("cp") ?? "").replace(/\D/g, "");
  if (cp.length < 4 || cp.length > 8) return c.json({ ok: false, error: "Código postal inválido" });

  // Items: "id:qty,id:qty" — mismos límites que el carrito (validateCart).
  const itemsRaw = (c.req.query("items") ?? "")
    .split(",")
    .slice(0, 20)
    .map((s) => {
      const [id, qty] = s.split(":");
      return { id: (id ?? "").trim(), qty: Number(qty ?? "1") };
    })
    .filter((i) => i.id !== "");
  if (itemsRaw.length === 0) return c.json({ ok: false, error: "Carrito vacío" });
  const cart = validateCart(itemsRaw as CartInput[], await listProducts(c.env.DB));
  if (!cart.ok) return c.json({ ok: false, error: cart.error ?? "Carrito inválido" });

  if ((settings.shippingAndreaniContrato ?? "") === "" || (settings.shippingAndreaniCliente ?? "") === "") {
    return c.json({ ok: false, error: "Falta config de Andreani en el panel", disabled: true });
  }

  const bulto = armarBulto(cart.items ?? [], {
    kilos: Math.max(0.1, Number(settings.shippingPackageKilos) || 0.5),
    volumen: Math.max(100, Number(settings.shippingPackageVolumen) || 1080),
  });
  const quote = await andreaniQuote(c.env, {
    cpDestino: cp,
    contrato: settings.shippingAndreaniContrato,
    cliente: settings.shippingAndreaniCliente,
    bultos: [{ kilos: bulto.kilos, volumen: bulto.volumen, valorDeclarado: bulto.valorDeclarado }],
  });
  if (!quote.ok) return c.json({ ok: false, error: quote.error ?? "No se pudo cotizar el envío" });
  return c.json({ ok: true, priceCents: quote.tarifa, pesoAforado: quote.pesoAforado });
});

// Tracking de estadísticas (beacon del frontend). La geo viene de request.cf,
// que Cloudflare provee gratis en cada request — no se usa ninguna API externa.
// Respuesta vacía 204: el beacon no espera cuerpo.
// Solo acepta beacons del propio sitio: sin esto, cualquier script externo
// puede inflar las métricas (visitas, clicks de WhatsApp) y quemar la cuota
// D1 del free tier.
app.post("/api/track", async (c) => {
  if (!isAllowedTrackOrigin(c.req.header("origin"), c.req.header("referer"), c.req.header("host"))) {
    return c.json({ error: "Origen no permitido" }, 403);
  }
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
app.get("/", (c) => c.env.ASSETS.fetch(new Request(c.req.url)));
// (se pide la URL original: con run_worker_first en "/", pedir "/index.html"
// dentro del worker devuelve 404 porque ese asset ya no pasa por el worker)
// La ficha inyecta las metas Open Graph del producto en el HTML inicial: los
// scrapers de WhatsApp/Facebook no ejecutan JS, así que la imagen y el nombre
// del producto tienen que venir ya resueltos. El bloque <!--OG:START-->...
// <!--OG:END--> del template se reemplaza; si el producto no existe (o el asset
// falla) queda el bloque genérico del propio template.
app.get("/producto/*", async (c) => {
  const res = await c.env.ASSETS.fetch(new Request(new URL("/product.html", c.req.url)));
  const id = decodeURIComponent(c.req.path.replace(/^\/producto\//, "")).trim();
  if (!res.ok || id === "") return res;
  const product = await getProduct(c.env.DB, id);
  if (!product) return res;
  const html = await res.text();
  if (!html.includes("<!--OG:START-->")) return new Response(html, { status: res.status, headers: res.headers });
  const settings = await getSettings(c.env.KV);
  const tags = ogTagsHtml({
    title: product.title,
    description: product.description,
    imageUrl: product.imageUrl,
    path: `/producto/${encodeURIComponent(product.id)}`,
    storeName: settings.storeName || "CenterPhone Celulares",
    priceCents: product.priceCents,
    currencySymbol: settings.currencySymbol,
    availability: product.availability,
    hiddenNoStock: product.hiddenNoStock,
  });
  const conTags = html.replace(/<!--OG:START-->[\s\S]*?<!--OG:END-->/, `<!--OG:START-->\n    ${tags}\n    <!--OG:END-->`);
  return new Response(conTags, { status: res.status, headers: res.headers });
});
app.get("/admin", (c) => c.redirect("/admin/", 301));
// /changelog.md es documentación interna (el panel la lee vía /api/admin/changelog,
// autenticado): el asset directo queda bloqueado con una respuesta vacía.
app.get("/changelog.md", (c) => c.text("No autorizado", 401));
// Atajo a la página de seguimiento de envíos: redirige a la URL configurada
// en el panel (302 temporal, así siempre respeta el valor actual) con fallback
// al track-lite de RepairPro si el campo está vacío. Deriva directo: sin página
// intermedia ni espera, para que no se aburra el usuario.
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
  // B3: el destino se fuerza a https (el trackUrl viejo pudo guardarse como
  // http:// antes de la validación; el fallback ya es https). Si el valor
  // guardado no es una URL válida/https, se usa el fallback.
  const dest = forceHttpsUrl(settings.trackUrl, 300) || "https://repairpro.centerphone.com.ar/track-lite";
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
    // Resumen semanal de seguridad por email (lunes 9:00 AR): si falta el
    // token de logs o el binding de email, se salta sin romper nada.
    ctx.waitUntil(
      runWeeklyDigest(env, Date.now()).catch((e) => console.error("seguridad: resumen semanal falló:", e)),
    );
    const settings = await getSettings(env.KV);
    if (settings.syncUrl === "") return;
    if (!(await isSyncDue(env.KV, settings))) return;
    ctx.waitUntil(runSync(env, "cron"));
  },
} satisfies ExportedHandler<Env>;
