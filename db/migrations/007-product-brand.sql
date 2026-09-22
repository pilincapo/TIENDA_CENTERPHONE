-- Marca detectada al importar (o desde el campo brand/marca de la fuente).
-- NULL = sin marca conocida; el JSON-LD hace fallback detectando del título.
ALTER TABLE products ADD COLUMN brand TEXT;
