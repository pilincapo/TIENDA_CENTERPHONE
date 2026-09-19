// Rutas de administración (montadas en /api/admin).

import { Hono } from "hono";
import type { Category, Product } from "../shared/types";
import type { AutoImport } from "../shared/autoimport";
import { TAGS } from "../shared/types";
import type { Env } from "./db";
import {
  deleteAutoImport, deleteCategory, deletePriceRule, deleteProduct, getAutoImportByUrl,
  getProduct, listAutoImports, listCategories, listPriceRules, listProducts, listSyncLog,
  upsertAutoImport, upsertCategory, upsertPriceRule, upsertProduct,
} from "./db";
import { markAutoImportRun, nowArgentina, runAllAutoImportsNow, runAutoImports } from "./autoimport";
import { getSyncState, importItems, regenerateSnapshot, runSync } from "./sync";
import { applyRuleSet, roundToPeso, type PriceRule } from "../shared/pricing";
import { extractItems, normalizeExternalItems } from "../shared/normalize";
import { extractFromUrl } from "./extract";
import { getSettings, newId, nowMs, saveSettings } from "./settings";
import {
  clearSessionCookieHeader, createSessionToken, readSessionCookie,
  sessionCookieHeader, timingSafeEqualStr, verifySessionToken,
} from "./auth";

export const adminApp = new Hono<{ Bindings: Env }>();

// Rate-limit de login en memoria (por isolate): 5 intentos fallidos por minuto por IP.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginBlocked(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 5;
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count += 1;
  }
}

adminApp.post("/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  if (loginBlocked(ip)) {
    return c.json({ error: "Demasiados intentos. Probá en un minuto." }, 429);
  }
  const body = await c.req.json<{ password?: string }>().catch(() => null);
  const password = body?.password ?? "";
  if (!timingSafeEqualStr(password, c.env.ADMIN_PASSWORD ?? "")) {
    recordLoginFailure(ip);
    return c.json({ error: "Contraseña incorrecta" }, 401);
  }
  const token = await createSessionToken(c.env.ADMIN_SESSION_SECRET ?? c.env.ADMIN_PASSWORD);
  c.header("Set-Cookie", sessionCookieHeader(token));
  return c.json({ ok: true });
});

adminApp.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookieHeader());
  return c.json({ ok: true });
});

adminApp.use("*", async (c, next) => {
  if (c.req.path === "/api/admin/login") return next();
  const token = readSessionCookie(c.req.raw);
  const ok = await verifySessionToken(c.env.ADMIN_SESSION_SECRET ?? c.env.ADMIN_PASSWORD, token);
  if (!ok) return c.json({ error: "No autorizado" }, 401);
  await next();
});

adminApp.get("/session", (c) => c.json({ ok: true }));

// ---- Productos ----

adminApp.get("/products", async (c) => {
  return c.json({ products: await listProducts(c.env.DB, true) });
});

adminApp.post("/products", async (c) => {
  const body = await c.req.json<Partial<Product>>().catch(() => null);
  if (!body?.title || typeof body.priceCents !== "number") {
    return c.json({ error: "Faltan título o precio" }, 400);
  }
  const id = body.id?.trim() || newId();
  const existing = await getProduct(c.env.DB, id);
  if (existing) return c.json({ error: "Ya existe un producto con ese id" }, 409);
  const product = sanitizeProduct(body, id);
  await upsertProduct(c.env.DB, product, nowMs());
  await regenerateSnapshot(c.env);
  return c.json({ product }, 201);
});

adminApp.put("/products/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await getProduct(c.env.DB, id);
  if (!existing) return c.json({ error: "Producto no encontrado" }, 404);
  const body = await c.req.json<Partial<Product>>().catch(() => null);
  const product = sanitizeProduct({ ...existing, ...body, id }, id);
  await upsertProduct(c.env.DB, product, nowMs());
  await regenerateSnapshot(c.env);
  return c.json({ product });
});

adminApp.delete("/products/:id", async (c) => {
  await deleteProduct(c.env.DB, c.req.param("id"));
  await regenerateSnapshot(c.env);
  return c.json({ ok: true });
});

// Borrado múltiple: { ids: [...] } o { categoryId: "..." } (borra la categoría entera,
// incluidos los productos que tengan esa categoría como subcategoría).
adminApp.post("/products/bulk", async (c) => {
  const body = await c.req.json<{ ids?: unknown; categoryId?: unknown }>().catch(() => null);
  let deleted = 0;
  if (Array.isArray(body?.ids)) {
    const ids = body.ids.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    for (const id of ids) {
      await deleteProduct(c.env.DB, id);
      deleted++;
    }
  } else if (typeof body?.categoryId === "string" && body.categoryId.trim() !== "") {
    const catId = body.categoryId.trim();
    const { results } = await c.env.DB.prepare(
      "SELECT id FROM products WHERE category_id = ?1 OR subcategory_id = ?1"
    )
      .bind(catId)
      .all<Record<string, unknown>>();
    for (const row of results ?? []) {
      await deleteProduct(c.env.DB, String(row.id));
      deleted++;
    }
  } else {
    return c.json({ error: "Pasá ids: [...] o categoryId" }, 400);
  }
  await regenerateSnapshot(c.env);
  return c.json({ ok: true, deleted });
});

function sanitizeProduct(p: Partial<Product>, id: string): Product {
  return {
    id,
    title: String(p.title ?? "").slice(0, 200),
    description: String(p.description ?? "").slice(0, 2000),
    priceCents: Math.max(0, roundToPeso(Math.round(Number(p.priceCents ?? 0)))),
    categoryId: p.categoryId ?? null,
    subcategoryId: p.subcategoryId ?? null,
    tags: (p.tags ?? []).filter((t): t is Product["tags"][number] => TAGS.includes(t as never)),
    imageUrl: String(p.imageUrl ?? "").slice(0, 500),
    status: p.status === "hidden" ? "hidden" : "published",
    availability: ["in_stock", "out_of_stock", "preorder"].includes(String(p.availability))
      ? (p.availability as Product["availability"])
      : "in_stock",
    sortOrder: Math.round(Number(p.sortOrder ?? 0)),
  };
}

// ---- Categorías ----

adminApp.get("/categories", async (c) => {
  return c.json({ categories: await listCategories(c.env.DB) });
});

adminApp.post("/categories", async (c) => {
  const body = await c.req.json<Partial<Category>>().catch(() => null);
  if (!body?.name) return c.json({ error: "Falta el nombre" }, 400);
  const id = body.id?.trim() || newId();
  const category: Category = {
    id, name: String(body.name).slice(0, 100),
    parentId: body.parentId ?? null, active: body.active !== false,
  };
  await upsertCategory(c.env.DB, category, nowMs());
  await regenerateSnapshot(c.env);
  return c.json({ category }, 201);
});

adminApp.put("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<Category>>().catch(() => null);
  if (!body?.name) return c.json({ error: "Falta el nombre" }, 400);
  const category: Category = {
    id, name: String(body.name).slice(0, 100),
    parentId: body.parentId ?? null, active: body.active !== false,
  };
  await upsertCategory(c.env.DB, category, nowMs());
  await regenerateSnapshot(c.env);
  return c.json({ category });
});

adminApp.delete("/categories/:id", async (c) => {
  await deleteCategory(c.env.DB, c.req.param("id"));
  await regenerateSnapshot(c.env);
  return c.json({ ok: true });
});

// ---- Sincronización y snapshot ----

adminApp.post("/sync", async (c) => {
  // Si hay auto-importaciones activas, el botón "Sincronizar ahora" corre esas
  // (es el mecanismo real de alimentación del catálogo). Si no, cae a la sync
  // clásica por syncUrl configurada en Configuración.
  const active = (await listAutoImports(c.env.DB)).filter((j) => j.active);
  if (active.length > 0) {
    const outcome = await runAllAutoImportsNow(c.env);
    return c.json(
      {
        ok: outcome.ok,
        total: outcome.results.length,
        imported: outcome.results.reduce((s, r) => s + r.imported, 0),
        failed: outcome.results.filter((r) => !r.ok).length,
        errors: outcome.results.filter((r) => r.error).map((r) => `${r.url}: ${r.error}`),
        mode: "auto-imports",
      },
      outcome.ok ? 200 : 502
    );
  }
  const outcome = await runSync(c.env, "manual");
  return c.json(outcome, outcome.ok ? 200 : 502);
});

adminApp.get("/sync/log", async (c) => {
  const state = await getSyncState(c.env.KV);
  const log = await listSyncLog(c.env.DB, 10);
  return c.json({ state, log });
});

adminApp.post("/snapshot", async (c) => {
  const snapshot = await regenerateSnapshot(c.env);
  return c.json({ ok: true, products: snapshot.products.length });
});

// ---- Configuración ----

// Normaliza una URL opcional: acepta vacío; fuerza https:// si falta el esquema.
function normalizeUrl(v: unknown, max: number): string {
  const s = String(v ?? "").trim().slice(0, max);
  if (s === "") return "";
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}

adminApp.get("/settings", async (c) => {
  return c.json({ settings: await getSettings(c.env.KV) });
});

adminApp.put("/settings", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: "Body inválido" }, 400);
  const settings = await saveSettings(c.env.KV, {
    whatsappPhone: String(body.whatsappPhone ?? "").replace(/[^0-9+]/g, ""),
    currencySymbol: String(body.currencySymbol ?? "$").slice(0, 3) || "$",
    syncUrl: String(body.syncUrl ?? "").slice(0, 500),
    syncIntervalMinutes: Math.max(15, Math.round(Number(body.syncIntervalMinutes ?? 60))),
    syncToken: String(body.syncToken ?? "").slice(0, 200),
    storeName: String(body.storeName ?? "").slice(0, 60),
    storeAddress: String(body.storeAddress ?? "").slice(0, 200),
    storeMapUrl: normalizeUrl(body.storeMapUrl, 500),
    storeHours: String(body.storeHours ?? "").slice(0, 300),
    instagramUrl: normalizeUrl(body.instagramUrl, 300),
    facebookUrl: normalizeUrl(body.facebookUrl, 300),
  });
  return c.json({ settings });
});

// ---- Reglas de precio ----

function sanitizeRule(body: Record<string, unknown>, id: string): PriceRule {
  const maxRaw = body.maxCents;
  const groupName = String(body.groupName ?? "").trim().slice(0, 80) || null;
  return {
    id,
    name: String(body.name ?? "").slice(0, 100),
    groupName,
    minCents: Math.max(0, roundToPeso(Math.round(Number(body.minCents ?? 0)))),
    maxCents: maxRaw === null || maxRaw === undefined || maxRaw === "" ? null : roundToPeso(Math.round(Number(maxRaw))),
    percent: Math.min(500, Math.max(-90, Number(body.percent ?? 0))),
    active: body.active !== false,
    priority: Math.round(Number(body.priority ?? 0)),
  };
}

adminApp.get("/price-rules", async (c) => {
  return c.json({ rules: await listPriceRules(c.env.DB) });
});

adminApp.post("/price-rules", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body?.name) return c.json({ error: "Falta el nombre de la regla" }, 400);
  const id = typeof body.id === "string" && body.id.trim() !== "" ? body.id.trim() : newId();
  const rule = sanitizeRule(body, id);
  await upsertPriceRule(c.env.DB, rule, nowMs());
  return c.json({ rule }, 201);
});

adminApp.put("/price-rules/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await listPriceRules(c.env.DB);
  if (!existing.some((r) => r.id === id)) return c.json({ error: "Regla no encontrada" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body?.name) return c.json({ error: "Falta el nombre de la regla" }, 400);
  const rule = sanitizeRule({ ...body, id }, id);
  await upsertPriceRule(c.env.DB, rule, nowMs());
  return c.json({ rule });
});

adminApp.delete("/price-rules/:id", async (c) => {
  await deletePriceRule(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

// ---- Auto-importaciones programadas ----

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Solo horas enteras: el cron corre cada 1 hora, los minutos no aplican.
const FULL_HOUR_RE = /^([01]\d|2[0-3]):00$/;

function sanitizeAutoImport(body: Record<string, unknown>, id: string): AutoImport & { url: string } {
  const times = Array.isArray(body.times)
    ? [...new Set((body.times as unknown[]).map((t) => String(t).trim()).filter((t) => FULL_HOUR_RE.test(t)))]
        .sort()
    : [];
  const ruleRaw = body.priceRuleId;
  const priceRuleId = typeof ruleRaw === "string" && ruleRaw.trim() !== "" ? ruleRaw.trim() : null;
  return {
    id,
    url: String(body.url ?? "").trim().slice(0, 500),
    label: String(body.label ?? "").trim().slice(0, 100),
    priceRuleId,
    times,
    active: body.active !== false,
    lastRunAt: typeof body.lastRunAt === "number" ? body.lastRunAt : null,
    lastStatus: typeof body.lastStatus === "string" ? body.lastStatus : null,
  };
}

adminApp.get("/auto-imports", async (c) => {
  return c.json({ jobs: await listAutoImports(c.env.DB) });
});

adminApp.post("/auto-imports", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body?.url || !String(body.url).startsWith("http")) {
    return c.json({ error: "Falta una URL válida" }, 400);
  }
  const id = typeof body.id === "string" && body.id.trim() !== "" ? body.id.trim() : newId();
  const job = sanitizeAutoImport(body, id);
  if (job.label === "") job.label = job.url.replace(/^https?:\/\//, "").slice(0, 80);
  await upsertAutoImport(c.env.DB, job, nowMs());
  return c.json({ job }, 201);
});

adminApp.put("/auto-imports/:id", async (c) => {
  const id = c.req.param("id");
  const existing = (await listAutoImports(c.env.DB)).find((j) => j.id === id);
  if (!existing) return c.json({ error: "Auto-importación no encontrada" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const job = sanitizeAutoImport({ ...existing, ...body, id }, id);
  await upsertAutoImport(c.env.DB, job, nowMs());
  return c.json({ job });
});

adminApp.delete("/auto-imports/:id", async (c) => {
  await deleteAutoImport(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

// Ejecutar ahora (manual): corre solo los activos cuyo horario incluya "ahora",
// o todos los activos si body.all = true.
adminApp.post("/auto-imports/run", async (c) => {
  const body = await c.req.json<{ all?: boolean }>().catch(() => ({}) as { all?: boolean });
  if (body?.all) {
    // Fuerza la ejecución de todos los activos ignorando horarios.
    const jobs = (await listAutoImports(c.env.DB)).filter((j) => j.active);
    const results = [];
    for (const job of jobs) {
      try {
        const r = await extractFromUrl(job.url);
        const outcome = await importItems(c.env, r.items, { forceRuleId: job.priceRuleId ?? null });
        await markAutoImportRun(c.env.DB, job.id, outcome.ok ? "ok" : "error", nowMs());
        results.push({ id: job.id, url: job.url, ok: outcome.ok, imported: outcome.imported, error: outcome.errors[0] ?? null });
      } catch (e) {
        await markAutoImportRun(c.env.DB, job.id, "error", nowMs());
        results.push({ id: job.id, url: job.url, ok: false, imported: 0, error: e instanceof Error ? e.message : "Error" });
      }
    }
    return c.json({ ok: results.every((r) => r.ok), results, ranAt: nowMs() });
  }
  const outcome = await runAutoImports(c.env);
  return c.json({ ...outcome, ranAt: nowMs(), nowAR: nowArgentina() });
});

// ---- Importación (URL, JSON pegado o items ya extraídos/seleccionados) ----

interface ImportBody {
  url?: string;
  json?: string;
  items?: unknown[];
  priceRuleId?: string | null;
}

async function resolveImportBody(
  body: ImportBody | null
): Promise<{ items: unknown[]; source: string; errors: string[] } | { error: string }> {
  if (body?.items && Array.isArray(body.items)) {
    return { items: body.items, source: "selección", errors: [] };
  }
  if (body?.json && body.json.trim() !== "") {
    try {
      return { items: extractItems(JSON.parse(body.json)), source: "json", errors: [] };
    } catch {
      return { error: "El JSON pegado no es válido" };
    }
  }
  if (body?.url && body.url.trim() !== "") {
    try {
      const r = await extractFromUrl(body.url.trim());
      return { items: r.items, source: r.source, errors: r.errors };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "No se pudo extraer la URL" };
    }
  }
  return { error: "Pasá una URL, un JSON o una selección de items" };
}

adminApp.post("/import", async (c) => {
  const body = await c.req.json<ImportBody>().catch(() => null);
  const r = await resolveImportBody(body);
  if ("error" in r) return c.json({ error: r.error }, 400);
  // Cuando la UI manda la selección del preview, los precios YA vienen con la
  // regla aplicada: no volver a aplicar (doble recargo). El resto de fuentes
  // (URL, JSON) aplican las reglas activas o la forzada dentro de importItems.
  const skipRules = r.source === "selección";
  const outcome = await importItems(c.env, r.items, {
    forceRuleId: skipRules ? null : body?.priceRuleId ?? null,
    skipRules,
  });
  // Recordar la URL importada (para la pestaña Auto-importaciones).
  if (outcome.ok && body?.url && body.url.trim().startsWith("http")) {
    await rememberImportUrl(c.env.DB, body.url.trim(), body.priceRuleId ?? null);
  }
  return c.json({ ...outcome, source: r.source }, outcome.ok ? 200 : 422);
});

/** Registra (o actualiza) la URL usada en una importación manual. */
async function rememberImportUrl(db: D1Database, url: string, priceRuleId: string | null): Promise<void> {
  try {
    const existing = await getAutoImportByUrl(db, url);
    const now = nowMs();
    if (existing) {
      // Solo actualiza la regla si se usó una distinta de "automático".
      await upsertAutoImport(db, { ...existing, priceRuleId: priceRuleId ?? existing.priceRuleId }, now);
    } else {
      await upsertAutoImport(
        db,
        {
          id: newId(),
          url,
          label: url.replace(/^https?:\/\//, "").slice(0, 80),
          priceRuleId,
          times: [],
          active: false,
          lastRunAt: null,
          lastStatus: null,
        },
        now
      );
    }
  } catch {
    // Si la tabla no existe todavía (base sin migrar), ignorar silenciosamente.
  }
}

adminApp.post("/import/preview", async (c) => {
  const body = await c.req.json<ImportBody>().catch(() => null);
  const r = await resolveImportBody(body);
  if ("error" in r) return c.json({ error: r.error }, 400);
  const rules = await listPriceRules(c.env.DB);
  const normalized = normalizeExternalItems(r.items);
  const applications: { productId: string; baseCents: number; finalCents: number; ruleName: string | null; percent: number }[] = [];
  for (const p of normalized.products) {
    const app = applyRuleSet(p.priceCents, rules, body?.priceRuleId ?? null);
    applications.push({
      productId: p.id,
      baseCents: app.baseCents,
      finalCents: app.finalCents,
      ruleName: app.ruleName,
      percent: app.percent,
    });
    p.priceCents = app.finalCents;
  }
  return c.json({
    source: r.source,
    found: r.items.length,
    products: normalized.products,
    applications,
    errors: [...r.errors, ...normalized.errors].slice(0, 30),
  });
});
