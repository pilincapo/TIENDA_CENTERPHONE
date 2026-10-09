// El mapping efectivo es defaults ∪ guardado: lo guardado pisa (el admin puede
// saltar una categoría), pero las claves NUEVAS del default siempre están. Sin
// ese merge, la raíz "varios" (productos de Tecnova sin categoría) no la veía
// `ensureTecnovaCategories` y el preview del panel no mostraba ninguna fila con
// el KV vacío.

import { describe, expect, it } from "vitest";
import { DEFAULT_TECNOVA_CATEGORY_MAP, TECNOVA_MAPPING_KEY } from "../shared/tecnova";
import { ensureTecnovaCategories, readTecnovaMapping } from "./tecnova";
import type { Env } from "./db";

interface FakeD1 {
  db: D1Database;
  /** Escrituras contra D1, en orden: [sql, binds]. */
  escrituras: { sql: string; binds: unknown[] }[];
}

function makeDb(cats: Record<string, unknown>[] = []): FakeD1 {
  const escrituras: { sql: string; binds: unknown[] }[] = [];
  const stmt = (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      run: async () => {
        escrituras.push({ sql, binds });
        return { success: true, meta: { changes: binds.length } };
      },
    }),
    all: async () => ({ results: cats }),
    first: async () => null,
  });
  return { db: { prepare: stmt } as unknown as D1Database, escrituras };
}

function makeEnv(kvValue: string | null, db: D1Database): { env: Env; pedidas: string[] } {
  const pedidas: string[] = [];
  const kv = {
    get: async (k: string) => {
      pedidas.push(k);
      return kvValue;
    },
    put: async () => {},
  };
  return { env: { KV: kv, DB: db } as unknown as Env, pedidas };
}

const raiz = (id: string): Record<string, unknown> => ({ id, name: id, parent_id: null, active: 1 });

describe("readTecnovaMapping (defaults ∪ guardado)", () => {
  it("lee siempre la clave del mapping del KV", async () => {
    const { env, pedidas } = makeEnv(null, makeDb().db);
    await readTecnovaMapping(env);
    expect(pedidas).toEqual([TECNOVA_MAPPING_KEY]);
  });

  it("KV vacío: devuelve todos los defaults, incluida la raíz de sin-categoría", async () => {
    const { env } = makeEnv('{"targets":{},"subs":{}}', makeDb().db);
    const m = await readTecnovaMapping(env);
    expect(m.targets[""]).toBe("varios");
    expect(m.targets.ALMACENAMIENTO).toBe(DEFAULT_TECNOVA_CATEGORY_MAP.ALMACENAMIENTO);
    expect(Object.keys(m.targets).sort()).toEqual(Object.keys(DEFAULT_TECNOVA_CATEGORY_MAP).sort());
  });

  it("sin mapping en el KV: devuelve los defaults", async () => {
    const { env } = makeEnv(null, makeDb().db);
    const m = await readTecnovaMapping(env);
    expect(m.targets[""]).toBe("varios");
    expect(m.subs).toEqual({});
  });

  it("lo guardado pisa al default y las claves nuevas del default siguen presentes", async () => {
    const kv = JSON.stringify({ targets: { AUDIO: "", CUSTOM: "electronica" }, subs: { BAZAR: "bazar" } });
    const { env } = makeEnv(kv, makeDb().db);
    const m = await readTecnovaMapping(env);
    expect(m.targets.AUDIO).toBe(""); // el admin la mandó a saltar: no se pisa
    expect(m.targets.CUSTOM).toBe("electronica"); // clave propia del admin
    expect(m.targets[""]).toBe("varios"); // clave nueva del default: siempre
    expect(m.subs).toEqual({ BAZAR: "bazar" });
  });

  it("mapping corrupto en el KV: cae a los defaults", async () => {
    const { env } = makeEnv("esto no es json", makeDb().db);
    const m = await readTecnovaMapping(env);
    expect(m.targets[""]).toBe("varios");
    expect(m.targets.VARIOS).toBe("varios"); // categoría propia VARIOS unificada en la raíz
  });
});

describe("ensureTecnovaCategories", () => {
  it("da de alta la raíz que falta (varios) y no toca las existentes", async () => {
    const existentes = [raiz("electronica"), raiz("computacion"), raiz("hogar")];
    const { db, escrituras } = makeDb(existentes);
    const { env } = makeEnv(null, db);
    const mapping = await readTecnovaMapping(env);
    const creadas = await ensureTecnovaCategories(env, mapping);
    expect(escrituras).toHaveLength(1);
    // binds de upsertCategoriesBatch: id, name, parent_id, active, now
    expect(escrituras[0]!.binds.slice(0, 4)).toEqual(["varios", "Varios", null, 1]);
    expect(creadas.has("varios")).toBe(true);
  });

  it("si la raíz ya existe no escribe nada", async () => {
    const existentes = [raiz("electronica"), raiz("computacion"), raiz("hogar"), raiz("varios")];
    const { db, escrituras } = makeDb(existentes);
    const { env } = makeEnv(null, db);
    await ensureTecnovaCategories(env, await readTecnovaMapping(env));
    expect(escrituras).toHaveLength(0);
  });
});
