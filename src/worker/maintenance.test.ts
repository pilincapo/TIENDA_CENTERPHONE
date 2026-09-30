import { describe, expect, it } from "vitest";
import { isMaintenanceBypass, maintenanceHtml } from "./maintenance";
import { DEFAULT_SETTINGS, type StoreSettings } from "../shared/types";

const settings = (over: Partial<StoreSettings> = {}): StoreSettings => ({
  ...DEFAULT_SETTINGS,
  whatsappPhone: "549345555555",
  instagramUrl: "https://www.instagram.com/centerphonesantafe",
  facebookUrl: "",
  maintenanceMode: true,
  ...over,
});

describe("isMaintenanceBypass", () => {
  it("deja pasar panel, pedidos, webhook y estáticos", () => {
    for (const p of [
      "/admin", "/admin/", "/admin/index.html", "/api/admin/login", "/api/admin/orders",
      "/pedido/abc123", "/api/orders/abc123", "/api/payments/webhook", "/seguimiento",
      "/assets/catalog-1.js", "/favicon.png", "/logo.jpg", "/404.html", "/_app/x.css",
    ]) {
      expect(isMaintenanceBypass(p), p).toBe(true);
    }
  });

  it("bloquea catálogo, fichas y APIs públicas de compra", () => {
    for (const p of ["/", "/producto/x", "/api/catalog", "/api/products/x", "/api/checkout", "/api/orders/transfer", "/api/track"]) {
      expect(isMaintenanceBypass(p), p).toBe(false);
    }
  });
});

describe("maintenanceHtml", () => {
  it("incluye WhatsApp, Instagram y escapa el mensaje", () => {
    const html = maintenanceHtml(settings({ maintenanceMessage: 'Actualizando <b>el</b> sistema' }), "CenterPhone");
    expect(html).toContain("https://wa.me/549345555555");
    expect(html).toContain("instagram.com/centerphonesantafe");
    expect(html).toContain("Actualizando &lt;b&gt;el&lt;/b&gt; sistema");
    expect(html).toContain("CenterPhone está en mantenimiento");
  });

  it("usa el mensaje por defecto cuando no hay configurado y omite redes vacías", () => {
    const html = maintenanceHtml(settings({ maintenanceMessage: "", instagramUrl: "", facebookUrl: "" }), "Mi tienda");
    expect(html).toContain("Estamos actualizando la tienda");
    expect(html).not.toContain("class=\"social\"");
    expect(html).toContain("Mi tienda está en mantenimiento");
  });
});
