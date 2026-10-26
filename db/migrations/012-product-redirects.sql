-- Redirects de productos: id viejo (hash del proveedor, p. ej. "6160") → id
-- actual (nombre de página). Cuando el importador renombra una fila, la URL
-- vieja ya indexada en Google responde 301 en vez de 404 (SEO).
CREATE TABLE IF NOT EXISTS product_redirects (
  from_id    TEXT PRIMARY KEY,
  to_id      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redirects_to ON product_redirects(to_id);
