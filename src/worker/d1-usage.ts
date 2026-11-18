// Instrumentación de lecturas de D1.
//
// Envuelve el binding `DB` para sumar el `meta.rows_read` que D1 ya devuelve en
// cada sentencia y, al terminar el request, registrar ruta, estado y cantidad de
// consultas en Workers Analytics Engine (binding `D1_USAGE`).
//
// Por qué: el 18/11 hubo una hora con 63.195 filas leídas (30 % del día) y el
// dataset de analítica de D1 no dice qué ruta las generó. Esto cuesta 0 filas de
// D1 (solo lee un `meta` que ya viene en la respuesta) y a lo sumo 1 data point
// por request que toque la base: las rutas sin D1 no registran nada.
//
// Qué NO se mide: `raw()` devuelve las filas y `batch()` una lista de resultados,
// pero ninguno de los dos devuelve `meta` (y `batch()` hoy no se usa en
// producción, así que no vale la pena el envoltorio extra). `first()` sí entra:
// cuenta la consulta aunque no pueda ver sus filas; los conteos caros no lo usan
// (ver `filaUnica` en db.ts).

import type { Context } from "hono";
import type { Env } from "./db";

export interface UsoD1 {
  rowsRead: number;
  rowsWritten: number;
  queries: number;
}

/** Además del data point, un request que pase esto deja línea en Workers Logs. */
const UMBRAL_LOG = 500;

export function nuevoUso(): UsoD1 {
  return { rowsRead: 0, rowsWritten: 0, queries: 0 };
}

interface Meta {
  rows_read?: number;
  rows_written?: number;
}

function sumar(uso: UsoD1, meta: Meta | undefined | null): void {
  uso.queries += 1;
  uso.rowsRead += Number(meta?.rows_read ?? 0);
  uso.rowsWritten += Number(meta?.rows_written ?? 0);
}

/**
 * Envuelve una sentencia para acumular su costo. `bind()` devuelve otra sentencia,
 * así que también la envuelve: es el patrón de casi todas las consultas del worker.
 * `first()` pasa por acá igual que `all()` — su resultado es la fila, sin `meta`,
 * así que suma la consulta y cero filas.
 */
function envolverSentencia(stmt: D1PreparedStatement, uso: UsoD1): D1PreparedStatement {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === "bind") {
        return (...args: unknown[]) => envolverSentencia(target.bind(...(args as never[])), uso);
      }
      if (prop === "all" || prop === "run" || prop === "first") {
        const nombre = prop;
        return (...args: unknown[]) =>
          (target[nombre] as unknown as (...a: unknown[]) => Promise<{ meta?: Meta }>)
            .apply(target, args)
            .then((r) => {
              sumar(uso, r?.meta);
              return r;
            });
      }
      const valor = Reflect.get(target, prop, receiver);
      return typeof valor === "function" ? valor.bind(target) : valor;
    },
  });
}

/** Devuelve el mismo `D1Database` con la entrada interceptada para medir. */
export function instrumentarD1(db: D1Database, uso: UsoD1): D1Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => envolverSentencia(target.prepare(sql), uso);
      }
      const valor = Reflect.get(target, prop, receiver);
      return typeof valor === "function" ? valor.bind(target) : valor;
    },
  });
}

/**
 * Emite el consumo del request. Se llama después de que el handler respondió, así
 * el estado es el real (404 y 500 incluidos). Nunca debe romper el request.
 */
export function registrarUsoD1(c: Context<{ Bindings: Env }>, uso: UsoD1): void {
  if (uso.queries === 0) return;
  const path = new URL(c.req.url).pathname;
  const ruta = c.req.routePath || path;
  try {
    c.env.D1_USAGE?.writeDataPoint({
      indexes: [ruta],
      blobs: [String(c.res?.status ?? 0), path],
      // filas leídas, filas escritas, consultas
      doubles: [uso.rowsRead, uso.rowsWritten, uso.queries],
    });
  } catch {
    // La instrumentación es best-effort: si falla, el sitio sigue igual.
  }
  if (uso.rowsRead >= UMBRAL_LOG) {
    console.log(`d1_uso ruta=${ruta} filas=${uso.rowsRead} consultas=${uso.queries}`);
  }
}
