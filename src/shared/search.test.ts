import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  it("encuentra términos parciales de varias palabras aunque cambie el orden", () => {
    expect(matchesSearch("Foc Led", "Foco LED 12W")).toBe(true);
    expect(matchesSearch("led foc", "Foco LED 12W")).toBe(true);
  });

  it("ignora mayúsculas y acentos", () => {
    expect(matchesSearch("camara", "Cámara de seguridad")).toBe(true);
  });

  it("exige que cada término coincida con alguna palabra", () => {
    expect(matchesSearch("Foc azul", "Foco LED 12W")).toBe(false);
  });

  it("mantiene coincidencia por fragmento dentro de una palabra", () => {
    expect(matchesSearch("phone", "Headphone inalámbrico")).toBe(true);
  });

  it("ignora consultas sin letras ni números", () => {
    expect(matchesSearch("---", "Cualquier producto")).toBe(true);
  });

  it("encuentra por sinónimo en los dos sentidos", () => {
    expect(matchesSearch("celular", "Teléfono liberado")).toBe(true);
    expect(matchesSearch("telefono", "Celular Samsung A15")).toBe(true);
    expect(matchesSearch("celu", "Teléfono Samsung")).toBe(true);
    expect(matchesSearch("auriculares", "Audífono Bluetooth")).toBe(true);
    expect(matchesSearch("funda", "Case para iPhone 13")).toBe(true);
  });

  it("no expande sinónimos cuando el término es una marca o un modelo", () => {
    // «iphone» contiene «phone», pero no es un sinónimo de celular genérico:
    // buscar un modelo no debe devolver todo el rubro.
    expect(matchesSearch("iphone", "Teléfono Samsung")).toBe(false);
    expect(matchesSearch("iphone", "iPhone 13 128GB")).toBe(true);
  });

  it("el sinónimo no relaja el resto de los términos", () => {
    expect(matchesSearch("celular azul", "Teléfono Samsung negro")).toBe(false);
  });
});
