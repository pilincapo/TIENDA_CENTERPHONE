// Tests del importador de Tecnova: mapeo de categorías, precio y stock.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TECNOVA_CATEGORY_MAP,
  tecnovaCatKey,
  tecnovaItemsToInternal,
  type TecnovaMapping,
} from "./tecnova";

const mapping: TecnovaMapping = { targets: { ...DEFAULT_TECNOVA_CATEGORY_MAP }, subs: {} };

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 185,
    title: "MEMORIA MICRO SD 128GB",
    price: 28000,
    stock: 10,
    categories: ["ALMACENAMIENTO"],
    image: "https://example.com/img.jpg",
    is_offer: false,
    is_new: false,
    is_featured: false,
    on_demand_lead_time: "",
    description: null,
    ...over,
  };
}

describe("tecnovaCatKey", () => {
  it("normaliza acentos y mayúsculas", () => {
    expect(tecnovaCatKey("Electrónica General")).toBe("ELECTRONICA GENERAL");
    expect(tecnovaCatKey("  iluminacion ")).toBe("ILUMINACION");
  });
});

describe("tecnovaItemsToInternal", () => {
  it("mapea ALMACENAMIENTO a computacion y calcula centavos", () => {
    const { items, skipped } = tecnovaItemsToInternal([row()], mapping);
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(1);
    const p = items[0]!;
    expect(p.categoryId).toBe("computacion");
    expect(p.price_cents).toBe(2_800_000);
    expect(p.availability).toBe("in_stock");
    expect(p.id).toBe("tecnova-185");
  });

  it("producto sin stock y sin lead time queda out_of_stock", () => {
    const { items } = tecnovaItemsToInternal([row({ stock: 0 })], mapping);
    expect(items[0]!.availability).toBe("out_of_stock");
  });

  it("producto sin stock con lead time queda preorder", () => {
    const { items } = tecnovaItemsToInternal([row({ stock: 0, on_demand_lead_time: "48/72 hs" })], mapping);
    expect(items[0]!.availability).toBe("preorder");
  });

  it("tags: oferta/nuevo/destacado desde flags booleanos", () => {
    const { items } = tecnovaItemsToInternal([row({ is_offer: true, is_new: true })], mapping);
    expect(items[0]!.tags).toEqual(["offer", "new"]);
  });

  it("targets vacío: aplica el mapping default (ALMACENAMIENTO → computacion)", () => {
    const vacio: TecnovaMapping = { targets: {}, subs: {} };
    const { items, skipped } = tecnovaItemsToInternal([row()], vacio);
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]!.categoryId).toBe("computacion");
  });

  it("mapping explícito \"\" salta la categoría aunque exista default", () => {
    const salta: TecnovaMapping = { targets: { ALMACENAMIENTO: "" }, subs: {} };
    const { items, skipped } = tecnovaItemsToInternal([row()], salta);
    expect(items).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("ALMACENAMIENTO");
  });

  it("mapping del admin pisa al default", () => {
    const custom: TecnovaMapping = { targets: { ALMACENAMIENTO: "hogar" }, subs: { ALMACENAMIENTO: "bazar" } };
    const { items } = tecnovaItemsToInternal([row()], custom);
    expect(items[0]!.categoryId).toBe("hogar");
    expect(items[0]!.subcategoryId).toBe("bazar");
  });

  it("salta productos sin título o sin precio válido", () => {
    const { items, skipped } = tecnovaItemsToInternal(
      [row({ title: "" }), row({ id: 2, price: -5 }), row({ id: 3 })],
      mapping
    );
    expect(items).toHaveLength(1);
    expect(skipped).toHaveLength(2);
  });

  it("elige la primera categoría del array y describe en subId opcional", () => {
    const { items } = tecnovaItemsToInternal([row({ categories: ["AUDIO", "VARIOS"] })], mapping);
    expect(items[0]!.categoryId).toBe("electronica");
  });

  it("id derivado del id numérico (estable entre corridas)", () => {
    const a = tecnovaItemsToInternal([row()], mapping).items[0]!.id;
    const b = tecnovaItemsToInternal([row()], mapping).items[0]!.id;
    expect(a).toBe(b);
    expect(a).toBe("tecnova-185");
  });
});
