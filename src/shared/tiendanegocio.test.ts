import { describe, expect, it } from "vitest";
import { decodeTiendaNegocioState, itemsFromTiendaNegocio } from "./tiendanegocio";

const stateJson = JSON.stringify({
  "products-categories-search": {
    category: { id: 89869, title: "Mascotas", slug: "mascotas" },
    products: [
      {
        hash: "6160",
        sku: "6160",
        title: "Repuesto rollo bolsas sanitarias para perro x3 unidades",
        price: 2400,
        promo: null,
        stock: 18,
        thumbnail: "https://cdn.example/img.png",
        seo_description: null,
        stockAvailable: true,
      },
      {
        hash: "6159",
        title: "Hueso porta bolsas",
        price: 4000,
        promo: 3500,
        stock: 0,
        thumbnail: null,
        stockAvailable: false,
      },
      { title: "", price: 1 },
    ],
  },
});

const html = `<html><body><script id="1-state" type="application/json">${stateJson.replace(
  /"/g,
  "&q;"
)}</script></body></html>`;

describe("decodeTiendaNegocioState", () => {
  it("decodifica &q; &s; &a;", () => {
    expect(decodeTiendaNegocioState("&q;hola&s; &a; &q;chau&q;")).toBe('"hola\' & "chau"');
  });
});

describe("itemsFromTiendaNegocio", () => {
  it("extrae productos completos con categoría de la página", () => {
    const { items, category } = itemsFromTiendaNegocio(html);
    expect(category).toBe("Mascotas");
    expect(items).toHaveLength(2);
    const first = items[0] as Record<string, unknown>;
    expect(first.id).toBe("6160");
    expect(first.title).toContain("Repuesto rollo");
    expect(first.price).toBe(2400);
    expect(first.category).toBe("Mascotas");
    expect(first.image_url).toBe("https://cdn.example/img.png");
    expect(first.availability).toBe("in_stock");
  });

  it("usa promo como precio y marca oferta + sin stock", () => {
    const { items } = itemsFromTiendaNegocio(html);
    const second = items[1] as Record<string, unknown>;
    expect(second.price).toBe(3500);
    expect(second.tags).toEqual(["oferta"]);
    expect(second.availability).toBe("out_of_stock");
  });

  it("omite productos sin título", () => {
    const { items } = itemsFromTiendaNegocio(html);
    expect(items.some((i) => (i as Record<string, unknown>).title === "")).toBe(false);
  });

  it("devuelve vacío para HTML sin estado", () => {
    const r = itemsFromTiendaNegocio("<p>otra cosa</p>");
    expect(r.items).toEqual([]);
    expect(r.category).toBeNull();
  });
});
