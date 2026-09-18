import { describe, expect, it } from "vitest";
import { applyPriceRules, applyRuleGroup, applyRuleSet, findOverlaps, groupNames, ruleMatches, type PriceRule } from "./pricing";

const r0a10k: PriceRule = {
  id: "baratos", name: "Recarga baratos", groupName: null, minCents: 0, maxCents: 1000000,
  percent: 40, active: true, priority: 0,
};
const r10kMas: PriceRule = {
  id: "caros", name: "Recarga caros", groupName: null, minCents: 1000000, maxCents: null,
  percent: 25, active: true, priority: 0,
};
const inactiva: PriceRule = {
  id: "off", name: "Inactiva", groupName: null, minCents: 0, maxCents: null,
  percent: 100, active: false, priority: 10,
};
const prioritaria: PriceRule = {
  id: "vip", name: "VIP", groupName: null, minCents: 0, maxCents: 1000000,
  percent: 10, active: true, priority: 5,
};

describe("ruleMatches", () => {
  it("matchea dentro del rango inclusive", () => {
    expect(ruleMatches(r0a10k, 0)).toBe(true);
    expect(ruleMatches(r0a10k, 1000000)).toBe(true);
    expect(ruleMatches(r0a10k, 1000001)).toBe(false);
  });

  it("maxCents null = sin techo", () => {
    expect(ruleMatches(r10kMas, 99999999)).toBe(true);
    expect(ruleMatches(r10kMas, 999999)).toBe(false);
  });

  it("regla inactiva nunca matchea", () => {
    expect(ruleMatches(inactiva, 500)).toBe(false);
  });
});

describe("applyPriceRules", () => {
  it("aplica 40% sobre precio base", () => {
    const app = applyPriceRules(100000, [r0a10k]);
    expect(app.finalCents).toBe(140000);
    expect(app.ruleId).toBe("baratos");
  });

  it("sin regla matcheante deja el precio igual", () => {
    const app = applyPriceRules(2000000, [r0a10k]);
    expect(app.finalCents).toBe(2000000);
    expect(app.ruleId).toBeNull();
  });

  it("gana la regla de mayor prioridad", () => {
    const app = applyPriceRules(500000, [r0a10k, prioritaria]);
    expect(app.ruleId).toBe("vip");
    expect(app.finalCents).toBe(550000);
  });

  it("elige el rango según el precio", () => {
    expect(applyPriceRules(50000, [r0a10k, r10kMas]).ruleId).toBe("baratos");
    expect(applyPriceRules(50000000, [r0a10k, r10kMas]).ruleId).toBe("caros");
  });

  it("ignora reglas inactivas aunque tengan prioridad", () => {
    const app = applyPriceRules(500000, [r0a10k, inactiva]);
    expect(app.ruleId).toBe("baratos");
  });

  it("recargo negativo rebaja", () => {
    const rebaja: PriceRule = { ...r0a10k, percent: -10 };
    expect(applyPriceRules(100000, [rebaja]).finalCents).toBe(90000);
  });
});

describe("applyRuleSet", () => {
  it("fuerza la regla indicada aunque otra tenga prioridad", () => {
    const app = applyRuleSet(500000, [r0a10k, prioritaria], "baratos");
    expect(app.ruleId).toBe("baratos");
    expect(app.finalCents).toBe(700000);
  });

  it("fuerza una regla aunque no matchee el rango", () => {
    const app = applyRuleSet(50000000, [r0a10k], "baratos");
    expect(app.ruleId).toBe("baratos");
    expect(app.finalCents).toBe(70000000);
  });

  it("ruleId inexistente = sin cambios", () => {
    const app = applyRuleSet(100000, [r0a10k], "no-existe");
    expect(app.finalCents).toBe(100000);
    expect(app.ruleId).toBeNull();
  });
});

describe("grupos de reglas", () => {
  const escala: PriceRule[] = [
    { id: "g1", name: "Tramo 1", groupName: "Escala 2026", minCents: 0, maxCents: 1000000, percent: 40, active: true, priority: 0 },
    { id: "g2", name: "Tramo 2", groupName: "Escala 2026", minCents: 1000001, maxCents: 2000000, percent: 30, active: true, priority: 0 },
    { id: "g3", name: "Tramo 3", groupName: "Escala 2026", minCents: 2000001, maxCents: null, percent: 20, active: true, priority: 0 },
    { id: "g4", name: "Otra escala", groupName: "Otra", minCents: 0, maxCents: null, percent: 50, active: true, priority: 0 },
  ];

  it("groupNames lista los grupos sin duplicados", () => {
    expect(groupNames(escala)).toEqual(["Escala 2026", "Otra"]);
  });

  it("aplica el tramo del grupo según el precio", () => {
    expect(applyRuleSet(50000, escala, "group:Escala 2026").finalCents).toBe(70000);
    expect(applyRuleSet(1500000, escala, "group:Escala 2026").finalCents).toBe(1950000);
    expect(applyRuleSet(50000000, escala, "group:Escala 2026").finalCents).toBe(60000000);
  });

  it("el grupo no aplica reglas de otros grupos", () => {
    const app = applyRuleSet(50000, escala, "group:Otra");
    expect(app.finalCents).toBe(75000);
  });

  it("límite exacto entre tramos contiguos cae en el tramo siguiente", () => {
    const app = applyRuleSet(1000001, escala, "group:Escala 2026");
    expect(app.ruleId).toBe("g2");
    expect(app.finalCents).toBe(1300000); // +30% redondeado a peso entero
  });

  it("precio en hueco entre tramos queda sin recargo", () => {
    const conHueco: PriceRule[] = [
      { id: "h1", name: "Hasta 10k", groupName: "G", minCents: 0, maxCents: 1000000, percent: 40, active: true, priority: 0 },
      { id: "h2", name: "Desde 20k", groupName: "G", minCents: 2000001, maxCents: null, percent: 20, active: true, priority: 0 },
    ];
    const app = applyRuleSet(1500000, conHueco, "group:G");
    expect(app.finalCents).toBe(1500000);
    expect(app.ruleId).toBeNull();
  });

  it("applyRuleGroup directo funciona igual", () => {
    expect(applyRuleGroup(30000, "escala 2026", escala).finalCents).toBe(42000);
  });
});

describe("findOverlaps", () => {
  it("detecta superposición total entre dos reglas activas", () => {
    const x: PriceRule = { id: "x", name: "X", groupName: null, minCents: 0, maxCents: 1000000, percent: 40, active: true, priority: 0 };
    const y: PriceRule = { id: "y", name: "Y", groupName: null, minCents: 0, maxCents: 1000000, percent: 25, active: true, priority: 0 };
    const o = findOverlaps([x, y]);
    expect(o).toHaveLength(1);
    expect(o[0]!.fromCents).toBe(0);
    expect(o[0]!.toCents).toBe(1000000);
  });

  it("rangos contiguos (0-10.000 y 10.001-∞) NO son superposición", () => {
    const o = findOverlaps([r0a10k, { ...r10kMas, minCents: 1000001 }]);
    expect(o).toHaveLength(0);
  });

  it("límite compartido en un solo precio ($10.000 exacto) SÍ advierte", () => {
    // Ambas reglas incluyen $10.000 (límites inclusivos): zona de conflicto de 1 valor.
    const o = findOverlaps([r0a10k, r10kMas]);
    expect(o).toHaveLength(1);
    expect(o[0]!.fromCents).toBe(1000000);
    expect(o[0]!.toCents).toBe(1000000);
  });

  it("detecta el solape parcial y la zona exacta", () => {
    const a: PriceRule = { id: "a", name: "A", groupName: null, minCents: 0, maxCents: 1000000, percent: 40, active: true, priority: 0 };
    const b: PriceRule = { id: "b", name: "B", groupName: null, minCents: 500000, maxCents: 2000000, percent: 30, active: true, priority: 0 };
    const o = findOverlaps([a, b]);
    expect(o).toHaveLength(1);
    expect(o[0]!.fromCents).toBe(500000);
    expect(o[0]!.toCents).toBe(1000000);
  });

  it("indica cuál gana según prioridad", () => {
    const o = findOverlaps([r0a10k, prioritaria]); // misma zona, vip tiene prioridad 5
    expect(o).toHaveLength(1);
    expect(o[0]!.winner.id).toBe("vip");
  });

  it("ignora reglas inactivas", () => {
    const o = findOverlaps([r0a10k, inactiva]); // misma zona pero inactiva
    expect(o).toHaveLength(0);
  });

  it("detecta superposición con reglas de grupos distintos", () => {
    const g1: PriceRule = { id: "g1", name: "G1", groupName: "Escala A", minCents: 0, maxCents: 1000000, percent: 40, active: true, priority: 0 };
    const g2: PriceRule = { id: "g2", name: "G2", groupName: "Escala B", minCents: 500000, maxCents: null, percent: 20, active: true, priority: 0 };
    const o = findOverlaps([g1, g2]);
    expect(o).toHaveLength(1);
    expect(o[0]!.fromCents).toBe(500000);
    expect(o[0]!.toCents).toBe(1000000);
  });
});
