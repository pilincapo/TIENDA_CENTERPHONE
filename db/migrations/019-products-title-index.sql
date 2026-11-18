-- Índice para que el dedupe entre fuentes no lea el catálogo entero.
--
-- Medido en la D1 de producción (2026-11-18, 2.090 productos importados de 22
-- fuentes): `filasDelProveedor` hacía `SELECT ... FROM products WHERE source_url
-- IS NOT NULL` y filtraba por host en JS — 2.090 filas por corrida, en las ~23
-- importaciones diarias (22 auto-importaciones + la manual), o sea ~48.000
-- filas por día solo para decidir si un artículo venía repetido.
--
-- El dedupe compara únicamente por título, así que el candidato de cada item son
-- las filas con ESE título. Con este índice esas filas salen por búsqueda directa
-- (`title IN (SELECT value FROM json_each(?))`) y una importación sin novedades
-- lee una fila por item en vez de todo el catálogo del proveedor.
CREATE INDEX IF NOT EXISTS idx_products_title
  ON products(title);
