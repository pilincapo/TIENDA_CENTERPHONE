-- Estadísticas de visitas: eventos de tracking (ficha de producto, búsquedas, home).
-- Una fila por evento; las agregaciones se hacen con GROUP BY en el endpoint de admin.
CREATE TABLE IF NOT EXISTS stats_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,             -- epoch ms del evento
  type       TEXT NOT NULL,                -- 'product_view' | 'search' | 'home_view' | 'wa_click'
  product_id TEXT,                         -- para product_view / wa_click
  query      TEXT,                         -- para search (normalizada: minúsculas, trimmed)
  country    TEXT,                         -- request.cf.country (código ISO)
  city       TEXT,                         -- request.cf.city
  region     TEXT,                         -- request.cf.region
  referrer   TEXT                          -- dominio de origen (host only)
);
CREATE INDEX IF NOT EXISTS idx_stats_ts ON stats_events(ts);
CREATE INDEX IF NOT EXISTS idx_stats_type_ts ON stats_events(type, ts);
CREATE INDEX IF NOT EXISTS idx_stats_product ON stats_events(product_id, ts);
