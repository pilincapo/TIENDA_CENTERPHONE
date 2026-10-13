// Metas Open Graph de la ficha de producto.
// Se generan en el worker (server-side) y no en el navegador porque los
// scrapers de WhatsApp, Facebook e Instagram NO ejecutan JavaScript: el nombre,
// el precio y la imagen del producto tienen que venir en el HTML inicial.
// Puro (sin bindings) para poder testearlo en node.

import { formatPrice } from "../shared/format";
import { AVAILABILITY_LABELS, type Availability } from "../shared/types";

/** Sitio canónico (mismo valor que usa el SEO del worker). */
export const SITE_ORIGIN = "https://centerphone.com.ar";

export function escAttr(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] as string));
}

export interface OgInput {
  title: string;
  description?: string;
  imageUrl?: string;
  /** Ruta relativa a la ficha (se resuelve contra SITE_ORIGIN). */
  path: string;
  storeName: string;
  priceCents?: number;
  currencySymbol?: string;
  availability?: Availability;
  hiddenNoStock?: boolean;
}

/** Descripción atractiva: disponibilidad + precio (lo que el comprador quiere ver al compartir). */
export function ogDescription(o: OgInput): string {
  const partes: string[] = [];
  const disp = o.hiddenNoStock ? AVAILABILITY_LABELS.out_of_stock : o.availability ? AVAILABILITY_LABELS[o.availability] : "";
  if (disp) partes.push(disp);
  if (typeof o.priceCents === "number" && o.priceCents > 0) {
    partes.push(formatPrice(o.priceCents, o.currencySymbol || "$"));
  }
  if (o.description && o.description.trim() !== "") partes.push(o.description.trim());
  partes.push(`Consultá por WhatsApp en ${o.storeName}.`);
  return partes.join(" · ").slice(0, 300);
}

/** Bloque de metas OG/Twitter + canonical, listo para inyectar en el <head>. */
export function ogTagsHtml(o: OgInput): string {
  const url = `${SITE_ORIGIN}${o.path}`;
  const image = o.imageUrl && o.imageUrl.trim() !== "" ? o.imageUrl : `${SITE_ORIGIN}/logo.jpg`;
  const title = `${o.title} — ${o.storeName}`;
  const desc = ogDescription(o);
  const metas = [
    `<meta property="og:type" content="product" />`,
    `<meta property="og:site_name" content="${escAttr(o.storeName)}" />`,
    `<meta property="og:title" content="${escAttr(title)}" />`,
    `<meta property="og:description" content="${escAttr(desc)}" />`,
    `<meta property="og:url" content="${escAttr(url)}" />`,
    `<meta property="og:image" content="${escAttr(image)}" />`,
    // summary_large_image: al compartir por WhatsApp/redes se ve la foto del producto.
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escAttr(title)}" />`,
    `<meta name="twitter:description" content="${escAttr(desc)}" />`,
    `<meta name="twitter:image" content="${escAttr(image)}" />`,
    `<link rel="canonical" href="${escAttr(url)}" />`,
  ];
  return metas.join("\n    ");
}
