// El renombre de ids viejos (hash del proveedor, p. ej. "6160" de hacetupedido)
// al nombre de página del título: es lo que mantiene el catálogo sin duplicados
// cuando el importador empieza a generar ids nuevos, y el registro de redirects
// es lo que evita que las URLs viejas indexadas respondan 404.
// Acá se prueban las ramas de decisión del helper:
//  - destino libre + fila vieja existente → renombra y registra el 301;
//  - destino ocupado por un producto AJENO → el item conserva su id viejo
//    (nunca se pisa otro producto) y el fallback se reporta al caller;
//  - destino ocupado por una fila de la propia fuente → ya estaba renombrado;
//  - sin fila vieja → producto nuevo, no se escribe nada;
//  - el proveedor cambió el título → se renombra la fila que apunta el
//    redirect viejo y la cadena queda aplanada en un solo salto.
// También que ningún statement pase de los binds por query de D1 y que los
// lotes grandes salen en pocos statements (json_each: un bind por lote).

import { describe, expect, it } from "vitest";
import type { Product } from "../shared/types";
import { destinoDeRedirect, renombrarIds } from "./rename-ids";

const FUENTE = "https://hacetupedido.com.ar/celulares";

interface FakeD1 {
  db: D1Database;
  lecturas: { sql: string; binds: unknown[] }[];
  escrituras: { sql: string; binds: unknown[] }[];
  /** id → source_url (null = producto de otra fuente / alta manual). */
  filas: Record<string, string | null>;
  /** from_id → to_id de product_redirects. */
  redirects: Record<string, string>;
}

/** D1 de mentira que entiende los statements de rename-ids (json_each). */
function makeDb(filas: Record<string, string | null>, redirects: Record<string, string> = {}): FakeD1 {
  const lecturas: { sql: string; binds: unknown[] }[] = [];
  const escrituras: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({
        all: async () => {
          lecturas.push({ sql, binds });
          const ids = JSON.parse(String(binds[0])) as string[];
          if (sql.includes("product_redirects")) {
            return { results: ids.filter((i) => redirects[i] !== undefined).map((i) => ({ from_id: i, to_id: redirects[i] })) };
          }
          return { results: ids.filter((i) => filas[i] !== undefined).map((i) => ({ id: i, source_url: filas[i] ?? null })) };
        },
        first: async () => {
          lecturas.push({ sql, binds });
          const desde = String(binds[0]);
          const to = redirects[desde];
          return to === undefined ? null : { to_id: to };
        },
        run: async () => {
          escrituras.push({ sql, binds });
          const json = JSON.parse(String(binds[0])) as Record<string, string>;
          if (sql.includes("INSERT INTO product_redirects")) {
            // D1 real rechaza `->>` sobre un string (el mapa {desde: hasta}):
            // el SELECT tiene que salir de j.key/j.value, como acá abajo.
            if (sql.includes("->>")) {
              throw new Error('D1_ERROR: malformed JSON: SQLITE_ERROR (->> sobre un string del mapa)');
            }
            for (const [desde, hasta] of Object.entries(json)) redirects[desde] = hasta;
            return { success: true, meta: { changes: Object.keys(json).length } };
          }
          if (sql.includes("UPDATE product_redirects")) {
            let changes = 0;
            for (const [desde, hasta] of Object.entries(json)) {
              for (const [from, to] of Object.entries(redirects)) {
                if (to === desde) {
                  redirects[from] = hasta;
                  changes += 1;
                }
              }
            }
            return { success: true, meta: { changes } };
          }
          // UPDATE OR IGNORE products: renombra solo si el destino está libre.
          let changes = 0;
          for (const [desde, hasta] of Object.entries(json)) {
            if (filas[desde] !== undefined && filas[hasta] === undefined) {
              filas[hasta] = filas[desde];
              delete filas[desde];
              changes += 1;
            }
          }
          return { success: true, meta: { changes } };
        },
      }),
    }),
  };
  return { db: db as unknown as D1Database, lecturas, escrituras, filas, redirects };
}

/** Item de importación ya normalizado (id nuevo + prevId legado). */
const item = (hasta: string, desde?: string): Product => ({
  id: hasta,
  prevId: desde,
  title: `Producto ${hasta}`,
  description: "",
  priceCents: 1000,
  categoryId: null,
  subcategoryId: null,
  tags: [],
  imageUrl: "",
  status: "published",
  availability: "in_stock",
  sortOrder: 0,
  createdAt: 0,
  sourceUrl: FUENTE,
});

describe("renombrarIds", () => {
  it("renombra la fila con el id viejo, registra el 301 y devuelve cuántas cambiaron", async () => {
    const { db, escrituras, filas, redirects } = makeDb({ "6160": FUENTE });
    const it1 = item("cargador-usb-c", "6160");
    const r = await renombrarIds(db, [it1], FUENTE);
    expect(r.renombrados).toBe(1);
    expect(filas).toEqual({ "cargador-usb-c": FUENTE });
    expect(redirects).toEqual({ "6160": "cargador-usb-c" });
    // 3 statements por lote: redirects, aplanado de cadenas y el rename.
    expect(escrituras).toHaveLength(3);
    expect(it1.id).toBe("cargador-usb-c"); // no se toca el id nuevo
    expect(r.fallbacks.size).toBe(0);
  });

  it("destino ocupado por un producto ajeno: conserva el id viejo y reporta el fallback", async () => {
    const { db, escrituras, filas, redirects } = makeDb({
      "6160": FUENTE,
      "cargador-usb-c": null, // alta manual, otra fuente
    });
    const it1 = item("cargador-usb-c", "6160");
    const r = await renombrarIds(db, [it1], FUENTE);
    expect(r.renombrados).toBe(0);
    expect(it1.id).toBe("6160"); // fallback: nunca se pisa el ajeno
    expect(r.fallbacks.get("cargador-usb-c")).toBe("6160");
    expect(escrituras).toHaveLength(0);
    expect(redirects).toEqual({});
    expect(filas["cargador-usb-c"]).toBeNull();
    expect(filas["6160"]).toBe(FUENTE);
  });

  it("ya renombrado en una corrida anterior: estado estable, sin escrituras", async () => {
    const { db, escrituras } = makeDb({ "cargador-usb-c": FUENTE });
    const r = await renombrarIds(db, [item("cargador-usb-c", "6160")], FUENTE);
    expect(r.renombrados).toBe(0);
    expect(escrituras).toHaveLength(0);
  });

  it("producto nuevo (sin fila vieja): se da de alta con el id nuevo", async () => {
    const { db, escrituras } = makeDb({});
    const it1 = item("cargador-usb-c", "777");
    const r = await renombrarIds(db, [it1], FUENTE);
    expect(r.renombrados).toBe(0);
    expect(escrituras).toHaveLength(0);
    expect(it1.id).toBe("cargador-usb-c");
  });

  it("el proveedor cambió el título: renombra la fila que apunta el redirect y aplana la cadena", async () => {
    // Estado: "6160" ya se renombró a "cargador-usb" en una corrida anterior;
    // ahora el título cambió a "Cargador USB-C Rápido" → id "cargador-usb-c-rapido".
    const { db, filas, redirects } = makeDb(
      { "cargador-usb": FUENTE },
      { "6160": "cargador-usb" }
    );
    const r = await renombrarIds(db, [item("cargador-usb-c-rapido", "6160")], FUENTE);
    expect(r.renombrados).toBe(1);
    expect(filas).toEqual({ "cargador-usb-c-rapido": FUENTE });
    // Un solo salto desde la URL vieja ORIGINAL: /producto/6160 → ...-rapido
    // (cadena aplanada). El redirect del slug intermedio también queda apuntando
    // al actual: los links compartidos con el título anterior no se caen tampoco.
    expect(redirects).toEqual({
      "6160": "cargador-usb-c-rapido",
      "cargador-usb": "cargador-usb-c-rapido",
    });
  });

  it("el redirect viejo apunta a un producto ajeno: no se toca nada", async () => {
    const { db, escrituras } = makeDb(
      { "cargador-usb": null },
      { "6160": "cargador-usb" }
    );
    const r = await renombrarIds(db, [item("cargador-usb-c-rapido", "6160")], FUENTE);
    expect(r.renombrados).toBe(0);
    expect(escrituras).toHaveLength(0);
  });

  it("items sin prevId ni diferencias no tocan la base", async () => {
    const { db, lecturas, escrituras } = makeDb({});
    const r = await renombrarIds(db, [item("sin-legacy"), item("igual", "igual")], FUENTE);
    expect(r.renombrados).toBe(0);
    expect(lecturas).toHaveLength(0);
    expect(escrituras).toHaveLength(0);
  });

  it("lote grande: pocos statements y binds acotados (json_each, un bind por lote)", async () => {
    const filas: Record<string, string | null> = {};
    const items: Product[] = [];
    for (let i = 0; i < 900; i++) {
      filas[String(i)] = FUENTE;
      items.push(item(`producto-${i}`, String(i)));
    }
    const { db, escrituras } = makeDb(filas);
    const r = await renombrarIds(db, items, FUENTE);
    expect(r.renombrados).toBe(900);
    expect(filas["0"]).toBeUndefined();
    expect(filas["producto-899"]).toBe(FUENTE);
    // 900 pares / 400 por lote = 3 lotes × 3 statements (redirects, cadena, rename).
    expect(escrituras).toHaveLength(9);
    for (const e of escrituras) expect(e.binds.length).toBeLessThanOrEqual(2);
  });
});

describe("destinoDeRedirect", () => {
  it("devuelve el destino del redirect", async () => {
    const { db } = makeDb({}, { "6160": "cargador-usb-c" });
    expect(await destinoDeRedirect(db, "6160")).toBe("cargador-usb-c");
  });

  it("sin redirect devuelve null", async () => {
    const { db } = makeDb({ "nadie": FUENTE });
    expect(await destinoDeRedirect(db, "nadie")).toBeNull();
  });

  it("sigue cadenas de redirects (una base sin aplanar) sin loops infinitos", async () => {
    const { db } = makeDb({}, { "a": "b", "b": "c" });
    expect(await destinoDeRedirect(db, "a")).toBe("c");
    // Loop explícito: corta en MAX_HOPS sin colgarse.
    const loop = makeDb({}, { "x": "y", "y": "x" });
    const destino = await destinoDeRedirect(loop.db, "x");
    expect(["x", "y"]).toContain(destino);
  });
});
