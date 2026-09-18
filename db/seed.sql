-- Datos de ejemplo (categorías + celulares)
INSERT OR REPLACE INTO categories (id, name, parent_id, active, created_at, updated_at) VALUES
  ('marcas', 'Marcas', NULL, 1, 1700000000000, 1700000000000),
  ('sam', 'Samsung', 'marcas', 1, 1700000000001, 1700000000001),
  ('moto', 'Motorola', 'marcas', 1, 1700000000002, 1700000000002),
  ('xiaomi', 'Xiaomi', 'marcas', 1, 1700000000003, 1700000000003),
  ('gama', 'Por gama', NULL, 1, 1700000000004, 1700000000004),
  ('gama-alta', 'Gama alta', 'gama', 1, 1700000000005, 1700000000005),
  ('gama-media', 'Gama media', 'gama', 1, 1700000000006, 1700000000006);

INSERT OR REPLACE INTO products (id, title, description, price_cents, category_id, subcategory_id, tags, image_url, status, availability, sort_order, created_at, updated_at) VALUES
  ('s24u', 'Samsung Galaxy S24 Ultra 512GB', 'Pantalla 6.8" QHD+ 120Hz, Snapdragon 8 Gen 3, cámara 200MP, S Pen incluida. Libre de fábrica.', 129999900, 'sam', 'gama-alta', '["new","featured"]', 'https://picsum.photos/seed/s24u/640/640', 'published', 'in_stock', 1, 1700000010000, 1700000010000),
  ('a55', 'Samsung Galaxy A55 256GB', 'Pantalla 6.6" Super AMOLED 120Hz, Exynos 1480, cámara 50MP con OIS, batería 5000mAh.', 45999900, 'sam', 'gama-media', '["offer"]', 'https://picsum.photos/seed/a55/640/640', 'published', 'in_stock', 2, 1700000010001, 1700000010001),
  ('edge50', 'Motorola Edge 50 Pro 256GB', 'Pantalla curva pOLED 6.7" 144Hz, carga turbo 125W, cámara 50MP con estabilización.', 69999900, 'moto', 'gama-alta', '["featured"]', 'https://picsum.photos/seed/edge50/640/640', 'published', 'in_stock', 3, 1700000010002, 1700000010002),
  ('g84', 'Motorola Moto G84 256GB', 'Pantalla pOLED 6.5" 120Hz, Snapdragon 695, audio stereo Dolby Atmos.', 32999900, 'moto', 'gama-media', '[]', 'https://picsum.photos/seed/g84/640/640', 'published', 'in_stock', 4, 1700000010003, 1700000010003),
  ('motoe13', 'Motorola Moto E13 64GB', 'Pantalla 6.5" HD+, Unisoc T606, batería 5000mAh. Ideal como primer smartphone.', 12999900, 'moto', 'gama-media', '["offer"]', 'https://picsum.photos/seed/e13/640/640', 'published', 'in_stock', 5, 1700000010004, 1700000010004),
  ('redmi13', 'Xiaomi Redmi Note 13 Pro 256GB', 'Pantalla AMOLED 6.67" 120Hz, cámara 200MP, carga 67W, IP54.', 42999900, 'xiaomi', 'gama-media', '["new"]', 'https://picsum.photos/seed/rn13/640/640', 'published', 'in_stock', 6, 1700000010005, 1700000010005),
  ('pocox6', 'Xiaomi POCO X6 Pro 512GB', 'Dimensity 8300 Ultra, pantalla Flow AMOLED 120Hz, HyperOS, 12GB RAM.', 54999900, 'xiaomi', 'gama-alta', '["featured","offer"]', 'https://picsum.photos/seed/pocox6/640/640', 'published', 'in_stock', 7, 1700000010006, 1700000010006),
  ('a15', 'Xiaomi Redmi A15 128GB', 'Entrada de gama, pantalla 6.7", batería 5000mAh, doble cámara.', 9999900, 'xiaomi', 'gama-media', '[]', 'https://picsum.photos/seed/a15/640/640', 'published', 'in_stock', 8, 1700000010007, 1700000010007),
  ('s23fe', 'Samsung Galaxy S23 FE 256GB', 'Pantalla Dynamic AMOLED 6.4" 120Hz, cámara 50MP, Exynos 2200.', 64999900, 'sam', 'gama-alta', '[]', 'https://picsum.photos/seed/s23fe/640/640', 'published', 'out_of_stock', 9, 1700000010008, 1700000010008),
  ('moto-x40', 'Motorola Moto X40 (reservado)', 'Flagship con Snapdragon 8 Gen 2, pantalla curva 165Hz. Disponible bajo pedido.', 89999900, 'moto', 'gama-alta', '[]', 'https://picsum.photos/seed/x40/640/640', 'published', 'preorder', 10, 1700000010009, 1700000010009),
  ('prototipo', 'Producto oculto de prueba', 'No debería verse en el catálogo público.', 100000, 'xiaomi', 'gama-media', '[]', '', 'hidden', 'in_stock', 99, 1700000010010, 1700000010010);
