// Salud semanal del cron: agrega las filas de sync_log de los últimos 7 días
// por fuente (columna detail = URL) y calcula tasa de éxito y duración media.
// Los totales globales incluyen también las corridas manuales y de importación.

export interface FuenteSalud {
  url: string;
  corridas: number;
  ok: number;
  errores: number;
  tasaExito: number; // 0..100
  duracionMediaMs: number; // promedio de finished_at - started_at
  ultimaCorrida: number | null;
  ultimoError: string | null;
}

export interface SaludSemanal {
  desde: number; // ms epoch del inicio de la ventana
  totalCorridas: number;
  totalOk: number;
  totalErrores: number;
  tasaExitoGlobal: number;
  duracionMediaMs: number;
  fuentes: FuenteSalud[];
}

interface FilaLog {
  status: string;
  detail: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export function computeSalud(rows: FilaLog[], now = Date.now()): SaludSemanal {
  const desde = now - 7 * 24 * 60 * 60 * 1000;
  const recientes = rows.filter((r) => r.started_at >= desde);

  let totalOk = 0;
  let durSum = 0;
  let durCount = 0;
  const porFuente = new Map<string, { ok: number; err: number; durSum: number; durCount: number; ultima: number; ultimoError: string | null }>();

  for (const r of recientes) {
    const ok = r.status === "ok";
    if (ok) totalOk++;
    const dur = r.finished_at != null ? r.finished_at - r.started_at : null;
    if (dur != null && dur >= 0) {
      durSum += dur;
      durCount++;
    }
    const key = r.detail ?? "(sin detalle)";
    const agg = porFuente.get(key) ?? { ok: 0, err: 0, durSum: 0, durCount: 0, ultima: 0, ultimoError: null };
    if (ok) agg.ok++; else { agg.err++; if (!agg.ultimoError && r.error) agg.ultimoError = r.error; }
    if (dur != null && dur >= 0) { agg.durSum += dur; agg.durCount++; }
    if (r.started_at > agg.ultima) agg.ultima = r.started_at;
    porFuente.set(key, agg);
  }

  const fuentes: FuenteSalud[] = [...porFuente.entries()]
    .map(([url, a]) => ({
      url,
      corridas: a.ok + a.err,
      ok: a.ok,
      errores: a.err,
      tasaExito: a.ok + a.err > 0 ? Math.round((a.ok / (a.ok + a.err)) * 100) : 0,
      duracionMediaMs: a.durCount > 0 ? Math.round(a.durSum / a.durCount) : 0,
      ultimaCorrida: a.ultima,
      ultimoError: a.ultimoError,
    }))
    .sort((a, b) => b.corridas - a.corridas);

  const totalCorridas = recientes.length;
  return {
    desde,
    totalCorridas,
    totalOk,
    totalErrores: totalCorridas - totalOk,
    tasaExitoGlobal: totalCorridas > 0 ? Math.round((totalOk / totalCorridas) * 100) : 0,
    duracionMediaMs: durCount > 0 ? Math.round(durSum / durCount) : 0,
    fuentes,
  };
}
