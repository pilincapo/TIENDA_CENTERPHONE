-- Agrega group_name a price_rules (migración para bases existentes)
ALTER TABLE price_rules ADD COLUMN group_name TEXT;
