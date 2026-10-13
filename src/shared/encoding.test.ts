import { describe, expect, it } from "vitest";
import { fixMojibake, looksLikeMojibake, repairTextFields } from "./encoding";

// Valores reales del KV local que motivaron el arreglo (UTF-8 leído como cp1252).
const HORARIOS_ROTO = "Lunes a viernes: 9:00 a 19:00 hs\nS\u00c3\u00a1bados: 10:00 a 13:00 hs";
const HORARIOS_OK = "Lunes a viernes: 9:00 a 19:00 hs\nSábados: 10:00 a 13:00 hs";

describe("looksLikeMojibake", () => {
  it("detecta los patrones clásicos", () => {
    expect(looksLikeMojibake("S\u00c3\u00a1bados")).toBe(true);
    expect(looksLikeMojibake("C\u00c3\u00b3mo comprar")).toBe(true);
    expect(looksLikeMojibake("\u00c2\u00b7")).toBe(true);
    expect(looksLikeMojibake("\u00e2\u20ac\u00a6")).toBe(true);
  });

  it("no molesta al texto sano", () => {
    expect(looksLikeMojibake("Sábados")).toBe(false);
    expect(looksLikeMojibake("Mendoza 2974 · Santa Fe")).toBe(false);
    expect(looksLikeMojibake("Ñandú")).toBe(false);
    expect(looksLikeMojibake("\u00c3")).toBe(false); // una «Ã» suelta es legítima
    expect(looksLikeMojibake("")).toBe(false);
  });
});

describe("fixMojibake", () => {
  it("repara el caso real de los horarios", () => {
    expect(fixMojibake(HORARIOS_ROTO)).toBe(HORARIOS_OK);
  });

  it("repara acentos de cómo comprar y notas de checkout", () => {
    expect(fixMojibake("C\u00c3\u00b3mo comprar")).toBe("Cómo comprar");
    expect(fixMojibake("Coordinamos env\u00c3\u00ado o retiro por WhatsApp")).toBe(
      "Coordinamos envío o retiro por WhatsApp"
    );
    expect(fixMojibake("despu\u00c3\u00a9s del pago")).toBe("después del pago");
  });

  it("repara texto de varias líneas sin tocar los saltos", () => {
    const roto = "Explor\u00c3\u00a1 el cat\u00c3\u00a1logo.\nToc\u00c3\u00a1 una categor\u00c3\u00ada.";
    expect(fixMojibake(roto)).toBe("Explorá el catálogo.\nTocá una categoría.");
  });

  it("repara caracteres de cp1252 fuera de latin-1 (·, …, emoji)", () => {
    expect(fixMojibake("\u00c2\u00b7")).toBe("·");
    expect(fixMojibake("\u00e2\u20ac\u00a6")).toBe("…");
    // 📦 (F0 9F 93 A6) leído como cp1252 = ðŸ“¦
    expect(fixMojibake("\u00f0\u0178\u201c\u00a6")).toBe("📦");
  });

  it("repara la doble corrupción «ÃƒÂ¡»", () => {
    expect(fixMojibake("\u00c3\u0192\u00c2\u00a1")).toBe("á");
  });

  it("deja intacto el texto sano", () => {
    for (const s of ["Sábados", "Mendoza 2974 · Santa Fe", "📦 Envío gratis", "Nogoya", ""]) {
      expect(fixMojibake(s)).toBe(s);
    }
  });

  it("no inventa nada si la secuencia no es UTF-8 válido", () => {
    // Termina en un byte de inicio sin continuación: no se puede reparar sin riesgo.
    const truncado = "\u00c3\u00a1\u00c3";
    expect(fixMojibake(truncado)).toBe(truncado);
    // Byte que no entra en latin-1/cp1252 (emoji escrito por el dueño, sano).
    const conEmoji = "\u00c3\u00a1 \ud83d\udce6";
    expect(fixMojibake(conEmoji)).toBe(conEmoji);
  });

  it("es estable: reparar dos veces da lo mismo", () => {
    const una = fixMojibake(HORARIOS_ROTO);
    expect(fixMojibake(una)).toBe(una);
  });
});

describe("repairTextFields", () => {
  it("repara solo los strings y respeta números, booleanos y null", () => {
    const entrada = {
      storeHours: HORARIOS_ROTO,
      freshHours: 48,
      maintenanceMode: false,
      maintenanceMessage: null,
    };
    const salida = repairTextFields(entrada);
    expect(salida.storeHours).toBe(HORARIOS_OK);
    expect(salida.freshHours).toBe(48);
    expect(salida.maintenanceMode).toBe(false);
    expect(salida.maintenanceMessage).toBe(null);
  });

  it("no muta el objeto original ni pierde claves", () => {
    const entrada = { howTitle: "C\u00c3\u00b3mo comprar", extra: 1 };
    const salida = repairTextFields(entrada);
    expect(entrada.howTitle).toBe("C\u00c3\u00b3mo comprar");
    expect(Object.keys(salida)).toEqual(["howTitle", "extra"]);
  });
});
