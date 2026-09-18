// Motor de reglas de precio: recargo porcentual por rango de precio.
// Se aplica durante la importación/sincronización sobre el precio base.

export interface PriceRule {
  id: string;
  name: string;
  groupName: string | null; // varias reglas con mismo grupo = escala
  minCents: number;
  maxCents: number | null; // null = sin límite superior
  percent: number; // ej: 40 = +40%
  active: boolean;
  priority: number; // mayor prioridad gana si varias reglas matchean
}

export interface PriceApplication {
  baseCents: number;
  finalCents: number;
  ruleId: string | null;
  ruleName: string | null;
  percent: number;
}

/** ¿El precio (en centavos) cae dentro del rango de la regla? */
export function ruleMatches(rule: PriceRule, cents: number): boolean {
  if (!rule.active) return false;
  if (cents < rule.minCents) return false;
  if (rule.maxCents !== null && cents > rule.maxCents) return false;
  return true;
}

/**
 * Modo AUTOMÁTICO: aplica todas las reglas activas (sueltas y agrupadas).
 * Si varias matchean, gana la de mayor prioridad (a igual prioridad, el rango
 * más angosto = más específico). El preview del importador muestra qué regla
 * ganó para cada producto, para que nunca haya recargos inesperados.
 */
export function applyPriceRules(baseCents: number, rules: PriceRule[]): PriceApplication {
  const candidates = rules
    .filter((r) => ruleMatches(r, baseCents))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const wa = (a.maxCents ?? Infinity) - a.minCents;
      const wb = (b.maxCents ?? Infinity) - b.minCents;
      return wa - wb;
    });
  const rule = candidates[0];
  if (!rule) {
    return { baseCents, finalCents: baseCents, ruleId: null, ruleName: null, percent: 0 };
  }
  const finalCents = roundToPeso(baseCents * (1 + rule.percent / 100));
  return {
    baseCents,
    finalCents,
    ruleId: rule.id,
    ruleName: rule.groupName ?? rule.name,
    percent: rule.percent,
  };
}

/**
 * Aplica un GRUPO de reglas (una escala) al precio base: la primera regla del
 * grupo cuyo rango contenga el precio. Si ninguna matchea, sin cambios.
 * (No usa applyPriceRules porque ese filtra las reglas agrupadas.)
 */
export function applyRuleGroup(
  baseCents: number,
  groupName: string,
  rules: PriceRule[]
): PriceApplication {
  const target = groupName.toLowerCase();
  const group = rules.filter(
    (r) => r.active && (r.groupName ?? "").toLowerCase() === target && ruleMatches(r, baseCents)
  );
  const rule = group[0];
  if (!rule) {
    return { baseCents, finalCents: baseCents, ruleId: null, ruleName: null, percent: 0 };
  }
  const finalCents = roundToPeso(baseCents * (1 + rule.percent / 100));
  return {
    baseCents,
    finalCents,
    ruleId: rule.id,
    ruleName: rule.groupName ?? rule.name,
    percent: rule.percent,
  };
}

/** Nombres de grupos presentes en las reglas (sin duplicados, orden alfabético). */
export function groupNames(rules: PriceRule[]): string[] {
  const set = new Set<string>();
  for (const r of rules) {
    const g = (r.groupName ?? "").trim();
    if (g !== "") set.add(g);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Aplica reglas automáticas por rango, o la regla forzada si se indica.
 * Forzar una regla la aplica SIEMPRE (aunque el precio esté fuera de su rango):
 * es una elección explícita del usuario en el importador.
 */
export function applyRuleSet(
  baseCents: number,
  rules: PriceRule[],
  forcedRuleId?: string | null
): PriceApplication {
  if (forcedRuleId) {
    // Puede ser el id de una regla individual o "group:<nombre>" para una escala.
    if (forcedRuleId.startsWith("group:")) {
      return applyRuleGroup(baseCents, forcedRuleId.slice(6), rules);
    }
    const forced = rules.find((r) => r.id === forcedRuleId);
    if (forced && forced.active) return applyForcedRule(baseCents, forced);
    return { baseCents, finalCents: baseCents, ruleId: null, ruleName: null, percent: 0 };
  }
  return applyPriceRules(baseCents, rules);
}

/** Versión de applyPriceRules que ignora el rango (para reglas forzadas). */
export function applyForcedRule(baseCents: number, rule: PriceRule): PriceApplication {
  const finalCents = roundToPeso(baseCents * (1 + rule.percent / 100));
  return { baseCents, finalCents, ruleId: rule.id, ruleName: rule.name, percent: rule.percent };
}

/** Redondea a peso entero: los precios de la tienda nunca tienen decimales. */
export function roundToPeso(cents: number): number {
  return Math.round(cents / 100) * 100;
}

// ---- Detección de superposiciones entre reglas ----

export interface RuleOverlap {
  a: PriceRule;
  b: PriceRule;
  /** Inicio de la zona en conflicto (centavos). */
  fromCents: number;
  /** Fin de la zona en conflicto; null = hasta ∞. */
  toCents: number | null;
  /** Regla que gana en la zona (misma lógica que el modo automático). */
  winner: PriceRule;
}

/**
 * Detecta pares de reglas ACTIVAS cuyos rangos se superponen. Rangos que solo
 * se tocan en el límite ($0–$10.000 y $10.001–…) NO cuentan como superposición.
 */
export function findOverlaps(rules: PriceRule[]): RuleOverlap[] {
  const actives = rules.filter((r) => r.active);
  const out: RuleOverlap[] = [];
  for (let i = 0; i < actives.length; i++) {
    for (let j = i + 1; j < actives.length; j++) {
      const a = actives[i]!;
      const b = actives[j]!;
      const from = Math.max(a.minCents, b.minCents);
      const toNum = Math.min(a.maxCents ?? Infinity, b.maxCents ?? Infinity);
      if (from > toNum) continue; // no se superponen
      const winner = overlapWinner(a, b, from);
      out.push({ a, b, fromCents: from, toCents: toNum === Infinity ? null : toNum, winner });
    }
  }
  return out;
}

/** Qué regla gana en la zona de conflicto (igual criterio que applyPriceRules). */
function overlapWinner(a: PriceRule, b: PriceRule, atCents: number): PriceRule {
  const candidates = [a, b]
    .filter((r) => ruleMatches(r, atCents))
    .sort((x, y) => {
      if (y.priority !== x.priority) return y.priority - x.priority;
      const wx = (x.maxCents ?? Infinity) - x.minCents;
      const wy = (y.maxCents ?? Infinity) - y.minCents;
      return wx - wy;
    });
  return candidates[0] ?? (a.priority >= b.priority ? a : b);
}
