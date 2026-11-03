// Tests de la sección DEVOLUCIONES del panel (ETAPA 3): listado con filtros,
// detalle con historial y cambio de estado/respuesta. Sigue el patrón de
// orders-patch.test.ts: D1 en memoria y sesión admin por login.
import { describe, expect, it } from "vitest";
import { adminApp } from "./admin";
import type { Dict, Env } from "./db";

type Row = Dict;

/** Aplica el filtro status + búsqueda que arma listReturnsPaged/countReturns. */
function matches(row: Row, status: string, like: string): boolean {
  if (status !== "" && row.status !== status) return false;
  if (like === "") return true;
  const needle = like.replace(/%/g, "").toLowerCase();
  return [row.name, row.code, row.contact, row.order_ref, row.product]
    .some((v) => String(v ?? "").toLowerCase().includes(needle));
}

function makeDb() {
  const requests = new Map<string, Row>();
  const events: Row[] = [];
  const db = {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        run: async () => {
          if (/UPDATE return_requests SET status/i.test(sql)) {
            const [id, status, response, ts] = args;
            const row = requests.get(String(id));
            if (row) {
              row.status = status;
              row.response = response;
              row.updated_at = ts;
            }
          } else if (/INSERT INTO return_events/i.test(sql)) {
            const [requestId, ts, status, note] = args;
            events.push({ request_id: requestId, ts, status, note });
          }
          return { success: true };
        },
        first: async () => {
          if (/COUNT\(\*\) AS total/i.test(sql)) {
            const [status, like] = args;
            return { total: [...requests.values()].filter((r) => matches(r, String(status), String(like))).length };
          }
          if (/FROM return_requests WHERE id/i.test(sql)) return requests.get(String(args[0])) ?? null;
          return null;
        },
        all: async () => {
          if (/GROUP BY status/i.test(sql)) {
            const by = new Map<string, number>();
            for (const r of requests.values()) by.set(String(r.status), (by.get(String(r.status)) ?? 0) + 1);
            return { results: [...by.entries()].map(([status, n]) => ({ status, n })) };
          }
          if (/FROM return_events WHERE request_id/i.test(sql)) {
            return { results: events.filter((e) => e.request_id === String(args[0])) };
          }
          const [status, like, limit, offset] = args;
          return {
            results: [...requests.values()]
              .filter((r) => matches(r, String(status), String(like)))
              .sort((a, b) => Number(b.created_at) - Number(a.created_at))
              .slice(Number(offset), Number(offset) + Number(limit)),
          };
        },
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, requests, events };
}

function seed(requests: Map<string, Row>, over: Partial<Row> & { id: string }): void {
  requests.set(over.id, {
    code: `ARR-${over.id.toUpperCase().slice(0, 6)}`,
    kind: "arrepentimiento",
    name: "Ana Gómez",
    contact: "3425819402",
    contact_kind: "wa",
    order_ref: null,
    product: null,
    detail: null,
    status: "recibida",
    response: null,
    ip_hash: null,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...over,
  });
}

function mockEnv(db: unknown): Env {
  return {
    DB: db,
    KV: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    ADMIN_PASSWORD: "pass-de-test",
  } as unknown as Env;
}

async function loginYCookie(env: Env): Promise<string> {
  const login = await adminApp.request(
    "/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
    env,
  );
  expect(login.status).toBe(200);
  return login.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

function get(path: string, cookie: string, env: Env) {
  return adminApp.request(path, { headers: { Cookie: cookie } }, env);
}

function patch(id: string, body: unknown, cookie: string, env: Env) {
  return adminApp.request(
    `/returns/${id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) },
    env,
  );
}

interface ListBody {
  returns: { id: string; name: string; contact: string }[];
  total: number;
  counts: Record<string, number>;
}

describe("GET /api/admin/returns", () => {
  it("exige sesión del panel", async () => {
    const { db } = makeDb();
    const res = await adminApp.request("/returns", {}, mockEnv(db));
    expect(res.status).toBe(401);
  });

  it("lista con datos de contacto y cuenta por estado", async () => {
    const { db, requests } = makeDb();
    seed(requests, { id: "r1", name: "Ana Gómez", created_at: 3 });
    seed(requests, { id: "r2", name: "Bruno Díaz", created_at: 2, status: "aprobada" });
    seed(requests, { id: "r3", name: "Carla Ruiz", created_at: 1, status: "cerrada" });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    const res = await get("/returns", cookie, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(body.total).toBe(3);
    expect(body.returns.map((r) => r.id)).toEqual(["r1", "r2", "r3"]); // más nueva primero
    // El panel sí ve el contacto: es con lo que se responde la solicitud.
    expect(body.returns[0]!.contact).toBe("3425819402");
    expect(body.counts).toEqual({ recibida: 1, aprobada: 1, cerrada: 1 });
  });

  it("filtra por estado y por texto en nombre o código", async () => {
    const { db, requests } = makeDb();
    seed(requests, { id: "r1", name: "Ana Gómez" });
    seed(requests, { id: "r2", name: "Bruno Díaz", status: "en_revision" });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    const porEstado = await get("/returns?status=en_revision", cookie, env);
    expect(((await porEstado.json()) as ListBody).returns.map((r) => r.id)).toEqual(["r2"]);

    const porTexto = await get("/returns?q=Ana", cookie, env);
    expect(((await porTexto.json()) as ListBody).returns.map((r) => r.id)).toEqual(["r1"]);

    const sinResultados = await get("/returns?q=zzz", cookie, env);
    const v = (await sinResultados.json()) as ListBody;
    expect(v.returns).toEqual([]);
    expect(v.total).toBe(0);
  });

  it("pagina de a 50 por defecto y respeta limit", async () => {
    const { db, requests } = makeDb();
    for (let i = 0; i < 3; i++) seed(requests, { id: `r${i}`, created_at: i });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    const res = await get("/returns?limit=2&page=2", cookie, env);
    const body = (await res.json()) as ListBody & { pages: number };
    expect(body.returns.length).toBe(1);
    expect(body.pages).toBe(2);
  });
});

describe("GET /api/admin/returns/:id", () => {
  it("devuelve el detalle con el historial fechado", async () => {
    const { db, requests, events } = makeDb();
    seed(requests, { id: "r1", detail: "Llegó con la pantalla rayada" });
    events.push(
      { request_id: "r1", ts: 10, status: "recibida", note: "Solicitud registrada" },
      { request_id: "r1", ts: 20, status: "en_revision", note: "Estado: En revisión" },
    );
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    const res = await get("/returns/r1", cookie, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request: { detail: string; history: { status: string; note: string }[] } };
    expect(body.request.detail).toBe("Llegó con la pantalla rayada");
    expect(body.request.history.map((h) => h.status)).toEqual(["recibida", "en_revision"]);
    expect(body.request.history[1]!.note).toBe("Estado: En revisión");
  });

  it("404 si la solicitud no existe", async () => {
    const { db } = makeDb();
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await get("/returns/no-existe", cookie, env);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/returns/:id", () => {
  it("cambia el estado y agrega un hito al historial", async () => {
    const { db, requests, events } = makeDb();
    seed(requests, { id: "r1" });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    const res = await patch("r1", { status: "aprobada" }, cookie, env);
    expect(res.status).toBe(200);
    expect(requests.get("r1")!.status).toBe("aprobada");
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("aprobada");
    const body = (await res.json()) as { request: { status: string; history: unknown[] } };
    expect(body.request.status).toBe("aprobada");
    expect(body.request.history).toHaveLength(1);
  });

  it("guarda la respuesta pública sin duplicar el hito de estado", async () => {
    const { db, requests, events } = makeDb();
    seed(requests, { id: "r1", status: "en_revision" });
    events.push({ request_id: "r1", ts: 10, status: "en_revision", note: null });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    const res = await patch("r1", { response: "  Pasá por el local con el código  " }, cookie, env);
    expect(res.status).toBe(200);
    expect(requests.get("r1")!.response).toBe("Pasá por el local con el código");
    expect(events).toHaveLength(1); // la respuesta no agrega un paso repetido
  });

  it("acepta cambiar estado y respuesta juntos, y borrar la respuesta", async () => {
    const { db, requests } = makeDb();
    seed(requests, { id: "r1" });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    await patch("r1", { status: "resuelta", response: "Cambio realizado" }, cookie, env);
    expect(requests.get("r1")!.status).toBe("resuelta");
    expect(requests.get("r1")!.response).toBe("Cambio realizado");

    await patch("r1", { response: "" }, cookie, env);
    expect(requests.get("r1")!.response).toBeNull();
  });

  it("rechaza estados inválidos y cuerpos vacíos", async () => {
    const { db, requests } = makeDb();
    seed(requests, { id: "r1" });
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);

    expect((await patch("r1", { status: "perdida" }, cookie, env)).status).toBe(400);
    expect((await patch("r1", {}, cookie, env)).status).toBe(400);
    expect((await patch("r1", { response: 42 }, cookie, env)).status).toBe(400);
    expect(requests.get("r1")!.status).toBe("recibida");
  });

  it("404 al actualizar una solicitud inexistente", async () => {
    const { db } = makeDb();
    const env = mockEnv(db);
    const cookie = await loginYCookie(env);
    const res = await patch("no-existe", { status: "cerrada" }, cookie, env);
    expect(res.status).toBe(404);
  });
});
