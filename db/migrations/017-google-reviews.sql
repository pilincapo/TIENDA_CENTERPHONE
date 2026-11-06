-- Reseñas de Google que el local muestra en el sitio.
--
-- Se cargan a mano desde el panel: la API de Google devuelve como máximo 5
-- reseñas por consulta y sus políticas no permiten guardarlas, así que la
-- alternativa compatible con el plan gratuito es curar las mejores. El autor y
-- la fecha se copian tal cual aparecen en Maps para no inventar testimonios.
--
-- `reviewed_at` es la fecha de la reseña (ms) y puede ser NULL: la tarjeta se
-- muestra sin fecha. `local_reply` es la respuesta pública del local, opcional.
CREATE TABLE IF NOT EXISTS google_reviews (
  id          TEXT PRIMARY KEY,
  author      TEXT NOT NULL,
  author_meta TEXT,                        -- "Local Guide · 24 reseñas"
  rating      INTEGER NOT NULL,            -- 1..5 (sin decimales, como Google)
  body        TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER,
  local_reply TEXT,
  featured    INTEGER NOT NULL DEFAULT 0,  -- 1 = arriba de la lista
  active      INTEGER NOT NULL DEFAULT 1,  -- 0 = oculta en el sitio
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_reviews_active ON google_reviews(active, featured, sort_order);
