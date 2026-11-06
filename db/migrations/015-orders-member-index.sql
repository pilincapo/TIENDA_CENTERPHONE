-- Panel → Club: compras y total gastado por socio.
-- La consulta filtra por member_code y estado "paid", y agrupa por socio en
-- cada página del listado. Sin índice, con muchas órdenes se vuelve un scan.
CREATE INDEX IF NOT EXISTS idx_orders_member_status ON orders(member_code, status);
