// Estadísticas de visitas: eventos en D1 + agregaciones para el panel.
// Sin servicios externos: una fila por evento en stats_events, agregado con GROUP BY.
// Free tier: los inserts son 1 query por evento (beacon), las lecturas se agrupan en SQL.

import type { Dict } from "./db";
import type { Env } from "./db";
import { nowMs } from "./settings";

export type StatEventType = "product_view" | "search" | "home_view" | "wa_click" | "track_view";

const DAY_MS = 86_400_000;
// Retención: 90 días alcanza para el selector más largo del panel. El borrado
// corre en cada cron (1 vez por hora, DELETE barato con índice por ts).
const RETENTION_MS = 90 * DAY_MS;

export interface TrackInput {
  type: StatEventType;
  productId?: string | null;
  query?: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  referrer?: string | null;
}

// Normaliza la búsqueda: minúsculas, sin espacios extra, máx 120 chars.
export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().slice(0, 120);
}

export async function trackEvent(env: Env, input: TrackInput): Promise<void> {
  const types: StatEventType[] = ["product_view", "search", "home_view", "wa_click", "track_view"];
  if (!types.includes(input.type)) return;
  const row: Dict = { ts: nowMs(), type: input.type };
  if (input.productId) row.product_id = input.productId.slice(0, 64);
  if (input.type === "search" && input.query) row.query = normalizeQuery(input.query);
  if (input.country) row.country = input.country.slice(0, 8);
  if (input.city) row.city = input.city.slice(0, 64);
  if (input.region) row.region = input.region.slice(0, 64);
  if (input.referrer) row.referrer = input.referrer.slice(0, 120);
  await env.DB.prepare(
    `INSERT INTO stats_events (ts, type, product_id, query, country, city, region, referrer)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(row.ts ?? null, row.type ?? null, row.product_id ?? null, row.query ?? null, row.country ?? null, row.city ?? null, row.region ?? null, row.referrer ?? null).run();
}

// Borrado de eventos viejos (llamado por el cron).
export async function pruneStats(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM stats_events WHERE ts < ?1`).bind(nowMs() - RETENTION_MS).run();
}

// ---- Agregaciones para el panel ----

export interface StatsSummary {
  since: number;
  totals: { productViews: number; searches: number; waClicks: number; homeViews: number; trackViews: number };
  topProducts: { id: string; title: string; category: string; views: number }[];
  topWa: { id: string; title: string; clicks: number }[];
  topSearches: { query: string; count: number }[];
  emptySearches: { query: string; count: number }[];
  byHour: { hour: number; views: number }[];   // hora 0-23, Argentina
  byDay: { day: string; views: number }[];     // 'YYYY-MM-DD' (hora Argentina), total del período
  byCountry: { country: string; count: number }[];
  byCity: { city: string; region: string; count: number }[];
  byReferrer: { referrer: string; count: number }[];
}

export async function getStatsSummary(env: Env, days: number): Promise<StatsSummary> {
  const since = nowMs() - Math.min(Math.max(days, 1), 90) * DAY_MS;
  const db = env.DB;
  const count = async (type: string): Promise<number> => {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM stats_events WHERE type = ?1 AND ts >= ?2`).bind(type, since).first<{ n: number }>();
    return r?.n ?? 0;
  };

  // La hora se guarda en UTC; para agrupar por hora Argentina: ts-3h sobre el índice.
  // (America/Argentina/Buenos_Aires es UTC-3 todo el año: sin horario de verano.)
  const AR_OFFSET = 3 * 3600_000;
  const topProducts = await db.prepare(
    `SELECT e.product_id AS id, COUNT(*) AS views, p.title AS title,
            COALESCE(c.name, '') AS category
     FROM stats_events e
     LEFT JOIN products p ON p.id = e.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE e.type = 'product_view' AND e.ts >= ?1
     GROUP BY e.product_id ORDER BY views DESC LIMIT 20`
  ).bind(since).all<Dict>();
  const topWa = await db.prepare(
    `SELECT e.product_id AS id, COUNT(*) AS clicks, p.title AS title
     FROM stats_events e
     LEFT JOIN products p ON p.id = e.product_id
     WHERE e.type = 'wa_click' AND e.ts >= ?1
     GROUP BY e.product_id ORDER BY clicks DESC LIMIT 20`
  ).bind(since).all<Dict>();
  const topSearches = await db.prepare(
    `SELECT query, COUNT(*) AS count FROM stats_events
     WHERE type = 'search' AND ts >= ?1 AND query != ''
     GROUP BY query ORDER BY count DESC LIMIT 20`
  ).bind(since).all<Dict>();
  // Búsquedas sin resultados: comparo contra los títulos del catálogo publicado
  // en JS (el catálogo es chico, entra en memoria sin problemas).
  const emptySearchesRows = await db.prepare(
    `SELECT query, COUNT(*) AS count FROM stats_events
     WHERE type = 'search' AND ts >= ?1 AND query != ''
     GROUP BY query ORDER BY count DESC LIMIT 60`
  ).bind(since).all<Dict>();
  const titlesRows = await db.prepare(`SELECT title FROM products WHERE status = 'published'`).all<Dict>();
  const titles = titlesRows.results?.map((r) => String(r.title).toLowerCase()) ?? [];
  const emptySearches = (emptySearchesRows.results ?? [])
    .filter((r) => {
      const q = String(r.query);
      return !titles.some((t) => t.includes(q) || q.split(/\s+/).every((w) => w.length > 2 && t.includes(w)));
    })
    .slice(0, 12);
  const byHourRows = await db.prepare(
    `SELECT ((ts - ?2) / 3600000) % 24 AS h, COUNT(*) AS n FROM stats_events
     WHERE type = 'product_view' AND ts >= ?1 GROUP BY h ORDER BY h`
  ).bind(since, AR_OFFSET).all<Dict>();
  // Serie por día (hora Argentina): ts-3h alineado a medianoche, un punto por día.
  // Se devuelven los N días del período completos (con ceros) para el gráfico de líneas.
  const byDayRows = await db.prepare(
    `SELECT date((ts - ?2) / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM stats_events
     WHERE type IN ('product_view','home_view') AND ts >= ?1 GROUP BY d ORDER BY d`
  ).bind(since, AR_OFFSET).all<Dict>();
  const byCountryRows = await db.prepare(
    `SELECT COALESCE(country, '??') AS country, COUNT(*) AS n FROM stats_events
     WHERE ts >= ?1 AND type IN ('product_view','home_view') GROUP BY country ORDER BY n DESC LIMIT 12`
  ).bind(since).all<Dict>();
  const byCityRows = await db.prepare(
    `SELECT COALESCE(city, '?') AS city, COALESCE(region, '') AS region, COUNT(*) AS n FROM stats_events
     WHERE ts >= ?1 AND type IN ('product_view','home_view') GROUP BY city, region ORDER BY n DESC LIMIT 12`
  ).bind(since).all<Dict>();
  const byReferrerRows = await db.prepare(
    `SELECT COALESCE(referrer, '(directo)') AS referrer, COUNT(*) AS n FROM stats_events
     WHERE ts >= ?1 AND type IN ('product_view','home_view') GROUP BY referrer ORDER BY n DESC LIMIT 10`
  ).bind(since).all<Dict>();

  const mapHour = new Map<number, number>();
  for (const r of byHourRows.results ?? []) mapHour.set(Number(r.h), Number(r.n));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, views: mapHour.get(hour) ?? 0 }));

  // Serie completa de días del período (con ceros en días sin visitas).
  const mapDay = new Map<string, number>();
  for (const r of byDayRows.results ?? []) mapDay.set(String(r.d), Number(r.n));
  const numDays = Math.min(Math.max(days, 1), 90);
  const byDay: { day: string; views: number }[] = [];
  const todayAr = new Date(nowMs() - AR_OFFSET);
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(todayAr.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    byDay.push({ day: key, views: mapDay.get(key) ?? 0 });
  }

  return {
    since,
    totals: {
      productViews: await count("product_view"),
      searches: await count("search"),
      waClicks: await count("wa_click"),
      homeViews: await count("home_view"),
      trackViews: await count("track_view"),
    },
    topProducts: (topProducts.results ?? []).map((r) => ({ id: String(r.id), title: String(r.title ?? "(eliminado)"), category: String(r.category ?? ""), views: Number(r.views) })),
    topWa: (topWa.results ?? []).map((r) => ({ id: String(r.id), title: String(r.title ?? "(eliminado)"), clicks: Number(r.clicks) })),
    topSearches: (topSearches.results ?? []).map((r) => ({ query: String(r.query), count: Number(r.count) })),
    emptySearches: emptySearches.map((r) => ({ query: String(r.query), count: Number(r.count) })),
    byHour,
    byDay,
    byCountry: (byCountryRows.results ?? []).map((r) => ({ country: String(r.country), count: Number(r.n) })),
    byCity: (byCityRows.results ?? []).map((r) => ({ city: String(r.city), region: String(r.region), count: Number(r.n) })),
    byReferrer: (byReferrerRows.results ?? []).map((r) => ({ referrer: String(r.referrer), count: Number(r.n) })),
  };
}
