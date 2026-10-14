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

describe("announcementHtml con movimiento", () => {
  it('por defecto (o con "none") la cinta queda estática, como siempre', () => {
    for (const html of [announcementHtml("Oferta"), announcementHtml("Oferta", "none")]) {
      expect(html).toContain('class="announce"');
      expect(html).not.toContain("announce--");
      expect(html).not.toContain("announce-track");
      expect(html).toContain(">Oferta<");
    }
  });

  it("cada movimiento agrega su modificador y envuelve el texto en la pista", () => {
    for (const m of ["marquee", "swing", "fade"] as const) {
      const html = announcementHtml("📦 Envío gratis", m);
      expect(html).toContain(`class="announce announce--${m}"`);
      expect(html).toContain('<span class="announce-track">📦 Envío gratis</span>');
      expect(html).toContain(`id="${ANNOUNCEMENT_ID}"`);
    }
  });

  it("un movimiento desconocido cae a estático (nunca rompe el HTML)", () => {
    const html = announcementHtml("Oferta", "slicer" as never);
    expect(html).toContain('class="announce"');
    expect(html).not.toContain("announce--");
    expect(html).not.toContain("announce-track");
  });

  it("con movimiento sigue escapando el texto y no se renderiza vacío", () => {
    const html = announcementHtml('<b>"promo"</b>', "marquee");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(announcementHtml("   ", "marquee")).toBe("");
  });
});
