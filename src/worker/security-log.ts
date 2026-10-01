// Eventos de seguridad para el panel: lee los últimos "seguridad:*" del
// Workers Logs de Cloudflare vía su API oficial (POST telemetry/query).
//
// Configuración (misma filosofía que el token de MercadoPago: sin token, el
// resto del panel funciona igual y esta pestaña muestra cómo configurarlo):
//   - CF_ACCOUNT_ID  (var, en wrangler.jsonc): cuenta dueña del worker.
//   - CF_LOGS_TOKEN  (secret): API token con permiso de lectura de
//     Workers Logs / Observability para esa cuenta. Se crea en el dashboard.

export interface SecurityEvent {
  time: number; // ms epoch del evento
  level: string; // "info" | "warn" | ...
  message: string; // línea completa, ej: 'seguridad: login fallido {"ip":"1.2.3.4"}'
}

export interface SecurityLogOut {
  configured: boolean; // false = falta CF_ACCOUNT_ID o CF_LOGS_TOKEN
  error?: string; // configuada pero la API falló
  events: SecurityEvent[]; // más nuevos primero
}

// Nombre del script en Cloudflare (name de wrangler.jsonc). Si algún día se
// renombra el worker, actualizar acá.
const WORKER_SERVICE = "celu-store";

const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;

interface CfEvent {
  $metadata?: { startTime?: number; level?: string; message?: string };
}

export async function fetchSecurityEvents(accountId: string, token: string, limit = 60): Promise<SecurityLogOut> {
  const to = Date.now();
  const from = to - 24 * 3600 * 1000; // últimas 24h (retención del plan gratis: 3 días)
  let res: Response;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        queryId: "panel-seguridad",
        timeframe: { from, to },
        view: "events",
        limit,
        parameters: {
          datasets: ["cloudflare-workers"],
          filters: [{ key: "$metadata.service", operation: "eq", type: "string", value: WORKER_SERVICE }],
          needle: { value: "seguridad:", matchCase: true },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { configured: true, events: [], error: `No se pudo consultar la API de Cloudflare: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 180);
    return { configured: true, events: [], error: `La API de Cloudflare respondió ${res.status}${detail ? `: ${detail}` : ""}` };
  }
  const json = await res.json<{ result?: { events?: { events?: CfEvent[] } } }>().catch(() => ({}) as { result?: { events?: { events?: CfEvent[] } } });
  const raw = json.result?.events?.events ?? [];
  const events = raw
    .map((e): SecurityEvent => ({
      time: Number(e.$metadata?.startTime ?? 0),
      level: String(e.$metadata?.level ?? "info"),
      message: String(e.$metadata?.message ?? "").slice(0, 300),
    }))
    .filter((e) => e.message !== "")
    .sort((a, b) => b.time - a.time); // más nuevos primero
  return { configured: true, events };
}

/** Valida la config sin llamar la API: devuelve motivo si falta algo. */
export function configProblem(accountId: string | undefined, token: string | undefined): string | null {
  if (!accountId || !ACCOUNT_ID_RE.test(accountId)) return "CF_ACCOUNT_ID no está configurado (var con el id de cuenta de Cloudflare).";
  if (!token) return "CF_LOGS_TOKEN no está configurado (secret con un API token con permiso de lectura de Workers Logs).";
  return null;
}
