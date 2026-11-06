// API pública del Club CenterPhone: alta gratuita, recuperación por WhatsApp y
// validación del código. El alta guarda datos personales, así que también se
// prueban honeypot, rate limit, mismo origen y que la respuesta no los exponga.
import { beforeEach, describe, expect, it } from "vitest";
import { loyaltyApp, resetLoyaltyRateLimit } from "./loyalty";
import type { Dict } from "./db";

type Row = Dict;

/** D1 en memoria con las consultas que usa el club (phone, code, INSERT). */
function makeDb() {
  const members = new Map<string, Row>(); // por código

  function insert(args: unknown[]): void {
    const cols = ["id", "code", "name", "phone", "email", "birthday", "active", "source", "created_at", "updated_at", "last_order_at", "discount_percent"];
    const row: Row = {};
    cols.forEach((c, i) => { row[c] = args[i]; });
    if (members.has(String(row.code))) throw new Error("UNIQUE constraint failed: members.code");
    if ([...members.values()].some((m) => m.phone === row.phone)) throw new Error("UNIQUE constraint failed: members.phone");
    members.set(String(row.code), row);
  }

  const db = {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        run: async () => {
          if (/INSERT INTO members/i.test(sql)) insert(args);
          return { success: true };
        },
        first: async () => {
          if (/FROM members WHERE phone/i.test(sql)) {
            return [...members.values()].find((m) => m.phone === args[0]) ?? null;
          }
          if (/FROM members WHERE code/i.test(sql)) return members.get(String(args[0])) ?? null;
          return null;
        },
        all: async () => ({ results: [] }),
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, members };
}

function mockEnv(db: unknown, settings: Record<string, unknown> = {}) {
  return {
    DB: db,
    KV: {
      get: async () => JSON.stringify({
        storeMode: "tienda",
        loyaltyEnabled: true,
        loyaltyDiscountPercent: 10,
        ...settings,
      }),
    },
  } as unknown as Parameters<typeof loyaltyApp.request>[2];
}

const BASE = {
  name: "Ana Gómez",
  phone: "342 581 9402",
  email: "ANA@Example.com",
  birthday: "1995-05-12",
};

function join(body: unknown, env: ReturnType<typeof mockEnv>, ip = "1.1.1.1") {
  return loyaltyApp.request(
    "/api/loyalty/join",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(body),
    },
    env,
  );
}

beforeEach(() => resetLoyaltyRateLimit());

describe("POST /api/loyalty/join", () => {
  it("da de alta gratis, normaliza los datos y devuelve un código SOC", async () => {
    const { db, members } = makeDb();
    const res = await join(BASE, mockEnv(db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; code: string; discountPercent: number };
    expect(body.ok).toBe(true);
    expect(body.code).toMatch(/^SOC-[2-9A-HJKMNP-Z]{6}$/);
    expect(body.discountPercent).toBe(10);

    expect(members.size).toBe(1);
    const row = [...members.values()][0]!;
    expect(row.phone).toBe("3425819402"); // sin 0/15/54/9
    expect(row.email).toBe("ana@example.com");
    expect(row.birthday).toBe("05-12"); // sin año
    expect(row.active).toBe(1);
  });

  it("guarda el nivel base como nivel del socio nuevo", async () => {
    const { db, members } = makeDb();
    const res = await join(BASE, mockEnv(db, { loyaltyDiscountPercent: 15 }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { discountPercent: number };
    expect(body.discountPercent).toBe(15);
    expect([...members.values()][0]!.discount_percent).toBe(15);
  });

  it("la recuperación devuelve el nivel del socio, no el base actual", async () => {
    const { db, members } = makeDb();
    const first = await join(BASE, mockEnv(db, { loyaltyDiscountPercent: 5 }));
    const { code } = (await first.json()) as { code: string };
    members.get(code)!.discount_percent = 15; // el dueño lo subió desde el panel

    const again = await join(BASE, mockEnv(db, { loyaltyDiscountPercent: 5 }));
    const body = (await again.json()) as { recovered: boolean; discountPercent: number };
    expect(body.recovered).toBe(true);
    expect(body.discountPercent).toBe(15);
  });

  it("recupera el mismo código con el mismo WhatsApp en otro formato", async () => {
    const { db, members } = makeDb();
    const env = mockEnv(db);
    const first = await join(BASE, env);
    const { code } = (await first.json()) as { code: string };

    const again = await join({ ...BASE, name: "Ana", phone: "+54 9 342 581 9402" }, env);
    expect(again.status).toBe(200);
    const body = (await again.json()) as { code: string; recovered: boolean };
    expect(body.recovered).toBe(true);
    expect(body.code).toBe(code);
    expect(members.size).toBe(1);
  });

  it("no expone email, cumpleaños ni el nombre completo en la respuesta", async () => {
    const { db } = makeDb();
    const res = await join(BASE, mockEnv(db));
    const raw = await res.text();
    expect(raw).not.toContain("ana@example.com");
    expect(raw).not.toContain("05-12");
    expect(raw).not.toContain("Gómez");
  });

  it("rechaza datos inválidos sin crear el socio", async () => {
    const { db, members } = makeDb();
    const env = mockEnv(db);
    expect((await join({ ...BASE, name: "A" }, env)).status).toBe(400);
    expect((await join({ ...BASE, phone: "123" }, env)).status).toBe(400);
    expect((await join({ ...BASE, email: "no-es-email" }, env)).status).toBe(400);
    expect((await join({ ...BASE, birthday: "2026-02-30" }, env)).status).toBe(400);
    expect(members.size).toBe(0);
  });

  it("el honeypot responde 200 sin crear nada", async () => {
    const { db, members } = makeDb();
    const res = await join({ ...BASE, website: "http://spam" }, mockEnv(db));
    expect(res.status).toBe(200);
    expect(members.size).toBe(0);
  });

  it("con el club apagado no acepta altas", async () => {
    const { db } = makeDb();
    const res = await join(BASE, mockEnv(db, { loyaltyEnabled: false }));
    expect(res.status).toBe(503);
  });

  it("limita los altas por IP", async () => {
    const { db } = makeDb();
    const env = mockEnv(db);
    for (let i = 0; i < 5; i++) {
      const res = await join({ ...BASE, phone: `34258194${String(i).padStart(2, "0")}` }, env);
      expect(res.status).toBe(201);
    }
    const blocked = await join({ ...BASE, phone: "3425819499" }, env);
    expect(blocked.status).toBe(429);
  });

  it("exige mismo origen cuando viene el header Origin", async () => {
    const { db } = makeDb();
    const res = await loyaltyApp.request(
      "/api/loyalty/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example", Host: "centerphone.com.ar" },
        body: JSON.stringify(BASE),
      },
      mockEnv(db),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/loyalty/validate", () => {
  it("valida un código activo y devuelve solo el primer nombre", async () => {
    const { db } = makeDb();
    const env = mockEnv(db);
    const created = await join(BASE, env);
    const { code } = (await created.json()) as { code: string };

    const res = await loyaltyApp.request(`/api/loyalty/validate?code=${code.toLowerCase()}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; discountPercent: number; name: string };
    expect(body).toMatchObject({ valid: true, discountPercent: 10, name: "Ana" });
  });

  it("devuelve el nivel del socio aunque el base sea otro", async () => {
    const { db, members } = makeDb();
    const env = mockEnv(db, { loyaltyDiscountPercent: 5 });
    const created = await join(BASE, env);
    const { code } = (await created.json()) as { code: string };
    members.get(code)!.discount_percent = 15;

    const res = await loyaltyApp.request(`/api/loyalty/validate?code=${code}`, {}, env);
    expect(((await res.json()) as { discountPercent: number }).discountPercent).toBe(15);
  });

  it("con el WhatsApp de la compra, el código solo vale para el número del socio", async () => {
    const { db } = makeDb();
    const env = mockEnv(db);
    const created = await join(BASE, env);
    const { code } = (await created.json()) as { code: string };

    const ok = await loyaltyApp.request(
      `/api/loyalty/validate?code=${code}&phone=${encodeURIComponent("+54 9 342 581 9402")}`,
      {},
      env,
    );
    expect(((await ok.json()) as { valid: boolean }).valid).toBe(true);

    const bad = await loyaltyApp.request(`/api/loyalty/validate?code=${code}&phone=3425550000`, {}, env);
    expect(await bad.json()).toMatchObject({ valid: false, reason: "phone_mismatch" });
  });

  it("no valida códigos inactivos, inexistentes ni mal formados", async () => {
    const { db, members } = makeDb();
    const env = mockEnv(db);
    const created = await join(BASE, env);
    const { code } = (await created.json()) as { code: string };
    members.get(code)!.active = 0;

    const inactive = await loyaltyApp.request(`/api/loyalty/validate?code=${code}`, {}, env);
    expect(((await inactive.json()) as { valid: boolean }).valid).toBe(false);

    for (const bad of ["SOC-ZZZZZZ", "cualquiera", ""]) {
      const res = await loyaltyApp.request(`/api/loyalty/validate?code=${bad}`, {}, env);
      expect(((await res.json()) as { valid: boolean }).valid).toBe(false);
    }
  });
});
