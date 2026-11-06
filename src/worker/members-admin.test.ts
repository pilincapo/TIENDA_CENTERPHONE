// Sección CLUB del panel: hereda el login de adminApp y muestra datos
// personales (email, cumpleaños, WhatsApp). Los tests cubren que sin sesión no
// se filtre nada y que el listado, el alta manual y la baja funcionen.
import { describe, expect, it } from "vitest";
import { adminApp } from "./admin";
import { currentMonthArgentina } from "./members-admin";
import { KV_SETTINGS_KEY } from "../shared/types";
import type { Dict, Env } from "./db";

function makeDb() {
  const members: Dict[] = [];
  const orders: Dict[] = [];

  function filtered(status: string, like: string): Dict[] {
    const needle = like.replace(/%/g, "").replace(/\\(.)/g, "$1").toLowerCase();
    return members
      .filter((m) => (status === "" ? true : status === "active" ? m.active === 1 : m.active === 0))
      .filter((m) => needle === "" || [m.name, m.code, m.phone, m.email]
        .some((v) => String(v ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.created_at) - Number(a.created_at));
  }

  const db = {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        all: async () => {
          // Compras pagadas por socio (una sola consulta por página).
          if (/FROM orders WHERE status = 'paid'/i.test(sql)) {
            const codes = args.map(String);
            const grouped = new Map<string, { n: number; spent: number }>();
            for (const o of orders) {
              if (o.status !== "paid" || !codes.includes(String(o.member_code))) continue;
              const key = String(o.member_code);
              const g = grouped.get(key) ?? { n: 0, spent: 0 };
              g.n += 1;
              g.spent += Number(o.total_cents ?? 0);
              grouped.set(key, g);
            }
            return { results: [...grouped.entries()].map(([member_code, g]) => ({ member_code, n: g.n, spent: g.spent })) };
          }
          if (/GROUP BY active/i.test(sql)) {
            const counts = new Map<number, number>();
            for (const m of members) counts.set(Number(m.active), (counts.get(Number(m.active)) ?? 0) + 1);
            return { results: [...counts.entries()].map(([active, n]) => ({ active, n })) };
          }
          if (/ORDER BY created_at/i.test(sql)) {
            const [status, like, limit, offset] = args;
            const rows = filtered(String(status), String(like));
            return { results: rows.slice(Number(offset ?? 0), Number(offset ?? 0) + Number(limit ?? 50)) };
          }
          return { results: [] };
        },
        first: async () => {
          if (/substr\(birthday/i.test(sql)) {
            return { n: members.filter((m) => m.active === 1 && String(m.birthday ?? "").startsWith(String(args[0]))).length };
          }
          if (/COUNT\(\*\) AS n FROM members WHERE/i.test(sql)) {
            return { n: filtered(String(args[0]), String(args[1])).length };
          }
          if (/FROM members WHERE id/i.test(sql)) return members.find((m) => m.id === args[0]) ?? null;
          if (/FROM members WHERE phone/i.test(sql)) return members.find((m) => m.phone === args[0]) ?? null;
          return null;
        },
        run: async () => {
          if (/INSERT INTO members/i.test(sql)) {
            const cols = ["id", "code", "name", "phone", "email", "birthday", "active", "source", "created_at", "updated_at", "last_order_at", "discount_percent"];
            const row: Dict = {};
            cols.forEach((c, i) => { row[c] = args[i]; });
            if (members.some((m) => m.phone === row.phone)) throw new Error("UNIQUE constraint failed: members.phone");
            members.push(row);
          } else if (/UPDATE members SET active/i.test(sql)) {
            const row = members.find((m) => m.id === args[0]);
            if (row) row.active = args[1];
          } else if (/UPDATE members SET discount_percent/i.test(sql)) {
            const row = members.find((m) => m.id === args[0]);
            if (row) row.discount_percent = args[1];
          }
          return { success: true };
        },
      });
      return { ...exec([]), bind: (...args: unknown[]) => exec(args) };
    },
  };
  return { db, members, orders };
}

function makeKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function mockEnv(db: unknown, kv = makeKv()): Env {
  return {
    DB: db,
    KV: kv,
    ADMIN_PASSWORD: "pass-de-test",
  } as unknown as Env;
}

async function login(env: Env): Promise<string> {
  const res = await adminApp.request(
    "/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pass-de-test" }) },
    env,
  );
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

function seed(members: Dict[], over: Partial<Dict> = {}): Dict {
  const row: Dict = {
    id: "m1", code: "SOC-ABC234", name: "Ana Gómez", phone: "3425819402", email: "ana@example.com",
    birthday: `${currentMonthArgentina()}-15`, active: 1, source: "web",
    created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, last_order_at: null, ...over,
  };
  members.push(row);
  return row;
}

interface ListBody {
  members: { id: string; code: string; email: string; birthday: string; ordersCount: number; spentCents: number }[];
  total: number;
  counts: { all: number; active: number; inactive: number };
  birthdaysThisMonth: number;
}

describe("GET /api/admin/members", () => {
  it("exige sesión del panel", async () => {
    const { db } = makeDb();
    const res = await adminApp.request("/members", {}, mockEnv(db));
    expect(res.status).toBe(401);
  });

  it("lista socios con sus datos y contadores", async () => {
    const { db, members } = makeDb();
    seed(members);
    seed(members, { id: "m2", code: "SOC-DEF567", name: "Bruno Díaz", email: null, active: 0, created_at: 1 });
    const env = mockEnv(db);
    const cookie = await login(env);

    const res = await adminApp.request("/members", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(body.total).toBe(2);
    expect(body.counts).toEqual({ all: 2, active: 1, inactive: 1 });
    expect(body.birthdaysThisMonth).toBe(1);
    expect(body.members[0]!.email).toBe("ana@example.com");
  });

  it("suma solo las compras pagadas de cada socio, no los pedidos pendientes", async () => {
    const { db, members, orders } = makeDb();
    seed(members);
    orders.push(
      { status: "paid", member_code: "SOC-ABC234", total_cents: 1_000_000 },
      { status: "paid", member_code: "SOC-ABC234", total_cents: 2_500_000 },
      { status: "pending", member_code: "SOC-ABC234", total_cents: 9_000_000 },
      { status: "paid", member_code: "SOC-OTRO99", total_cents: 7_000_000 },
    );
    const env = mockEnv(db);
    const cookie = await login(env);

    const res = await adminApp.request("/members", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as ListBody;
    expect(body.members[0]).toMatchObject({ code: "SOC-ABC234", ordersCount: 2, spentCents: 3_500_000 });
  });
});

describe("POST /api/admin/members", () => {
  it("da de alta y rechaza un WhatsApp repetido", async () => {
    const { db, members } = makeDb();
    seed(members);
    const env = mockEnv(db);
    const cookie = await login(env);
    const post = (body: unknown) =>
      adminApp.request(
        "/members",
        { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) },
        env,
      );

    expect((await post({ name: "Ana", phone: "342 581 9402" })).status).toBe(409);
    expect((await post({ name: "Carla", phone: "123" })).status).toBe(400);

    const ok = await post({ name: "Carla Ruiz", phone: "+54 9 342 555 0000", birthday: "1988-12-01" });
    expect(ok.status).toBe(201);
    const created = members.find((m) => m.phone === "3425550000")!;
    expect(created.birthday).toBe("12-01");
    expect(created.source).toBe("panel");
  });
});

describe("PATCH /api/admin/club", () => {
  it("exige sesión del panel", async () => {
    const { db } = makeDb();
    const res = await adminApp.request(
      "/club",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) },
      mockEnv(db),
    );
    expect(res.status).toBe(401);
  });

  it("prende y apaga el club sin pisar el resto de la configuración", async () => {
    const { db } = makeDb();
    const store = new Map<string, string>([
      [KV_SETTINGS_KEY, JSON.stringify({ storeName: "Mi Tienda", loyaltyEnabled: true, loyaltyDiscountPercent: 15 })],
    ]);
    const env = mockEnv(db, makeKv(store));
    const cookie = await login(env);
    const patch = (enabled: unknown) =>
      adminApp.request(
        "/club",
        { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ enabled }) },
        env,
      );

    const off = await patch(false);
    expect(off.status).toBe(200);
    expect(((await off.json()) as { loyaltyEnabled: boolean }).loyaltyEnabled).toBe(false);
    let saved = JSON.parse(store.get(KV_SETTINGS_KEY) ?? "{}") as Dict;
    expect(saved.loyaltyEnabled).toBe(false);
    // El toggle no puede borrar el nombre ni el % ya configurados.
    expect(saved.storeName).toBe("Mi Tienda");
    expect(saved.loyaltyDiscountPercent).toBe(15);

    expect((await patch("sí")).status).toBe(400);
    const on = await patch(true);
    expect(on.status).toBe(200);
    saved = JSON.parse(store.get(KV_SETTINGS_KEY) ?? "{}") as Dict;
    expect(saved.loyaltyEnabled).toBe(true);
  });
});

describe("PATCH /api/admin/members/:id", () => {
  it("desactiva el socio sin borrarlo", async () => {
    const { db, members } = makeDb();
    seed(members);
    const env = mockEnv(db);
    const cookie = await login(env);

    const res = await adminApp.request(
      "/members/m1",
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ active: false }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(members[0]!.active).toBe(0);
    expect(members[0]!.code).toBe("SOC-ABC234");
  });

  it("cambia el nivel de descuento y rechaza un valor que no es nivel", async () => {
    const { db, members } = makeDb();
    seed(members);
    const env = mockEnv(db);
    const cookie = await login(env);
    const patch = (discountPercent: unknown) =>
      adminApp.request(
        "/members/m1",
        { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ discountPercent }) },
        env,
      );

    const ok = await patch(15);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { member: { discountPercent: number } }).member.discountPercent).toBe(15);
    expect(members[0]!.discount_percent).toBe(15);

    expect((await patch(7)).status).toBe(400);
    expect(members[0]!.discount_percent).toBe(15); // no se pisó
  });

  it("sin nivel vuelve al descuento base", async () => {
    const { db, members } = makeDb();
    seed(members, { discount_percent: 10 });
    const env = mockEnv(db);
    const cookie = await login(env);

    const res = await adminApp.request(
      "/members/m1",
      { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ discountPercent: null }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(members[0]!.discount_percent).toBeNull();
    expect(((await res.json()) as { member: { discountPercent: null } }).member.discountPercent).toBeNull();
  });

  it("el alta manual acepta el nivel elegido", async () => {
    const { db, members } = makeDb();
    const env = mockEnv(db);
    const cookie = await login(env);

    const res = await adminApp.request(
      "/members",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ name: "Carla Ruiz", phone: "3425550000", discountPercent: 15 }),
      },
      env,
    );
    expect(res.status).toBe(201);
    expect(members.find((m) => m.phone === "3425550000")!.discount_percent).toBe(15);
  });
});
