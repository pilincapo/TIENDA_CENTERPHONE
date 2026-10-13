// El plan gratis de Cloudflare permite 50 queries D1 por invocación. El upsert de
// productos manda las filas dentro de UN bind (JSON) y las expande con json_each:
// con la versión anterior (7 filas por statement por el límite de 100 parámetros)
// una fuente de 370 productos —el catálogo de Tecnova— eran 53 statements y la
// importación completa se pasaba del límite.
import { describe, expect, it } from "vitest";
import { upsertCategoriesBatch, upsertProductsBatch } from "./db";
import type { Product } from "../shared/types";

const NOW = 1_770_000_000_000;

function makeDb(): { db: D1Database; statements: { sql: string; binds: unknown[] }[] } {
  const statements: { sql: string; binds: unknown[] }[] = [];
  const prepare = (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      run: async () => {
        statements.push({ sql, binds });
        return { success: true, meta: { changes: binds.length } };
      },
    }),
  });
  return { db: { prepare } as unknown as D1Database, statements };
}

function producto(i: number): Product {
  return {
    id: `p-${i}`,
    title: `Producto ${i}`,
    description: "Descripción ".repeat(20),
    priceCents: 1000 + i,
    categoryId: "celulares",
    subcategoryId: i % 2 === 0 ? "accesorios" : null,
    tags: ["new"],
    imageUrl: `https://ejemplo.com/${i}.jpg`,
    status: "published",
    availability: "in_stock",
    sortOrder: i,
    createdAt: NOW - 1000,
    sourceUrl: "https://tecnova.com.ar/",
    brand: null,
  };
}

describe("upsertProductsBatch (límite de 50 queries por invocación)", () => {
  it("370 productos salen en 8 statements (50 filas por bind), no en 53", async () => {
    const { db, statements } = makeDb();
    const failed = await upsertProductsBatch(db, Array.from({ length: 370 }, (_, i) => producto(i)), NOW);
    expect(failed).toEqual([]);
    expect(statements.length).toBe(8);
    // 8 statements + consultas auxiliares de la corrida: cómodo bajo las 50 del free.
    expect(statements.length).toBeLessThan(50);
  });

  it("cada statement expande un JSON con hasta 50 productos y el timestamp", async () => {
    const { db, statements } = makeDb();
    await upsertProductsBatch(db, Array.from({ length: 60 }, (_, i) => producto(i)), NOW);
    expect(statements.map((s) => s.sql.includes("json_each(?1)"))).toEqual([true, true]);
    const payload = JSON.parse(String(statements[0]!.binds[0])) as Record<string, unknown>[];
    expect(payload).toHaveLength(50);
    expect(statements[1]!.binds).toHaveLength(1);
    const resto = JSON.parse(String(statements[1]!.binds[0])) as Record<string, unknown>[];
    expect(resto).toHaveLength(10);
    expect(payload[0]).toMatchObject({ id: "p-0", priceCents: 1000, now: NOW });
    // subcategoryId ausente/NULL viaja igual (la sentencia lo respeta con COALESCE).
    expect(payload[1]).toMatchObject({ id: "p-1", subcategoryId: null });
  });

  it("sin productos no prepara ningún statement", async () => {
    const { db, statements } = makeDb();
    expect(await upsertProductsBatch(db, [], NOW)).toEqual([]);
    expect(statements).toHaveLength(0);
  });
});

// El texto que llega de las fuentes externas se sanea al ESCRIBIR (mismo criterio
// que los settings: src/shared/encoding.ts), así el catálogo, el snapshot y el
// JSON-LD no pueden quedar con «SÃ¡bados» aunque la fuente venga mal codificada.
describe("texto saneado al escribir en D1", () => {
  it("repara el mojibake de título, descripción, marca e imagen en el lote", async () => {
    const { db, statements } = makeDb();
    const roto: Product = {
      ...producto(0),
      title: "Bater\u00c3\u00ada para celular \u00e2\u20ac\u201d 4000mAh",
      description: "Incluye cable \u00c3\u00batil.",
      brand: "S\u00c3\u00a1msung",
      imageUrl: "https://ejemplo.com/bater\u00c3\u00ada.jpg",
    };
    expect(await upsertProductsBatch(db, [roto], NOW)).toEqual([]);
    const payload = JSON.parse(String(statements[0]!.binds[0])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({
      title: "Batería para celular — 4000mAh",
      description: "Incluye cable útil.",
      brand: "Sámsung",
      imageUrl: "https://ejemplo.com/batería.jpg",
    });
  });

  it("no toca id ni sourceUrl: son claves de identidad", async () => {
    const { db, statements } = makeDb();
    // Aun con mojibake en los campos de identidad, no se reescriben (cambiarlos
    // haría que el producto se vea como desaparecido en el próximo sync).
    const raro: Product = {
      ...producto(0),
      id: "p\u00c3\u00a1-0",
      sourceUrl: "https://tecnova.com.ar/b\u00c3\u00basqueda",
    };
    await upsertProductsBatch(db, [raro], NOW);
    const payload = JSON.parse(String(statements[0]!.binds[0])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({ id: "p\u00c3\u00a1-0", sourceUrl: "https://tecnova.com.ar/b\u00c3\u00basqueda" });
  });

  it("deja intacto el texto sano (tildes, «·», emoji) y la marca nula", async () => {
    const { db, statements } = makeDb();
    const sano: Product = { ...producto(1), title: "Cargador rápido · 📦 20W", brand: null };
    await upsertProductsBatch(db, [sano], NOW);
    const payload = JSON.parse(String(statements[0]!.binds[0])) as Record<string, unknown>[];
    expect(payload[0]).toMatchObject({ title: "Cargador rápido · 📦 20W", brand: null });
  });

  it("repara el nombre de la categoría sin tocar id ni parentId", async () => {
    const { db, statements } = makeDb();
    await upsertCategoriesBatch(
      db,
      [{ id: "electronica", name: "Electr\u00c3\u00b3nica", parentId: "ra\u00c3\u00adz", active: true }],
      NOW
    );
    expect(statements[0]!.binds[0]).toBe("electronica");
    expect(statements[0]!.binds[1]).toBe("Electrónica");
    expect(statements[0]!.binds[2]).toBe("ra\u00c3\u00adz");
  });
});
