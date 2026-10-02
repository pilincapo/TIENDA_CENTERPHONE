-- Estado previo al archivar: al restaurar, el pedido vuelve al estado que
-- tenía antes de archivarlo (cancelled / rejected / pending / paid) en vez de
-- asumir paid o pending. Las filas archivadas antes de esta migración quedan
-- con NULL y el backend cae al comportamiento anterior (paid si paid_at).
ALTER TABLE orders ADD COLUMN pre_archive_status TEXT;
