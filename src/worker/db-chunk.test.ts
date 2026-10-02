// El límite duro de D1 son 100 parámetros por sentencia. Con BATCH_SIZE=30 el
// batch de productos generaba 391 parámetros, la sentencia fallaba SIEMPRE y
// el import caía al upsert producto por producto (lento y sin el COALESCE de
// subcategoría). El chunk ahora se calcula desde el límite real.
import { describe, expect, it } from "vitest";
import { chunkSizeFor } from "./db";

describe("chunkSizeFor", () => {
  it("productos: 13 binds por fila + 1 de now queda en 92 parámetros", () => {
    const n = chunkSizeFor(13);
    expect(n).toBe(7);
    expect(n * 13 + 1).toBeLessThanOrEqual(100);
    // El siguiente tamaño ya excedería el límite.
    expect((n + 1) * 13 + 1).toBeGreaterThan(100);
  });

  it("categorías: 4 binds por fila + 1 no pasa los 100 parámetros", () => {
    const n = chunkSizeFor(4);
    expect(n * 4 + 1).toBeLessThanOrEqual(100);
    expect(n * 4 + 1).toBeGreaterThan(90);
  });

  it("ids: 1 bind por fila aprovecha el límite", () => {
    expect(chunkSizeFor(1)).toBe(99);
  });

  it("nunca devuelve chunk vacío", () => {
    expect(chunkSizeFor(0)).toBeGreaterThanOrEqual(1);
    expect(chunkSizeFor(1000)).toBe(1);
  });
});
