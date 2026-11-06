// Funciones puras del Club: normalización del WhatsApp (es la clave para
// recuperar el código), formato del código, cumpleaños y matemática del
// descuento. Si esto cambia, el carrito y el worker se desalinean.
import { describe, expect, it } from "vitest";
import {
  MEMBER_TIERS, birthdayInMonth, birthdayLabel, birthdayMonthDay, effectiveMemberPercent, firstName,
  isValidMemberCode, isValidMemberPhone, memberDiscountCents, memberDiscountPercent, memberTierPercent,
  normalizeMemberCode, normalizeMemberPhone,
} from "./loyalty";

describe("normalizeMemberPhone", () => {
  it("unifica el mismo número escrito de formas distintas", () => {
    expect(normalizeMemberPhone("342 581 9402")).toBe("3425819402");
    expect(normalizeMemberPhone("0342 581 9402")).toBe("3425819402");
    expect(normalizeMemberPhone("+54 9 342 581 9402")).toBe("3425819402");
    expect(normalizeMemberPhone("5493425819402")).toBe("3425819402");
    expect(normalizeMemberPhone("(0342) 581-9402")).toBe("3425819402");
  });

  it("no inventa números con datos basura", () => {
    expect(normalizeMemberPhone("")).toBe("");
    expect(normalizeMemberPhone(null)).toBe("");
    expect(normalizeMemberPhone("abc")).toBe("");
  });
});

describe("isValidMemberPhone", () => {
  it("acepta entre 8 y 11 dígitos", () => {
    expect(isValidMemberPhone("3425819402")).toBe(true);
    expect(isValidMemberPhone("34258194")).toBe(true);
    expect(isValidMemberPhone("3425819")).toBe(false);
    expect(isValidMemberPhone("342581940212")).toBe(false);
  });
});

describe("código de socio", () => {
  it("normaliza a mayúsculas y valida el alfabeto sin caracteres ambiguos", () => {
    expect(normalizeMemberCode(" soc-abc234 ")).toBe("SOC-ABC234");
    expect(isValidMemberCode("SOC-ABC234")).toBe(true);
    // 0/O/1/I/L no existen en el alfabeto: el código se dicta por teléfono.
    expect(isValidMemberCode("SOC-ABCI23")).toBe(false);
    expect(isValidMemberCode("SOC-ABC23")).toBe(false);
    expect(isValidMemberCode("ABC-ABC234")).toBe(false);
  });
});

describe("descuento de socio", () => {
  it("redondea igual que el worker y acota el porcentaje a 0-50", () => {
    expect(memberDiscountPercent(10)).toBe(10);
    expect(memberDiscountPercent(80)).toBe(50);
    expect(memberDiscountPercent(-5)).toBe(0);
    expect(memberDiscountPercent("raro")).toBe(0);
    expect(memberDiscountCents(50_000_000, 10)).toBe(5_000_000);
    expect(memberDiscountCents(999, 10)).toBe(100); // Math.round(99.9)
    expect(memberDiscountCents(0, 10)).toBe(0);
  });

  it("solo acepta los niveles 5, 10 y 15", () => {
    expect(MEMBER_TIERS).toEqual([5, 10, 15]);
    expect(memberTierPercent(5)).toBe(5);
    expect(memberTierPercent("15")).toBe(15);
    expect(memberTierPercent(7)).toBeNull();
    expect(memberTierPercent(20)).toBeNull();
    expect(memberTierPercent(null)).toBeNull();
    expect(memberTierPercent("")).toBeNull();
  });

  it("usa el nivel del socio y, sin nivel, el base de la configuración", () => {
    expect(effectiveMemberPercent(15, 5)).toBe(15);
    expect(effectiveMemberPercent(5, 15)).toBe(5);
    expect(effectiveMemberPercent(null, 10)).toBe(10);
    expect(effectiveMemberPercent(undefined, 10)).toBe(10);
    // Un valor viejo que no es nivel cae al base, no rompe el carrito.
    expect(effectiveMemberPercent(12, 10)).toBe(10);
    expect(effectiveMemberPercent(null, 0)).toBe(0);
  });
});

describe("cumpleaños", () => {
  it("guarda solo día y mes, aceptando fecha completa o día/mes", () => {
    expect(birthdayMonthDay("1995-05-12")).toBe("05-12");
    expect(birthdayMonthDay("12/05")).toBe("05-12");
    expect(birthdayMonthDay("05-12")).toBe("05-12");
    expect(birthdayMonthDay("2026-02-30")).toBeNull(); // no existe
    expect(birthdayMonthDay("1995-13-01")).toBeNull();
    expect(birthdayMonthDay("")).toBeNull();
  });

  it("formatea y detecta el mes para el panel", () => {
    expect(birthdayLabel("05-12")).toBe("12/05");
    expect(birthdayLabel(null)).toBe("");
    expect(birthdayInMonth("05-12", 4)).toBe(true);
    expect(birthdayInMonth("05-12", 0)).toBe(false);
  });
});

describe("firstName", () => {
  it("solo devuelve el primer nombre", () => {
    expect(firstName("  Ana María Gómez ")).toBe("Ana");
    expect(firstName("")).toBe("");
  });
});
