import { describe, expect, it } from "vitest";
import { validateCart, sanitizeBuyer, MAX_ITEMS, MAX_QTY_PER_ITEM } from "./orders";
import type { Product } from "../shared/types";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1", title: "iPhone 13", description: "", priceCents: 50000000,
    categoryId: null, subcategoryId: null, tags: [], imageUrl: "",
    status: "published", availability: "in_stock", sortOrder: 0, createdAt: 0,
    sourceUrl: null, brand: null,
    ...overrides,
  };
}

describe("validateCart", () => {
  it("recalcula precio y total desde la base, ignorando lo que mande el cliente", () => {
    // El input solo trae {id, qty}: aunque el cliente mande un campo de precio
    // inventado, no se usa. El precio sale de la lista de productos de la base.
    const result = validateCart([{ id: "p1", qty: 2 }], [product()]);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([{ id: "p1", title: "iPhone 13", qty: 2, priceCents: 50000000 }]);
    expect(result.totalCents).toBe(100000000);
  });

  it("rechaza producto inexistente, oculto, sin stock y bajo pedido", () => {
    expect(validateCart([{ id: "fantasma", qty: 1 }], [product()]).ok).toBe(false);
    expect(validateCart([{ id: "p1", qty: 1 }], [product({ status: "hidden" })]).ok).toBe(false);
    expect(validateCart([{ id: "p1", qty: 1 }], [product({ availability: "out_of_stock" })]).ok).toBe(false);
    expect(validateCart([{ id: "p1", qty: 1 }], [product({ availability: "preorder" })]).ok).toBe(false);
  });

  it("acumula cantidades del mismo producto y aplica el tope por ítem", () => {
    const result = validateCart([{ id: "p1", qty: 3 }, { id: "p1", qty: 4 }], [product()]);
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0]!.qty).toBe(7);
    expect(validateCart([{ id: "p1", qty: MAX_QTY_PER_ITEM + 1 }], [product()]).ok).toBe(false);
    expect(validateCart([{ id: "p1", qty: 5 }, { id: "p1", qty: 6 }], [product()]).ok).toBe(false);
  });

  it("rechaza más de MAX_ITEMS líneas, qty no numérica y carrito vacío", () => {
    const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ id: `p${i}`, qty: 1 }));
    const catalog = many.map((_, i) => product({ id: `p${i}` }));
    expect(validateCart(many, catalog).ok).toBe(false);
    expect(validateCart([{ id: "p1", qty: Number("abc") }], [product()]).ok).toBe(false);
    expect(validateCart([], [product()]).ok).toBe(false);
  });

  it("acepta multi-producto con total correcto", () => {
    const catalog = [
      product({ id: "a", title: "A", priceCents: 10_000 }),
      product({ id: "b", title: "B", priceCents: 10_000 }),
    ];
    const result = validateCart([{ id: "a", qty: 2 }, { id: "b", qty: 1 }], catalog);
    expect(result.ok).toBe(true);
    expect(result.totalCents).toBe(30_000);
  });
});

describe("sanitizeBuyer", () => {
  it("acota longitud y saca caracteres de control y ángulos", () => {
    const b = sanitizeBuyer("  Juan <script>alert(1)</script>\n", "342 555-1234 ");
    expect(b.name).toBe("Juan scriptalert(1)/script");
    expect(b.phone).toBe("342 555-1234");
    expect(b.name.length).toBeLessThanOrEqual(80);
  });

  it("no rompe con undefined o números", () => {
    expect(sanitizeBuyer(undefined, undefined).name).toBe("");
    expect(sanitizeBuyer(42, 12345).name).toBe("42");
  });
});
