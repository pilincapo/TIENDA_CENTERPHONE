// Renombra filas de `products` del id viejo (hash numérico del proveedor, p. ej.
// "6160" de hacetupedido) al nombre de página del título ("cargador-usb-c"), y
// registra el 301 en product_redirects para que las URLs viejas que ya están
// indexadas en Google no pierdan el posicionamiento.
//
// Es el mismo algoritmo que probó el renombre de Tecnova, generalizado a
// cualquier importación por URL y optimizado para lotes grandes: los ids viajan
// dentro de UN bind (JSON) y se expanden con json_each, así el límite de 100
// parámetros por sentencia de D1 no acota el tamaño del lote (927 renombres de
// hacetupedido salen en 3 statements, no en 19).

import type { Product } from "../shared/types";

/** Ids por query de lookup: viajan en un solo bind JSON. */
const LOOKUP_CHUNK = 1000;
/** Pares (desde → hasta) por statement de rename/redirect. */
const RENAME_CHUNK = 400;
/** Saltos máximos al resolver una cadena de redirects en lectura. */
const MAX_HOPS = 5;

export interface RenameResult {
  /** Filas que realmente cambiaron de id. */
  renombrados: number;
  /** id nuevo → id conservado, para los items a los que no se pudo renombrar
   *  (destino ocupado por un producto ajeno). El caller debe tenerlo en cuenta
   *  armando la lista de ids que sobreviven al ocultado automático. */
  fallbacks: Map<string, string>;
}

/** `id → source_url` (null = alta manual / otra fuente) de un lote de ids,
 *  en queries de a LOOKUP_CHUNK con un solo bind. */
async function lookupOwners(db: D1Database, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += LOOKUP_CHUNK) {
    const chunk = unicos.slice(i, i + LOOKUP_CHUNK);
    const res = await db
      .prepare(`SELECT id, source_url FROM products WHERE id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(chunk))
      .all<{ id: string; source_url: string | null }>();
    for (const r of res.results) out.set(r.id, r.source_url ?? null);
  }
  return out;
}

/** `from_id → to_id` de los redirects de un lote de ids viejos. Solo hace falta
 *  cuando el id viejo ya no existe como fila (el proveedor cambió el título). */
async function lookupRedirects(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += LOOKUP_CHUNK) {
    const chunk = unicos.slice(i, i + LOOKUP_CHUNK);
    const res = await db
      .prepare(`SELECT from_id, to_id FROM product_redirects WHERE from_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(chunk))
      .all<{ from_id: string; to_id: string }>();
    for (const r of res.results) out.set(r.from_id, r.to_id);
  }
  return out;
}

/**
 * Renombra las filas que todavía tienen el id viejo (`prevId`) al nombre de
 * página (`id`). Corre ANTES del upsert, sobre el lote que se va a importar, y
 * es idempotente: cuando ya no queda ningún id viejo (estado estable desde la
 * segunda corrida) hace dos lecturas y no escribe nada.
 *
 * Reglas por item:
 *  - Destino ocupado por un producto AJENO (source_url distinto): el item se
 *    queda con su id viejo — nunca se pisa otro producto. El fallback se
 *    devuelve en `fallbacks` para que el ocultado automático no lo oculte.
 *  - Destino ocupado por una fila de la propia fuente: ya es el producto
 *    renombrado en una corrida anterior; no hay nada que hacer.
 *  - Fila vieja existente (misma fuente): renombra y registra el 301.
 *  - Id viejo ya renombrado con otro título en una corrida anterior (existe el
 *    redirect pero no la fila): renombra la fila que apunta el redirect — así
 *    un cambio de título en el proveedor mueve la fila y aplana la cadena.
 *  - Sin fila vieja: es un producto nuevo, se da de alta con el id nuevo.
 *
 * Puede mutar `item.id` (fallback), por eso se llama antes de armar keepIds y
 * el upsert. Nunca corta la importación: los errores los catchea el caller.
 */
export async function renombrarIds(db: D1Database, items: Product[], sourceUrl: string): Promise<RenameResult> {
  const fallbacks = new Map<string, string>();
  const cand = items.filter(
    (p): p is Product & { prevId: string } =>
      typeof p.prevId === "string" && p.prevId !== "" && p.prevId !== p.id
  );
  if (cand.length === 0) return { renombrados: 0, fallbacks };

  const destinos = await lookupOwners(db, cand.map((c) => c.id));
  const origenes = await lookupOwners(db, cand.map((c) => c.prevId));

  const pares: { desde: string; hasta: string }[] = [];
  const sinOrigen: (Product & { prevId: string })[] = [];
  for (const c of cand) {
    const duenoDestino = destinos.get(c.id);
    if (duenoDestino !== undefined && duenoDestino !== sourceUrl) {
      // El destino lo tiene un producto ajeno: conserva el id viejo.
      fallbacks.set(c.id, c.prevId);
      c.id = c.prevId;
      continue;
    }
    if (duenoDestino !== undefined) continue; // ya renombrado en una corrida anterior
    if (origenes.get(c.prevId) === sourceUrl) {
      pares.push({ desde: c.prevId, hasta: c.id });
      continue;
    }
    sinOrigen.push(c); // el id viejo no existe como fila: ver redirects abajo
  }

  // El proveedor cambió el título desde la última corrida: el id viejo ya se
  // renombró antes (queda el redirect) y hay que mover la fila que ese
  // redirect apunta. Solo si esa fila es de esta misma fuente.
  if (sinOrigen.length > 0) {
    const redirects = await lookupRedirects(db, sinOrigen.map((c) => c.prevId));
    const destinosVia: string[] = [];
    for (const c of sinOrigen) {
      const via = redirects.get(c.prevId);
      if (via !== undefined && via !== c.id) destinosVia.push(via);
    }
    if (destinosVia.length > 0) {
      const owners = await lookupOwners(db, destinosVia);
      for (const c of sinOrigen) {
        const via = redirects.get(c.prevId);
        if (via === undefined) continue;
        if (owners.get(via) !== sourceUrl) continue; // el redirect apunta a un ajeno
        if (destinos.get(c.id) !== undefined) continue; // destino tomado: resuelto arriba
        pares.push({ desde: via, hasta: c.id });
      }
    }
  }

  if (pares.length === 0) return { renombrados: 0, fallbacks };

  const now = Date.now();
  let renombrados = 0;
  for (let i = 0; i < pares.length; i += RENAME_CHUNK) {
    const chunk = pares.slice(i, i + RENAME_CHUNK);
    const json = JSON.stringify(Object.fromEntries(chunk.map((p) => [p.desde, p.hasta])));
    // 1) Redirects ANTES del rename: la fila origen todavía tiene el id viejo.
    //    El JSON es un mapa {desde: hasta}, así que desde/to_id salen de
    //    j.key/j.value (NO de `->>` sobre j.value: eso parsea el string como
    //    JSON y tira "malformed JSON"). ON CONFLICT pisa el to_id si el
    //    redirect ya existía (apuntaba al título anterior de una corrida previa).
    await db
      .prepare(
        `INSERT INTO product_redirects (from_id, to_id, created_at)
         SELECT j.key, j.value, ?2
         FROM json_each(?1) AS j WHERE true
         ON CONFLICT(from_id) DO UPDATE SET to_id = excluded.to_id`
      )
      .bind(json, now)
      .run();
    // 2) Aplanado de cadenas: los redirects que apuntaban al id viejo pasan al
    //    nuevo, así /producto/{hash} sale en un solo salto al título actual.
    await db
      .prepare(
        `WITH m AS (SELECT key AS desde, value AS hasta FROM json_each(?1))
         UPDATE product_redirects SET to_id = (SELECT hasta FROM m WHERE m.desde = product_redirects.to_id)
         WHERE to_id IN (SELECT desde FROM m)`
      )
      .bind(json)
      .run();
    // 3) El rename de filas (OR IGNORE: si un destino quedó tomado entre la
    //    lectura y la escritura, se saltea ese par en vez de reventar el lote).
    const r = await db
      .prepare(
        `WITH m AS (SELECT key AS desde, value AS hasta FROM json_each(?1))
         UPDATE OR IGNORE products
         SET id = (SELECT hasta FROM m WHERE m.desde = products.id), updated_at = ?2
         WHERE products.id IN (SELECT desde FROM m)`
      )
      .bind(json, now)
      .run();
    renombrados += r.meta.changes ?? 0;
  }
  return { renombrados, fallbacks };
}

/**
 * Sigue los redirects desde un id viejo hasta el id actual (máx. MAX_HOPS
 * saltos; el write-time aplana las cadenas, pero una base migrada a medias
 * podría tener alguna). Devuelve null si no hay redirect: la URL vieja no
 * conoció nunca a este producto.
 */
export async function destinoDeRedirect(db: D1Database, id: string): Promise<string | null> {
  let actual = id;
  for (let salto = 0; salto < MAX_HOPS; salto++) {
    const row = await db
      .prepare(`SELECT to_id FROM product_redirects WHERE from_id = ?1`)
      .bind(actual)
      .first<{ to_id: string }>();
    const next = row?.to_id ? String(row.to_id) : "";
    if (next === "" || next === actual) break;
    actual = next;
  }
  return actual === id ? null : actual;
}
