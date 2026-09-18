import { describe, expect, it } from "vitest";
import { extractItems, normalizeExternalItems } from "./normalize";

describe("extractItems", () => {
  it("acepta array directo", () => {
    expect(extractItems([{ a: 1 }])).toHaveLength(1);
  });

  it("busca en products/items/data/results", () => {
    expect(extractItems({ products: [{ a: 1 }] })).toHaveLength(1);
    expect(extractItems({ data: [{}, {}] })).toHaveLength(2);
  });

  it("devuelve vacío para basura", () => {
    expect(extractItems("nope")).toEqual([]);
    expect(extractItems({ foo: 1 })).toEqual([]);
  });
});

describe("normalizeExternalItems", () => {
  it("mapea un producto completo", () => {
    const r = normalizeExternalItems([
      {
        id: "p1",
        title: "Galaxy S24",
        price: 1299999,
        description: "El mejor",
        category: "Samsung",
        subcategory: "Gama alta",
        tags: ["new"],
        image: "https://x/img.jpg",
        stock: "in_stock",
      },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(1);
    const p = r.products[0]!;
    expect(p.id).toBe("p1");
    expect(p.priceCents).toBe(129999900);
    expect(p.categoryId).toBe("samsung");
    expect(p.subcategoryId).toBe("gama-alta");
    expect(p.tags).toEqual(["new"]);
    expect(p.status).toBe("published");
  });

  it("acepta aliases en español", () => {
    const r = normalizeExternalItems([
      { nombre: "Moto G84", precio: "$329.999,00", categoria: "Motorola", etiquetas: "oferta" },
    ]);
    expect(r.errors).toEqual([]);
    const p = r.products[0]!;
    expect(p.title).toBe("Moto G84");
    expect(p.priceCents).toBe(32999900);
    expect(p.tags).toEqual(["offer"]);
  });

  it("genera id desde el título si falta", () => {
    const r = normalizeExternalItems([{ title: "Redmi Note 13", price: 100 }]);
    expect(r.products[0]!.id).toBe("redmi-note-13");
  });

  it("reporta errores sin cortar el lote", () => {
    const r = normalizeExternalItems([
      { title: "Sin precio" },
      null,
      { title: "OK", price: 5 },
      { title: "Precio raro", price: "abc" },
    ]);
    expect(r.products).toHaveLength(1);
    expect(r.errors).toHaveLength(3);
  });

  it("no duplica categorías", () => {
    const r = normalizeExternalItems([
      { title: "A", price: 1, category: "Samsung" },
      { title: "B", price: 2, category: "Samsung" },
    ]);
    expect(r.categories).toHaveLength(1);
  });

  it("subcategoría queda asociada a su categoría", () => {
    const r = normalizeExternalItems([
      { title: "A", price: 1, category: "X", subcategory: "Y" },
    ]);
    expect(r.categories).toEqual([
      { id: "x", name: "X", parentId: null },
      { id: "y", name: "Y", parentId: "x" },
    ]);
  });

  it("status hidden se respeta", () => {
    const r = normalizeExternalItems([{ title: "Oculto", price: 1, status: "hidden" }]);
    expect(r.products[0]!.status).toBe("hidden");
  });

  it("items ya normalizados: priceCents en centavos se respeta y crea la categoría desde categoryId", () => {
    const r = normalizeExternalItems([
      { id: "q1", title: "QA", priceCents: 100000, categoryId: "ropa-de-mascotas", status: "published", availability: "in_stock", tags: [], description: "", imageUrl: "", sortOrder: 0 },
    ]);
    expect(r.errors).toEqual([]);
    const p = r.products[0]!;
    expect(p.priceCents).toBe(100000); // no ×100
    expect(p.categoryId).toBe("ropa-de-mascotas");
    expect(r.categories).toEqual([{ id: "ropa-de-mascotas", name: "Ropa de mascotas", parentId: null }]);
  });

  it("items ya normalizados con subcategoryId crea la subcategoría asociada", () => {
    const r = normalizeExternalItems([
      { id: "q2", title: "QA2", priceCents: 5, categoryId: "perros", subcategoryId: "alimentos", status: "published", availability: "in_stock", tags: [], description: "", imageUrl: "", sortOrder: 0 },
    ]);
    expect(r.categories).toEqual([
      { id: "perros", name: "Perros", parentId: null },
      { id: "alimentos", name: "Alimentos", parentId: "perros" },
    ]);
  });

  it("price_cents explícito en un JSON externo se toma tal cual", () => {
    const r = normalizeExternalItems([{ title: "Con centavos", price_cents: 2500 }]);
    expect(r.products[0]!.priceCents).toBe(2500);
  });
});
