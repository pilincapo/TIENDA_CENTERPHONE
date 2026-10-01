-- Celu Store: esquema D1 (SQLite)
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  price_cents    INTEGER NOT NULL,
  category_id    TEXT,
  subcategory_id TEXT,
  tags           TEXT NOT NULL DEFAULT '[]',
  image_url      TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'published',
  availability   TEXT NOT NULL DEFAULT 'in_stock',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  source_url     TEXT,
  brand          TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
  id                TEXT PRIMARY KEY,
  trigger           TEXT NOT NULL,
  status            TEXT NOT NULL,
  items_total       INTEGER,
  items_imported    INTEGER,
  items_failed      INTEGER,
  items_deactivated INTEGER,
  error             TEXT,
  detail            TEXT,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER
);

CREATE TABLE IF NOT EXISTS price_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  group_name  TEXT,
  min_cents   INTEGER NOT NULL DEFAULT 0,
  max_cents   INTEGER,
  percent     REAL NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_imports (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  price_rule_id TEXT,          -- regla individual o "group:<nombre>"; null = automático
  times       TEXT NOT NULL DEFAULT '[]', -- JSON: ["09:00","15:30"] hora Argentina
  active      INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  last_status TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Pedidos con pago online (MercadoPago Checkout Pro). El id es aleatorio e
-- intratable: la página pública /pedido/:id muestra el estado solo con ese link.
CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | cancelled | rejected
  total_cents        INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'ARS',
  buyer_name         TEXT NOT NULL DEFAULT '',
  buyer_phone        TEXT NOT NULL DEFAULT '',
  payer_email        TEXT,                             -- email que reporta MP en el pago
  items_json         TEXT NOT NULL DEFAULT '[]',       -- [{id,title,qty,priceCents}] congelados al crear
  mp_preference_id   TEXT,
  mp_payment_id      TEXT,
  paid_at            INTEGER,
  notified_wa        INTEGER NOT NULL DEFAULT 0,
  archived_at        INTEGER,                           -- fecha del archivo (epoch ms)
  archived_by        TEXT,                              -- IP del panel que archivo
  archive_note       TEXT,                              -- motivo opcional del archivo
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
