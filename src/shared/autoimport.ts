// Auto-importación programada: un link importado manualmente que el cron
// vuelve a traer en los horarios configurados (hora Argentina).

export interface AutoImport {
  id: string;
  url: string;
  label: string;
  /** Regla individual o "group:<nombre>"; null = automático (reglas activas). */
  priceRuleId: string | null;
  /** Horarios "HH:MM" en hora Argentina. */
  times: string[];
  active: boolean;
  lastRunAt: number | null;
  lastStatus: string | null;
}
