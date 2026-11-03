// Tests de las solicitudes de cambio/devolución/arrepentimiento (ETAPA 2).
// Lo que se cuida acá es el cumplimiento: que se pueda pedir sin registrarse ni
// justificar, que se devuelva un código en el acto y que el seguimiento público
// NO exponga datos personales.
import { beforeEach, describe, expect, it } from "vitest";
import type { Dict } from "./db";
import { returnsApp, validateReturnInput, newCode, isValidToken, resetReturnRateLimit } from "./returns";
import { returnsPageApp } from "./returns-page";

type Row = Dict;

function makeDb() {
  const requests = new Map<string, Row>();
  const events: Row[] = [];
  const db = {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        run: async () => {
          if (/INSERT INTO return_requests/i.test(sql)) {
            const [id, code, kind, name, contact, contactKind, orderRef, product, detail, ipHash, ts] = args;
            requests.set(String(id), {
              id, code, kind, name, contact, contact_kind: contactKind, order_ref: orderRef,
              product, detail, status: "recibida", response: null, ip_hash: ipHash,
              created_at: ts, updated_at: ts,
            });
          } else if (/INSERT INTO return_events/i.test(sql)) {
            const [requestId, ts, note] = args;
            events.push({ request_id: requestId, ts, status: "recibida", note });
          }
          return { success: true };
        },
        first: async () => (/FROM return_requests WHERE id/i.test(sql) ? requests.get(String(args[0])) ?? null : null),
        all: async () => ({ results: events.filter((e) => e.request_id === String(args[0])) }),
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, requests, events };
}

function makeKv() {
  return { get: async () => null };
}

type ReqArgs = Parameters<typeof returnsApp.request>;
function env(db: unknown): ReqArgs[2] {
  return {
    DB: db,
    KV: makeKv(),
    ASSETS: {} as Fetcher,
    ADMIN_PASSWORD: "pass-de-test",
    ADMIN_SESSION_SECRET: "secret-de-test",
  } as ReqArgs[2];
}

function post(body: Record<string, unknown>, db: unknown, headers: Record<string, string> = {}) {
  return returnsApp.request(
    "/api/returns",
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } },
    env(db),
  );
}

const VALIDO = { kind: "arrepentimiento", name: "Ana Gómez", contact: "3425819402" };

beforeEach(() => {
  resetReturnRateLimit();
});

describe("validación de la solicitud", () => {
  it("acepta el mínimo: nombre y WhatsApp, sin motivo", () => {
    const r = validateReturnInput({ name: "Ana", contact: "3425819402" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("arrepentimiento");
    expect(r.value.contactKind).toBe("wa");
    expect(r.value.detail).toBeNull();
  });

  it("no exige justificar el motivo", () => {
    const r = validateReturnInput({ name: "Ana", contact: "ana@correo.com", kind: "arrepentimiento" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.detail).toBeNull();
    expect(r.value.contactKind).toBe("email");
  });

  it("rechaza sin nombre o sin contacto", () => {
    expect(validateReturnInput({ contact: "3425819402" }).ok).toBe(false);
    expect(validateReturnInput({ name: "Ana" }).ok).toBe(false);
  });

  it("valida el email y normaliza el WhatsApp a dígitos", () => {
    expect(validateReturnInput({ name: "Ana", contact: "ana@@correo" }).ok).toBe(false);
    const r = validateReturnInput({ name: "Ana", contact: "+54 9 342 581-9402" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.contact).toBe("5493425819402");
  });

  it("cae en 'arrepentimiento' si el tipo es desconocido y recorta el detalle", () => {
    const r = validateReturnInput({ name: "Ana", contact: "3425819402", kind: "otro", detail: "x".repeat(2000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("arrepentimiento");
    expect((r.value.detail ?? "").length).toBe(1000);
  });
});

describe("código de seguimiento", () => {
  it("es legible y usa el prefijo del tipo", () => {
    expect(newCode("arrepentimiento")).toMatch(/^ARR-[2-9A-HJ-NP-Z]{6}$/);
    expect(newCode("garantia")).toMatch(/^GAR-[2-9A-HJ-NP-Z]{6}$/);
  });

  it("el token público es de 32 hex", () => {
    expect(isValidToken("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidToken("../../etc")).toBe(false);
    expect(isValidToken("ABC")).toBe(false);
  });
});

describe("POST /api/returns", () => {
  it("crea la solicitud, registra el evento y devuelve código + token", async () => {
    const { db, requests, events } = makeDb();
    const res = await post(VALIDO, db);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Dict;
    expect(body.ok).toBe(true);
    expect(String(body.code)).toMatch(/^ARR-[2-9A-HJ-NP-Z]{6}$/);
    expect(isValidToken(String(body.token))).toBe(true);
    expect(body.url).toBe(`/devoluciones/seguimiento/${body.token}`);
    expect(requests.size).toBe(1);
    const row = requests.get(String(body.token))!;
    expect(row.kind).toBe("arrepentimiento");
    expect(row.status).toBe("recibida");
    expect(events.length).toBe(1);
    // La IP se guarda hasheada, nunca en claro.
    expect(row.ip_hash).not.toBe("127.0.0.1");
  });

  it("el honeypot corta el envío sin crear filas", async () => {
    const { db, requests } = makeDb();
    const res = await post({ ...VALIDO, website: "http://spam.test" }, db);
    expect(res.status).toBe(200);
    expect(requests.size).toBe(0);
  });

  it("responde 400 con el motivo cuando falta el contacto", async () => {
    const { db } = makeDb();
    const res = await post({ kind: "cambio", name: "Ana" }, db);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Dict;
    expect(String(body.error)).toContain("WhatsApp o un email");
  });

  it("rechaza cuerpos gigantes (413)", async () => {
    const { db } = makeDb();
    const res = await returnsApp.request(
      "/api/returns",
      {
        method: "POST",
        body: JSON.stringify({ ...VALIDO, detail: "x".repeat(9000) }),
        headers: { "Content-Type": "application/json" },
      },
      env(db),
    );
    expect(res.status).toBe(413);
  });

  it("rechaza JSON inválido", async () => {
    const { db } = makeDb();
    const res = await returnsApp.request(
      "/api/returns",
      { method: "POST", body: "{no es json", headers: { "Content-Type": "application/json" } },
      env(db),
    );
    expect(res.status).toBe(400);
  });

  it("limita los envíos por IP (429)", async () => {
    const { db } = makeDb();
    const headers = { "CF-Connecting-IP": "203.0.113.7" };
    for (let i = 0; i < 5; i++) {
      expect((await post(VALIDO, db, headers)).status).toBe(201);
    }
    expect((await post(VALIDO, db, headers)).status).toBe(429);
  });
});

describe("GET /api/returns/:token", () => {
  it("devuelve el estado sin datos personales", async () => {
    const { db, requests } = makeDb();
    const creada = (await (await post(VALIDO, db)).json()) as Dict;
    const token = String(creada.token);
    requests.get(token)!.product = "iPhone 13";

    const res = await returnsApp.request(`/api/returns/${token}`, { method: "GET" }, env(db));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const raw = await res.text();
    const body = JSON.parse(raw) as { request: Dict };
    expect(body.request.code).toBe(creada.code);
    expect(body.request.kindLabel).toContain("Arrepentimiento");
    expect(body.request.product).toBe("iPhone 13");
    // Nunca el nombre, el contacto ni el comentario.
    expect(raw).not.toContain("Ana Gómez");
    expect(raw).not.toContain("3425819402");
    expect(body.request.name).toBeUndefined();
    expect(body.request.contact).toBeUndefined();
    expect(body.request.detail).toBeUndefined();
  });

  it("404 con token desconocido o con formato inválido", async () => {
    const { db } = makeDb();
    expect((await returnsApp.request(`/api/returns/${"a".repeat(32)}`, { method: "GET" }, env(db))).status).toBe(404);
    expect((await returnsApp.request("/api/returns/../secreto", { method: "GET" }, env(db))).status).toBe(404);
  });
});

describe("página /devoluciones/seguimiento/:token", () => {
  it("muestra el código y el estado, sin datos personales", async () => {
    const { db } = makeDb();
    const creada = (await (await post(VALIDO, db)).json()) as Dict;
    const res = await returnsPageApp.request(`/devoluciones/seguimiento/${creada.token}`, { method: "GET" }, env(db));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(String(creada.code));
    expect(html).toContain("Solicitud recibida");
    expect(html).toContain('content="noindex"');
    expect(html).not.toContain("Ana Gómez");
    expect(html).not.toContain("3425819402");
  });

  it("404 cuando el token no existe", async () => {
    const { db } = makeDb();
    const res = await returnsPageApp.request(`/devoluciones/seguimiento/${"b".repeat(32)}`, { method: "GET" }, env(db));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Solicitud no encontrada");
  });
});
