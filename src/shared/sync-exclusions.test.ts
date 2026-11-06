import { describe, expect, it } from "vitest";
import {
  exclusionSet,
  isExcluded,
  normalizeExclusionEntry,
  parseExclusionList,
  sanitizeSyncExcludeList,
} from "./sync-exclusions";

describe("artículos excluidos", () => {
  it("acepta el código suelto", () => {
    expect(normalizeExclusionEntry("6233")).toBe("6233");
    expect(normalizeExclusionEntry("  6233  ")).toBe("6233");
    expect(normalizeExclusionEntry("/6233/")).toBe("6233");
  });

  it("acepta el link de la ficha, relativo o completo", () => {
    expect(normalizeExclusionEntry("/producto/6233")).toBe("6233");
    expect(normalizeExclusionEntry("https://centerphone.com.ar/producto/6233")).toBe("6233");
    expect(normalizeExclusionEntry("https://centerphone.com.ar/producto/samsung-galaxy-a15/")).toBe(
      "samsung-galaxy-a15",
    );
    expect(normalizeExclusionEntry("https://centerphone.com.ar/producto/6233?utm=google#top")).toBe("6233");
  });

  it("acepta links de otra web usando el último segmento", () => {
    expect(normalizeExclusionEntry("https://proveedor.com/articulos/ABC-12/")).toBe("abc-12");
  });

  it("ignora líneas vacías y comentarios", () => {
    expect(normalizeExclusionEntry("")).toBe("");
    expect(normalizeExclusionEntry("   ")).toBe("");
    expect(normalizeExclusionEntry("# no va más")).toBe("");
  });

  it("junta todo en una lista sin repetidos", () => {
    const raw = ["6233", "/producto/6233", "", "https://centerphone.com.ar/producto/9999", "# comentario"].join("\n");
    expect(parseExclusionList(raw)).toEqual(["6233", "9999"]);
  });

  it("compara contra el id del producto sin importar mayúsculas", () => {
    const set = exclusionSet("/producto/Samsung-Galaxy-A15");
    expect(isExcluded(set, "samsung-galaxy-a15")).toBe(true);
    expect(isExcluded(set, "Samsung-Galaxy-A15")).toBe(true);
    expect(isExcluded(set, "6233")).toBe(false);
    expect(isExcluded(exclusionSet(""), "6233")).toBe(false);
  });

  it("al guardar conserva lo que pegó el dueño, sin repetidos", () => {
    const raw = "6233\nhttps://centerphone.com.ar/producto/6233\n\n# nota\n/producto/9999\n";
    expect(sanitizeSyncExcludeList(raw)).toBe("6233\n/producto/9999");
  });

  it("acota una lista gigante", () => {
    const raw = Array.from({ length: 500 }, (_, i) => `p-${i}`).join("\n");
    expect(sanitizeSyncExcludeList(raw).split("\n")).toHaveLength(300);
  });
});
