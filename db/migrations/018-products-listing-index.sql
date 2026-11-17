-- Índices para que las rutas por request NO lean el catálogo entero.
--
-- Medido en la D1 de producción (2026-11-17, 2.090 productos / 1.372
-- publicados): `SELECT * FROM products WHERE status='published' ORDER BY
-- sort_order, created_at` costaba 2.744 filas leídas por llamada — el índice de
-- status más el `USE TEMP B-TREE FOR ORDER BY` del plan. Con ~1.700 de esas
-- lecturas por día, el pico llegaba a 4,6 M de filas (92 % del límite diario
-- del free tier).
--
-- idx_products_listing: mantenimiento del catálogo (listProducts,
-- listProductsForSitemap, regenerateSnapshot). El ORDER BY sale del índice, sin
-- el B-TREE temporal.
CREATE INDEX IF NOT EXISTS idx_products_listing
  ON products(status, sort_order, created_at);

-- idx_products_related: relacionadas de la ficha (/api/products/:id): misma
-- categoría, publicadas, ordenadas por sort_order/created_at y LIMIT 8. Sin
-- este índice el filtro por categoría obliga a recorrer todo lo publicado.
CREATE INDEX IF NOT EXISTS idx_products_related
  ON products(status, category_id, sort_order, created_at);
