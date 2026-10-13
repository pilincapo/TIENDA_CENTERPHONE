// El plan gratis de Cloudflare permite 50 queries D1 por invocación. El upsert de
// productos manda las filas dentro de UN bind (JSON) y las expande con json_each:
// con la versión anterior (7 filas por statement por el límite de 100 parámetros)
// una fuente de 370 productos —el catálogo de Tecnova— eran 53 statements y la
// importación completa se pasaba del límite.
import { describe, expect, it } from "vitest";
import {
  setProductsWaPublish,
  setWhatsAppScope,
  upsertCategoriesBatch,
  upsertProduct,
  upsertProductsBatch,
  waCategoryScope,
  waSourceScope,
  whatsAppScopePreview,
} from "./db";
import type { Product } from "../shared/types";

const NOW = 1_770_000_000_000;

/**
 * D1 de mentira: guarda las consultas y devuelve cambios = cantidad de binds (valor
 * arbitrario, alcanza para verificar el troceado). `fila` es lo que devuelve first().
 */
function makeDb(fila: Record<string, unknown> | null = null): { db: D1Database; statements: { sql: string; binds: unknown[] }[] } {
  const statements: { sql: string; binds: unknown[] }[] = [];
  const prepare = (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      run: async () => {
        statements.push({ sql, binds });
        return { success: true, meta: { changes: binds.length } };
      },
      first: async () => {
        statements.push({ sql, binds });
        return fila;
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

// La marca del catálogo de WhatsApp (`products.wa_publish`) la administra el
// panel, no las fuentes: si el upsert de importación la escribiera, cada sync
// borraría la selección hecha a mano y el feed de Meta quedaría vacío.
describe("importación y marca del catálogo de WhatsApp", () => {
  it("el upsert por lotes no escribe wa_publish", async () => {
    const { db, statements } = makeDb();
    await upsertProductsBatch(db, [producto(0), producto(1)], NOW);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.sql.toLowerCase()).not.toContain("wa_publish");
    }
  });

  it("el upsert individual (alta/edición del panel) tampoco la escribe", async () => {
    const { db, statements } = makeDb();
    await upsertProduct(db, { ...producto(0), waPublish: true }, NOW);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql.toLowerCase()).not.toContain("wa_publish");
  });
});

describe("setProductsWaPublish (acción masiva del panel)", () => {
  it("marca por lotes de 98 ids: ids desde ?3, dentro del límite de 100 parámetros de D1", async () => {
    const { db, statements } = makeDb();
    const ids = Array.from({ length: 100 }, (_, i) => `p-${i}`);
    const actualizados = await setProductsWaPublish(db, ids, true, NOW);
    expect(statements).toHaveLength(2);
    expect(statements[0]!.sql).toContain("SET wa_publish = ?1, updated_at = ?2 WHERE id IN (?3");
    // 98 ids + wa_publish + updated_at = 100 parámetros exactos.
    expect(statements[0]!.binds).toHaveLength(100);
    expect(statements[0]!.binds[0]).toBe(1);
    expect(statements[0]!.binds[1]).toBe(NOW);
    expect(statements[0]!.binds[99]).toBe("p-97");
    expect(statements[1]!.binds[0]).toBe(1);
    expect(statements[1]!.binds[2]).toBe("p-98");
    expect(statements[1]!.binds[3]).toBe("p-99");
    expect(actualizados).toBeGreaterThan(0);
  });

  it("desmarcar escribe 0 y sin ids no prepara ninguna consulta", async () => {
    const { db, statements } = makeDb();
    expect(await setProductsWaPublish(db, [], true, NOW)).toBe(0);
    expect(statements).toHaveLength(0);
    await setProductsWaPublish(db, ["a"], false, NOW);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.binds[0]).toBe(0);
  });
});

// Acción masiva por alcance: por categoría (misma semántica que el borrado masivo del
// panel: los productos que la tienen como categoría O como subcategoría) o por origen
// (misma semántica que el filtro "Origen:" de la lista, vía sourceCondition).
describe("marcar/quitar un alcance entero en WhatsApp", () => {
  it("el preview separa lo que entra al feed de lo que queda afuera", async () => {
    const { db, statements } = makeDb({
      total: 10,
      ya_marcados: 4,
      a_marcar: 6,
      con_foto: 8,
      sin_stock: 1,
      sin_foto: 1,
      en_feed: 3,
    });
    const p = await whatsAppScopePreview(db, waCategoryScope("mascotas"));
    expect(p).toEqual({ total: 10, yaMarcados: 4, aMarcar: 6, conFoto: 8, sinStock: 1, sinFoto: 1, enFeed: 3 });
    // conFoto + sinStock + sinFoto = total: el texto de la vista previa tiene que cerrar siempre.
    expect(p.conFoto + p.sinStock + p.sinFoto).toBe(p.total);
    // Lo que está en el feed es un subconjunto de lo marcado (marcado + publicado + con foto).
    expect(p.enFeed).toBeLessThanOrEqual(p.yaMarcados);
    expect(statements[0]!.sql).toContain("WHERE (category_id = ? OR subcategory_id = ?)");
    expect(statements[0]!.binds).toEqual(["mascotas", "mascotas"]);
  });

  it("un preview sin filas no devuelve NaN", async () => {
    const { db } = makeDb({ total: null, ya_marcados: null, a_marcar: null, con_foto: null, sin_stock: null, sin_foto: null, en_feed: null });
    expect(await whatsAppScopePreview(db, waCategoryScope("vacia"))).toEqual({
      total: 0,
      yaMarcados: 0,
      aMarcar: 0,
      conFoto: 0,
      sinStock: 0,
      sinFoto: 0,
      enFeed: 0,
    });
  });

  it("el alcance por origen reusa el predicado del filtro de la lista", async () => {
    const { db, statements } = makeDb();
    expect(waSourceScope("tecnova")).toEqual({ where: "source_url LIKE ?", args: ["%tecnova%"] });
    // Los manuales son los que no tienen source_url, igual que en el filtro del panel.
    expect(waSourceScope("manual")).toEqual({ where: "source_url IS NULL", args: [] });
    // "Todos" no es un alcance: no hay acción masiva sobre el catálogo entero de un clic.
    expect(waSourceScope("")).toBeNull();
    await whatsAppScopePreview(db, waSourceScope("manual")!);
    expect(statements[0]!.sql).toContain("WHERE source_url IS NULL");
    expect(statements[0]!.binds).toEqual([]);
  });

  it("marcar el alcance es una sola consulta y solo toca lo que falta", async () => {
    const { db, statements } = makeDb();
    await setWhatsAppScope(db, waCategoryScope("mascotas"), true, NOW);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain("WHERE wa_publish = ? AND ((category_id = ? OR subcategory_id = ?))");
    expect(statements[0]!.sql.toLowerCase()).not.toContain("status =");
    expect(statements[0]!.binds).toEqual([1, NOW, 0, "mascotas", "mascotas"]);
  });

  it("quitar el alcance invierte los valores (y sirve para un origen)", async () => {
    const { db, statements } = makeDb();
    await setWhatsAppScope(db, waSourceScope("tecnova")!, false, NOW);
    expect(statements[0]!.sql).toContain("WHERE wa_publish = ? AND (source_url LIKE ?)");
    expect(statements[0]!.binds).toEqual([0, NOW, 1, "%tecnova%"]);
  });
});
