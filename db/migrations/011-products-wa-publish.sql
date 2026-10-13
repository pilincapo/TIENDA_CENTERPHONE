-- Marca de "publicar en el catálogo de WhatsApp": solo los productos marcados
-- entran al feed CSV que Meta descarga (Commerce Manager → Fuentes de datos →
-- Feed programado). 0 = no publicado.
--
-- Vive aparte de `status` a propósito: `status` dice si el producto está en el
-- catálogo del SITIO y esta marca si además se publica en WhatsApp. Los syncs de
-- las fuentes no la tocan (los upserts listan columnas explícitas), así que un
-- producto ya marcado sigue marcado después de cada importación.
ALTER TABLE products ADD COLUMN wa_publish INTEGER NOT NULL DEFAULT 0;
