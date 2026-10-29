// Dedupe entre fuentes del mismo proveedor: el mismo artículo que llega por el
// listado paraguas (`productos/electronica`) y por el de su categoría
// (`productos/cables`). Cada uno es una auto-importación distinta, y el catálogo
// terminaba con dos fichas: una con el slug y otra con el id viejo.
// Acá se prueban las decisiones del helper:
//  - gana la fila PUBLICADA, con slug y con subcategoría, sin importar el orden
//    en que corran las fuentes (ranking estable);
//  - el id descartado queda con 301 al que sobrevive;
//  - la fila descartada se oculta, nunca se borra;
//  - dos homónimos con precio (o imagen) distinto son dos productos: no se tocan;
//  - otro proveedor y las altas manuales quedan afuera.

import { describe, expect, it } from "vitest";
import type { Product } from "../shared/types";
import { claveTitulo, dedupeEntreFuentes, hostDeFuente } from "./dedupe-sources";

const CABLES = "https://www.hacetupedido.com/productos/cables?page=all";
const ELECTRONICA = "https://www.hacetupedido.com/productos/electronica?page=all";
const SLUG = "cable-para-impresora-1-5-mts-2-0-tipo-c-en-bolsa-3079c";
const TITULO = "Cable para IMPRESORA 1,5 mts 2.0 TIPO C en bolsa (3079C)";

interface Fila {
  id: string;
  title: string;
  priceCents: number;
  imageUrl: string;
  sourceUrl: string | null;
  status: string;
  subcategoryId: string | null;
  createdAt: number;
}

interface FakeD1 {
  db: D1Database;
  lecturas: { sql: string; binds: unknown[] }[];
  escrituras: { sql: string; binds: unknown[] }[];
  /** from_id → to_id de product_redirects. */
  redirects: Record<string, string>;
  /** ids que quedaron con status hidden. */
  ocultos: Set<string>;
}

function fila(over: Partial<Fila> & { id: string }): Fila {
  return {
    title: TITULO,
    priceCents: 882000,
    imageUrl: "https://cdn.example/img.png",
    sourceUrl: CABLES,
    status: "published",
    subcategoryId: "cables",
    createdAt: 1000,
    ...over,
  };
}

function item(over: Partial<Product> & { id: string }): Product {
  return {
    title: TITULO,
    description: "",
    priceCents: 882000,
    categoryId: "electronica",
    subcategoryId: null,
    tags: [],
    imageUrl: "https://cdn.example/img.png",
    status: "published",
    availability: "in_stock",
    sortOrder: 0,
    createdAt: 2000,
    sourceUrl: ELECTRONICA,
    ...over,
  };
}

/** D1 de mentira que entiende los tres statements de dedupe-sources. */
function makeDb(filas: Fila[], redirects: Record<string, string> = {}): FakeD1 {
  const lecturas: { sql: string; binds: unknown[] }[] = [];
  const escrituras: { sql: string; binds: unknown[] }[] = [];
  const ocultos = new Set<string>();

  const ejecutar = async (sql: string, binds: unknown[]) => {
    escrituras.push({ sql, binds });
    if (sql.includes("INSERT INTO product_redirects")) {
      const mapa = JSON.parse(String(binds[0])) as Record<string, string>;
      for (const [desde, hasta] of Object.entries(mapa)) redirects[desde] = hasta;
      return { meta: { changes: 0 } };
    }
    if (sql.includes("UPDATE product_redirects")) {
      const mapa = JSON.parse(String(binds[0])) as Record<string, string>;
      for (const [desde, to] of Object.entries(redirects)) if (mapa[to] !== undefined) redirects[desde] = mapa[to];
      return { meta: { changes: 0 } };
    }
    if (sql.includes("UPDATE products SET status = 'hidden'")) {
      const ids = Object.keys(JSON.parse(String(binds[0])) as Record<string, string>);
      let cambios = 0;
      for (const id of ids) {
        if (filas.some((f) => f.id === id) && !ocultos.has(id)) {
          ocultos.add(id);
          cambios++;
        }
      }
      return { meta: { changes: cambios } };
    }
    throw new Error(`statement inesperado: ${sql}`);
  };

  const db = {
    prepare(sql: string) {
      const conBinds = (binds: unknown[]) => ({
        all: async () => {
          lecturas.push({ sql, binds });
          // El SELECT real filtra source_url IS NOT NULL: las altas manuales no entran.
          return {
            results: filas
              .filter((f) => f.sourceUrl !== null)
              .map((f) => ({
                id: f.id,
                title: f.title,
                price_cents: f.priceCents,
                image_url: f.imageUrl,
                source_url: f.sourceUrl,
                status: f.status,
                subcategory_id: f.subcategoryId,
                created_at: f.createdAt,
              })),
          };
        },
        run: () => ejecutar(sql, binds),
        first: async () => null,
      });
      return { ...conBinds([]), bind: (...binds: unknown[]) => conBinds(binds) };
    },
  };
  return { db: db as unknown as D1Database, lecturas, escrituras, redirects, ocultos };
}

describe("claveTitulo / hostDeFuente", () => {
  it("normaliza acentos, mayúsculas y espacios", () => {
    expect(claveTitulo("  Trípode   para CELULAR ")).toBe("tripode para celular");
  });
  it("trata www y sin www como el mismo proveedor", () => {
    expect(hostDeFuente("https://hacetupedido.com/productos/rodadosyaccesorios")).toBe("hacetupedido.com");
    expect(hostDeFuente("https://www.hacetupedido.com/productos/cables")).toBe("hacetupedido.com");
    expect(hostDeFuente(null)).toBeNull();
  });
});

describe("dedupeEntreFuentes", () => {
  it("descarta la copia del listado paraguas y deja 301 al slug", async () => {
    // En la base están las dos filas: la del slug (cables) y la numérica (electronica).
    const f = makeDb([fila({ id: SLUG }), fila({ id: "4693", sourceUrl: ELECTRONICA, subcategoryId: null })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: "4693" })], ELECTRONICA, 5000);

    expect(r.descartados).toBe(1);
    expect(r.items).toHaveLength(0); // no entra al upsert
    expect(f.redirects).toEqual({ "4693": SLUG }); // la URL vieja indexada sigue viva
    expect([...f.ocultos]).toEqual(["4693"]);
  });

  it("desde la fuente de la categoría, gana el item (slug) y oculta el numérico", async () => {
    const f = makeDb([fila({ id: "4693", sourceUrl: ELECTRONICA, subcategoryId: null })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: SLUG, sourceUrl: CABLES, subcategoryId: "cables" })], CABLES, 5000);

    expect(r.descartados).toBe(0);
    expect(r.items.map((p) => p.id)).toEqual([SLUG]);
    expect(r.ocultados).toBe(1);
    expect(f.redirects).toEqual({ "4693": SLUG });
  });

  it("el ganador no depende del orden en que corran las fuentes", async () => {
    // Misma situación mirada desde las dos fuentes: en ambos casos sobrevive el slug.
    const desdeElectronica = makeDb([fila({ id: SLUG })]);
    const a = await dedupeEntreFuentes(desdeElectronica.db, [item({ id: "4693" })], ELECTRONICA, 1);

    const desdeCables = makeDb([fila({ id: "4693", sourceUrl: ELECTRONICA, subcategoryId: null })]);
    const b = await dedupeEntreFuentes(desdeCables.db, [item({ id: SLUG, sourceUrl: CABLES, subcategoryId: "cables" })], CABLES, 1);

    expect(a.items).toHaveLength(0);
    expect(b.items.map((p) => p.id)).toEqual([SLUG]);
    expect(desdeElectronica.redirects).toEqual({ "4693": SLUG });
    expect(desdeCables.redirects).toEqual({ "4693": SLUG });
  });

  it("dos homónimos con precios distintos son dos productos: no se tocan", async () => {
    const f = makeDb([fila({ id: "4693", sourceUrl: ELECTRONICA, subcategoryId: null, priceCents: 700000 })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: SLUG, sourceUrl: CABLES })], CABLES, 5000);

    expect(r.descartados).toBe(0);
    expect(r.items).toHaveLength(1);
    expect(f.escrituras).toHaveLength(0);
  });

  it("dos homónimos con imágenes distintas son dos productos: no se tocan", async () => {
    const f = makeDb([fila({ id: "4693", sourceUrl: ELECTRONICA, imageUrl: "https://cdn.example/otra.png" })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: SLUG, sourceUrl: CABLES })], CABLES, 5000);

    expect(r.descartados).toBe(0);
    expect(f.escrituras).toHaveLength(0);
  });

  it("no dedupea entre proveedores distintos", async () => {
    const f = makeDb([fila({ id: SLUG, sourceUrl: "https://tecnova.com.ar/" })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: "4693" })], ELECTRONICA, 5000);

    expect(r.items).toHaveLength(1);
    expect(f.escrituras).toHaveLength(0);
  });

  it("nunca toca altas manuales (source_url NULL)", async () => {
    const f = makeDb([fila({ id: SLUG, sourceUrl: null })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: "4693" })], ELECTRONICA, 5000);

    expect(r.items).toHaveLength(1);
    expect(f.escrituras).toHaveLength(0);
  });

  it("no toca un producto consigo mismo (misma fuente, mismo id)", async () => {
    const f = makeDb([fila({ id: SLUG })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: SLUG, sourceUrl: CABLES, subcategoryId: "cables" })], CABLES, 5000);

    expect(r.items).toHaveLength(1);
    expect(f.escrituras).toHaveLength(0);
  });

  it("sin sourceUrl no hace nada", async () => {
    const f = makeDb([fila({ id: SLUG })]);
    const r = await dedupeEntreFuentes(f.db, [item({ id: "4693" })], null, 5000);
    expect(r.items).toHaveLength(1);
    expect(f.escrituras).toHaveLength(0);
  });
});
