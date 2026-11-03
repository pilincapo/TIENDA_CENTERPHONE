-- Solicitudes de cambio, devolución, garantía y arrepentimiento (compras a
-- distancia). Normativa: Ley 24.240 art. 34, CCyC art. 1110, Disposición
-- 954/2025 (botón de arrepentimiento y registro de la solicitud con código).
--
-- Datos mínimos: nombre y UN medio de contacto. El motivo es opcional: el
-- arrepentimiento no se justifica. No hay email/telefono obligatorio de ambos.
--
-- `id` es un token de 32 hex aleatorio: es la credencial del seguimiento
-- público (misma idea que /pedido/:id). `code` es el código legible que se le
-- informa al consumidor ("DEV-XXXXXX").
CREATE TABLE IF NOT EXISTS return_requests (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL,              -- arrepentimiento | cambio | devolucion | garantia
  name         TEXT NOT NULL,
  contact      TEXT NOT NULL,              -- WhatsApp o email, según contact_kind
  contact_kind TEXT NOT NULL,              -- wa | email
  order_ref    TEXT,                       -- pedido, si lo tiene
  product      TEXT,                       -- producto, si lo conoce
  detail       TEXT,                       -- comentario libre (opcional)
  status       TEXT NOT NULL DEFAULT 'recibida',
  response     TEXT,                       -- respuesta del comercio (visible al consumidor)
  ip_hash      TEXT,                       -- anti-abuso; la IP nunca se guarda en claro
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_returns_created ON return_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_status ON return_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_contact ON return_requests(contact_kind, contact, created_at DESC);

-- Historial de estados: cada cambio queda fechado. Lo que ve el consumidor en
-- el seguimiento público sale de acá (sin datos personales ni notas internas).
CREATE TABLE IF NOT EXISTS return_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  status     TEXT NOT NULL,
  note       TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_events_request ON return_events(request_id, ts);
