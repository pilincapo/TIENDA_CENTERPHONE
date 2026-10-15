import { describe, expect, it } from "vitest";
import { announcementHtml, announcementPromos, rotateEveryMs, ANNOUNCEMENT_ID } from "./announcement";

describe("announcementHtml", () => {
  it("sin texto no renderiza nada", () => {
    expect(announcementHtml("")).toBe("");
    expect(announcementHtml("   ")).toBe("");
    expect(announcementHtml(null)).toBe("");
    expect(announcementHtml(undefined)).toBe("");
    expect(announcementHtml("\n   \n\t")).toBe(""); // solo líneas vacías = sin promos
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

  it("una sola promo queda encendida y sin pista (estático = HTML de siempre)", () => {
    const html = announcementHtml("Solo una");
    expect(html).toContain('<span class="announce-msg is-on">Solo una</span>');
    expect((html.match(/announce-msg/g) ?? []).length).toBe(1);
    expect(html).not.toContain("announce-track");
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

  it("cada movimiento agrega su modificador y envuelve la promo en la pista", () => {
    for (const m of ["marquee", "swing", "fade"] as const) {
      const html = announcementHtml("📦 Envío gratis", m);
      expect(html).toContain(`class="announce announce--${m}"`);
      expect(html).toContain(
        '<span class="announce-track"><span class="announce-msg is-on">📦 Envío gratis</span></span>',
      );
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

describe("varias promos (una por línea)", () => {
  it("cada línea no vacía es una promo y solo la primera arranca encendida", () => {
    const html = announcementHtml("Promo uno\nPromo dos\nPromo tres");
    expect(html).toContain('<span class="announce-msg is-on">Promo uno</span>');
    expect(html).toContain('<span class="announce-msg">Promo dos</span>');
    expect(html).toContain('<span class="announce-msg">Promo tres</span>');
    expect((html.match(/is-on/g) ?? []).length).toBe(1);
    expect(html).not.toContain("\n"); // el HTML no arrastra los saltos crudos
  });

  it("announcementPromos descarta vacías y recorta cada línea", () => {
    expect(announcementPromos("  Uno  \n\n   \nDos  ")).toEqual(["Uno", "Dos"]);
    expect(announcementPromos(null)).toEqual([]);
  });

  it("nunca pasa de MAX_ANNOUNCEMENT_PROMOS (5)", () => {
    const muchas = Array.from({ length: 9 }, (_, i) => `P${i + 1}`).join("\n");
    expect(announcementPromos(muchas)).toHaveLength(5);
    const html = announcementHtml(muchas);
    expect((html.match(/announce-msg/g) ?? []).length).toBe(5);
    expect(html).toContain(">P5<");
    expect(html).not.toContain(">P6<");
  });

  it("con movimiento, todas las promos van dentro de la pista y escapadas", () => {
    const html = announcementHtml('<b>a</b>\nSegunda promo', "swing");
    expect(html).toContain(
      '<span class="announce-track"><span class="announce-msg is-on">&lt;b&gt;a&lt;/b&gt;</span><span class="announce-msg">Segunda promo</span></span>',
    );
    expect(html).toContain('class="announce announce--swing"');
  });
});

describe("velocidad de la animación y la rotación", () => {
  it('"normal" (o ausente) no agrega modificador: el HTML de siempre, igualito', () => {
    for (const speed of [undefined, null, "normal"] as const) {
      const html = announcementHtml("Oferta", "marquee", speed);
      expect(html).toContain('class="announce announce--marquee"');
      expect(html).not.toContain("announce--fast");
      expect(html).not.toContain("announce--slow");
    }
    // Estático + normal: ni siquiera el de movimiento.
    expect(announcementHtml("Oferta", undefined, "normal")).not.toContain("announce--");
  });

  it('lento y rápido agregan su modificador junto al de movimiento', () => {
    expect(announcementHtml("A\nB", "swing", "slow")).toContain('class="announce announce--swing announce--slow"');
    expect(announcementHtml("A\nB", "fade", "fast")).toContain('class="announce announce--fade announce--fast"');
    // Estático + velocidad: solo el de velocidad.
    expect(announcementHtml("A\nB", "none", "fast")).toContain('class="announce announce--fast"');
  });

  it("una velocidad desconocida cae a normal (sin modificador, nunca rompe)", () => {
    const html = announcementHtml("Oferta", "marquee", "turbo" as never);
    expect(html).toContain('class="announce announce--marquee"');
    expect(html).not.toContain("announce--turbo");
    expect(html).not.toContain("announce--fast");
    expect(html).not.toContain("announce--slow");
  });

  it("slow alarga y fast acorta el intervalo de rotación respecto de normal", () => {
    // Base: marquee 18000, fade 7000, swing 8000, none 6000 (velocidad normal).
    expect(rotateEveryMs("marquee", "normal")).toBe(18000);
    expect(rotateEveryMs("fade", "normal")).toBe(7000);
    expect(rotateEveryMs("swing", "normal")).toBe(8000);
    expect(rotateEveryMs("none", "normal")).toBe(6000);
    for (const m of ["marquee", "fade", "swing", "none"] as const) {
      expect(rotateEveryMs(m, "slow")).toBeGreaterThan(rotateEveryMs(m, "normal"));
      expect(rotateEveryMs(m, "fast")).toBeLessThan(rotateEveryMs(m, "normal"));
    }
    // Concreto: marquee rápido = barrido a 0.55× (9900 ms).
    expect(rotateEveryMs("marquee", "fast")).toBe(9900);
    expect(rotateEveryMs("marquee", "slow")).toBe(32400); // 18000 × 1.8
  });
});
