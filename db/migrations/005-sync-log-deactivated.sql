-- Historial: cuántos productos de la fuente se ocultaron en cada corrida
-- (ya no vienen en el listado de la URL). NULL en corridas que no revisaron fuentes.
ALTER TABLE sync_log ADD COLUMN items_deactivated INTEGER;
