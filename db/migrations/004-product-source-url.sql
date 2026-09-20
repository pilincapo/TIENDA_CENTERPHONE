-- Asocia cada producto con la URL de la que fue importado (migración para bases existentes).
-- NULL = creado manualmente desde el panel (nunca se desactiva automáticamente).
ALTER TABLE products ADD COLUMN source_url TEXT;
