// Auto-importaciones programadas: URLs importadas manualmente que el cron
// vuelve a traer en los horarios configurados (hora Argentina).

import { extractFromUrl } from "./extract";
import { importItems } from "./sync";
import { listAutoImports, upsertAutoImport, type Env } from "./db";
import { nowMs } from "./settings";
import type { AutoImport } from "../shared/autoimport";
import type { D1Database } from "@cloudflare/workers-types";

export type { AutoImport };

export interface AutoImportOutcome {
  ok: boolean;
  results: { id: string; url: string; ok: boolean; imported: number; error: string | null }[];
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
    try {
      const r = await extractFromUrl(job.url);
      const outcome = await importItems(env, r.items, { forceRuleId: job.priceRuleId ?? null });
      await markAutoImportRun(env.DB, job.id, outcome.ok ? "ok" : "error", nowMs());
      results.push({ id: job.id, url: job.url, ok: outcome.ok, imported: outcome.imported, error: outcome.errors[0] ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await markAutoImportRun(env.DB, job.id, "error", nowMs());
      results.push({ id: job.id, url: job.url, ok: false, imported: 0, error: msg });
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
    try {
      const r = await extractFromUrl(job.url);
      const outcome = await importItems(env, r.items, { forceRuleId: job.priceRuleId ?? null });
      await markAutoImportRun(env.DB, job.id, outcome.ok ? "ok" : "error", nowMs());
      results.push({ id: job.id, url: job.url, ok: outcome.ok, imported: outcome.imported, error: outcome.errors[0] ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await markAutoImportRun(env.DB, job.id, "error", nowMs());
      results.push({ id: job.id, url: job.url, ok: false, imported: 0, error: msg });
    }
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
