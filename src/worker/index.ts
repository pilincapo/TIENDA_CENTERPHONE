// Entrada del worker: rutas públicas + cron.

import { Hono } from "hono";
import type { CatalogSnapshot } from "../shared/types";
import type { Env } from "./db";
import { adminApp } from "./admin";
import { getSettings } from "./settings";
import { getProduct, listProducts } from "./db";
import { getSnapshot, isSyncDue, regenerateSnapshot, runSync } from "./sync";
import { runAutoImports } from "./autoimport";
import { isValidPhone } from "../shared/whatsapp";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/admin", adminApp);

// Snapshot público (servido desde KV, con regeneración de emergencia).
app.get("/api/catalog", async (c) => {
  let snapshot: CatalogSnapshot | null = await getSnapshot(c.env);
  if (!snapshot) snapshot = await regenerateSnapshot(c.env);
  return c.json(snapshot);
});

// Ficha de producto (solo publicados) + relacionadas.
app.get("/api/products/:id", async (c) => {
  const product = await getProduct(c.env.DB, c.req.param("id"));
  if (!product || product.status !== "published") {
    return c.json({ error: "Producto no encontrado" }, 404);
  }
  const related = product.categoryId
    ? (await listProducts(c.env.DB))
        .filter((p) => p.id !== product.id && p.categoryId === product.categoryId)
        .slice(0, 8)
    : [];
  const settings = await getSettings(c.env.KV);
  return c.json({ product, related, settings: publicSettings(settings) });
});

function publicSettings(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    whatsappPhone: s.whatsappPhone,
    currencySymbol: s.currencySymbol,
    whatsappOk: isValidPhone(s.whatsappPhone),
  };
}

// Settings públicos para el frontend (sin exponer tokens ni URLs de sync).
app.get("/api/public/settings", async (c) => {
  return c.json(publicSettings(await getSettings(c.env.KV)));
});

// Rutas de página: /producto/* sirve el shell de ficha; /admin sin slash redirige.
app.get("/producto/*", (c) =>
  c.env.ASSETS.fetch(new Request(new URL("/product.html", c.req.url)))
);
app.get("/admin", (c) => c.redirect("/admin/", 301));

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
    const settings = await getSettings(env.KV);
    if (settings.syncUrl === "") return;
    if (!(await isSyncDue(env.KV, settings))) return;
    ctx.waitUntil(runSync(env, "cron"));
  },
} satisfies ExportedHandler<Env>;
