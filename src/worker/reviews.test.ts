// Reseñas de Google: la API pública no puede filtrar reseñas ocultas y el panel
// (con sesión) es el único que puede crear, editar o borrar.
import { describe, expect, it } from "vitest";
import { adminApp } from "./admin";
import { reviewsApp } from "./reviews";
import { KV_SETTINGS_KEY } from "../shared/types";
import type { Dict, Env } from "./db";

const COLS = [
  "id",
  "author",
  "author_meta",
  "rating",
  "body",
  "reviewed_at",
  "local_reply",
  "featured",
  "active",
  "sort_order",
  "created_at",
  "updated_at",
];

function makeDb() {
  const rows: Dict[] = [];

  function sorted(onlyActive: boolean): Dict[] {
    return rows
      .filter((r) => !onlyActive || Number(r.active) === 1)
      .sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) ||
          Number(a.sort_order) - Number(b.sort_order) ||
          Number(b.reviewed_at ?? 0) - Number(a.reviewed_at ?? 0),
      );
  }

  const db = {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        all: async () => ({ results: sorted(/WHERE active = 1/i.test(sql)) }),
        first: async () => rows.find((r) => r.id === args[0]) ?? null,
        run: async () => {
          if (/INSERT INTO google_reviews/i.test(sql)) {
            const row: Dict = {};
            COLS.forEach((c, i) => {
              row[c] = args[i];
            });
            rows.push(row);
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE google_reviews SET author/i.test(sql)) {
            const row = rows.find((r) => r.id === args[0]);
            if (!row) return { success: true, meta: { changes: 0 } };
            COLS.slice(1).forEach((c, i) => {
              row[c] = args[i + 1];
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (/DELETE FROM google_reviews/i.test(sql)) {
            const i = rows.findIndex((r) => r.id === args[0]);
            if (i >= 0) rows.splice(i, 1);
            return { success: true, meta: { changes: i >= 0 ? 1 : 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      });
      return { ...exec([]), bind: (...a: unknown[]) => exec(a) };
    },
  };
  return { db, rows };
}

function makeKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function mockEnv(db: unknown, kv = makeKv()): Env {
  return { DB: db, KV: kv, ADMIN_PASSWORD: "pass-de-test" } as unknown as Env;
}

function seedSettings(kv: KVNamespace, over: Record<string, unknown> = {}): void {
  const raw = {
    storeName: "CenterPhone Celulares",
    storeAddress: "Mendoza 2974 · Santa Fe",
    storeMapUrl: "https://maps.google.com/?q=Mendoza+2974",
    googleReviewsEnabled: true,
    googleReviewsRating: 0,
    googleReviewsCount: 0,
    googleReviewUrl: "",
    ...over,
  };
  (kv as unknown as { put: (k: string, v: string) => Promise<void> }).put(KV_SETTINGS_KEY, JSON.stringify(raw));
}

function seedReview(rows: Dict[], over: Partial<Dict> = {}): Dict {
  const row: Dict = {
    id: "r1",
    author: "Lucía González",
    author_meta: "Local Guide · 24 reseñas",
    rating: 5,
    body: "Excelente atención.",
    reviewed_at: 1_700_000_000_000,
    local_reply: "",
    featured: 0,
    active: 1,
    sort_order: 0,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...over,
  };
  rows.push(row);
  return row;
}

async function login(env: Env): Promise<string> {
  const res = await adminApp.request(
    "/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
    env,
  );
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

interface PublicBody {
  enabled: boolean;
  rating: number;
  count: number;
  reviewUrl: string;
  reviews: { id: string; author: string; rating: number; active?: boolean }[];
}

describe("GET /api/google-reviews", () => {
  it("con el bloque apagado no devuelve reseñas", async () => {
    const { db, rows } = makeDb();
    seedReview(rows);
    const kv = makeKv();
    seedSettings(kv, { googleReviewsEnabled: false });
    const res = await reviewsApp.request("/api/google-reviews", {}, mockEnv(db, kv));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicBody;
    expect(body.enabled).toBe(false);
    expect(body.reviews).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("devuelve sólo las visibles, con la destacada primero", async () => {
    const { db, rows } = makeDb();
    seedReview(rows, { id: "vieja", author: "Ana", sort_order: 2, featured: 0 });
    seedReview(rows, { id: "nueva", author: "Bruno", sort_order: 1, featured: 0 });
    seedReview(rows, { id: "destacada", author: "Carla", sort_order: 9, featured: 1 });
    seedReview(rows, { id: "oculta", author: "Diego", active: 0, featured: 1 });
    const kv = makeKv();
    seedSettings(kv, { googleReviewsEnabled: true });

    const res = await reviewsApp.request("/api/google-reviews", {}, mockEnv(db, kv));
    const body = (await res.json()) as PublicBody;
    expect(body.reviews.map((r) => r.id)).toEqual(["destacada", "nueva", "vieja"]);
    expect(body.reviews.some((r) => r.id === "oculta")).toBe(false);
    expect(body.count).toBe(3);
    expect(body.rating).toBe(5);
  });

  it("usa el promedio y el total cargados en el panel cuando están", async () => {
    const { db, rows } = makeDb();
    seedReview(rows, { rating: 3 });
    const kv = makeKv();
    seedSettings(kv, { googleReviewsEnabled: true, googleReviewsRating: 4.8, googleReviewsCount: 84 });
    const body = (await (await reviewsApp.request("/api/google-reviews", {}, mockEnv(db, kv))).json()) as PublicBody;
    expect(body.rating).toBe(4.8);
    expect(body.count).toBe(84);
  });
});

describe("panel de reseñas", () => {
  it("sin sesión no expone nada", async () => {
    const { db } = makeDb();
    expect((await adminApp.request("/google-reviews", {}, mockEnv(db))).status).toBe(401);
  });

  it("crea una reseña y la devuelve en el listado", async () => {
    const { db, rows } = makeDb();
    const env = mockEnv(db);
    const cookie = await login(env);
    const res = await adminApp.request(
      "/google-reviews",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ author: "Ana Gómez", rating: 5, body: "Muy buena atención", reviewedAt: "2026-10-12" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.author).toBe("Ana Gómez");
    expect(Number(rows[0]?.active)).toBe(1);

    const list = await adminApp.request("/google-reviews", { headers: { Cookie: cookie } }, env);
    const body = (await list.json()) as { reviews: { author: string }[] };
    expect(body.reviews[0]?.author).toBe("Ana Gómez");
  });

  it("rechaza un puntaje fuera de 1..5", async () => {
    const { db, rows } = makeDb();
    const env = mockEnv(db);
    const cookie = await login(env);
    const res = await adminApp.request(
      "/google-reviews",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ author: "Ana", rating: 9 }),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("destaca y oculta desde la tabla sin mandar el formulario entero", async () => {
    const { db, rows } = makeDb();
    seedReview(rows, { id: "r1" });
    const env = mockEnv(db);
    const cookie = await login(env);

    const res = await adminApp.request(
      "/google-reviews/r1",
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ featured: true }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(Number(rows[0]?.featured)).toBe(1);
    expect(rows[0]?.author).toBe("Lucía González"); // no se perdió el resto

    const hide = await adminApp.request(
      "/google-reviews/r1",
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ active: false }) },
      env,
    );
    expect(hide.status).toBe(200);
    expect(Number(rows[0]?.active)).toBe(0);
  });

  it("borra y responde 404 si ya no existe", async () => {
    const { db, rows } = makeDb();
    seedReview(rows, { id: "r1" });
    const env = mockEnv(db);
    const cookie = await login(env);
    const first = await adminApp.request("/google-reviews/r1", { method: "DELETE", headers: { Cookie: cookie } }, env);
    expect(first.status).toBe(200);
    expect(rows).toHaveLength(0);
    const again = await adminApp.request("/google-reviews/r1", { method: "DELETE", headers: { Cookie: cookie } }, env);
    expect(again.status).toBe(404);
  });

  it("guarda la configuración y valida el link de Google", async () => {
    const { db } = makeDb();
    const kv = makeKv();
    seedSettings(kv, { googleReviewsEnabled: false });
    const env = mockEnv(db, kv);
    const cookie = await login(env);

    const badUrl = await adminApp.request(
      "/google-reviews/config",
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ reviewUrl: "no es una url" }) },
      env,
    );
    expect(badUrl.status).toBe(400);

    const ok = await adminApp.request(
      "/google-reviews/config",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ enabled: true, rating: 4.9, count: 84, reviewUrl: "https://g.page/r/abc/review" }),
      },
      env,
    );
    expect(ok.status).toBe(200);
    const saved = (await ok.json()) as { config: { enabled: boolean; count: number; reviewUrl: string } };
    expect(saved.config.enabled).toBe(true);
    expect(saved.config.count).toBe(84);
    expect(saved.config.reviewUrl).toContain("g.page/r/abc/review");

    // El sitio público ya ve el bloque prendido.
    const pub = (await (await reviewsApp.request("/api/google-reviews", {}, env)).json()) as PublicBody;
    expect(pub.enabled).toBe(true);
    expect(pub.count).toBe(84);
  });
});
