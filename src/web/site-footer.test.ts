// El pie es el único lugar donde el visitante encuentra los enlaces legales en
// todas las páginas: si se rompe o deja de escaparse el texto del panel, hay
// riesgo de XSS y de incumplir la información obligatoria al consumidor.
import { describe, expect, it } from "vitest";
import { footerHtml, LEGAL_LINKS, TITULAR, CUIT } from "./site-footer";
import type { PublicSettings } from "./types-web";

function settings(over: Partial<PublicSettings> = {}): PublicSettings {
  return {
    whatsappPhone: "5493425819402",
    currencySymbol: "$",
    whatsappOk: true,
    storeName: "CenterPhone Celulares",
    storeAddress: "Mendoza 2974 · Santa Fe",
    storeMapUrl: "https://maps.google.com/?q=Mendoza+2974",
    storeHours: "Lunes a viernes: 9:00 a 19:00\nSábados: 10:00 a 13:00",
    instagramUrl: "https://www.instagram.com/centerphonesantafe",
    facebookUrl: "https://www.facebook.com/centerphonesantafe",
    trackUrl: "",
    howSteps: "",
    howTitle: "Cómo comprar",
    howPickupNote: "",
    freshHours: 168,
    storeMode: "tienda",
    paymentsEnabled: true,
    checkoutNote: "",
    mpSurchargePercent: 0,
    transferDiscountPercent: 0,
    transferCbu: "",
    loyaltyEnabled: false,
    loyaltyName: "Club CenterPhone",
    loyaltyDiscountPercent: 10,
    loyaltyWelcomeText: "",
    googleReviewsEnabled: false,
    googleReviewsRating: 0,
    googleReviewsCount: 0,
    googleReviewUrl: "",
    maintenanceMode: false,
    announcementBar: "",
    announcementMotion: "none",
    announcementSpeed: "normal",
    shippingAndreaniEnabled: false,
    shippingPostalCode: "",
    shippingPackageKilos: 0.5,
    shippingPackageVolumen: 1080,
    ...over,
  };
}

describe("footerHtml", () => {
  it("incluye los tres enlaces legales en la columna LEGAL", () => {
    const html = footerHtml(settings());
    expect(html).toContain(">Legal<");
    for (const l of LEGAL_LINKS) {
      expect(html).toContain(`href="${l.href}"`);
      expect(html).toContain(`>${l.label}<`);
    }
    // El botón de arrepentimiento va al formulario, no al texto de la política.
    expect(html).toContain('href="/devoluciones"');
  });

  it("identifica al titular y el CUIT (información obligatoria)", () => {
    const html = footerHtml(settings());
    expect(html).toContain(TITULAR);
    expect(html).toContain(CUIT);
    expect(html).toContain("Mendoza 2974, Santa Fe, Argentina");
  });

  it("usa los datos del panel: marca, horarios y dirección con mapa", () => {
    const html = footerHtml(settings({ storeName: "Tienda Demo", storeMapUrl: "https://maps.example/x" }));
    expect(html).toContain(">Tienda Demo<");
    expect(html).toContain("Lunes a viernes: 9:00 a 19:00<br/>Sábados: 10:00 a 13:00");
    expect(html).toContain('href="https://maps.example/x"');
  });

  it("escapa el contenido configurable (sin HTML inyectado)", () => {
    const html = footerHtml(
      settings({
        storeName: '<img src=x onerror="alert(1)">',
        storeAddress: "<b>dirección</b>",
        instagramUrl: 'https://x.test/"><script>alert(1)</script>',
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
  });

  it("sin redes ni dirección muestra los huecos sin botones vacíos", () => {
    const html = footerHtml(settings({ instagramUrl: "", facebookUrl: "", storeAddress: "", storeHours: "" }));
    expect(html).not.toContain("footer-social-btn");
    expect(html).toContain('<ul class="footer-legal">'); // la columna legal sigue
    expect(html).toContain("—"); // horarios/dirección no configurados
  });
});
