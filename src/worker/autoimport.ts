// Auto-importaciones programadas: URLs importadas manualmente que el cron
// vuelve a traer en los horarios configurados (hora Argentina).

import { extractFromUrl } from "./extract";
import { importItems } from "./sync";
import { insertSyncLog, listAutoImports, upsertAutoImport, type Env } from "./db";
import { newId, nowMs } from "./settings";
import { KV_SYNC_STATE_KEY } from "../shared/types";
import type { AutoImport } from "../shared/autoimport";
import type { D1Database } from "@cloudflare/workers-types";

export type { AutoImport };

/** Refleja el resultado de una corrida en el estado del dashboard (KV). */
function updateSyncState(env: Env, ok: boolean, startedAt: number, error: string | null): void {
  void env.KV.put(KV_SYNC_STATE_KEY, JSON.stringify({ lastSyncAt: startedAt, lastStatus: ok ? "ok" : "error", lastError: error }), {}).catch(() => { /* el dashboard no debe romper la corrida */ });
}

export interface AutoImportOutcome {
  ok: boolean;
  warnings: string[];
  results: { id: string; url: string; ok: boolean; imported: number; deactivated: number; warnings: string[]; error: string | null }[];
}

/** Registra una corrida de auto-importación en el historial (sync_log).
 *  Es awaitable: si se escribe antes de que termine la invocación, la fila
 *  sobrevive aunque el runtime mate el request después (antes era
 *  fire-and-forget y el historial perdía corridas enteras). */
async function logRun(
  env: Env,
  trigger: "cron" | "manual",
  url: string,
  ok: boolean,
  stats: { imported: number; total: number | null; failed: number | null; deactivated: number; warnings: string[]; errors: string[] },
  startedAt: number
): Promise<void> {
  const motivos: string[] = [...stats.errors, ...stats.warnings];
  try {
    await insertSyncLog(env.DB, {
      id: newId(),
      trigger,
      status: ok ? "ok" : "error",
      itemsTotal: stats.total,
      itemsImported: stats.imported,
      itemsFailed: stats.failed,
      itemsDeactivated: stats.deactivated,
      error: ok
        ? (motivos.length > 0 ? motivos.join("; ").slice(0, 900) : null)
        : (motivos.join("; ").slice(0, 900) || null),
      detail: url,
      startedAt,
      finishedAt: nowMs(),
    });
  } catch { /* el historial no debe romper la corrida */ }
}

/** Hora actual en Argentina (America/Argentina/Buenos_Aires) como "HH:MM". */
export function nowArgentina(): string {
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date());
}

/** Ventana de atraso: si un job activo con horarios no corre hace más de 24h,
 *  el próximo tick del cron lo recupera aunque no sea su horario. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * ¿La auto-importación debe correr ahora? El cron corre cada 1 hora
 * (a las XX:00 exactas), así que solo aplican horarios de horas enteras.
 * Horarios con minutos (legado) corren en su hora entera ("09:10" → tick 09:00).
 *
 * Recuperación: un job activo con horarios cuyo lastRunAt tiene más de 24h
 * (el cron lo salteó por timeout/corte de CPU) corre en este tick aunque
 * no sea su horario — así una fuente muerta no espera hasta mañana.
 */
export function isDueNow(job: AutoImport, hhmm: string, now = Date.now()): boolean {
  if (!job.active) return false;
  if (job.times.length === 0) return false;
  if (job.lastRunAt != null && now - job.lastRunAt > STALE_MS) return true; // atrasado: recuperar
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return false;
  if (m !== 0) return false; // el cron solo despierta a las XX:00
  return job.times.some((t) => {
    const [th, tm] = t.split(":").map(Number);
    if (th === undefined || tm === undefined || Number.isNaN(th) || Number.isNaN(tm)) return false;
    return th === h; // matchea la hora, sin importar minutos de configuraciones viejas
  });
}

/** Actualiza lastRunAt/lastStatus de un job tras correrlo. */
export async function markAutoImportRun(db: D1Database, id: string, status: string, at: number): Promise<void> {
  const jobs = await listAutoImports(db);
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  await upsertAutoImport(db, { ...job, lastRunAt: at, lastStatus: status }, at);
}

/** Ejecuta UN job de auto-importación y registra todo (historial, estado, lastRun).
 *  Es el bloque compartido entre el cron, "Ejecutar ahora" y la sync manual
 *  fuente-por-fuente (una por request para no pasarse del límite de CPU del plan gratis). */
async function runOneJob(env: Env, job: AutoImport, trigger: "cron" | "manual"): Promise<AutoImportOutcome["results"][number]> {
  const startedAt = nowMs();
  try {
    const r = await extractFromUrl(job.url);
    if (r.items.length === 0) {
      const motivo = r.errors.length > 0 ? r.errors.join("; ") : "La fuente no devolvió productos";
      await markAutoImportRun(env.DB, job.id, "error", nowMs());
      await logRun(env, trigger, job.url, false, { imported: 0, total: 0, failed: 0, deactivated: 0, warnings: [], errors: [motivo] }, startedAt);
      updateSyncState(env, false, startedAt, motivo);
      return { id: job.id, url: job.url, ok: false, imported: 0, deactivated: 0, warnings: [], error: motivo };
    }
    const outcome = await importItems(env, r.items, { forceRuleId: job.priceRuleId ?? null, sourceUrl: job.url });
    await markAutoImportRun(env.DB, job.id, outcome.ok ? "ok" : "error", nowMs());
    await logRun(env, trigger, job.url, outcome.ok, { imported: outcome.imported, total: outcome.total, failed: outcome.failed, deactivated: outcome.deactivated, warnings: outcome.warnings, errors: outcome.errors }, startedAt);
    updateSyncState(env, outcome.ok, startedAt, outcome.ok ? null : (outcome.errors[0] ?? null));
    return { id: job.id, url: job.url, ok: outcome.ok, imported: outcome.imported, deactivated: outcome.deactivated, warnings: outcome.warnings, error: outcome.ok ? null : (outcome.errors[0] ?? "Error") };
  } catch (e) {
    // Registrar el motivo completo (con ubicación en el código si hay stack).
    const raw = e instanceof Error ? e.message : String(e);
    const where = e instanceof Error && e.stack ? e.stack.split("\n")[1]?.trim() ?? "" : "";
    const msg = where !== "" ? `${raw} | ${where}` : raw;
    await markAutoImportRun(env.DB, job.id, "error", nowMs());
    await logRun(env, trigger, job.url, false, { imported: 0, total: null, failed: null, deactivated: 0, warnings: [], errors: [msg] }, startedAt);
    updateSyncState(env, false, startedAt, msg);
    return { id: job.id, url: job.url, ok: false, imported: 0, deactivated: 0, warnings: [], error: msg };
  }
}

/** Ejecuta las auto-importaciones activas cuyo horario coincide con la hora
 *  actual en Argentina. La llama el cron (cada 1 hora).
 *  Con presupuesto de tiempo: si se acerca al límite de CPU del plan gratis,
 *  corta limpio y registra las fuentes que quedaron pendientes. */
export async function runAutoImports(env: Env): Promise<AutoImportOutcome> {
  const hhmm = nowArgentina();
  const jobs = await listAutoImports(env.DB);
  const due = jobs.filter((j) => isDueNow(j, hhmm));
  const results: AutoImportOutcome["results"] = [];
  const t0 = Date.now();
  for (const job of due) {
    // Presupuesto: ~18s por fuente de margen. El plan gratis corta a los ~30s de
    // CPU (≈50s de wall time con I/O); mejor parar a tiempo y dejar la fuente
    // restante para el próximo tick del cron (corre cada 1 hora) que morir a mitad.
    if (Date.now() - t0 > 20_000 && results.length > 0) {
      const pend = due.length - results.length;
      const msg = `Cron interrumpido por límite de tiempo: ${pend} fuente(s) quedaron pendientes para el próximo tick`;
      results.push({ id: "", url: "(pendientes)", ok: false, imported: 0, deactivated: 0, warnings: [], error: msg });
      // La fila va al historial con await: si la invocación muere después, ya está escrita.
      await logRun(env, "cron", "(pendientes)", false, { imported: 0, total: null, failed: null, deactivated: 0, warnings: [], errors: [msg] }, Date.now());
      break;
    }
    results.push(await runOneJob(env, job, "cron"));
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), warnings: results.flatMap((r) => r.warnings), results };
}

/** Corre UN solo job por id (para la sync manual fuente-por-fuente).
 *  Cada request procesa una única fuente para no exceder el límite de CPU
 *  del plan gratis de Cloudflare (varias fuentes grandes en un request mueren). */
export async function runAutoImportById(env: Env, id: string): Promise<AutoImportOutcome["results"][number] | null> {
  const job = (await listAutoImports(env.DB)).find((j) => j.id === id);
  if (!job) return null;
  return runOneJob(env, job, "manual");
}

/** Ejecuta TODOS los jobs (activos o no) en un solo request. Solo apto para
 *  pocas fuentes chicas: en producción el límite de CPU del plan gratis corta
 *  el Worker si hay varias fuentes grandes. La sync manual del panel usa
 *  runAutoImportById de a una por vez por ese motivo. */
export async function runAllAutoImportsNow(env: Env): Promise<AutoImportOutcome> {
  const jobs = await listAutoImports(env.DB);
  const results: AutoImportOutcome["results"] = [];
  for (const job of jobs) {
    results.push(await runOneJob(env, job, "manual"));
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), warnings: results.flatMap((r) => r.warnings), results };
}
