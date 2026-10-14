# Runbook de producción — centerphone.com.ar

Operaciones y verificaciones para deployar y configurar el worker `celu-store`.
Referencia rápida; el detalle histórico está en `changelog.md`.

## Deploy

```bash
# 1. Migración D1 remota (solo si schema.sql cambió)
npx wrangler d1 execute celu-store-db --remote --file=db/schema.sql

# 2. Deploy del worker
npm run deploy
```

## Secret `MERCADOPAGO_ACCESS_TOKEN`

**Quirk de `wrangler secret put` interactivo**: pide **nombre y valor por
separado**; si se escribe el token como nombre queda un secret-artefacto con
valor vacío (y `wrangler secret list` no lo delata: solo muestra nombres).

Forma segura de cargarlo:

```bash
echo "APP_USR-..." | npx wrangler secret put MERCADOPAGO_ACCESS_TOKEN
```

- El token vive solo como secret del worker o en `.dev.vars` (gitignoreado). Nunca en el repo.
- Sin token el sitio funciona igual (catálogo + WhatsApp); `POST /api/checkout` responde `503`.
- Verificar credencial activa: el `pref_id` de una preferencia creada arranca con el app id correspondiente.

## Toggle de pagos (`paymentsEnabled`)

**Primera opción: el panel** (`/admin/` › Configuración). Es el camino soportado
y el que ahora manda el `Content-Type: application/json; charset=utf-8`.

Si el guardado desde el panel no llega (ej. hecho antes del deploy), se puede
tocar la KV a mano preservando el resto de los valores:

```bash
# 1. Bajar el valor actual (--text decodifica como UTF-8)
npx wrangler kv key get "config:settings:v1" --text --namespace-id=71875a431359487e954c86f15edf54ae > settings.json
# 2. Editar paymentsEnabled: true (y checkoutNote si corresponde)
# 3. Verificar que el archivo siga siendo UTF-8 y sin mojibake (ver abajo)
# 4. Subirlo
npx wrangler kv key put "config:settings:v1" --path settings.json --namespace-id=71875a431359487e954c86f15edf54ae
```

Para la KV **local** (`wrangler dev`) agregan `--local` a los dos comandos.

### ⚠️ Mojibake: «Sábados» guardado como «SÃ¡bados»

Pisar ese JSON con una herramienta de Windows codifica los bytes en el codepage
ANSI y rompe las tildes y los emojis (es lo que pasó con los horarios y el
«Cómo comprar»): se ve así en la tienda, en el footer y en el `openingHours` del
JSON-LD. Reglas:

- Verificar el archivo **antes** de subirlo:
  `python -c "import io;d=io.open('settings.json',encoding='utf-8').read();print('mojibake' if ('Ã' in d or 'Â' in d) else 'ok')"`
- No usar `>` / `Out-File` / `Set-Content` de PowerShell para escribirlo ni
  guardarlo desde Notepad como «ANSI»: deja UTF-16 o ANSI. Mejor editarlo en un
  editor que guarde UTF-8 (VS Code) y confirmar con el chequeo de arriba.
- Con el archivo mal subido igual no se ve roto: desde 2026-10-13 el worker
  repara el mojibake al leer los settings (`src/shared/encoding.ts`) y el próximo
  guardado desde el panel lo persiste corregido. Pero conviene no reintroducirlo:
  el valor en KV queda sucio hasta esa siguiente escritura.

## Analítica y SEO

### Dónde se ven las visitas

| Fuente | Qué da | Dónde |
|---|---|---|
| **Panel › 📊 Estadísticas** | Tracking **propio** (1 fila por evento en `stats_events`, 90 días): vistas a fichas, búsquedas, clics de WhatsApp, visitas al home, usos de /seguimiento, por día, por hora (Argentina), por país/ciudad y por referrer | `/admin/` |
| **Cloudflare › Web Analytics** | RUM de Cloudflare (**sin cookies**, sin banner): pageviews, páginas top, referrers, países, dispositivos, Core Web Vitals | dash de Cloudflare |

Se complementan: el panel mide **intención de negocio** (clics de WhatsApp, búsquedas) que Cloudflare no ve; Cloudflare mide **tráfico y rendimiento** que el panel no.

### ⚠️ El beacon de Cloudflare: cómo verificarlo (y la trampa)

La zona tiene RUM **activo** (`/zones/{id}/settings/rum` = `on`), con el sitio de Web Analytics en `auto_install` y su ruleset habilitado, y la CSP ya permite el beacon
(`static.cloudflareinsights.com` en `script-src` y `cloudflareinsights.com` en `connect-src`, en **`public/_headers`** y en **`src/worker/security.ts`** — si se edita la CSP, no sacar esos dos orígenes o el seguimiento se cae en silencio).

**No verificar el beacon con `curl`**: Cloudflare inyecta el snippet solo en requests que parecen un **navegador real**. Con `curl` (incluso mandando User-Agent de Chrome) el HTML **no** trae el beacon y el "0" es un falso negativo — así se diagnosticó mal el 2026-10-13. Para verificarlo de verdad, cargar la página en un navegador y mirar:

- que exista `<script src="https://static.cloudflareinsights.com/beacon.min.js/…">` en el DOM (el src lleva un hash de versión y `data-cf-beacon` con `version`/`token`/`r`/`spa`);
- o el `POST /cdn-cgi/rum` (204) en la pestaña Network.

Desde la API: `rumPageloadEventsAdaptiveGroups` en GraphQL (dataset account-level, filtrado por `siteTag`) muestra los pageviews con `datetimeHour` y `requestPath`.

### Google Search Console (SEO)

El sitio ya tiene lo que Search Console consume: `/sitemap.xml` (dinámico desde D1, solo publicados), `/robots.txt` con el `Sitemap:`, JSON-LD (`Store`, `WebSite`, `Product` con precio y disponibilidad, `BreadcrumbList`), `canonical` y 301 de `www` al dominio sin `www`.

**La verificación por DNS ya está hecha**: el apex (`centerphone.com.ar`) tiene el TXT
`google-site-verification=TKs0MJu7LiYX8g4LF5gU6kYvJkQjavaSKXBfbIjefLU`, creado el
**2026-08-20** (el mismo día que el sitio de Web Analytics) y **resolviendo
públicamente** (comprobado con DNS-over-HTTPS el 2026-10-13). Es decir: la
propiedad de **dominio** `centerphone.com.ar` ya quedó verificada en su momento.
**No borrar ese TXT**: es lo que sostiene la verificación.

Lo que queda es dentro de Google (no hay conector de Google para automatizarlo):

1. Entrar a Search Console y confirmar que la propiedad `centerphone.com.ar` figura como **verificada**.
2. Enviar `https://centerphone.com.ar/sitemap.xml` (un clic) si todavía no está enviado; la propiedad de dominio cubre `www` también.
3. Mirar **Rendimiento** (consultas, impresiones, clics, posición), **Páginas** (qué se indexó) y los informes de **datos estructurados**.

### ⚠️ Soft 404: qué URLs quedaron indexadas y cómo limpiarlas (2026-10-13)

Hasta el deploy `22cb6e14-7946-41a7-a213-d52f40f9f7d4` el worker devolvía el cuerpo de `public/404.html` con el **200** del asset: cualquier URL inexistente respondía 200 con la página de error, y una ficha de producto sin producto devolvía el shell con 200. Google puede guardar eso como **página válida** (o como «Soft 404»), así que las URLs que ya no existen podían seguir en el índice.

**Del lado del sitio ya está resuelto** (medido sobre producción, deploy `22cb6e14`):

| Check | Resultado |
|---|---|
| `/no-existe-xyz`, `/a/b/c`, `/no-existe.jpg`, `/wp-login.php` | **404** con la página de error |
| `/producto/` y `/producto/%20` (id vacío) | **404** |
| `/producto/<id inexistente>` | **404** |
| `/producto/5469` y 24 URLs muestreadas del sitemap | 200 (con las metas OG inyectadas) |
| Cabeceras del 404 | `Cache-Control: public, max-age=0, must-revalidate` → el borde revalida, no sirve un 200 viejo |
| `/sitemap.xml` | 1388 URLs (1365 productos + 22 categorías + home), todas vivas |

**La lista de URLs afectadas NO se puede sacar de los datos del sitio** (dos caminos ya probados, para no repetirlos):

- `stats_events` (visitas) guarda `product_id` **truncado a 64 caracteres** (`slice(0, 64)` en `stats.ts`). Comparando crudo parecen **28 productos muertos con tráfico**, pero los 28 son **falsos positivos**: son productos vivos con id más largo que el recorte. Y no se puede verificar por `LIKE '<prefijo>%'` porque D1 rechaza el patrón largo (`LIKE or GLOB pattern too complex`, error 7500): hay que usar `substr(p.id, 1, length(e.product_id)) = e.product_id`.
- `orders.items_json` sí guarda el id completo, pero solo de lo vendido: de 18 pedidos, 15 productos siguen vivos y el único id ausente es el ítem sintético `descuento-transferencia` (no es una URL real).
- El ciclo normal del catálogo no deja URLs muertas: cuando la fuente deja de traer un producto queda `status = hidden` (13 hoy) y **se sigue sirviendo con 200**. Muerto de verdad es solo lo borrado a mano en el panel, o una URL histórica de un sitio anterior.

Conclusión: **la lista sale de Google, no de D1.**

**Cómo hacerlo en Search Console** (requiere tu cuenta; no hay conector de Google para automatizarlo):

1. **Páginas** (Indexación de páginas) → mirar los grupos **«Soft 404»** y **«Página detectada, pero no indexada»**: ahí están las URLs que el soft 404 dejó pasar como válidas.
2. En el grupo **Soft 404** → botón **«Validar corrección»**. Google vuelve a rastrear esas URLs y ahora reciben 404 real, así que el grupo se vacía solo (tarda días, no es instantáneo).
3. Para las que además no querés seguir viendo en resultados (un producto discontinuado que aún aparece con la foto vieja): **Quitar → Quitar temporalmente**, con la URL exacta. Dura ~6 meses y no exige que la página deje de existir.
4. **Sitemaps** → reenviar `https://centerphone.com.ar/sitemap.xml` para que el recrawl arranque con la lista limpia.
5. Confirmar en **Rendimiento → Páginas** que las URLs 404 dejan de sumar impresiones.

**Handoff**: en «Páginas» cada grupo se puede **exportar** (CSV / Google Sheets). Si me pasás ese export, clasifico cada URL (viva / 404 / redirigida), chequeo el status actual de cada una contra producción y armo la lista de remociones lista para pegar.

**Alternativa sin Search Console** (para tener la lista desde el sitio): el worker ya tiene Workers Logs activo (`observability` en `wrangler.jsonc`), pero hoy no registra los 404. Un `console.warn` en `notFoundPage()` daría, con pocos días de rastreo, las URLs reales que los bots piden y ya no existen.

### Verificación del SEO técnico (2026-10-13, sobre producción)

| Check | Resultado |
|---|---|
| `/robots.txt` | 200: `Allow: /`, `Disallow: /admin`, `Sitemap:` correcto |
| `/sitemap.xml` | 200 `application/xml; charset=utf-8`, XML válido, **1388 URLs únicas** (1365 productos + 22 categorías + home), sin duplicados, sin `/admin`, todas `https://centerphone.com.ar/` |
| `/pedido/:id` inexistente | 404 con `robots: noindex` |
| URL larga | el sitemap entra cómodo en el límite de 50.000 URLs / 50 MB |

**Hallazgo menor, no corregido**: `/admin/` no lleva `noindex` (sí está `Disallow`-eado en `robots.txt` y con `Cache-Control: no-store`, y no está linkeado ni en el sitemap). Agregar `<meta name="robots" content="noindex">` a `admin/index.html` sería el cierre prolijo.

### 📱 Catálogo de WhatsApp: publicar productos elegidos (feed programado, 2026-10-13)

El catálogo de WhatsApp no tiene carga masiva —ni en la app ni desde ningún panel—: el catálogo de WhatsApp **es** un catálogo de Meta (Commerce Manager) vinculado a la cuenta, y Meta lo llena **descargando periódicamente un archivo de una URL pública**. Por eso acá no se "suben" productos: se **marcan** en el panel y el worker sirve el archivo que Meta baja solo.

**Paso a paso detallado: [GUIA_CATALOGO_WHATSAPP.md](GUIA_CATALOGO_WHATSAPP.md)** — los requisitos de Meta con sus fuentes, la verificación de disponibilidad en Argentina (y lo que no se pudo confirmar), los problemas típicos y el checklist de publicación. Lo de abajo es el resumen.

**Cómo se usa:**

1. En el panel, pestaña **Productos**: seleccionás las filas (los checkboxes de siempre) y usás **📱 Publicar en WhatsApp** o **📱 Quitar de WhatsApp**. Los marcados muestran el badge 📱 y la barra dice cuántos están en el feed.
2. Para marcar de una sola vez, usá las filas **📱 WhatsApp por categoría** y **📱 WhatsApp por origen** (Tecnova, Hacetupedido o manuales): al elegir el alcance, el panel muestra **cuántos se marcarían, cuántos entrarían al feed y cuántos están hoy**, y pide confirmación con esos números. Si la acción dejaría el catálogo **vacío** o con **menos de un cuarto** de lo que hay hoy, pide una **segunda confirmación** con el aviso: vale la pena leerla, porque con el feed en cero **Meta no borra nada, pero tampoco actualiza** (el endpoint responde error a propósito).
3. **Ajustes → 📱 Catálogo de WhatsApp** muestra la **URL del feed** (con el token en la query), cuántos productos se publican y permite **copiarla** o **regenerarla**. Al regenerarla, la URL vieja deja de servir: hay que actualizarla en Commerce Manager.

**Pasos en Meta (una sola vez):**

1. Commerce Manager → tu catálogo → **Fuentes de datos** → **Agregar fuente** → **Feed programado** (por URL).
2. Pegá la URL del panel, elegí la frecuencia (lo más seguido que permite Meta es **cada hora**) y el tipo de feed: **reemplazo completo** (recomendado: desmarcar un producto, o que la fuente deje de traerlo, lo saca del catálogo) o **actualización** (solo agrega y actualiza; lo desmarcado queda visible y hay que borrarlo a mano).
3. Esperar la primera descarga (hasta 1 hora) y revisar **Productos** en Commerce Manager: los rechazados indican el campo que falla.
4. **Validar primero 2-3 productos** y confirmar que el precio en **ARS** se ve bien antes de marcar todo el catálogo (la documentación de Meta no confirma ARS para todos los mercados).

**Qué lleva el feed** (`src/shared/wa-feed.ts`): `id`, `title`, `description`, `availability`, `condition`, `price` (`3360.00 ARS`), `link` (`/producto/<id>`), `image_link` y `brand`.

| Check | Resultado (verificado en local) |
|---|---|
| Feed con token y 2 productos marcados | **200**, CSV con encabezado + 2 filas y 9 columnas por fila (parser RFC 4180) |
| Sin token / token inválido / token viejo tras rotar | **404** |
| 0 productos marcados | **500** (guarda anti-vaciado; Meta deja el catálogo como estaba) |
| Producto sin stock marcado a mano | no entra al feed, y el contador del panel lo refleja |
| Desmarcar un producto | sale del feed en la descarga siguiente |
| Guardar Configuración (formulario) | el token **no** se pisa: la URL queda idéntica y el feed sigue en 200 |
| Rotar el token (Ajustes) | token viejo 404, nuevo 200 |
| Descarga repetida del feed | la primera trae `X-Wa-Feed-Cache: d1` (lee D1) y las siguientes `kv`: se sirve de una copia en KV que **no** toca D1 |
| Cualquier cambio (marca, precio, alta, sincronización) | invalida la copia: la descarga siguiente vuelve a `d1` y ya refleja el cambio (el TTL de 5 minutos es solo el techo) |

Detalles a tener en cuenta:

- Entran **solo los publicados y con foto**: sin `image_link` Meta rechaza el feed completo, así que esos productos se saltean y quedan en Workers Logs (`wa-feed: …`) junto con el motivo.
- **995 de 1365 productos no tienen descripción** y **solo 150 tienen marca**: se generan textos de respaldo con el título, la categoría y el nombre de la tienda, porque Meta exige ambos campos.
- El feed **sigue sirviéndose en modo mantenimiento** (el catálogo de WhatsApp es el mismo canal de venta) y está excluido del rastreo en `robots.txt`.
- El token vive en los ajustes y **no** se edita en Configuración: se genera solo la primera vez que se abre la sección y se rota desde el botón (si se filtra la URL, rotar y actualizar Commerce Manager).
- El feed se sirve desde una **copia en KV** (5 minutos) para que las descargas de Meta no lean el catálogo entero en D1: la copia se tira en cada cambio del catálogo (1-2 escrituras de KV **por cambio**, nunca por request). El contador del panel cuenta **marcados + publicados + con foto**, que es exactamente lo que sale en el archivo.

## Verificación post-deploy

| Check | Esperado |
|---|---|
| `GET /` (con y sin www) | 200 / 301 a dominio canónico |
| `GET /producto/:slug` | 200 |
| CSP en `/` | nonce + insights + frame-ancestors none |
| `GET /admin/` | 200 con `Cache-Control: no-store`; sin sesión las rutas admin → 401 |
| `POST /api/track` Origin externo | 403 |
| `POST /api/checkout` sin pagos activos | 503 |
| `POST /api/payments/webhook` | 200 |
| `GET /pedido/:id` inexistente | 404 |
| `GET /sitemap.xml` | 200 |
| UI: cards con botones Agregar/Comprar | solo `in_stock` y con pagos activos |

## Lecciones

- `wrangler secret list` muestra solo nombres: un secret con valor vacío no se ve; el síntoma es el `503` del checkout sin más pista.
- El webhook de MP no requiere configuración en el panel: la `notification_url` viaja en cada preferencia.
- MP rechaza `auto_return` si las `back_urls` no son https (ya resuelto en código: solo se envían si el sitio es https).
