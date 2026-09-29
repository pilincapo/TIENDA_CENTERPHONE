import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS, hashPassword, verifyPassword,
  createSessionToken, verifySessionToken,
} from "./auth";
import {
  changeAdminPassword, getStoredPasswordHash, getSessionSecret, verifyAdminPassword,
} from "./admin-credentials";
import type { Env } from "./db";

// KV mock mínimo en memoria.
function mockKV(entries: Record<string, string> = {}): KVNamespace {
  const map = new Map(Object.entries(entries));
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
  } as unknown as KVNamespace;
}

function mockEnv(kv: KVNamespace, adminPassword = "secreto-viejo"): Env {
  return { KV: kv, ADMIN_PASSWORD: adminPassword } as unknown as Env;
}

describe("hashPassword / verifyPassword", () => {
  it("genera salt distinto por llamada y verifica correctamente", async () => {
    const h1 = await hashPassword("mipassword123");
    const h2 = await hashPassword("mipassword123");
    expect(h1.salt).not.toBe(h2.salt); // salt aleatorio
    expect(h1.iterations).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword("mipassword123", h1)).toBe(true);
    expect(await verifyPassword("mipassword124", h1)).toBe(false);
    expect(await verifyPassword("", h1)).toBe(false);
  });
});

describe("verifyAdminPassword", () => {
  it("sin hash en KV: valida contra el secret (migración)", async () => {
    const env = mockEnv(mockKV());
    expect(await verifyAdminPassword(env, "secreto-viejo")).toBe(true);
    expect(await verifyAdminPassword(env, "otra")).toBe(false);
  });

  it("sin hash en KV y sin secret: rechaza todo", async () => {
    const env = mockEnv(mockKV(), "");
    expect(await verifyAdminPassword(env, "lo-que-sea")).toBe(false);
  });

  it("con hash en KV: KV manda sobre el secret viejo", async () => {
    const env = mockEnv(mockKV());
    await changeAdminPassword(env, "nueva-clave-99");
    expect(await verifyAdminPassword(env, "nueva-clave-99")).toBe(true);
    expect(await verifyAdminPassword(env, "secreto-viejo")).toBe(false);
  });
});

describe("changeAdminPassword + getSessionSecret", () => {
  it("persiste el hash en KV con formato válido", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    await changeAdminPassword(env, "nueva-clave-99");
    const stored = await getStoredPasswordHash(kv);
    expect(stored).not.toBe(null);
    expect(await verifyPassword("nueva-clave-99", stored!)).toBe(true);
  });

  it("rota el secret de sesión: los tokens viejos quedan inválidos", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const oldSecret = await getSessionSecret(env);
    const oldToken = await createSessionToken(oldSecret);
    expect(await verifySessionToken(oldSecret, oldToken)).toBe(true);

    const newSecret = await changeAdminPassword(env, "nueva-clave-99");
    expect(newSecret).not.toBe(oldSecret);

    // Token firmado con el secret viejo ya no valida con el nuevo.
    expect(await verifySessionToken(newSecret, oldToken)).toBe(false);
    // Y getSessionSecret (cache actualizado por el cambio) devuelve el nuevo.
    expect(await getSessionSecret(env)).toBe(newSecret);
  });

  it("getSessionSecret cae a ADMIN_SESSION_SECRET y luego a ADMIN_PASSWORD (envs distintos, el cache es por env)", async () => {
    const env1 = mockEnv(mockKV(), "pass-backup") as Env & { ADMIN_SESSION_SECRET?: string };
    (env1 as { ADMIN_SESSION_SECRET?: string }).ADMIN_SESSION_SECRET = "sess-secret-1";
    expect(await getSessionSecret(env1)).toBe("sess-secret-1");
    // Otro isolate (otro objeto env): sin secret de sesión en KV ni en env,
    // cae al ADMIN_PASSWORD.
    const env2 = mockEnv(mockKV(), "pass-backup");
    expect(await getSessionSecret(env2)).toBe("pass-backup");
  });
});
