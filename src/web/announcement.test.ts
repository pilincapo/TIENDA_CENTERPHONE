import { describe, expect, it } from "vitest";
import { announcementHtml, ANNOUNCEMENT_ID } from "./announcement";

describe("announcementHtml", () => {
  it("sin texto no renderiza nada", () => {
    expect(announcementHtml("")).toBe("");
    expect(announcementHtml("   ")).toBe("");
    expect(announcementHtml(null)).toBe("");
    expect(announcementHtml(undefined)).toBe("");
  });

  it("con texto arma la cinta con el id esperado", () => {
    const html = announcementHtml("📦 Envío gratis en Santa Fe");
    expect(html).toContain(`id="${ANNOUNCEMENT_ID}"`);
    expect(html).toContain("📦 Envío gratis en Santa Fe");
    expect(html).toContain('class="announce"');
  });

  it("escapa el HTML del texto configurado", () => {
    const html = announcementHtml('<img src=x onerror="alert(1)"> & "cuotas"');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("recorta espacios de los extremos", () => {
    expect(announcementHtml("  Oferta  ")).toContain(">Oferta<");
  });
});
