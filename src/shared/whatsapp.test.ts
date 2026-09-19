import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone, waLink, waLinkText } from "./whatsapp";
import type { Product } from "./types";

const settings = {
  whatsappPhone: "+54 9 11 1234-5678",
  currencySymbol: "$",
  syncUrl: "",
  syncIntervalMinutes: 60,
  syncToken: "",
};

const product: Product = {
  id: "galaxy-s24",
  title: 'Galaxy S24 "Ultra"',
  description: "",
  priceCents: 129999900,
  categoryId: "sam",
  subcategoryId: null,
  tags: [],
  imageUrl: "",
  status: "published",
  availability: "in_stock",
  sortOrder: 0,
};

describe("normalizePhone", () => {
  it("deja solo dígitos", () => {
    expect(normalizePhone("+54 9 11 1234-5678")).toBe("5491112345678");
  });
});

describe("isValidPhone", () => {
  it("acepta entre 10 y 15 dígitos", () => {
    expect(isValidPhone("5491112345678")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("waLink", () => {
  it("incluye número, título y precio, sin URL del producto", () => {
    const link = waLink(settings, product, "https://tienda.example");
    expect(link.startsWith("https://wa.me/5491112345678?text=")).toBe(true);
    const text = decodeURIComponent(link.split("text=")[1] ?? "");
    expect(text).toContain('Galaxy S24 "Ultra"');
    expect(text).toContain("$1.299.999");
    expect(text).not.toContain("https://");
  });

  it("URL-encodea el mensaje", () => {
    const link = waLink(settings, product, "https://x.y");
    expect(link).not.toContain(" ");
  });
});

describe("waLinkText", () => {
  it("arma link de consulta general", () => {
    expect(waLinkText(settings, "Hola!")).toBe(
      "https://wa.me/5491112345678?text=Hola!"
    );
  });
});
