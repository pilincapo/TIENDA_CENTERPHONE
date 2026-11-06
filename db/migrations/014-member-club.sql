-- Club CenterPhone: socios con suscripción gratuita.
--
-- No hay cuentas ni contraseñas: el código (SOC-XXXXXX) es la credencial y el
-- WhatsApp normalizado es la clave para recuperarlo. El descuento se valida
-- siempre server-side al crear el pedido (nunca se confía en el navegador).
CREATE TABLE IF NOT EXISTS members (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,             -- solo dígitos, sin 54/9 ni 0 inicial
  email         TEXT,                      -- opcional
  birthday      TEXT,                      -- "MM-DD" (sin año: menos datos personales)
  active        INTEGER NOT NULL DEFAULT 1,
  source        TEXT NOT NULL DEFAULT 'web', -- web | panel
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_order_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_code   ON members(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone  ON members(phone);
CREATE INDEX IF NOT EXISTS idx_members_active        ON members(active, created_at);

-- Código de socio usado en cada pedido (NULL = compra sin club). Permite ver
-- el historial del socio desde el panel y marcar su último pedido.
ALTER TABLE orders ADD COLUMN member_code TEXT;
