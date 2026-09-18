-- Auto-importaciones programadas: links importados manualmente que el cron
-- vuelve a traer en los horarios configurados.
CREATE TABLE IF NOT EXISTS auto_imports (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  price_rule_id TEXT,
  times       TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  last_status TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
