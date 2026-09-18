import { describe, expect, it } from "vitest";
import { parseAvailability, parsePriceCents, parseTags, slugify } from "./parse";

describe("parsePriceCents", () => {
  it("convierte números a centavos", () => {
    expect(parsePriceCents(1234.5)).toBe(123500);
    expect(parsePriceCents(100)).toBe(10000);
  });

  it("convierte strings con punto decimal", () => {
    expect(parsePriceCents("1299.99")).toBe(130000);
    expect(parsePriceCents("$1299.99")).toBe(130000);
  });

  it("interpreta coma como decimal (formato AR)", () => {
    expect(parsePriceCents("1299,99")).toBe(130000);
    expect(parsePriceCents("$1.299,99")).toBe(130000);
  });

  it("redondea al peso entero siempre (la tienda no usa decimales)", () => {
    expect(parsePriceCents("1299,49")).toBe(129900);
    expect(parsePriceCents(1234.5)).toBe(123500);
    expect(parsePriceCents("999,99")).toBe(100000);
  });

  it("interpreta punto como miles cuando hay coma decimal", () => {
    expect(parsePriceCents("1.234")).toBe(123400);
  });

  it("interpreta coma como miles si el punto es decimal", () => {
    expect(parsePriceCents("1,234.56")).toBe(123500);
  });

  it("rechaza inválidos", () => {
    expect(parsePriceCents("abc")).toBeNull();
    expect(parsePriceCents("")).toBeNull();
    expect(parsePriceCents(null)).toBeNull();
    expect(parsePriceCents(-5)).toBeNull();
  });
});

describe("parseTags", () => {
  it("acepta arrays y filtra desconocidos", () => {
    expect(parseTags(["new", "featured", "otro"])).toEqual(["new", "featured"]);
  });

  it("acepta strings separados por coma y sinónimos", () => {
    expect(parseTags("nuevo, oferta, nope")).toEqual(["new", "offer"]);
    expect(parseTags("destacado")).toEqual(["featured"]);
  });

  it("normaliza al orden canónico", () => {
    expect(parseTags(["offer", "new"])).toEqual(["new", "offer"]);
  });

  it("devuelve vacío para basura", () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(123)).toEqual([]);
  });
});

describe("parseAvailability", () => {
  it("mapea variantes de sin stock", () => {
    expect(parseAvailability("agotado")).toBe("out_of_stock");
    expect(parseAvailability("sin stock")).toBe("out_of_stock");
    expect(parseAvailability(0)).toBe("out_of_stock");
    expect(parseAvailability(1)).toBe("in_stock");
  });

  it("mapea preorder", () => {
    expect(parseAvailability("bajo pedido")).toBe("preorder");
    expect(parseAvailability("reservado")).toBe("preorder");
  });

  it("default en stock", () => {
    expect(parseAvailability(undefined)).toBe("in_stock");
    expect(parseAvailability("cualquier cosa")).toBe("in_stock");
  });
});

describe("slugify", () => {
  it("normaliza acentos y espacios", () => {
    expect(slugify("Samsung Galaxy S24 Últra")).toBe("samsung-galaxy-s24-ultra");
  });

  it("nunca devuelve vacío", () => {
    expect(slugify("///")).toBe("item");
    expect(slugify("")).toBe("item");
  });
});
