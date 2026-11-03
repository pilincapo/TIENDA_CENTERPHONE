import { describe, expect, it } from "vitest";
import type { Category, Product } from "../shared/types";
import { highlightHtml, liveResults } from "./search-live";

function producto(id: string, title: string, categoryId = "celulares"): Product {
  return {
    id, title, priceCents: 100000, currency: "ARS",
    imageUrl: null, description: null, brand: null,
    categoryId, subcategoryId: null,
    availability: "in_stock", status: "published", tags: [],
    sourceUrl: null, updatedAt: "",
  } as unknown as Product;
}

const categorias: Category[] = [
  { id: "celulares", name: "Celulares", parentId: null } as Category,
  { id: "audio", name: "Audio", parentId: null } as Category,
];

describe("highlightHtml", () => {
  it("resalta la coincidencia y escapa el resto del texto", () => {
    expect(highlightHtml("<b>iPhone</b> 15", "iphone")).toBe(
      "&lt;b&gt;<mark>iPhone</mark>&lt;/b&gt; 15"
    );
  });

  it("encuentra la palabra sin tildes pero respeta el texto original", () => {
    expect(highlightHtml("Cámara frontal", "camara")).toBe("<mark>Cámara</mark> frontal");
  });

  it("resalta varias palabras de la consulta", () => {
    expect(highlightHtml("Cargador USB-C 33W", "cargador 33w")).toBe(
      "<mark>Cargador</mark> USB-C <mark>33W</mark>"
    );
  });

  it("sin consulta solo escapa, sin marcar", () => {
    expect(highlightHtml("Funda <15>", "   ")).toBe("Funda &lt;15&gt;");
  });

  it("no altera el texto cuando no hay coincidencias", () => {
    expect(highlightHtml("MicroSD 64 GB", "iphone")).toBe("MicroSD 64 GB");
  });
});

describe("liveResults", () => {
  const productos = [
    producto("a", "Samsung Galaxy A55 5G"),
    producto("b", "iPhone 15 128 GB"),
    producto("c", "Auriculares Bluetooth TWS", "audio"),
    producto("d", "Cargador USB-C 33W"),
  ];

  it("sin texto no devuelve nada (el panel queda cerrado)", () => {
    expect(liveResults(productos, categorias, "   ")).toEqual([]);
  });

  it("filtra por título y por categoría, sin depender de mayúsculas ni tildes", () => {
    expect(liveResults(productos, categorias, "SAMSUNG").map((p) => p.id)).toEqual(["a"]);
    expect(liveResults(productos, categorias, "audio").map((p) => p.id)).toEqual(["c"]);
  });

  it("ordena primero los títulos que arrancan con lo buscado", () => {
    const ids = liveResults(
      [producto("x", "Funda auriculares"), producto("y", "Auriculares TWS")],
      categorias,
      "auri"
    ).map((p) => p.id);
    expect(ids).toEqual(["y", "x"]);
  });

  it("devuelve todo el listado coincidente: el recorte a 5 lo hace el panel", () => {
    const muchos = Array.from({ length: 8 }, (_, i) => producto(`p${i}`, `Cable USB ${i}`));
    expect(liveResults(muchos, categorias, "cable")).toHaveLength(8);
  });
});
