// Aviso de venta por email: lo que importa es que salga UNA vez por pedido, con
// los datos que el vendedor necesita para cerrar la venta, y que ningún fallo de
// email pueda romper el checkout.
import { describe, expect, it } from "vitest";
import type { Env } from "./db";
import type { Order } from "../shared/types";
import { formatPrice } from "../shared/format";
import { notifySale, saleEmailText, saleNotifyKey } from "./sale-notify";

function pedido(over: Partial<Order> = {}): Order {
  return {
    id: "a1b2c3d4e5f60718a1b2c3d4e5f60718",
    status: "pending",
    totalCents: 1_125_000,
    currency: "ARS",
    buyerName: "Juan Pérez",
    buyerPhone: "3425819402",
    payerEmail: null,
    items: [
      { id: "p1", title: "iPhone 13 128 GB", qty: 1, priceCents: 1_250_000 },
      { id: "descuento-transferencia", title: "Descuento transferencia (10%)", qty: 1, priceCents: -125_000 },
    ],
    mpPreferenceId: null,
    mpPaymentId: null,
    paidAt: null,
    notifiedWa: false,
    memberCode: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

function makeKv(): KVNamespace & { _map: Map<string, string> } {
  const map = new Map<string, string>();
  const kv = {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
    delete: async (k: string) => { map.delete(k); },
    _map: map,
  };
  return kv as unknown as KVNamespace & { _map: Map<string, string> };
}

function makeEnv(enviar?: (m: unknown) => Promise<void>) {
  const kv = makeKv();
  const enviados: Record<string, unknown>[] = [];
  const env = {
    KV: kv,
    DB: {} as D1Database,
    CF_SITE_ORIGIN: "https://centerphone.com.ar",
    EMAIL: enviar
      ? { send: async (m: unknown) => { enviados.push(m as Record<string, unknown>); await enviar(m); } }
      : { send: async (m: unknown) => { enviados.push(m as Record<string, unknown>); } },
  } as unknown as Env;
  return { env, kv, enviados };
}

describe("texto del aviso", () => {
  it("lleva cliente, productos, total, WhatsApp y link al panel", () => {
    const texto = saleEmailText(pedido(), "transfer", {
      storeName: "CenterPhone Celulares",
      currencySymbol: "$",
      siteUrl: "https://centerphone.com.ar/",
    });
    expect(texto).toContain("Pedido por transferencia");
    expect(texto).toContain("A1B2C3D4");
    expect(texto).toContain("Juan Pérez");
    expect(texto).toContain("1x iPhone 13 128 GB");
    expect(texto).toContain(formatPrice(1_250_000, "$"));
    expect(texto).toContain(formatPrice(-125_000, "$"));
    expect(texto).toContain(`TOTAL: ${formatPrice(1_125_000, "$")}`);
    expect(texto).toContain("https://wa.me/3425819402");
    expect(texto).toContain("https://centerphone.com.ar/admin/");
    // El link al panel no duplica la barra del origen.
    expect(texto).not.toContain("com.ar//admin");
  });

  it("el aviso de pago acreditado dice que está listo para despachar", () => {
    const texto = saleEmailText(pedido({ status: "paid" }), "paid", { storeName: "CenterPhone" });
    expect(texto).toContain("Pago acreditado");
    expect(texto).toContain("listo para despachar");
    // Sin siteUrl no se inventa un link.
    expect(texto).not.toContain("/admin/");
  });

  it("sin teléfono no arma un link de WhatsApp roto", () => {
    const texto = saleEmailText(pedido({ buyerPhone: "" }), "paid", {});
    expect(texto).not.toContain("wa.me");
    expect(texto).toContain("(sin teléfono)");
  });
});

describe("envío del aviso", () => {
  it("manda un email con asunto y cuerpo", async () => {
    const { env, enviados } = makeEnv();
    const out = await notifySale(env, pedido(), "transfer", { storeName: "CenterPhone", currencySymbol: "$" });
    expect(out.sent).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(String(enviados[0]?.subject)).toContain("transferencia");
    expect(String(enviados[0]?.text)).toContain("Juan Pérez");
    expect(enviados[0]?.from).toBe("noreply@centerphone.com.ar");
  });

  it("avisa una sola vez por pedido (el webhook de MP se reintenta)", async () => {
    const { env, kv, enviados } = makeEnv();
    const p = pedido();
    expect((await notifySale(env, p, "paid")).sent).toBe(true);
    const segundo = await notifySale(env, p, "paid");
    expect(segundo.sent).toBe(false);
    expect(segundo.motivo).toBe("ya avisado");
    expect(enviados).toHaveLength(1);
    expect(kv._map.has(saleNotifyKey(p.id))).toBe(true);
  });

  it("pedidos distintos se avisan cada uno", async () => {
    const { env, enviados } = makeEnv();
    await notifySale(env, pedido({ id: "pedido-uno-0001" }), "paid");
    await notifySale(env, pedido({ id: "pedido-dos-0002" }), "transfer");
    expect(enviados).toHaveLength(2);
  });

  it("sin binding de email no hace nada y no rompe", async () => {
    const { env } = makeEnv();
    const sinEmail = { ...env, EMAIL: undefined } as unknown as Env;
    const out = await notifySale(sinEmail, pedido(), "paid");
    expect(out.sent).toBe(false);
    expect(out.motivo).toBe("sin binding de email");
  });

  it("un fallo de envío no se propaga (la venta ya está guardada)", async () => {
    const { env } = makeEnv(async () => { throw new Error("email caído"); });
    const out = await notifySale(env, pedido(), "paid");
    expect(out.sent).toBe(false);
    expect(out.motivo).toBe("fallo de envío");
  });
});
