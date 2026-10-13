// URL pública del feed del catálogo de WhatsApp (la que descarga Meta).
//
// El catálogo de WhatsApp no se llena desde el panel: Meta descarga solo (cada
// hora o cada día, según cómo se configure la fuente en Commerce Manager) un
// archivo desde una URL. Este endpoint es esa URL: devuelve el CSV de los
// productos que el panel marcó como "publicar en WhatsApp" (ver
// src/shared/wa-feed.ts, que arma el archivo).
//
// El token viaja en la query (?t=): Meta no permite cabeceras propias en la
// descarga, así que la URL es el único lugar donde se puede autenticar. Se genera
// y se rota desde el panel (Ajustes → Catálogo de WhatsApp) y vive en KV con los
// ajustes de la tienda.

import { Hono } from "hono";
import type { Env } from "./db";
import { listCategories, listWhatsAppFeedProducts } from "./db";
import { getSettings } from "./settings";
import { timingSafeEqualStr } from "./auth";
import { buildWaFeed } from "../shared/wa-feed";

export const waFeedApp = new Hono<{ Bindings: Env }>();

waFeedApp.get("/api/whatsapp/feed.csv", async (c) => {
  const settings = await getSettings(c.env.KV);
  const esperado = settings.whatsappFeedToken ?? "";
  const token = c.req.query("t") ?? "";
  // Sin token configurado el feed no existe: ni siquiera se confirma que la URL
  // sea la correcta (404 igual que cualquier ruta inexistente).
  if (esperado === "" || token === "" || !timingSafeEqualStr(token, esperado)) {
    return c.json({ error: "No encontrado" }, 404);
  }

  const [products, categories] = await Promise.all([
    listWhatsAppFeedProducts(c.env.DB),
    listCategories(c.env.DB),
  ]);

  // Guarda anti-borrado: con la fuente configurada como "reemplazo completo", un
  // archivo con cero productos VACÍA el catálogo de WhatsApp. Es preferible que la
  // descarga falle (Meta la marca con error y deja el catálogo como estaba) a que
  // se publique un feed vacío.
  if (products.length === 0) {
    console.warn("wa-feed: no hay productos marcados para WhatsApp; se rechaza la descarga para no vaciar el catálogo");
    c.header("Cache-Control", "no-store");
    return c.text("No hay productos marcados para el catálogo de WhatsApp", 500);
  }

  const origin = (c.env.CF_SITE_ORIGIN ?? "").replace(/\/+$/, "") || new URL(c.req.url).origin;
  const { csv, included, skipped } = buildWaFeed(products, {
    origin,
    storeName: settings.storeName ?? "",
    categoryNames: new Map(categories.map((cat) => [cat.id, cat.name])),
  });
  // Queda en Workers Logs: cuántos productos salieron y cuáles se saltearon (y por qué).
  if (skipped.length > 0) {
    console.warn(
      `wa-feed: ${skipped.length} producto(s) quedaron fuera del feed: ${skipped
        .map((s) => `${s.id} (${s.reason})`)
        .join("; ")}`
    );
  }
  console.log(`wa-feed: ${included} producto(s) publicados para el catálogo de WhatsApp`);

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  return c.body(csv);
});
