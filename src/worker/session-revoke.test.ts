import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS, createSessionToken, sessionIssuedAt, verifySessionToken,
} from "./auth";
import {
  getRevocationEpoch, getSessionSecret, revokeActiveSessions,
} from "./admin-credentials";
import { forceHttpsUrl } from "./settings";
import type { Env } from "./db";

function mockKV(entries: Record<string, string> = {}): KVNamespace {
  const map = new Map(Object.entries(entries));
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
  } as unknown as KVNamespace;
}

function mockEnv(kv: KVNamespace): Env {
  return { KV: kv, ADMIN_PASSWORD: "pass" } as unknown as Env;
}

describe("M4: revocación de sesiones en logout", () => {
  it("sin epoch de revocación: los tokens válidos pasan", async () => {
    const env = mockEnv(mockKV());
    const token = await createSessionToken("secret");
    expect(await verifySessionToken("secret", token, await getRevocationEpoch(env))).toBe(true);
  });

  it("tras revokeActiveSessions: tokens emitidos antes quedan inválidos", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    // Simular un token emitido hace 10 minutos (TTL restante: 50 min).
    const viejo = await createSessionToken("secret", SESSION_TTL_MS - 10 * 60 * 1000);
    await revokeActiveSessions(env);
    const epoch = await getRevocationEpoch(env);
    expect(epoch).toBeGreaterThan(0);
    expect(await verifySessionToken("secret", viejo, epoch)).toBe(false);
    // Un token emitido DESPUÉS de la revocación sigue válido (re-login).
    const nuevo = await createSessionToken("secret");
    expect(await verifySessionToken("secret", nuevo, epoch)).toBe(true);
  });

  it("token emitido dentro del margen de reloj (5s) sobrevive por diseño", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const reciente = await createSessionToken("secret"); // emitido "ahora"
    await revokeActiveSessions(env);
    const epoch = await getRevocationEpoch(env);
    expect(await verifySessionToken("secret", reciente, epoch)).toBe(true);
  });

  it("el epoch persiste en KV (sobrevive el isolate)", async () => {
    const kv = mockKV();
    await revokeActiveSessions(mockEnv(kv));
    expect(await getRevocationEpoch(mockEnv(kv))).toBeGreaterThan(0);
  });

  it("sessionIssuedAt infiere la emisión (expiry - TTL)", async () => {
    const token = await createSessionToken("s", SESSION_TTL_MS - 60_000); // emitido hace 1 min
    const issued = sessionIssuedAt(token);
    const hace = Date.now() - issued;
    expect(hace).toBeGreaterThanOrEqual(59_000);
    expect(hace).toBeLessThanOrEqual(62_000);
  });
});

describe("B1/B3: forceHttpsUrl", () => {
  it("acepta https y lo normaliza", () => {
    expect(forceHttpsUrl("https://ejemplo.com/lista", 500)).toBe("https://ejemplo.com/lista");
  });
  it("agrega https:// si falta el esquema", () => {
    expect(forceHttpsUrl("ejemplo.com/lista", 500)).toBe("https://ejemplo.com/lista");
  });
  it("rechaza http:// explícito (texto claro)", () => {
    expect(forceHttpsUrl("http://ejemplo.com/x", 500)).toBe("");
  });
  it("acepta vacío/nulo como vacío", () => {
    expect(forceHttpsUrl("", 500)).toBe("");
    expect(forceHttpsUrl(null, 500)).toBe("");
    expect(forceHttpsUrl(undefined, 500)).toBe("");
  });
  it("rechaza basura que no es URL", () => {
    expect(forceHttpsUrl("no es una url con espacios", 500)).toBe("");
  });
  it("recorta al máximo de caracteres antes de validar", () => {
    const out = forceHttpsUrl("https://ejemplo.com/" + "a".repeat(600), 40);
    expect(out.length).toBeLessThanOrEqual(43); // 40 chars + "https://" agregado
  });
  it("conserva query string y path", () => {
    expect(forceHttpsUrl("https://tienda.com/products.json?limit=250", 500))
      .toBe("https://tienda.com/products.json?limit=250");
  });
});
