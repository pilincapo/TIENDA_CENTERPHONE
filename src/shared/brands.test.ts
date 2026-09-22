import { describe, expect, it } from "vitest";
import { detectBrand } from "./brands";

describe("detectBrand", () => {
  it("detecta marcas comunes en títulos", () => {
    expect(detectBrand("Samsung Galaxy A54 5G 256GB")).toBe("Samsung");
    expect(detectBrand("Redmi Note 13 128GB")).toBe("Xiaomi");
    expect(detectBrand("Motorola Moto G84")).toBe("Motorola");
    expect(detectBrand("iPhone 15 Pro 128GB")).toBe("Apple");
  });

  it("no distingue mayúsculas ni usa fragmentos de palabra", () => {
    expect(detectBrand("samsung galaxy a05")).toBe("Samsung");
    // "mino" no debe matchear "mi" ni "moto" matchear dentro de otra palabra
    expect(detectBrand("Funda compatible con Samsung")).toBe("Samsung");
  });

  it("gana la marca que aparece más temprano en el título", () => {
    expect(detectBrand("Xiaomi Redmi Note 13 vs Samsung A15")).toBe("Xiaomi");
    expect(detectBrand("Funda Samsung para iPhone 15")).toBe("Samsung");
  });

  it("devuelve null si no reconoce ninguna marca", () => {
    expect(detectBrand("Cargador genérico 20W")).toBeNull();
    expect(detectBrand("")).toBeNull();
  });

  it("mapea aliases a la marca canónica", () => {
    expect(detectBrand("Galaxy A15")).toBe("Samsung");
    expect(detectBrand("Poco X6 Pro")).toBe("Xiaomi");
    expect(detectBrand("Xperia 1 V")).toBe("Sony");
    expect(detectBrand("Kindle 11va gen")).toBe("Amazon");
  });
});
