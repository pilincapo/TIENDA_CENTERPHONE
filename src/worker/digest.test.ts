// Tests del resumen semanal de seguridad (digest.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDigestText, esMomentoDelResumen, runWeeklyDigest } from "./digest";
import type { Env } from "./db";

const ACCOUNT = "0bb717edbda5f33508dc01f1d194a00b";

// Lunes 2026-10-05 12:00 UTC = 09:00 en Argentina (UTC-3).
const LUNES_9_AR = Date.UTC(2026, 9, 5, 12, 0, 0);
// Martes 2026-10-06 12:00 UTC.
const MARTES_9_AR = Date.UTC(2026, 9, 6, 12, 0, 0);
// Lunes 2026-10-05 17:00 UTC = 14:00 AR.
const LUNES_14_AR = Date.UTC(2026, 9, 5, 17, 0, 0);

function mockKV(entries: Record<string, string> = {}): KVNamespace & { _map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
    _map: map,
  } as unknown as KVNamespace & { _map: Map<string, string> };
}

function telemetryResponse(events: unknown[]): Response {
  return new Response(JSON.stringify({ success: true, result: { events: { events } } }), { status: 200 });
}

describe("esMomentoDelResumen", () => {
  it("lunes a las 9 de Argentina: sí", () => {
    expect(esMomentoDelResumen(LUNES_9_AR)).toBe(true);
  });
  it("martes a las 9 de Argentina: no", () => {
    expect(esMomentoDelResumen(MARTES_9_AR)).toBe(false);
  });
  it("lunes a las 14 de Argentina: no", () => {
    expect(esMomentoDelResumen(LUNES_14_AR)).toBe(false);
  });
});

describe("buildDigestText", () => {
  it("incluye período, eventos y secciones vacías con mensaje tranquilo", () => {
    const texto = buildDigestText(LUNES_9_AR - 7 * 24 * 3600 * 1000, LUNES_9_AR, [], []);
    expect(texto).toContain("Resumen semanal de seguridad");
    expect(texto).toContain("EVENTOS DE SEGURIDAD: 0");
    expect(texto).toContain("Ninguno. Tranquilo.");
    expect(texto).toContain("RESPUESTAS RECHAZADAS (4xx/5xx, todos los workers): 0");
  });

  it("resume eventos de seguridad con hora argentina y marca advertencias", () => {
    const texto = buildDigestText(
      LUNES_9_AR - 7 * 24 * 3600 * 1000,
      LUNES_9_AR,
      [
        { time: LUNES_9_AR - 3600 * 1000, level: "warn", message: 'seguridad: login fallido (clave incorrecta) {"ip":"203.0.113.7"}' },
        { time: LUNES_9_AR - 7200 * 1000, level: "info", message: "seguridad: login OK" },
      ],
      [],
    );
    expect(texto).toContain("EVENTOS DE SEGURIDAD: 2");
    expect(texto).toContain("⚠");
    expect(texto).toContain("login fallido");
    expect(texto).toContain("ℹ");
  });

  it("resume rechazos por worker, rutas, IPs y cuenta los escaneos", () => {
    const texto = buildDigestText(
      LUNES_9_AR - 7 * 24 * 3600 * 1000,
      LUNES_9_AR,
      [],
      [
        { time: LUNES_9_AR, level: "info", message: "repairpro-guard GET https://repairpro.centerphone.com.ar/.env" },
        { time: LUNES_9_AR, level: "info", message: "repairpro-clon GET https://repair2.centerphone.com.ar/api/users/x/settings/profile" },
      ],
    );
    expect(texto).toContain("RESPUESTAS RECHAZADAS (4xx/5xx, todos los workers): 2");
    expect(texto).toContain("Por worker:");
    expect(texto).toContain("Escaneos bloqueados: 1");
  });
});

describe("runWeeklyDigest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fuera de horario no consulta ni envía", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await runWeeklyDigest({ KV: mockKV() } as unknown as Env, MARTES_9_AR);
    expect(out.sent).toBe(false);
    expect(out.motivo).toContain("fuera de horario");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin token no envía", async () => {
    const out = await runWeeklyDigest({ KV: mockKV() } as unknown as Env, LUNES_9_AR);
    expect(out.sent).toBe(false);
    expect(out.motivo).toContain("CF_LOGS_TOKEN");
  });

  it("sin binding de email no envía", async () => {
    const env = { KV: mockKV(), CF_ACCOUNT_ID: ACCOUNT, CF_LOGS_TOKEN: "tok" } as unknown as Env;
    const out = await runWeeklyDigest(env, LUNES_9_AR);
    expect(out.sent).toBe(false);
    expect(out.motivo).toContain("binding de email");
  });

  it("con todo configurado: consulta la API, envía el email y marca la semana", async () => {
    const kv = mockKV();
    const enviados: unknown[] = [];
    const env = {
      KV: kv,
      CF_ACCOUNT_ID: ACCOUNT,
      CF_LOGS_TOKEN: "tok",
      EMAIL: { send: async (m: unknown) => { enviados.push(m); return { messageId: "x" }; } },
    } as unknown as Env;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(telemetryResponse([{ $metadata: { startTime: LUNES_9_AR, level: "warn", message: "seguridad: login fallido" } }]))
      .mockResolvedValueOnce(telemetryResponse([])));

    const out = await runWeeklyDigest(env, LUNES_9_AR);
    expect(out.sent).toBe(true);
    expect(enviados).toHaveLength(1);
    const msg = enviados[0] as { subject: string; text: string };
    expect(msg.subject).toContain("Resumen semanal de seguridad");
    expect(msg.text).toContain("seguridad: login fallido");
    expect(kv._map.get("seguridad:digest-ultimo-envio")).toBe(String(LUNES_9_AR));

    // Reintento del cron dentro de la misma ventana (9:05 AR): no reenvía.
    const otra = await runWeeklyDigest(env, LUNES_9_AR + 5 * 60 * 1000);
    expect(otra.sent).toBe(false);
    expect(otra.motivo).toContain("ya enviado");
    expect(enviados).toHaveLength(1);
  });

  it("si la API de logs falla, no envía ni marca la semana (se reintenta la hora siguiente)", async () => {
    const kv = mockKV();
    const env = {
      KV: kv,
      CF_ACCOUNT_ID: ACCOUNT,
      CF_LOGS_TOKEN: "tok",
      EMAIL: { send: async () => ({ messageId: "x" }) },
    } as unknown as Env;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(runWeeklyDigest(env, LUNES_9_AR)).rejects.toThrow("500");
    expect(kv._map.size).toBe(0);
  });
});
