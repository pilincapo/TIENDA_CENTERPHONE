// Datos estructurados schema.org (JSON-LD) para rich snippets de Google.
// Se inyecta en la ficha de producto después del render: Google ejecuta JS y
// lee el JSON-LD del DOM. Precio, disponibilidad y condición en el formato
// que Search Console espera para "Ficha de producto".
import type { Product } from "../shared/types";
import { detectBrand } from "../shared/brands";

function availabilitySchema(p: Product): string {
  if (p.hiddenNoStock || p.availability === "out_of_stock") return "https://schema.org/OutOfStock";
  if (p.availability === "preorder") return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
}

export function productJsonLd(p: Product, storeName: string): string {
  // Si no hay marca guardada ni detectable del título, se omite el nodo:
  // un Brand sin "name" genera warning en Search Console.
  const brandName = p.brand ?? detectBrand(p.title);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    image: p.imageUrl || undefined,
    description: (p.description || "Consultá por WhatsApp.").slice(0, 300),
    sku: p.id,
    // Marca guardada en la importación; si el producto es anterior a la
    // columna, se detecta del título en el momento (evita re-importar todo).
    ...(brandName ? { brand: { "@type": "Brand", name: brandName } } : {}),
    offers: {
      "@type": "Offer",
      url: `https://centerphone.com.ar/producto/${encodeURIComponent(p.id)}`,
      priceCurrency: "ARS",
      // Google exige precio como número decimal con punto (no coma, no separador).
      price: (p.priceCents / 100).toFixed(2),
      availability: availabilitySchema(p),
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: storeName },
    },
  };
  return JSON.stringify(data);
}

export interface BreadcrumbItem {
  name: string;
  /** URL absoluta del escalón (home, categoría, ficha). */
  url: string;
}

export interface LocalBusinessInfo {
  storeName: string;
  storeAddress: string;
  whatsappPhone: string;
  storeHours: string;
  storeMapUrl: string;
  instagramUrl: string;
  facebookUrl: string;
}

/**
 * Store (subtipo de LocalBusiness): SEO local — que Google pueda mostrar el
 * local con dirección, teléfono y horarios en las búsquedas de la ciudad.
 * Se arma desde la config del panel; los campos vacíos se omiten (un nodo con
 * valor vacío da warning en Search Console).
 */
export function localBusinessJsonLd(s: LocalBusinessInfo): string {
  const sameAs = [s.instagramUrl, s.facebookUrl].filter((u) => u && u.trim() !== "");
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: s.storeName || "CenterPhone Celulares",
    url: "https://centerphone.com.ar/",
    image: "https://centerphone.com.ar/logo.jpg",
    priceRange: "$$",
    ...(s.whatsappPhone ? { telephone: `+${s.whatsappPhone.replace(/\D/g, "")}` } : {}),
    ...(s.storeAddress
      ? { address: { "@type": "PostalAddress", streetAddress: s.storeAddress, addressCountry: "AR" } }
      : {}),
    // Horarios en texto libre del panel: van como descripción y no como
    // openingHoursSpecification (que exige formato estructurado y sería inválido).
    ...(s.storeHours ? { openingHours: s.storeHours.replace(/\n+/g, " · ").slice(0, 200) } : {}),
    ...(s.storeMapUrl ? { hasMap: s.storeMapUrl } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
  return JSON.stringify(data);
}

/**
 * WebSite con SearchAction: le dice a Google que el sitio tiene buscador
 * interno y que puede usarlo en los resultados. El frontend lee `?q=` de la
 * URL, así que el target es real (no un enlace muerto).
 */
export function webSiteJsonLd(storeName: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: storeName || "CenterPhone Celulares",
    url: "https://centerphone.com.ar/",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://centerphone.com.ar/?q={search_term_string}",
      "query-input": "required name=search_term_string",
    },
  });
}

/** BreadcrumbList: debe espejar la miga visible (Inicio › Categoría › Producto). */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  });
}
