import { describe, expect, it } from "vitest";
import { cartTransferBanner, discountCentsFor, discountPercentFrom, productTransferLine } from "./transfer-banner";

describe("discountPercentFrom", () => {
  it("acota a 0-50 y redondea a entero (misma regla que el worker)", () => {
    expect(discountPercentFrom(10)).toBe(10);
    expect(discountPercentFrom(10.6)).toBe(11);
    expect(discountPercentFrom(-5)).toBe(0);
    expect(discountPercentFrom(80)).toBe(50);
    expect(discountPercentFrom(0)).toBe(0);
  });

  it("basura no numérica o ausente = 0", () => {
    expect(discountPercentFrom(undefined)).toBe(0);
    expect(discountPercentFrom(null)).toBe(0);
    expect(discountPercentFrom("hola")).toBe(0);
    expect(discountPercentFrom("")).toBe(0);
  });
});

describe("discountCentsFor", () => {
  it("usa el mismo redondeo que finalizeOrder (Math.round sobre el total)", () => {
    // 68.160 * 10% = 6.816 exacto.
    expect(discountCentsFor(6_816_000, 10)).toBe(681_600);
    // Redondeo del worker: Math.round(33.600 * 10 / 100) = Math.round(3360) = 3360.
    expect(discountCentsFor(3_360_000, 10)).toBe(336_000);
    // Caso con decimal que redondea: Math.round(12345 * 7.5 / 100) → pct es entero,
    // pero el total puede ser impar de centavos: 333 * 10 / 100 = 33.3 → 33.
    expect(discountCentsFor(333, 10)).toBe(33);
    expect(discountCentsFor(335, 10)).toBe(34); // .5 redondea hacia arriba
  });

  it("sin descuento o total en cero no descuenta nada", () => {
    expect(discountCentsFor(100_000, 0)).toBe(0);
    expect(discountCentsFor(0, 10)).toBe(0);
    expect(discountCentsFor(-100, 10)).toBe(0);
  });
});

describe("cartTransferBanner", () => {
  it("con descuento genera pastilla, precio tachado, total final y ahorro", () => {
    const html = cartTransferBanner(6_816_000, 10, "$");
    expect(html).toContain("cart-transfer-pill");
    expect(html).toContain(">-10%</");
    expect(html).toContain('<s class="cart-transfer-was">$68.160</s>');
    expect(html).toContain('<b class="cart-transfer-now">$61.344</b>');
    expect(html).toContain("Ahorrás $6.816 pagando por transferencia");
    expect(html).toContain("Consultar este pedido");
  });

  it("con pct = 0 o total en cero devuelve cadena vacía", () => {
    expect(cartTransferBanner(6_816_000, 0, "$")).toBe("");
    expect(cartTransferBanner(6_816_000, undefined, "$")).toBe("");
    expect(cartTransferBanner(0, 10, "$")).toBe("");
  });

  it("el total final coincide con la fórmula del worker", () => {
    const total = 123_457; // centavos con resto
    const html = cartTransferBanner(total, 7, "$");
    const esperado = total - Math.round((total * 7) / 100);
    // "$1.235" aprox: calculamos con formatPrice equivalente.
    expect(html).toContain(`$${Math.round(esperado / 100).toLocaleString("es-AR")}`);
  });
});

describe("productTransferLine", () => {
  it("línea compacta con pastilla, final en negrita y de lista tachado", () => {
    const html = productTransferLine(6_816_000, 10, "$");
    expect(html).toContain("price-transfer-pill");
    expect(html).toContain(">-10%</");
    expect(html).toContain("Por transferencia: <b>$61.344</b> <s>$68.160</s>");
  });

  it("sin descuento no renderiza nada", () => {
    expect(productTransferLine(6_816_000, 0, "$")).toBe("");
    expect(productTransferLine(6_816_000, "abc", "$")).toBe("");
    expect(productTransferLine(0, 10, "$")).toBe("");
  });
});
