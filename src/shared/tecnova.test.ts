// Tests del importador de Tecnova: mapeo de categorías, precio y stock.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TECNOVA_CATEGORY_MAP,
  tecnovaCatKey,
  tecnovaItemsToInternal,
  tecnovaSlug,
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
    // El nombre de página sale del TÍTULO, no del id numérico del proveedor.
    expect(p.id).toBe("memoria-micro-sd-128gb");
    // El id viejo viaja en prevId para que el worker renombre la fila en D1.
    expect(p.prevId).toBe("tecnova-185");
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

  it("sin categoría (categories vacío) entra en la raíz de default \"varios\"", () => {
    // 7 fichas de Tecnova vienen con categories: [] — antes se salteaban todas.
    const { items, skipped } = tecnovaItemsToInternal([row({ categories: [] })], mapping);
    expect(skipped).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]!.categoryId).toBe("varios");
  });

  it("el admin puede seguir saltando la clave \"\" si la mapea a vacío", () => {
    const salta: TecnovaMapping = { targets: { "": "" }, subs: {} };
    const { items, skipped } = tecnovaItemsToInternal([row({ categories: [] })], salta);
    expect(items).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it("la categoría propia VARIOS de Tecnova cae en la raíz varios (unificación)", () => {
    const { items, skipped } = tecnovaItemsToInternal([row({ categories: ["VARIOS"] })], mapping);
    expect(skipped).toEqual([]);
    expect(items[0]!.categoryId).toBe("varios");
  });

  it("elige la primera categoría del array y describe en subId opcional", () => {
    const { items } = tecnovaItemsToInternal([row({ categories: ["AUDIO", "VARIOS"] })], mapping);
    expect(items[0]!.categoryId).toBe("electronica");
  });

  it("nombre de página estable entre corridas (mismo título, mismo id)", () => {
    const a = tecnovaItemsToInternal([row()], mapping).items[0]!.id;
    const b = tecnovaItemsToInternal([row()], mapping).items[0]!.id;
    expect(a).toBe("memoria-micro-sd-128gb");
    expect(a).toBe(b);
  });

  it("dos productos con el mismo título quedan con sufijo -2", () => {
    const { items } = tecnovaItemsToInternal([row(), row({ id: 999 })], mapping);
    expect(items.map((i) => i.id)).toEqual(["memoria-micro-sd-128gb", "memoria-micro-sd-128gb-2"]);
    expect(items[1]!.prevId).toBe("tecnova-999");
  });

  it("título sin nada utilizable cae al id legado (sin prevId)", () => {
    const { items } = tecnovaItemsToInternal([row({ title: "///" })], mapping);
    expect(items[0]!.id).toBe("tecnova-185");
    expect(items[0]!.prevId).toBeUndefined();
  });
});

describe("tecnovaSlug", () => {
  it("normaliza acentos y espacios igual que slugify", () => {
    expect(tecnovaSlug("Memoria MICRO SD 128GB")).toBe("memoria-micro-sd-128gb");
    expect(tecnovaSlug("Cargador USB-C 45W – Rápido")).toBe("cargador-usb-c-45w-rapido");
  });

  it("título largo corta en límite de palabra dentro del tope del id", () => {
    const s = tecnovaSlug("adaptador ".repeat(30).trim());
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
    expect(s).toBe(Array.from({ length: 8 }, () => "adaptador").join("-"));
  });

  it("devuelve vacío si el título no deja nada utilizable", () => {
    expect(tecnovaSlug("///")).toBe("");
    expect(tecnovaSlug("   ")).toBe("");
  });
});
