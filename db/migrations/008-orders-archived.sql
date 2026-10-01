-- Archivo de pedidos: historial de pedidos cancelados o de prueba.
-- archived_at  = fecha del archivo (epoch ms); NULL = no archivado.
-- archived_by  = IP del panel que archivó (informativo).
ALTER TABLE orders ADD COLUMN archived_at INTEGER;
ALTER TABLE orders ADD COLUMN archived_by TEXT;
