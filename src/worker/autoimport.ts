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

/** Registra una corrida de auto-importación en el historial (sync_log). */
function logRun(
  env: Env,
  trigger: "cron" | "manual",
  url: string,
  ok: boolean,
  stats: { imported: number; total: number | null; failed: number | null; deactivated: number; warnings: string[]; errors: string[] },
  startedAt: number
): void {
  const motivos: string[] = [...stats.errors, ...stats.warnings];
  void insertSyncLog(env.DB, {
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
  }).catch(() => { /* el historial no debe romper la corrida */ });
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

/**
 * ¿La auto-importación debe correr ahora? El cron corre cada 1 hora
 * (a las XX:00 exactas), así que solo aplican horarios de horas enteras.
 * Horarios con minutos (legado) corren en su hora entera ("09:10" → tick 09:00).
 */
export function isDueNow(job: AutoImport, hhmm: string): boolean {
  if (!job.active) return false;
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

/**
 * Ejecuta las auto-importaciones activas cuyo horario coincide con la hora
 * actual en Argentina. La llama el cron (cada 15 min).
 */
export async function runAutoImports(env: Env): Promise<AutoImportOutcome> {
  const hhmm = nowArgentina();
  const jobs = await listAutoImports(env.DB);
  const due = jobs.filter((j) => isDueNow(j, hhmm));
  const results: AutoImportOutcome["results"] = [];

  for (const job of due) {
    const startedAt = nowMs();
    try {
      const r = await extractFromUrl(job.url);
      if (r.items.length === 0) {
        // Sin productos extraídos: no se toca el catálogo y el historial muestra TODAS las
        // estrategias probadas y por qué falló cada una.
        const motivo = r.errors.length > 0 ? r.errors.join("; ") : "La fuente no devolvió productos";
        await markAutoImportRun(env.DB, job.id, "error", nowMs());
        logRun(env, "cron", job.url, false, { imported: 0, total: 0, failed: 0, deactivated: 0, warnings: [], errors: [motivo] }, startedAt);
        updateSyncState(env, false, startedAt, motivo);
        results.push({ id: job.id, url: job.url, ok: false, imported: 0, deactivated: 0, warnings: [], error: motivo });
        continue;
      }
      const outcome = await importItems(env, r.items, { forceRuleId: job.priceRuleId ?? null, sourceUrl: job.url });
      await markAutoImportRun(env.DB, job.id, outcome.ok ? "ok" : "error", nowMs());
      logRun(env, "cron", job.url, outcome.ok, { imported: outcome.imported, total: outcome.total, failed: outcome.failed, deactivated: outcome.deactivated, warnings: outcome.warnings, errors: outcome.errors }, startedAt);
      updateSyncState(env, outcome.ok, startedAt, outcome.ok ? null : (outcome.errors[0] ?? null));
      results.push({ id: job.id, url: job.url, ok: outcome.ok, imported: outcome.imported, deactivated: outcome.deactivated, warnings: outcome.warnings, error: outcome.ok ? null : (outcome.errors[0] ?? "Error") });
    } catch (e) {
      // Registrar el motivo completo (con ubicación en el código si hay stack).
      const raw = e instanceof Error ? e.message : String(e);
      const where = e instanceof Error && e.stack ? e.stack.split("\n")[1]?.trim() ?? "" : "";
      const msg = where !== "" ? `${raw} | ${where}` : raw;
      await markAutoImportRun(env.DB, job.id, "error", nowMs());
      logRun(env, "cron", job.url, false, { imported: 0, total: null, failed: null, deactivated: 0, warnings: [], errors: [msg] }, startedAt);
      updateSyncState(env, false, startedAt, msg);
      results.push({ id: job.id, url: job.url, ok: false, imported: 0, deactivated: 0, warnings: [], error: msg });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

/**
 * Ejecuta TODAS las auto-importaciones activas ahora, ignorando horarios.
 * La usa el botón "Sincronizar ahora" del dashboard y el endpoint /auto-imports/run-all.
 */
export async function runAllAutoImportsNow(env: Env): Promise<AutoImportOutcome> {
  const jobs = (await listAutoImports(env.DB)).filter((j) => j.active);
  const results: AutoImportOutcome["results"] = [];
  for (const job of jobs) {
    const startedAt = nowMs();
    try {
      const r = await extractFromUrl(job.url);
      if (r.items.length === 0) {
        const motivo = r.errors.length > 0 ? r.errors.join("; ") : "La fuente no devolvió productos";
        await markAutoImportRun(env.DB, job.id, "error", nowMs());
        logRun(env, "manual", job.url, false, { imported: 0, total: 0, failed: 0, deactivated: 0, warnings: [], errors: [motivo] }, startedAt);
        updateSyncState(env, false, startedAt, motivo);
        results.push({ id: job.id, url: job.url, ok: false, imported: 0, deactivated: 0, warnings: [], error: motivo });
        continue;
      }
      const outcome = await importItems(env, r.items, { forceRuleId: job.priceRuleId ?? null, sourceUrl: job.url });
      await markAutoImportRun(env.DB, job.id, outcome.ok ? "ok" : "error", nowMs());
      logRun(env, "manual", job.url, outcome.ok, { imported: outcome.imported, total: outcome.total, failed: outcome.failed, deactivated: outcome.deactivated, warnings: outcome.warnings, errors: outcome.errors }, startedAt);
      updateSyncState(env, outcome.ok, startedAt, outcome.ok ? null : (outcome.errors[0] ?? null));
      results.push({ id: job.id, url: job.url, ok: outcome.ok, imported: outcome.imported, deactivated: outcome.deactivated, warnings: outcome.warnings, error: outcome.ok ? null : (outcome.errors[0] ?? "Error") });
    } catch (e) {
      // Registrar el motivo completo (con ubicación en el código si hay stack).
      const raw = e instanceof Error ? e.message : String(e);
      const where = e instanceof Error && e.stack ? e.stack.split("\n")[1]?.trim() ?? "" : "";
      const msg = where !== "" ? `${raw} | ${where}` : raw;
      await markAutoImportRun(env.DB, job.id, "error", nowMs());
      logRun(env, "manual", job.url, false, { imported: 0, total: null, failed: null, deactivated: 0, warnings: [], errors: [msg] }, startedAt);
      updateSyncState(env, false, startedAt, msg);
      results.push({ id: job.id, url: job.url, ok: false, imported: 0, deactivated: 0, warnings: [], error: msg });
    }
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
