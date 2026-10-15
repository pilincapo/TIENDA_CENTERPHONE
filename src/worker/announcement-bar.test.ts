import { describe, expect, it } from "vitest";
import { sanitizeAnnouncementBar } from "./settings";

// La cinta ahora acepta varias promos: una por línea (como "Cómo comprar").
// El worker es quien recorta, así que un body raro no puede ensenar la tienda.
describe("sanitizeAnnouncementBar", () => {
  it("una sola línea queda igual que antes (formato de siempre)", () => {
    expect(sanitizeAnnouncementBar("📦 Envío gratis en Santa Fe")).toBe("📦 Envío gratis en Santa Fe");
  });

  it("una promo por línea: recorta espacios, descarta vacías y une con \\n", () => {
    expect(sanitizeAnnouncementBar("  Uno  \r\n\r\nDos\t\n   \nTres  ")).toBe("Uno\nDos\nTres");
    expect(sanitizeAnnouncementBar("Uno\n\n\nDos")).toBe("Uno\nDos");
  });

  it("nunca pasa de 5 promos", () => {
    const entrada = Array.from({ length: 8 }, (_, i) => `P${i}`).join("\n");
    const salida = sanitizeAnnouncementBar(entrada).split("\n");
    expect(salida).toHaveLength(5);
    expect(salida[4]).toBe("P4");
  });

  it("cada promo se limita a 120 caracteres", () => {
    expect(sanitizeAnnouncementBar("x".repeat(300))).toHaveLength(120);
    expect(sanitizeAnnouncementBar(`${"x".repeat(300)}\ncorta`)).toBe(`${"x".repeat(120)}\ncorta`);
  });

  it("campo ausente o vacío queda \"\": cinta no renderizada", () => {
    expect(sanitizeAnnouncementBar(undefined)).toBe("");
    expect(sanitizeAnnouncementBar(null)).toBe("");
    expect(sanitizeAnnouncementBar("")).toBe("");
    expect(sanitizeAnnouncementBar("\n  \n")).toBe("");
  });
});
