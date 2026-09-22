// Datos estructurados schema.org (JSON-LD) para rich snippets de Google.
// Se inyecta en la ficha de producto después del render: Google ejecuta JS y
// lee el JSON-LD del DOM. Precio, disponibilidad y condición en el formato
// que Search Console espera para "Ficha de producto".
import type { Product } from "../shared/types";

function availabilitySchema(p: Product): string {
  if (p.hiddenNoStock || p.availability === "out_of_stock") return "https://schema.org/OutOfStock";
  if (p.availability === "preorder") return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
}

export function productJsonLd(p: Product, storeName: string): string {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    image: p.imageUrl || undefined,
    description: (p.description || "Consultá por WhatsApp.").slice(0, 300),
    sku: p.id,
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
