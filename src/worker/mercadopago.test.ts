import { describe, expect, it, vi, afterEach } from "vitest";
import { createPreference, fetchPayment, mpItems } from "./mercadopago";
import type { OrderItem } from "../shared/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const items: OrderItem[] = [
  { id: "p1", title: "iPhone 13 128GB", qty: 2, priceCents: 50000000 },
  { id: "p2", title: "Funda", qty: 1, priceCents: 990000 },
];

describe("mpItems", () => {
  it("convierte centavos a pesos y acota campos", () => {
    const mp = mpItems(items);
    expect(mp).toEqual([
      { id: "p1", title: "iPhone 13 128GB", quantity: 2, unit_price: 500000, currency_id: "ARS" },
      { id: "p2", title: "Funda", quantity: 1, unit_price: 9900, currency_id: "ARS" },
    ]);
  });
});

describe("createPreference", () => {
  it("arma el payload Checkout Pro correcto y devuelve el init_point", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "pref-123", init_point: "https://mpago.la/xyz" }),
      { status: 201 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPreference({
      token: "TEST-token", orderId: "order-1", items, buyerName: "Juan", buyerPhone: "342 555 1234",
      siteUrl: "https://centerphone.com.ar",
    });

    expect(result.ok).toBe(true);
    expect(result.preferenceId).toBe("pref-123");
    expect(result.initPoint).toBe("https://mpago.la/xyz");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/checkout/preferences");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer TEST-token");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["external_reference"]).toBe("order-1");
    expect(body["auto_return"]).toBe("approved");
    const back = body["back_urls"] as Record<string, string>;
    for (const key of ["success", "pending", "failure"]) {
      expect(back[key]).toBe("https://centerphone.com.ar/pedido/order-1");
    }
    // Los montos van en pesos (no centavos) y la moneda es ARS.
    expect((body["items"] as { unit_price: number }[])[0]!.unit_price).toBe(500000);
  });

  it("propaga el error real de MP cuando la API rechaza", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "invalid token" }),
      { status: 401 },
    )));
    const result = await createPreference({
      token: "malo", orderId: "o", items, buyerName: "", buyerPhone: "", siteUrl: "https://x.com",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid token");
  });

  it("no explota si MP no responde", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await createPreference({
      token: "t", orderId: "o", items, buyerName: "", buyerPhone: "", siteUrl: "https://x.com",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
  });
});

describe("fetchPayment (webhook re-consulta la API)", () => {
  it("marca approved solo con status approved y pasa external_reference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 123, status: "approved", external_reference: "order-1", test_mode: false }),
      { status: 200 },
    )));
    const r = await fetchPayment("t", "123");
    expect(r.found).toBe(true);
    expect(r.approved).toBe(true);
    expect(r.externalReference).toBe("order-1");
  });

  it("no marca approved para pagos pendientes ni de prueba (test_mode)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ id: 1, status: "pending", external_reference: "order-1", test_mode: false }),
      { status: 200 },
    )));
    expect((await fetchPayment("t", "1")).approved).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ id: 2, status: "approved", external_reference: "order-1", test_mode: true }),
      { status: 200 },
    )));
    expect((await fetchPayment("t", "2")).isTest).toBe(true);
    expect((await fetchPayment("t", "2")).approved).toBe(true);
  });

  it("devuelve found:false si MP rechaza o falla la red", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect((await fetchPayment("t", "999")).found).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect((await fetchPayment("t", "999")).found).toBe(false);
  });
});
