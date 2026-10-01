// Tests del lector de eventos de seguridad (Workers Logs vía API de Cloudflare)
// y de la ruta del panel que lo expone (protegida por sesión, como el resto).
import { afterEach, describe, expect, it, vi } from "vitest";
import { configProblem, fetchSecurityEvents } from "./security-log";
import { adminApp } from "./admin";
import type { Env } from "./db";

const ACCOUNT = "0bb717edbda5f33508dc01f1d194a00b";

function apiResponse(events: unknown[]): Response {
  return new Response(JSON.stringify({ success: true, result: { events: { events } } }), { status: 200 });
}

function meta(startTime: number, level: string, message: string): unknown {
  return { $metadata: { startTime, level, message } };
}

function mockEnv(kv: KVNamespace, extra: Record<string, string> = {}): Env {
  return { KV: kv, ADMIN_PASSWORD: "pass-de-test", ...extra } as unknown as Env;
}

function mockKV(): KVNamespace {
  return { get: async () => null, put: async () => {} } as unknown as KVNamespace;
}

describe("fetchSecurityEvents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normaliza y ordena los eventos (más nuevos primero)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse([
      meta(100, "warn", 'seguridad: login fallido {"ip":"1.1.1.1"}'),
      meta(200, "info", "seguridad: login OK"),
    ])));
    const out = await fetchSecurityEvents(ACCOUNT, "tok");
    expect(out.configured).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.events).toHaveLength(2);
    expect(out.events[0]!).toMatchObject({ time: 200, level: "info", message: "seguridad: login OK" });
    expect(out.events[1]!).toMatchObject({ time: 100, level: "warn" });
  });

  it("recorta mensajes largos y descarta eventos vacíos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse([
      meta(300, "info", "x".repeat(500)),
      { $metadata: { startTime: 400 } },
    ])));
    const out = await fetchSecurityEvents(ACCOUNT, "tok");
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.message.length).toBe(300);
  });

  it("la API respondiendo mal devuelve error sin explotar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    const out = await fetchSecurityEvents(ACCOUNT, "tok-malo");
    expect(out.configured).toBe(true);
    expect(out.events).toEqual([]);
    expect(out.error).toContain("403");
  });

  it("un error de red devuelve error sin explotar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const out = await fetchSecurityEvents(ACCOUNT, "tok");
    expect(out.configured).toBe(true);
    expect(out.error).toContain("network down");
  });
});

describe("configProblem", () => {
  it("pide token cuando falta", () => {
    expect(configProblem(ACCOUNT, "")).toContain("CF_LOGS_TOKEN");
  });
  it("pide cuenta cuando el id es inválido", () => {
    expect(configProblem("corto", "tok")).toContain("CF_ACCOUNT_ID");
  });
  it("null cuando todo está configurado", () => {
    expect(configProblem(ACCOUNT, "tok")).toBeNull();
  });
});

describe("GET /api/admin/security-events", () => {
  it("sin sesión responde 401", async () => {
    const res = await adminApp.request("/security-events", {}, mockEnv(mockKV()));
    expect(res.status).toBe(401);
  });

  it("sin token responde configured:false con pista", async () => {
    const env = mockEnv(mockKV(), { CF_ACCOUNT_ID: ACCOUNT });
    const login = await adminApp.request(
      "/login",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
      env,
    );
    const cookie = login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    const res = await adminApp.request("/security-events", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; hint?: string };
    expect(body.configured).toBe(false);
    expect(body.hint).toContain("CF_LOGS_TOKEN");
  });

  it("con token consulta la API y devuelve los eventos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse([
      meta(500, "info", "seguridad: webhook mp recibido (payment 555)"),
    ])));
    const env = mockEnv(mockKV(), { CF_ACCOUNT_ID: ACCOUNT, CF_LOGS_TOKEN: "tok" });
    const login = await adminApp.request(
      "/login",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
      env,
    );
    const cookie = login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    const res = await adminApp.request("/security-events", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; events: { message: string }[] };
    expect(body.configured).toBe(true);
    expect(body.events[0]!.message).toContain("webhook mp recibido");
  });
});
