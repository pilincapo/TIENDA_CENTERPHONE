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
});  it("detecta la marca del título y respeta la explícita de la fuente", () => {
    const r = normalizeExternalItems([
      { title: "Samsung Galaxy A15 128GB", price: 300000 },
      { title: "Cargador 20W", price: 15000, marca: "Baseus" },
    ]);
    expect(r.products[0]?.brand).toBe("Samsung");
    expect(r.products[1]?.brand).toBe("Baseus");
  });

  it("deja brand en null cuando no puede detectar", () => {
    const r = normalizeExternalItems([{ title: "Cable USB-C genérico", price: 5000 }]);
    expect(r.products[0]?.brand).toBeNull();
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
    // El id (que es también la URL /producto/{id}) sale del TÍTULO, no del id
    // opaco del proveedor; el id viejo viaja en prevId para el renombre + 301.
    expect(p.id).toBe("galaxy-s24");
    expect(p.prevId).toBe("p1");
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
    expect(r.products[0]!.prevId).toBeNull(); // sin id de origen no hay nada que renombrar
  });

  it("id opaco del proveedor (hash numérico) queda en prevId, no en la URL", () => {
    const r = normalizeExternalItems([
      { id: "6160", title: "Cargador USB-C 20W", price: 8000 },
      { hash: "777", title: "Funda Silicona", price: 3000 },
    ]);
    expect(r.products[0]!.id).toBe("cargador-usb-c-20w");
    expect(r.products[0]!.prevId).toBe("6160");
    // Sin id/sku/slug explícitos no hay prevId: el idFuente es el slug del
    // título, igual que el id nuevo (el hash de TiendaNegocio ya lo mapea a id
    // itemsFromTiendaNegocio, no normalize).
    expect(r.products[1]!.id).toBe("funda-silicona");
    expect(r.products[1]!.prevId).toBeNull();
  });

  it("títulos repetidos en la misma corrida quedan con sufijo -2", () => {
    const r = normalizeExternalItems([
      { id: "1", title: "Cargador USB", price: 100 },
      { id: "2", title: "Cargador USB", price: 200 },
      { id: "3", title: "Cargador USB", price: 300 },
    ]);
    expect(r.products.map((p) => p.id)).toEqual(["cargador-usb", "cargador-usb-2", "cargador-usb-3"]);
    expect(r.products.map((p) => p.prevId)).toEqual(["1", "2", "3"]);
  });

  it("item ya normalizado (con prevId del preview) conserva su id sin volver a deduplicar", () => {
    // El panel reenvía la selección del preview en lotes de 50: el id y el
    // prevId calculados en la pasada anterior tienen que sobrevivir tal cual.
    const r = normalizeExternalItems([
      { id: "cargador-usb-2", prevId: "2", title: "Cargador USB", priceCents: 200, status: "published", availability: "in_stock", tags: [], description: "", sortOrder: 0 },
    ]);
    expect(r.products[0]!.id).toBe("cargador-usb-2");
    expect(r.products[0]!.prevId).toBe("2");
  });

  it("título sin nada utilizable cae al id del proveedor (sin prevId)", () => {
    const r = normalizeExternalItems([{ id: "900", title: "///", price: 100 }]);
    expect(r.products[0]!.id).toBe("900");
    expect(r.products[0]!.prevId).toBeNull();
  });

  it("salta los items inválidos sin cortar el lote (quedan como avisos)", () => {
    const r = normalizeExternalItems([
      { title: "Sin precio" },
      null,
      { title: "OK", price: 5 },
      { title: "Precio raro", price: "abc" },
    ]);
    expect(r.products).toHaveLength(1);
    expect(r.skipped).toHaveLength(3);
    expect(r.skipped.some((s) => s.includes("precio inválido"))).toBe(true);
    expect(r.errors).toHaveLength(0);
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
