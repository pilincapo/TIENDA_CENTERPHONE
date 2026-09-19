# 📱 CenterPhone Celulares

Catálogo web de celulares con **cierre de venta por WhatsApp**. Todo corre en Cloudflare con plan gratuito.

## Qué incluye

- **Pública** (`/`): grid de productos con búsqueda, filtros por categoría/subcategoría, rango de precio y etiquetas (nuevo/destacado/oferta). Ficha de producto con breadcrumb, relacionados y botón **"Consultar por WhatsApp"** con mensaje precargado (nombre y precio del producto). Botón flotante de WhatsApp global.
- **Panel admin** (`/admin/`): login con password, CRUD de productos y categorías (con jerarquía), **importación inteligente por URL** (pegás el link de una categoría y extrae los productos con selección individual), importación por JSON pegado/arrastrado, **reglas de precios** (recargo % por rango, agrupables en escalas, automáticas o forzadas al importar), **auto-importaciones programadas** (URLs + horarios en hora Argentina, hasta 3 por job), sincronización manual, **historial de sincronizaciones** (cron, manual e importaciones, con causa de los errores), y configuración completa (nombre de la tienda, WhatsApp, dirección, horarios, redes, moneda).
- **Reglas de precios**: pestaña para crear reglas tipo "entre $0 y $10.000 → +40%", agrupables en escalas (ej: 1–10.000, 10.001–20.000, 20.001+). Durante cualquier importación (manual o del cron), si el precio cae en el rango de una regla activa se le aplica el recargo. Si varias coinciden gana la mayor prioridad (y a igual prioridad, el rango más específico). En Importar podés además **forzar una regla o un grupo entero** de la lista. Los precios siempre quedan en **pesos enteros** (sin decimales).
- **Extracción desde URL** (botón Analizar / auto al pegar el link): prueba en orden ① JSON directo, ② estado embebido de tiendas **TiendaNegocio** (script `1-state`: productos con precio, stock, imagen + categoría de la página), ③ JSON-LD schema.org (ficha individual o categoría con fetch de fichas), ④ Shopify `/products.json`. La categoría se crea automáticamente si no existe. Los fallos de red/DNS/estado HTTP se reportan con la causa clara.
- **Sincronización automática**: cron horario de Cloudflare que ejecuta las auto-importaciones activas en los horarios configurados (hora Argentina). Los precios pueden venir como número (`1299999`), string (`"$1.299,99"`), con tags en español (`nuevo/oferta/destacado`) y stock (`agotado`, `bajo pedido`).
- **Snapshot público en KV**: la home lee un JSON cacheado en el edge (rápido, casi sin lecturas de D1); se regenera en cada cambio del panel o import.

## Costo: $0

| Servicio | Uso | Plan gratuito |
|---|---|---|
| Workers | web + API | 100.000 requests/día |
| D1 | datos | 5 GB, 5M lecturas/día |
| KV | snapshot + config | 100.000 lecturas y 1.000 escrituras/día |
| Cron Triggers | sync programada | incluido |
| `*.workers.dev` | dominio | gratis |

## Arranque rápido (local)

```bash
npm install
npx wrangler login        # solo la primera vez
npm run setup             # crea D1 + KV, aplica schema + seed, configura secretos
npm run deploy            # build + deploy a Cloudflare
```

Te va a pedir crear la contraseña de admin si no existe `.dev.vars`:

```bash
npx wrangler secret put ADMIN_PASSWORD          # tu contraseña del panel
npx wrangler secret put ADMIN_SESSION_SECRET    # o dejá que npm run setup la genere
```

## Desarrollo local

```bash
npm run build:web   # empaqueta el frontend a public/ (una vez)
npm run dev:worker  # sirve todo en http://localhost:8787
```

En local, wrangler usa `.dev.vars` para los secretos. `npm run setup` lo crea; formato:

```
ADMIN_PASSWORD=tu-clave
ADMIN_SESSION_SECRET=cualquier-texto-largo-al-azar
```

Nota: `npm run setup` inicializa la base **remota**. Para el flujo 100% local:

```bash
npx wrangler d1 execute celu-store-db --local --file=db/schema.sql
npx wrangler d1 execute celu-store-db --local --file=db/seed.sql
```

## Importar desde tu categoría TiendaNegocio

Pegás `https://www.hacetupedido.com/productos/mascotas` en **Importar** → se analizan los 7 productos (precio, stock, imagen) y se crea la categoría `Mascotas`. Marcás/desmarcás y confirmás. Para mantenerlo al día solo, cargá esa URL como **Auto-importación** con los horarios deseados (hora Argentina).

## El JSON que debe devolver tu URL de sync

Cualquiera de estas formas funciona (los nombres aceptan español e inglés, y el mapeador tolera variantes):

```json
{
  "products": [
    {
      "id": "s24u",
      "title": "Samsung Galaxy S24 Ultra 512GB",
      "description": "Pantalla 6.8\" QHD+...",
      "price": 1299999,
      "category": "Samsung",
      "subcategory": "Gama alta",
      "tags": ["new", "featured"],
      "image_url": "https://.../s24u.jpg",
      "availability": "in_stock",
      "status": "published"
    }
  ]
}
```

- `price`: número (en unidades, no centavos) o string `"$1.299,99"` — se convierte y redondea a peso entero solo.
- Sin `id`, se genera del título. `tags` acepta `["new"]` o `"nuevo, oferta"`.
- `availability`: `in_stock` / `out_of_stock` / `preorder` (o `agotado`, `bajo pedido`).
- También se acepta un array puro, o `{ "items": [...] }` / `{ "data": [...] }`.

## Cómo compra el cliente

1. Entra al catálogo, filtra por marca o precio, entra a la ficha.
2. Toca **"Consultar por WhatsApp"** → se abre WhatsApp con:

   > Hola! Me interesa "Samsung Galaxy S24 Ultra 512GB" ($1.299.999).

3. Cerrás la venta conversando. Sin pagos, sin carrito.

## Panel: qué hay en cada pestaña

- **Dashboard**: estado del catálogo, botones "Sincronizar ahora" y "Regenerar snapshot", historial de sincronizaciones (automáticas/manuales) con detalle y causa de errores.
- **Productos**: tabla completa (incluye ocultos), crear/editar/borrar (individual, múltiple o por categoría), tags y disponibilidad.
- **Categorías**: con jerarquía (padre/hijo) y activo/inactivo (las inactivas no salen en filtros).
- **Importar**: pegá un link (extrae y preselecciona productos con checkboxes), JSON, o arrastrá un archivo → previsualización con reglas de precio aplicadas → confirmar. Botón "Importar seleccionados" fijo arriba.
- **Reglas de precios**: rangos con % de recargo, agrupables en escalas con aviso de solapamientos.
- **Auto-importaciones**: URLs programadas con hasta 3 horarios (hora Argentina), ejecución manual inmediata y estado de la última corrida.
- **Configuración**: nombre de la tienda, número de WhatsApp, dirección, horarios, redes sociales, moneda, URL de sync clásica.

## Verificación

```bash
npm test       # 76 tests de parsers, normalizador, reglas y WhatsApp
npm run build  # frontend + 404.html + assets de marca
npm run typecheck
```
