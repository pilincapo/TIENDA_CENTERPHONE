// Dedupe entre fuentes del MISMO proveedor.
//
// El catálogo de hacetupedido publica el mismo artículo en el listado "paraguas"
// (`productos/electronica`) y en el de su categoría específica
// (`productos/cables`). Cada listado es una auto-importación distinta, con su
// propio `source_url`, así que el producto entraba dos veces: una fila con el
// slug (la de la categoría) y otra con el id viejo — el renombre de ids no pisa
// un destino que considera "ajeno" (ver rename-ids.ts), así que la copia del
// paraguas se quedaba con el hash numérico para siempre.
//
// Este paso deja UNA sola fila visible por producto:
//  - elige la ganadora con un ranking ESTABLE (publicada > slug > con
//    subcategoría > más antigua > id), así el resultado no depende de qué fuente
//    corra primero ni de en qué orden;
//  - registra el 301 del id descartado al que queda (product_redirects), así las
//    URLs viejas ya indexadas no pasan a 404;
//  - saca el item del upsert y oculta la fila descartada si ya existía (sin
//    DELETE: reversible y sin perder la fila de la otra fuente).
//
// Nunca toca filas de otro proveedor ni altas manuales (source_url NULL), y solo
// considera duplicado al producto si el precio (y la imagen, cuando ambas
// existen) coinciden: dos artículos homónimos con precios distintos son dos
// productos de verdad.

import type { Product } from "../shared/types";

/** Pares (desde → hasta) por statement de redirect/ocultado. */
const CHUNK = 400;

export interface DedupeResult {
  /** Items que se sacaron de la importación (no se insertan ni actualizan). */
  descartados: number;
  /** Filas preexistentes que quedaron ocultas por ser duplicado de otra. */
  ocultados: number;
  /** Ids que sobreviven al dedupe (para armar los keepIds del ocultado automático). */
  items: Product[];
}

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

/** Clave de comparación del título: sin acentos, minúsculas y espacios colapsados. */
export function claveTitulo(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Host del proveedor sin `www.` (para que `hacetupedido.com` y
 *  `www.hacetupedido.com` cuenten como el mismo vendedor). */
export function hostDeFuente(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Puntaje del ranking: gana el que tiene más puntos. */
function puntaje(id: string, status: string, subcategoryId: string | null): number {
  const numerico = /^\d+$/.test(id) ? 0 : 2; // el slug es la "regla nueva"
  const publicado = status === "published" ? 4 : 0;
  const conSubcategoria = subcategoryId === null ? 0 : 1;
  return publicado + numerico + conSubcategoria;
}

/** ¿Son el mismo artículo? Precio exacto y, si ambos tienen imagen, la misma. */
function mismaFicha(a: { priceCents: number; imageUrl: string }, b: Fila): boolean {
  if (a.priceCents !== b.priceCents) return false;
  if (a.imageUrl !== "" && b.imageUrl !== "" && a.imageUrl !== b.imageUrl) return false;
  return true;
}

/** Todas las filas importadas de un host (en UNA lectura, se filtra en JS:
 *  el `lower()` de SQLite no baja las mayúsculas acentuadas). */
async function filasDelProveedor(db: D1Database, host: string): Promise<Fila[]> {
  const res = await db
    .prepare(
      `SELECT id, title, price_cents, image_url, source_url, status, subcategory_id, created_at
       FROM products
       WHERE source_url IS NOT NULL`
    )
    .all<{
      id: string;
      title: string;
      price_cents: number;
      image_url: string | null;
      source_url: string | null;
      status: string;
      subcategory_id: string | null;
      created_at: number;
    }>();
  const out: Fila[] = [];
  for (const r of res.results) {
    if (hostDeFuente(r.source_url ?? null) !== host) continue;
    out.push({
      id: String(r.id),
      title: String(r.title),
      priceCents: Number(r.price_cents),
      imageUrl: String(r.image_url ?? ""),
      sourceUrl: r.source_url == null ? null : String(r.source_url),
      status: String(r.status),
      subcategoryId: r.subcategory_id == null ? null : String(r.subcategory_id),
      createdAt: Number(r.created_at ?? 0),
    });
  }
  return out;
}

/** Oculta filas y deja el 301 hacia la que queda (aplanando cadenas). */
async function aplicarDescartes(db: D1Database, pares: { desde: string; hasta: string }[], now: number): Promise<number> {
  let ocultados = 0;
  for (let i = 0; i < pares.length; i += CHUNK) {
    const chunk = pares.slice(i, i + CHUNK);
    const json = JSON.stringify(Object.fromEntries(chunk.map((p) => [p.desde, p.hasta])));
    await db
      .prepare(
        `INSERT INTO product_redirects (from_id, to_id, created_at)
         SELECT j.key, j.value, ?2
         FROM json_each(?1) AS j WHERE true
         ON CONFLICT(from_id) DO UPDATE SET to_id = excluded.to_id`
      )
      .bind(json, now)
      .run();
    // Los redirects que apuntaban al id descartado pasan a apuntar al que queda.
    await db
      .prepare(
        `WITH m AS (SELECT key AS desde, value AS hasta FROM json_each(?1))
         UPDATE product_redirects SET to_id = (SELECT hasta FROM m WHERE m.desde = product_redirects.to_id)
         WHERE to_id IN (SELECT desde FROM m)`
      )
      .bind(json)
      .run();
    const r = await db
      .prepare(
        `UPDATE products SET status = 'hidden', updated_at = ?2
         WHERE status <> 'hidden' AND id IN (SELECT key FROM json_each(?1))`
      )
      .bind(json, now)
      .run();
    ocultados += r.meta.changes ?? 0;
  }
  return ocultados;
}

/**
 * Deja un solo producto visible por artículo repetido entre fuentes del mismo
 * proveedor. Corre después de `renombrarIds` (los ids ya están resueltos) y antes
 * del upsert. Devuelve la lista de items que siguen en la importación.
 */
export async function dedupeEntreFuentes(
  db: D1Database,
  items: Product[],
  sourceUrl: string | null,
  now: number
): Promise<DedupeResult> {
  const host = hostDeFuente(sourceUrl);
  if (host === null || items.length === 0) return { descartados: 0, ocultados: 0, items };

  const filas = await filasDelProveedor(db, host);
  const porClave = new Map<string, Fila[]>();
  for (const f of filas) {
    const k = claveTitulo(f.title);
    const lista = porClave.get(k);
    if (lista) lista.push(f);
    else porClave.set(k, [f]);
  }

  const descartes: { desde: string; hasta: string }[] = [];
  const sobreviven: Product[] = [];
  for (const item of items) {
    const otras = (porClave.get(claveTitulo(item.title)) ?? []).filter(
      (r) => r.sourceUrl !== sourceUrl && r.id !== item.id && mismaFicha(item, r)
    );
    if (otras.length === 0) {
      sobreviven.push(item);
      continue;
    }
    // Ranking estable entre el item y las filas de las otras fuentes.
    let ganador = { id: item.id, score: puntaje(item.id, item.status, item.subcategoryId), creado: Number.MAX_SAFE_INTEGER };
    for (const r of otras) {
      const score = puntaje(r.id, r.status, r.subcategoryId);
      if (score > ganador.score || (score === ganador.score && r.createdAt < ganador.creado)) {
        ganador = { id: r.id, score, creado: r.createdAt };
      }
    }
    if (ganador.id === item.id) {
      // El item gana: las copias de las otras fuentes quedan como 301 + ocultas.
      sobreviven.push(item);
      for (const r of otras) if (r.id !== item.id) descartes.push({ desde: r.id, hasta: item.id });
      continue;
    }
    // El item pierde: no se escribe y su id pasa a redirigir al que queda.
    descartes.push({ desde: item.id, hasta: ganador.id });
    for (const r of otras) if (r.id !== ganador.id) descartes.push({ desde: r.id, hasta: ganador.id });
  }

  if (descartes.length === 0) return { descartados: 0, ocultados: 0, items: sobreviven };
  const ocultados = await aplicarDescartes(db, descartes, now);
  const descartados = items.length - sobreviven.length;
  console.log(`import: ${descartados} duplicado(s) entre fuentes descartados, ${ocultados} fila(s) ocultas`);
  return { descartados, ocultados, items: sobreviven };
}
