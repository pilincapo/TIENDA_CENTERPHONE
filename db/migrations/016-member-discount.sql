-- Club CenterPhone: niveles de descuento por socio (5 / 10 / 15 %).
--
-- El panel asigna el nivel a mano desde Ventas → Club. NULL = el socio usa el
-- descuento base de la configuración (así quedan los socios dados de alta antes
-- de que existieran los niveles) y el checkout sigue recalculando siempre en el
-- worker, nunca desde el navegador.
ALTER TABLE members ADD COLUMN discount_percent INTEGER;
