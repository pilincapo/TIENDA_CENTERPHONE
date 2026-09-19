-- Historial de sincronizaciones: anota de qué URL vino cada corrida
ALTER TABLE sync_log ADD COLUMN detail TEXT;
