import { describe, expect, it } from "vitest";
import { ogDescription, ogTagsHtml, SITE_ORIGIN } from "./og";

const base = {
  title: 'Samsung Galaxy A15 128 GB "azul"',
  path: "/producto/tecnova-1",
  storeName: "CenterPhone Celulares",
  priceCents: 249900,
  currencySymbol: "$",
  availability: "in_stock" as const,
};

describe("ogTagsHtml", () => {
  it("arma title, url, imagen y twitter card grande", () => {
    const html = ogTagsHtml({ ...base, imageUrl: "https://cdn.example/a.jpg" });
    expect(html).toContain(`<meta property="og:title" content="Samsung Galaxy A15 128 GB &quot;azul&quot; — CenterPhone Celulares" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/producto/tecnova-1" />`);
    expect(html).toContain(`<meta property="og:image" content="https://cdn.example/a.jpg" />`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/producto/tecnova-1" />`);
  });

  it("incluye disponibilidad y precio en la descripción", () => {
    const html = ogTagsHtml(base);
    expect(html).toContain("En stock");
    expect(html).toContain("$2.499");
  });

  it("sin imagen usa el logo del sitio", () => {
    expect(ogTagsHtml(base)).toContain(`${SITE_ORIGIN}/logo.jpg`);
  });

  it("sin stock lo dice en vez de mostrar la disponibilidad", () => {
    const html = ogTagsHtml({ ...base, availability: "out_of_stock", hiddenNoStock: true });
    expect(html).toContain("Sin stock");
  });

  it("escapa comillas y signos para no romper el atributo", () => {
    const html = ogTagsHtml({ ...base, title: 'a" onload="x', description: "<b>hola</b>" });
    expect(html).not.toContain('onload="x"');
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("ogDescription", () => {
  it("sin precio ni disponibilidad deja solo la invitación a WhatsApp", () => {
    const d = ogDescription({ title: "x", path: "/producto/1", storeName: "Tienda" });
    expect(d).toBe("Consultá por WhatsApp en Tienda.");
  });
});
