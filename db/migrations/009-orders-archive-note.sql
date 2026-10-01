-- Motivo opcional del archivo de pedidos: se guarda en el historial junto a
-- archived_at/archived_by y se muestra en la pestaña Pedidos (chip Archivados).
ALTER TABLE orders ADD COLUMN archive_note TEXT;
