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
