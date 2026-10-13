import { describe, expect, it, vi, afterEach } from "vitest";
import { andreaniQuote, andreaniResetCache, armarBulto } from "./andreani";

afterEach(() => {
  vi.restoreAllMocks();
  andreaniResetCache();
});

describe("armarBulto", () => {
  it("suma peso y volumen por cantidad y usa el precio como valor declarado", () => {
    const b = armarBulto(
      [{ priceCents: 450_000, qty: 2 }, { priceCents: 300_000, qty: 1 }],
      { kilos: 0.5, volumen: 1080 },
    );
    expect(b.kilos).toBe(1.5); // 3 unidades × 0.5
    expect(b.volumen).toBe(3240); // 3 × 1080
    expect(b.valorDeclarado).toBe(12000); // (450000 + 300000) / 100 → pesos
  });

  it("no baja de un mínimo con carrito chico (KV no, solo límites físicos)", () => {
    const b = armarBulto([{ priceCents: 100, qty: 1 }], { kilos: 0.01, volumen: 10 });
    expect(b.kilos).toBe(0.1);
    expect(b.volumen).toBe(100);
  });

  it("tolera cantidades inválidas sin romper", () => {
    const b = armarBulto([{ priceCents: 100_000, qty: Number("x") }], { kilos: 0.5, volumen: 1080 });
    expect(b.kilos).toBe(0.1); // cantidad 0 → mínimo físico
    expect(b.valorDeclarado).toBe(0);
  });
});

describe("andreaniQuote (fetch mockeado)", () => {
  const env = { ANDREANI_USER: "u", ANDREANI_PASSWORD: "p" };

  it("mapea tarifa (pesos → centavos) y peso aforado", async () => {
    const login = new Response(null, { status: 200, headers: { "x-authorization-token": "tok-1" } });
    const quote = new Response(JSON.stringify({ tarifa: 25.41, peso_aforado: 1000 }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      return String(url).includes("/login") ? login : quote;
    }));
    const r = await andreaniQuote(env, {
      cpDestino: "3000", contrato: "AND00EST", cliente: "CL0001",
      bultos: [{ kilos: 0.5, volumen: 1080, valorDeclarado: 4500 }],
    });
    expect(r.ok).toBe(true);
    expect(r.tarifa).toBe(2541); // 25.41 ARS × 100
    expect(r.pesoAforado).toBe(1000);
  });

  it("arma la URL con bultos anidados (formato bultos[0][kilos]) en la query", async () => {
    let quoteUrl = "";
    const login = new Response(null, { status: 200, headers: { "x-authorization-token": "tok-2" } });
    const quote = new Response(JSON.stringify({ tarifa: 100 }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).includes("/login")) return login;
      quoteUrl = String(url);
      return quote;
    }));
    await andreaniQuote(env, {
      cpDestino: "1406", contrato: "AND00SUC", cliente: "CL9",
      bultos: [{ kilos: 1.5, volumen: 3240, valorDeclarado: 1200 }],
    });
    expect(quoteUrl).toContain("cpDestino=1406");
    expect(quoteUrl).toContain("contrato=AND00SUC");
    expect(quoteUrl).toContain("cliente=CL9");
    expect(quoteUrl).toContain(encodeURIComponent("bultos[0][kilos]") + "=1.5");
    expect(quoteUrl).toContain(encodeURIComponent("bultos[0][volumen]") + "=3240");
    expect(quoteUrl).toContain(encodeURIComponent("bultos[0][valorDeclarado]") + "=1200");
  });

  it("reintenta con token fresco tras un 401 (token vencido)", async () => {
    const login = new Response(null, { status: 200, headers: { "x-authorization-token": "tok-3" } });
    let quoteCalls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).includes("/login")) return login;
      quoteCalls++;
      return quoteCalls === 1
        ? new Response(JSON.stringify({ message: "no autorizado" }), { status: 401 })
        : new Response(JSON.stringify({ tarifa: 50 }), { status: 200 });
    }));
    // Primer intento: 401 → re-login automático dentro del mismo request → tarifa OK.
    const r = await andreaniQuote(env, {
      cpDestino: "3000", contrato: "C", cliente: "CL",
      bultos: [{ kilos: 0.5, valorDeclarado: 1000 }],
    });
    expect(r.ok).toBe(true);
    expect(r.tarifa).toBe(5000); // 50 ARS → centavos
    expect(quoteCalls).toBe(2); // 1 falló con 401 + 1 reintentada
  });

  it("devuelve error claro si faltan credenciales", async () => {
    andreaniResetCache(); // sin token precacheado: debe fallar sin llamar
    let called = 0;
    vi.stubGlobal("fetch", vi.fn(() => { called++; return new Response(null, { status: 200 }); }));
    const r = await andreaniQuote(
      { ANDREANI_USER: "", ANDREANI_PASSWORD: "" },
      { cpDestino: "3000", contrato: "C", cliente: "CL", bultos: [{ valorDeclarado: 1 }] },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("credenciales");
    expect(called).toBe(0);
  });

  it("invalida el cache cuando el login responde sin token", async () => {
    let logins = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).includes("/login")) {
        logins++;
        return new Response(null, { status: 200 }); // sin header de token
      }
      return new Response(JSON.stringify({ tarifa: 1 }), { status: 200 });
    }));
    const r = await andreaniQuote(env, {
      cpDestino: "3000", contrato: "C", cliente: "CL", bultos: [{ valorDeclarado: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(logins).toBe(1);
    expect(r.error).toContain("sin token");
  });
});
