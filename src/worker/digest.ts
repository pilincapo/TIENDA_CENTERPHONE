// Resumen semanal de seguridad por email: se dispara desde el cron horario
// (lunes a las 9:00 de Argentina), consulta los logs de TODOS los workers de
// la cuenta vía la API de Cloudflare y manda un email de texto simple.
//
// Requisitos (misma filosofía que MercadoPago: sin configurar, no hace nada):
//   - CF_ACCOUNT_ID (var) + CF_LOGS_TOKEN (secret): leer los logs.
//   - Binding send_email "EMAIL" (wrangler.jsonc) con Email Routing activo y
//     la casilla destino verificada en el dashboard.
// Una sola escritura de KV por semana (idempotencia del cron horario).

import type { Env } from "./db";

export interface DigestEvent {
  time: number;
  level: string;
  message: string;
}

export interface DigestOut {
  sent: boolean;
  motivo?: string; // por qué no se envió (fuera de horario, sin config, etc.)
}

const DIGEST_FROM = "noreply@centerphone.com.ar";
const DIGEST_SUBJECT = "🛡 Resumen semanal de seguridad — CenterPhone";
const KV_LAST_SENT = "seguridad:digest-ultimo-envio";
const SEMANA_MS = 7 * 24 * 3600 * 1000;

/** Hora local de Argentina (UTC-3 todo el año). */
function horaArgentina(ms: number): { dia: number; hora: number } {
  const d = new Date(ms - 3 * 3600 * 1000);
  return { dia: d.getUTCDay(), hora: d.getUTCHours() };
}

/** ¿Corresponde enviar el resumen? Lunes (1) entre las 9:00 y las 10:00 AR. */
export function esMomentoDelResumen(ms: number): boolean {
  const { dia, hora } = horaArgentina(ms);
  return dia === 1 && hora === 9;
}

async function queryEventos(accountId: string, token: string, from: number, to: number, filtros: unknown[], queryId: string): Promise<DigestEvent[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      queryId,
      timeframe: { from, to },
      view: "events",
      limit: 1000,
      parameters: { datasets: ["cloudflare-workers"], filters: filtros },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`API de Cloudflare ${res.status}`);
  const json = (await res.json()) as { result?: { events?: { events?: Array<{ $metadata?: { startTime?: number; level?: string; message?: string } }> } } };
  const raw = json.result?.events?.events ?? [];
  return raw
    .map((e): DigestEvent => ({
      time: Number(e.$metadata?.startTime ?? 0),
      level: String(e.$metadata?.level ?? "info"),
      message: String(e.$metadata?.message ?? ""),
    }))
    .filter((e) => e.message !== "");
}

/** Arma el texto del email a partir de los eventos ya consultados. */
export function buildDigestText(desdeMs: number, hastaMs: number, seguridad: DigestEvent[], rechazados: DigestEvent[]): string {
  const fecha = (ms: number): string => {
    const d = new Date(ms - 3 * 3600 * 1000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const lineas: string[] = [];
  lineas.push("Resumen semanal de seguridad — CenterPhone");
  lineas.push(`Período: ${fecha(desdeMs)} al ${fecha(hastaMs)}`);
  lineas.push("");

  // 1) Eventos de seguridad explícitos (login, logout sin sesión, webhook de pagos)
  lineas.push(`== EVENTOS DE SEGURIDAD: ${seguridad.length}`);
  if (seguridad.length === 0) {
    lineas.push("   Ninguno. Tranquilo.");
  } else {
    for (const e of seguridad.slice(0, 30)) {
      const d = new Date(e.time - 3 * 3600 * 1000);
      const hora = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      const marcador = e.level === "warn" ? "⚠" : "ℹ";
      lineas.push(`   ${marcador} ${hora} — ${e.message}`);
    }
    if (seguridad.length > 30) lineas.push(`   … y ${seguridad.length - 30} más`);
    lineas.push("   Si algo no lo reconocés: cambiá la contraseña del panel (Configuración).");
  }
  lineas.push("");

  // 2) Rechazos (4xx/5xx) de todos los workers: escaneos + sesiones vencidas
  lineas.push(`== RESPUESTAS RECHAZADAS (4xx/5xx, todos los workers): ${rechazados.length}`);
  if (rechazados.length > 0) {
    const porServicio = new Map<string, number>();
    const porPath = new Map<string, number>();
    const porIp = new Map<string, number>();
    const escaneos: string[] = [];
    for (const e of rechazados) {
      const svc = e.message.match(/^(\w[\w-]*)\s+https?:\/\//)?.[1] ?? "?";
      porServicio.set(svc, (porServicio.get(svc) ?? 0) + 1);
      const path = e.message.match(/https?:\/\/[^/]+(\/\S*)?/)?.[1] ?? "?";
      const soloPath = path.split("?")[0] ?? "?";
      porPath.set(soloPath, (porPath.get(soloPath) ?? 0) + 1);
      const ip = e.message.match(/ip[=:"]*([0-9a-fA-F.:]+)/)?.[1] ?? "?";
      porIp.set(ip, (porIp.get(ip) ?? 0) + 1);
      if (/\.env|\.php|wp-|xmlrpc|phpmyadmin|\.git/i.test(soloPath)) escaneos.push(soloPath);
    }
    const top = (m: Map<string, number>, n: number): string =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(", ") || "—";
    lineas.push(`   Por worker: ${top(porServicio, 6)}`);
    lineas.push(`   Rutas más rechazadas: ${top(porPath, 8)}`);
    lineas.push(`   IPs con más rechazos: ${top(porIp, 5)}`);
    lineas.push(`   Escaneos bloqueados: ${escaneos.length === 0 ? "0" : String(escaneos.length)}`);
    if (escaneos.length > 0) lineas.push(`   → ${[...new Set(escaneos)].slice(0, 8).join(", ")}`);
  }
  lineas.push("");
  lineas.push("Nota: los 401 desde tu propia IP tras horas sin usar un panel son sesiones vencidas, no ataques.");
  return lineas.join("\n");
}

/** Punto de entrada desde el cron: hace todo y devuelve el motivo si no envió. */
export async function runWeeklyDigest(env: Env, ahoraMs: number): Promise<DigestOut> {
  if (!esMomentoDelResumen(ahoraMs)) return { sent: false, motivo: "fuera de horario" };
  const token = env.CF_LOGS_TOKEN ?? "";
  const accountId = env.CF_ACCOUNT_ID ?? "";
  if (token === "" || accountId === "") return { sent: false, motivo: "sin CF_LOGS_TOKEN" };
  if (!env.EMAIL) return { sent: false, motivo: "sin binding de email" };

  // Idempotencia: el cron corre cada hora; solo un envío por semana.
  const ultimo = Number((await env.KV.get(KV_LAST_SENT)) ?? 0);
  if (Number.isFinite(ultimo) && ahoraMs - ultimo < SEMANA_MS - 3600 * 1000) {
    return { sent: false, motivo: "ya enviado esta semana" };
  }

  const hasta = ahoraMs;
  const desde = hasta - SEMANA_MS;
  const [seguridad, rechazados] = await Promise.all([
    queryEventos(accountId, token, desde, hasta, [{ key: "$metadata.message", operation: "starts_with", type: "string", value: "seguridad:" }], "digest-seguridad"),
    queryEventos(accountId, token, desde, hasta, [{ key: "$workers.event.response.status", operation: "gte", type: "number", value: 400 }], "digest-rechazados"),
  ]);
  const texto = buildDigestText(desde, hasta, seguridad, rechazados);
  // El binding restringido (destination_address en wrangler.jsonc) completa el
  // destinatario cuando `to` va vacío (así el email no queda hardcodeado acá);
  // los tipos exigen un destinatario, de ahí el cast.
  await env.EMAIL.send({
    from: DIGEST_FROM,
    subject: DIGEST_SUBJECT,
    text: texto,
  } as unknown as EmailMessageBuilder);
  await env.KV.put(KV_LAST_SENT, String(ahoraMs));
  console.log("seguridad: resumen semanal enviado", JSON.stringify({ seguridad: seguridad.length, rechazados: rechazados.length }));
  return { sent: true };
}
