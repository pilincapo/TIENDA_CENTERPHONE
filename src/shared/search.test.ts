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
});
