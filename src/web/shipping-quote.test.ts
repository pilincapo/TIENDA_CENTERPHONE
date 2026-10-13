import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  savedPostalCode, savePostalCode, cartItemsParam, shippingQuoteHtml,
  quoteInitialState, errorState, doneState, fetchQuote,
} from "./shipping-quote";
import type { PublicSettings } from "./types-web";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => { store.set(k, v); },
    removeItem: (k: string): void => { store.delete(k); },
  });
});

const settings = (enabled: boolean): PublicSettings =>
  ({
    whatsappPhone: "", currencySymbol: "$", whatsappOk: true, storeName: "", storeAddress: "",
    storeMapUrl: "", storeHours: "", instagramUrl: "", facebookUrl: "", trackUrl: "",
    howSteps: "", howTitle: "", howPickupNote: "", freshHours: 0, storeMode: "tienda",
    paymentsEnabled: true, checkoutNote: "", mpSurchargePercent: 0, transferDiscountPercent: 0,
    transferCbu: "", maintenanceMode: false, shippingAndreaniEnabled: enabled,
    shippingPostalCode: "3000", shippingPackageKilos: 0.5, shippingPackageVolumen: 1080,
  }) as PublicSettings;

describe("CP guardado", () => {
  it("sanitiza y persiste solo dígitos válidos", () => {
    savePostalCode(" 3000 ");
    expect(savedPostalCode()).toBe("3000");
    savePostalCode("12"); // muy corto: no se guarda
    expect(savedPostalCode()).toBe("3000");
  });

  it("devuelve null con storage corrupto o vacío", () => {
    expect(savedPostalCode()).toBe(null);
    store.set("center_shipping_cp", "abcdé");
    expect(savedPostalCode()).toBe(null);
  });
});

describe("cartItemsParam", () => {
  it("serializa id:qty y clampea qty mínima", () => {
    expect(cartItemsParam([{ id: "a", qty: 2 }, { id: "b", qty: 0 }])).toBe("a:2,b:1");
  });
});

describe("quoteInitialState", () => {
  it("hidden sin config o con carrito vacío", () => {
    expect(quoteInitialState(settings(false), [{ id: "a", qty: 1 }]).hidden).toBe(true);
    expect(quoteInitialState(settings(true), []).hidden).toBe(true);
  });

  it("con CP guardado sale cotizando (loading); sin CP, formulario", () => {
    savePostalCode("1010");
    const s = quoteInitialState(settings(true), [{ id: "a", qty: 1 }]);
    expect(s.status).toBe("loading");
    expect(s.cp).toBe("1010");
    expect(quoteInitialState(settings(true), [{ id: "a", qty: 1 }]).status).toBe("loading");
  });

  it("sin CP guardado muestra el input", () => {
    const s = quoteInitialState(settings(true), [{ id: "a", qty: 1 }]);
    expect(s.status).toBe("input");
  });
});

describe("shippingQuoteHtml", () => {
  it("estado input: formulario con summary e input", () => {
    const html = shippingQuoteHtml({ status: "input", cp: "", priceCents: 0 }, "$");
    expect(html).toContain("Calculá tu envío");
    expect(html).toContain("ship-quote-cp");
    expect(html).not.toContain("$");
  });

  it("estado done: CP y precio formateado, sin formulario", () => {
    const html = shippingQuoteHtml(doneState("3000", 254100), "$",);
    expect(html).toContain("Envío a 3000");
    expect(html).toContain("$2.541");
    expect(html).not.toContain("Calculá tu envío");
    expect(html).toContain("data-ship-edit");
  });

  it("estado done sin CP: no renderiza nada (cotización anulada)", () => {
    expect(shippingQuoteHtml(doneState("", 254100), "$")).toBe("");
  });

  it("estado error: detalle visible y form abierto", () => {
    const html = shippingQuoteHtml(errorState("3000", "Andreani respondió 500"), "$");
    expect(html).toContain("Andreani respondió 500");
    expect(html).toContain("<details open>");
  });

  it("hidden=true: no renderiza nada (cotizador deshabilitado o carrito vacío)", () => {
    const st = doneState("3000", 1000);
    st.hidden = true;
    expect(shippingQuoteHtml(st, "$")).toBe("");
  });
});

describe("fetchQuote", () => {
  it("devuelve priceCents en ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, priceCents: 55500 }), { status: 200 }),
    ));
    const r = await fetchQuote("3000", [{ id: "a", qty: 2 }]);
    expect(r).toEqual({ ok: true, priceCents: 55500 });
  });

  it("mapea error y disabled del worker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "Código postal inválido" }), { status: 400 }),
    ));
    expect(await fetchQuote("12", [])).toEqual({ ok: false, error: "Código postal inválido" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, disabled: true }), { status: 200 }),
    ));
    const r = await fetchQuote("3000", []);
    expect(r.ok).toBe(false);
    expect(r.disabled).toBe(true);
  });
});
