-- Borra los productos y categorías de ejemplo (los cargados por sync o el panel se conservan si tienen otros ids)
DELETE FROM products WHERE id IN ('s24u','a55','edge50','g84','motoe13','redmi13','pocox6','a15','s23fe','moto-x40','prototipo');
DELETE FROM categories WHERE id IN ('marcas','sam','moto','xiaomi','gama','gama-alta','gama-media');
