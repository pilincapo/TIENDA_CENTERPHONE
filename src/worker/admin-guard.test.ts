// Guardia anti-regresión: TODA ruta de /api/admin debe exigir sesión, salvo
// /login (y el /session que se consulta con sesión). El bug del changelog
// (ruta registrada antes del middleware use() en Hono) es fácil de repetir
// al agregar un endpoint al final del archivo: estos tests lo hacen explotar.
import { describe, expect, it, vi } from "vitest";
import { adminApp } from "./admin";
import type { Env } from "./db";

function mockKV(entries: Record<string, string> = {}): KVNamespace & { _map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  const kv = {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
    _map: map,
  };
  return kv as KVNamespace & { _map: Map<string, string> };
}

function mockEnv(kv: KVNamespace): Env {
  return { KV: kv, ADMIN_PASSWORD: "pass-de-test" } as unknown as Env;
}

// Sin cookie: el middleware debe cortar con 401 ANTES de tocar datos. Incluye
// rutas de lectura sensibles y también logout (que escribe en KV: sin sesión
// no puede desloguear al admin ni quemar la cuota de escritura).
describe("Guardia: /api/admin exige sesión", () => {
  const rutas: [string, RequestInit][] = [
    ["/logout", { method: "POST" }],
    ["/changelog", {}],
    ["/settings", {}],
    ["/orders", {}],
    ["/products", {}],
    ["/sync", { method: "POST" }],
    ["/import", { method: "POST" }],
    ["/password", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }],
  ];

  for (const [ruta, init] of rutas) {
    it(`sin cookie responde 401: ${init.method ?? "GET"} ${ruta}`, async () => {
      const res = await adminApp.request(ruta, init, mockEnv(mockKV()));
      expect(res.status).toBe(401);
    });
  }

  it("sin cookie, logout NO escribe nada en KV (nada que revocar)", async () => {
    const kv = mockKV();
    await adminApp.request("/logout", { method: "POST" }, mockEnv(kv));
    expect(kv._map.size).toBe(0);
  });

  it("flujo feliz: login → sesión válida → logout revoca", async () => {
    const kv = mockKV();
    const env = mockEnv(kv);
    const login = await adminApp.request(
      "/login",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
      env,
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("celu_session=");

    const session = await adminApp.request("/session", { headers: { Cookie: cookie } }, env);
    expect(session.status).toBe(200);

    const logout = await adminApp.request("/logout", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(logout.status).toBe(200);
    // La respuesta borra la cookie (Set-Cookie con expiración).
    expect(logout.headers.get("Set-Cookie") ?? "").toContain("celu_session=");
    // La revocación quedó registrada en KV (tokens previos quedan fuera).
    expect(kv._map.get("admin:sessions-revoked-before")).toBeTruthy();
    // Nota: un token emitido hace <5s sobrevive por diseño (margen de reloj,
    // ver session-revoke.test.ts); por eso acá no se espera 401 inmediato.
  });

  it("deja registro de seguridad: login fallido, login OK y logout sin sesión", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    });
    try {
      const env = mockEnv(mockKV());
      const mala = await adminApp.request(
        "/login",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "clave-incorrecta" }) },
        env,
      );
      expect(mala.status).toBe(401);

      const buena = await adminApp.request(
        "/login",
        { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.5" }, body: JSON.stringify({ password: "pass-de-test" }) },
        env,
      );
      expect(buena.status).toBe(200);

      const fuera = await adminApp.request("/logout", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.5" } }, env);
      expect(fuera.status).toBe(401);

      expect(warns.some((w) => w.includes("seguridad: login fallido"))).toBe(true);
      expect(warns.some((w) => w.includes("seguridad: login OK"))).toBe(true);
      expect(warns.some((w) => w.includes("seguridad: logout sin sesión"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
