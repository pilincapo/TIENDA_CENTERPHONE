<<<<<<< HEAD
# 📱 CenterPhone Celulares

Catálogo web de celulares con **cierre de venta por WhatsApp**. Todo corre en Cloudflare con plan gratuito.

## Qué incluye

- **Pública** (`/`): grid de productos con búsqueda, filtros por categoría/subcategoría, rango de precio y etiquetas (nuevo/destacado/oferta). Ficha de producto con breadcrumb, relacionados y botón **"Consultar por WhatsApp"** con mensaje precargado (nombre, precio y link del producto). Botón flotante de WhatsApp global.
- **Panel admin** (`/admin/`): login con password, CRUD de productos y categorías (con jerarquía), **importación inteligente por URL** (pegás el link de una categoría y extrae los productos con selección individual), importación por JSON pegado/arrastrado, **reglas de precios** (recargo % por rango, automáticas o forzadas al importar), sincronización manual, historial de sincronizaciones, y configuración (número de WhatsApp, moneda, URL de sync, intervalo).
- **Reglas de precios**: pestaña para crear reglas tipo "entre $0 y $10.000 → +40%". Durante cualquier importación (manual o del cron), si el precio cae en el rango de una regla activa se le aplica el recargo. Si varias coinciden gana la mayor prioridad (y a igual prioridad, el rango más específico). En Importar podés además **forzar una regla concreta** de la lista, que se aplica a todos los productos elegidos aunque estén fuera de su rango.
- **Extracción desde URL** (botón Analizar / auto al pegar el link): prueba en orden ① JSON directo, ② estado embebido de tiendas **TiendaNegocio** (script `1-state`: productos con precio, stock, imagen + categoría de la página), ③ JSON-LD schema.org (ficha individual o categoría con fetch de fichas), ④ Shopify `/products.json`. La categoría se crea automáticamente si no existe.
- **Sincronización automática**: cron cada 15 min que consulta tu URL JSON y sincroniza solo si pasó el intervalo configurado. Los precios pueden venir como número (`1299999`), string (`"$1.299,99"`), con tags en español (`nuevo/oferta/destacado`) y stock (`agotado`, `bajo pedido`).
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
npm run dev:worker  # sirve todo en http://localhost:88787
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

Pegás `https://www.hacetupedido.com/productos/mascotas` en **Importar** → se analizan los 7 productos (precio, stock, imagen) y se crea la categoría `Mascotas`. Marcás/desmarcás y confirmás. Para que el cron mantenga todo al día, pegá esa misma URL como **URL de sincronización** en Configuración.

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
```

- `price`: número (en unidades, no centavos) o string `"$1.299,99"` — se convierte a centavos solo.
- Sin `id`, se genera del título. `tags` acepta `["new"]` o `"nuevo, oferta"`.
- `availability`: `in_stock` / `out_of_stock` / `preorder` (o `agotado`, `bajo pedido`).
- También se acepta un array puro, o `{ "items": [...] }` / `{ "data": [...] }`.

## Cómo compra el cliente

1. Entra al catálogo, filtra por marca o precio, entra a la ficha.
2. Toca **"Consultar por WhatsApp"** → se abre WhatsApp con:

   > Hola! Me interesa "Samsung Galaxy S24 Ultra 512GB" ($1.299.999). https://tu-tienda.workers.dev/producto/s24u

3. Cerrás la venta conversando. Sin pagos, sin carrito.

## Panel: qué hay en cada pestaña

- **Dashboard**: última sync, botón "Sincronizar ahora" y "Regenerar snapshot", historial.
- **Productos**: tabla completa (incluye ocultos), crear/editar/borrar, tags y disponibilidad.
- **Categorías**: con jerarquía (padre/hijo) y activo/inactivo (las inactivas no salen en filtros).
- **Importar**: pegá JSON, arrastrá un archivo o descargá desde URL → previsualización → confirmar.
- **Configuración**: número de WhatsApp (formato internacional sin `+`: `5491100000000`), moneda, URL de sync, token opcional (header `Authorization: Bearer`), intervalo del cron.

## Verificación

```bash
npm test       # 30 tests de parsers, normalizador y WhatsApp
npm run build  # frontend + 404.html
npm run typecheck
```
=======
# TIENDA_CENTERPHONE
>>>>>>> origin/main
