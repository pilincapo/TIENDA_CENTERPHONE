// Instrumentación de D1: registrar el costo real por request sin cambiar ninguna
// consulta. Cubre la suma por sentencia (incluido `bind()`), el caso de `first()`
// y el data point que se emite.
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { instrumentarD1, nuevoUso, registrarUsoD1 } from "./d1-usage";
import { countProducts } from "./db";
import type { Env } from "./db";

function sentenciaFalsa(rowsRead: number, rowsWritten = 0): D1PreparedStatement {
  const stmt = {
    bind: (..._args: unknown[]) => sentenciaFalsa(rowsRead, rowsWritten),
    all: async () => ({ results: [{ a: 1 }], meta: { rows_read: rowsRead, rows_written: rowsWritten } }),
    run: async () => ({ success: true, meta: { rows_read: rowsRead, rows_written: rowsWritten } }),
    raw: async () => [[1]],
    first: async () => ({ a: 1 }),
  };
  return stmt as unknown as D1PreparedStatement;
}

/** Devuelve una sentencia por `prepare()`, con el costo indicado en orden. */
function dbFalsa(costos: number[]): D1Database {
  let i = 0;
  return {
    prepare: () => {
      const costo = costos[i] ?? costos[costos.length - 1] ?? 0;
      i += 1;
      return sentenciaFalsa(costo);
    },
  } as unknown as D1Database;
}

function contexto(routePath: string, estado: number, ds?: unknown) {
  const puntos: unknown[] = [];
  const c = {
    req: { url: "https://centerphone.com.ar/api/products/123", method: "GET", routePath },
    res: { status: estado },
    env: ds === undefined ? {} : { D1_USAGE: ds },
  } as unknown as Context<{ Bindings: Env }>;
  return { c, puntos };
}

describe("instrumentarD1", () => {
  it("suma las filas y las escrituras de cada sentencia", async () => {
    const uso = nuevoUso();
    const db = instrumentarD1(dbFalsa([1371, 8, 1]), uso);

    await db.prepare("a").all();
    await db.prepare("b").bind("x").all();
    await db.prepare("c").run();

    expect(uso).toEqual({ rowsRead: 1380, rowsWritten: 0, queries: 3 });
  });

  it("first() cuenta la consulta aunque D1 no devuelva meta", async () => {
    const uso = nuevoUso();
    const db = instrumentarD1(dbFalsa([1]), uso);

    expect(await db.prepare("SELECT 1").first()).toEqual({ a: 1 });
    expect(uso).toEqual({ rowsRead: 0, rowsWritten: 0, queries: 1 });
  });

  it("un conteo del panel llega con sus filas: usa all(), no first()", async () => {
    // Si `countProducts` volviera a `first()`, el meta se perdería y esto daría 0.
    const uso = nuevoUso();
    const db = instrumentarD1(dbFalsa([2091]), uso);

    await countProducts(db, { status: "", q: "", src: "" });

    expect(uso.queries).toBe(1);
    expect(uso.rowsRead).toBe(2091);
  });

  it("no altera el resultado ni el encadenado de las consultas", async () => {
    const db = instrumentarD1(dbFalsa([3]), nuevoUso());
    const res = await db.prepare("SELECT 1").bind(1).all();
    expect(res.results).toEqual([{ a: 1 }]);
    // `raw()` pasa de largo: no aporta `meta` y no hace falta envolverlo.
    expect(await db.prepare("SELECT 1").raw()).toEqual([[1]]);
  });
});

describe("registrarUsoD1", () => {
  it("emite ruta, estado y consultas, con el path real como blob", () => {
    const { c, puntos } = contexto("/api/products/:id", 200, {
      writeDataPoint: (p: unknown) => puntos.push(p),
    });
    registrarUsoD1(c, { rowsRead: 9, rowsWritten: 0, queries: 2 });

    expect(puntos).toEqual([
      {
        indexes: ["/api/products/:id"],
        blobs: ["200", "/api/products/123"],
        doubles: [9, 0, 2],
      },
    ]);
  });

  it("no gasta un data point si el request no tocó D1", () => {
    const { c, puntos } = contexto("/sitemap.xml", 200, {
      writeDataPoint: (p: unknown) => puntos.push(p),
    });
    registrarUsoD1(c, nuevoUso());

    expect(puntos).toHaveLength(0);
  });

  it("sin binding (dev local o tests) no rompe el request", () => {
    const { c, puntos } = contexto("/api/catalog", 200);
    expect(() => registrarUsoD1(c, { rowsRead: 1371, rowsWritten: 0, queries: 1 })).not.toThrow();
    expect(puntos).toHaveLength(0);
  });
});
