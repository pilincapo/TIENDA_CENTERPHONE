import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  cartAdd, cartClear, cartLines, cartRemove, cartSetQty, cartCount,
  MAX_QTY_PER_ITEM, MAX_ITEMS,
} from "./cart";

// localStorage mock en memoria (los tests corren en node, no en navegador).
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => { store.set(k, v); },
  removeItem: (k: string): void => { store.delete(k); },
  clear: (): void => { store.clear(); },
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", localStorageMock);
});

describe("carrito", () => {
  it("agrega un producto nuevo y persiste en localStorage", () => {
    expect(cartAdd("p1", 1)).toBe(true);
    expect(cartLines()).toEqual([{ id: "p1", qty: 1 }]);
    expect(cartCount()).toBe(1);
    // Persistencia: lo que hay en el storage crudo es JSON válido.
    expect(JSON.parse(store.get("celu_cart_v1")!)).toEqual([{ id: "p1", qty: 1 }]);
  });

  it("acumula cantidad al repetir el producto", () => {
    cartAdd("p1", 2);
    cartAdd("p1", 3);
    expect(cartLines()).toEqual([{ id: "p1", qty: 5 }]);
  });

  it("rechaza superar el tope por producto (sin mutar el carrito)", () => {
    cartAdd("p1", MAX_QTY_PER_ITEM);
    expect(cartAdd("p1", 1)).toBe(false);
    expect(cartCount()).toBe(MAX_QTY_PER_ITEM);
  });

  it("rechaza superar el máximo de líneas distintas", () => {
    for (let i = 0; i < MAX_ITEMS; i++) {
      expect(cartAdd(`p${i}`, 1)).toBe(true);
    }
    expect(cartAdd("extra", 1)).toBe(false);
    expect(cartLines()).toHaveLength(MAX_ITEMS);
  });

  it("cartSetQty clampea entre 1 y el máximo", () => {
    cartAdd("p1", 2);
    cartSetQty("p1", 0);
    expect(cartLines()[0]!.qty).toBe(1);
    cartSetQty("p1", 999);
    expect(cartLines()[0]!.qty).toBe(MAX_QTY_PER_ITEM);
    cartSetQty("inexistente", 3); // no-op, no crea línea
    expect(cartLines()).toHaveLength(1);
  });

  it("cartRemove y cartClear", () => {
    cartAdd("p1", 1);
    cartAdd("p2", 2);
    cartRemove("p1");
    expect(cartLines()).toEqual([{ id: "p2", qty: 2 }]);
    cartClear();
    expect(cartLines()).toEqual([]);
    expect(cartCount()).toBe(0);
  });

  it("lee tolerante un storage corrupto", () => {
    store.set("celu_cart_v1", "{no es json");
    expect(cartLines()).toEqual([]);
    store.set("celu_cart_v1", JSON.stringify([{ id: "p1", qty: 999 }, { id: 42, qty: 1 }, "junk"]));
    const lines = cartLines();
    expect(lines).toEqual([{ id: "p1", qty: MAX_QTY_PER_ITEM }]);
  });
});
