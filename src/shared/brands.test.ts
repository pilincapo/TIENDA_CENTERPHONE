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

  it("detecta marcas propias del catálogo (electro, audio, accesorios)", () => {
    expect(detectBrand("Cable TIME TIPO C mallado 3.1A carga rápida")).toBe("Time");
    expect(detectBrand("Trípode para parlante ECOPOWER en caja")).toBe("Ecopower");
    expect(detectBrand("Auricular vincha bluetooth QCY HS2 LITE")).toBe("QCY");
    expect(detectBrand("Joystick PS5 REDRAGON WARGRIP G831")).toBe("Redragon");
    expect(detectBrand("Stereo Bluetooth con frente desmontable SEISA QM-C1884")).toBe("Seisa");
    expect(detectBrand("Mini arrocera automática ORYX 1,2 Litros")).toBe("Oryx");
    expect(detectBrand("Pava eléctrica de acero HYTOSHY 2 litros")).toBe("Hytoshy");
    expect(detectBrand("Pila ENERGIZER MAX alcalina AA")).toBe("Energizer");
  });

  it("no confunde nombres de producto o conectores con marcas", () => {
    // KITTY/CAPIBARA son diseños de lámparas, no marcas; RCA es un conector
    expect(detectBrand("Lámpara recargable de silicona KITTY")).toBeNull();
    expect(detectBrand("Adaptador plug 6,5mm a 2 RCA HEMBRA")).toBeNull();
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
