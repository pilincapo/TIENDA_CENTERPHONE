## 2026-10-14 — Commit, push y deploy de la jornada de catálogo móvil

- **Commits en `main`** (push exit 0 a `origin/main`): `2e22e80` — precios sin cortar en móvil, vista de lista con alternador, orden persistente, suite visual con Playwright y la guía del catálogo de WhatsApp— y `18ca982` — el runbook: la suite visual como paso previo obligatorio de cada deploy.
- **Runbook**: el bloque de Deploy ahora arranca con `npm run test:visual` y aclara «si falla, NO deployar», con los requisitos (Playwright instalado una vez por máquina, D1 local con productos).
- **La suite corrió como gate real del deploy**: **9 passed** en 29.5s (exit 0), como manda el runbook.
- **Deploy `8f533114-5f53-4839-893f-64182371e84b`** (exit 0): 9 assets subidos (4 ya estaban), bindings KV/D1/ASSETS/EMAIL/vars y cron `0 * * * *` intactos, startup 4 ms. Sin migración D1 (schema.sql sin cambios).
- **Verificado en producción** (deploy `8f533114`): `/`, `/producto/5469`, `/admin/`, `/sitemap.xml`, `/robots.txt` y `/api/catalog` → **200**; `www` → **301** al canónico; el HTML servido referencia los **bundles nuevos** (mismos hashes que el build local: `catalog-Bw0-LBUb.js`, `whatsapp-DjX4VeZN.css`). En navegador a 360px sobre el sitio real: **0 precios cortados** (precio a 113px de ancho), sin scroll horizontal; el alternador **lista** aplica (columna única, foto 116px) y tras **recarga** persisten **la vista lista y el orden «Menor precio»**, guardados en localStorage **y aplicados** (precios renderizados en orden creciente). Los arreglos de hoy ya están visibles para los clientes.
- **Nota**: como esta entrada registra el deploy, no está en el asset desplegado — llega con el próximo (mismo patrón que las entradas anteriores).

## 2026-10-14 — Catálogo: el orden también se guarda en el navegador, y pruebas visuales automatizadas

- **Pedido**: dos cosas — (1) "guardá también la preferencia de orden (menor/mayor precio) en el navegador, igual que la vista"; (2) "agregá una prueba visual automatizada que falle si un precio queda cortado o el alternador de vista no persiste".
- **(1) Orden persistente** (`src/web/catalog.ts`): clave `celu_sort_v1` en localStorage, con la misma defensiva que la vista y el carrito (valor ilegible o storage bloqueado → aleatorio, que es el orden por defecto). Se guarda en cada cambio del select "Ordenar" y también cuando "Limpiar filtros" vuelve el orden a aleatorio, para que el storage siempre refleje lo último que se vio. Al abrir la tienda el select arranca en lo último elegido **y lo aplica**: si fue "Menor precio", la grilla viene ordenada.
- **(2) Pruebas visuales con Playwright** (`tests/visual/`, script `npm run test:visual`, 9 pruebas con Chromium real contra el sitio servido por wrangler): el config (`playwright.config.ts`) levanta **su propio** wrangler en el puerto **8788** con build fresco, para no pisar el dev server manual de 8787 ni heredar su 404 de assets. `precios.spec.ts`: a **320/360/390/414/480/768/1280px**, en **grilla y lista**, ningún `.card-price` con `scrollWidth > clientWidth` —la definición exacta del corte— y sin scroll horizontal de página. `vista.spec.ts`: la vista elegida **sobrevive la recarga** (lista → recarga → sigue lista; grilla → recarga → sigue grilla) y el orden elegido sobrevive la recarga **y ordena de verdad** (precios renderizados en orden creciente).
- **La prueba se verificó con bugs reales, no solo en verde**: se inyectaron a propósito los dos fallos —un `max-width: 34px` que fuerza el corte del precio, y el `saveView()` de la vista quitado— y la suite cayó a **8 failed / 1 passed** (fallaron los 7 anchos de precios y el de persistencia de vista; el de orden, intacto, siguió pasando), con **exit 1**. Revertido, volvió a **9 passed**.
- **Por qué no un test de vitest**: en jsdom no hay layout, `scrollWidth` y `clientWidth` valen 0 y el corte sería indetectable —una aserción que nunca falla no es un test—. La cobertura del layout vive en navegador real; la suite de unitarios (**388 en 43 archivos**), typecheck y build siguen en 0.
- **Setup**: `@playwright/test` como devDependency más `npx playwright install chromium` (una vez por máquina, 118 MiB). `tests/visual/` queda fuera del `include` de vitest (`src/**/*.test.ts`), así que las dos suites no se pisan. La corrida completa de las 9 pruebas tarda ~30-50s (más el build y el arranque de wrangler que hace el propio Playwright).
- **Detalle de entorno (Windows)**: al matar `wrangler dev` con `taskkill` del wrapper, los procesos `node` internos quedan vivos y **reaniman** al `workerd`, que sigue escuchando en el puerto con el índice de assets viejo (se ve como 404 misterioso en `/` y los assets con el servidor «Ready»). Hay que matar también los `node` supervisores (enumerar con PowerShell `Get-CimInstance Win32_Process`) y verificar con `netstat` que el puerto quede libre antes de levantar uno nuevo.

- **Sin deploy**: cambios locales; nada subido a Cloudflare. Sin commitear (siguen pendientes también el arreglo de precios y la vista lista de hoy).

## 2026-10-14 — Catálogo: vista de lista con alternador grilla/lista (preferencia guardada)

- **Pedido**: "implementá la vista de lista para móvil con un alternador grilla/lista en la toolbar, guardando la preferencia en el navegador".
- **Diseño**: la toolbar suma, en la fila de Ordenar, dos botones de ícono (▦ grilla / ☰ lista) con estado activo igual que un chip y `aria-pressed` para lectores de pantalla. La lista es **CSS puro** (`.grid.grid--list`): una columna de filas horizontales —foto de 116px a la izquierda (180px en desktop), datos a la derecha— sin tocar el HTML de las tarjetas; `renderGrid()` solo agrega la clase según `state.view`. En móvil siguen mandando las reglas del pie en dos filas, así que **el precio no se corta en ninguna vista**.
- **Persistencia**: clave `celu_view_v1` en localStorage, con la misma convención defensiva que el carrito (si localStorage está bloqueado o lleno, la vista vale solo la sesión). El alternador actualiza los dos botones en el lugar —sin redibujar la toolbar— para no perder el scroll horizontal de los chips.
- **Un bug de especificidad cazado antes de probar**: `.grid--list` puro perdía contra la regla `.grid { repeat(2, ...) }` del media query ≤800px (misma especificidad pero **después** en el archivo), lo que habría mostrado la lista como 2 columnas en móvil. Se corrigió con selector `.grid.grid--list` (y comentario que explica por qué).
- **Verificado en el navegador** (bundle nuevo, 127.0.0.1:8787): los dos botones presentes con `aria-pressed` correcto; clic en lista → `grid--list` aplicada, **columna única**, `flex-direction: row`, foto de **116px**, `aria-pressed` y localStorage actualizados; clic en grilla → vuelve a 2 columnas. **Persistencia real**: con la vista en lista, la recarga **arranca en lista**. Filtros por tag, Limpiar y «Cargar más» (20→40 tarjetas) conservan la vista. Precios **0 cortados** en lista a 327px y en grilla a 360/390/414/480/768; en desktop 1280 la lista queda en columna única de 1215px con foto de **180px** y 0 cortes; sin scroll horizontal en ningún ancho. La fila del toolbar envuelve en ≤480px (medido: `flex-wrap: wrap`, sin desborde).
- **Tests**: suite completa **388 en 43 archivos**, typecheck y build en 0. No hay test unitario nuevo: `catalog.ts` hace `getElementById` a nivel de módulo y los tests web corren en node sin DOM; la cobertura es la verificación en navegador de arriba.
- **Sin deploy**: cambios locales; nada subido a Cloudflare. Sin commitear.
- **Detalle del entorno**: tras cada `npm run build`, wrangler dev se queda con el índice de assets viejo (404 para el CSS nuevo): hay que reiniciar `wrangler dev` para que lo reindexe.

## 2026-10-14 — Catálogo: los precios ya no se cortan en la versión móvil

- **Pedido**: "verificar que se cortan los precios en la versión móvil, acomodar para que se vean los precios correctamente, sugerirme alternativas de vistas".
- **Verificación (antes)**: sobre el sitio real (dev server local 8787, viewport 360×780) se midieron **todos** los `.card-price` de la grilla: **20 de 20 cortados** — cada precio tenía **30px** de ancho y necesitaba **63px**. La causa: en la tarjeta de 154px el botón «Consultar» se llevaba ~85px y la regla mobile de `.card-price` lo dejaba con `text-overflow: ellipsis` (se veía `$125…`). A 320px quedaban ~25px. La ficha, el carrito y los totales no tenían el problema: era solo la grilla móvil.
- **Arreglo** (solo CSS, bloque `@media (max-width: 800px)` de `src/web/styles.css`): el pie de la tarjeta pasa a `flex-wrap: wrap`, el **precio ocupa su propia fila a todo el ancho** (`flex: 1 1 100%`, sin ellipsis, con `white-space: nowrap` para que el número nunca se parta a mitad) y el botón «Consultar» queda **debajo, a todo el ancho** (~30px de alto: mejor área táctil). Desktop ≥801px conserva la fila única de siempre.
- **Verificado después, en el navegador**: **0 de 20 precios cortados** en **320 / 360 / 390 / 414 / 480 / 768 / 1280px**, y sin scroll horizontal en ninguno de esos anchos. A 360px el precio pasó de 30px a **129px** de ancho y el botón midió 129×28px; a 320px, 109px; a 1280px el pie siguió en **fila única** (26px de alto), o sea que desktop no cambió. También se midieron la **ficha de producto** (precio a 288px, sin corte) y el **modal del carrito** (5 precios, 0 cortados) a 360px.
- **Tests**: suite completa **388 en 43 archivos** y typecheck en 0 (el cambio es solo de CSS, pero se corrieron igual).
- **Limitación**: el screenshot del webview falló por composición en este entorno (2 intentos, pestaña reabierta); la verificación fue por medición directa del DOM (`scrollWidth` vs `clientWidth`), que es el criterio que define el corte.
- **Alternativas de vista sugeridas** (no implementadas en este cambio): vista **lista** en móvil con alternador grilla/lista y preferencia guardada; grilla **sin botón «Consultar»** en la card; grilla **compacta de 3 columnas** ≥480px; y **bloque de precio destacado** a todo el ancho bajo el título.
- **Sin deploy**: cambios locales solamente; nada subido a Cloudflare. Sin commitear.

## 2026-10-13 — Guía detallada para publicar el catálogo, y qué se pudo verificar de Argentina

- **Pedido**: "una guía más detallada para publicar el catálogo" y "verificá si funciona en Argentina".
- **Entregable**: [GUIA_CATALOGO_WHATSAPP.md](GUIA_CATALOGO_WHATSAPP.md) (nueva, enlazada desde el runbook): qué necesitás antes de empezar, cómo preparar y probar el feed, el paso a paso en Commerce Manager (con los nombres de menú de Meta), cómo validar con 2-3 productos antes de marcar todo, qué manda el feed campo por campo, el estado real del catálogo en producción, la sección de Argentina, los problemas típicos y un checklist de publicación.
- **Argentina: lo que sí se pudo confirmar** (documentación oficial de Meta, consultada el 2026-10-13): el catálogo básico es de la **app WhatsApp Business** y **no necesita la API** ni un proveedor; el **formato de precio que ya generamos** (`12500.00 ARS`) **cumple la especificación** (número + espacio + código ISO 4217, punto decimal, sin símbolo); para vender en varios países con distintos precios el mecanismo documentado son los *country feeds*.
- **Argentina: lo que NO se pudo confirmar, y por eso no se afirma**: la **lista vigente de países** con catálogo de WhatsApp (lo único oficial es el anuncio de lanzamiento del 7/11/2019 con siete países —Argentina no está— pero ahí mismo Meta dice que se desplegaría «pronto en todo el mundo», y en 2020 afirmó que los enlaces a catálogos están disponibles globalmente: esa lista **no prueba** ni la exclusión ni la inclusión de hoy); si hace falta **verificación de empresa** o cuenta publicitaria para el catálogo de la app; si Meta **exige que ARS coincida** con el país del catálogo (ARS figura como moneda admitida en la lista de *Games Payments*, no en una de catálogos); y qué hace Meta con un **archivo vacío**. La guía incluye el camino práctico para resolverlo en la propia cuenta en 5 minutos (ver si Commerce Manager ofrece «Archivo de datos → Usar una URL» y si la app muestra la sección Catálogo).
- **Verificación real sobre datos de producción** (consulta de solo lectura): 1365 publicados (995 sin descripción, 1215 sin marca), **18 en preventa**, **100 ya marcados** —todos de Tecnova, o sea que el panel se está usando— y **22 con foto `.webp`**. Como Meta solo acepta **JPEG o PNG de 500×500 en adelante**, se revisaron esas 22 foto por foto contra el requisito: **las 22 son WebP de verdad y varias también miden menos de 500 px de ancho** (454×500, 284×500, 248×500…), y varias URLs respondieron **404** en un segundo intento. **4 de las 22 ya están marcados** (`tecnova-78`, `-88`, `-95`, `-97`): Meta los está rechazando hoy y hay que sacarlos o cambiarles la foto; los otros 18 quedaron listados en la guía para no marcarlos. Se comprobó además que un producto con foto WebP **sí entra al feed** (el feed no filtra por formato de imagen), así que el rechazo es de Meta, por ítem, y no rompe el archivo.
- **Verificado de punta a punta lo que documenta la guía**: marcando 2 productos, el feed responde **200** con `text/csv`, el encabezado de las **9 columnas** y una fila por producto; al desmarcarlos, **500** (el guard anti-vaciado). Base local devuelta a 0 marcados.
- **Sin deploy**: la guía es documentación y las consultas a producción fueron de **solo lectura** (`rows_written: 0`); nada subido a Cloudflare. Tampoco se commiteó todavía.

## 2026-10-13 — Catálogo de WhatsApp: acción masiva por origen, aviso de catálogo vacío y el feed servido desde KV

- **Pedido**: tres cosas sobre lo anterior — (1) marcar/quitar del catálogo de WhatsApp todos los productos de un **origen** (Tecnova, Hacetupedido, manuales) de una sola vez con la misma vista previa que la acción por categoría; (2) servir el feed **desde KV** con vencimiento corto para que las descargas periódicas de Meta no lean D1 entero cada vez, cuidando el límite de escrituras del plan gratis; (3) **avisar** en el panel cuando una acción masiva dejaría el catálogo casi vacío.
- **(1) Una sola acción, dos alcances**: lo de categoría quedó como un caso de algo más general: `GET/POST /api/admin/products/whatsapp/scope` acepta `categoryId` o `src`, y el panel tiene dos filas (categoría y origen) generadas por el mismo bloque. `src` es el mismo "Origen:" del filtro de la lista: el predicado se extrajo a una única función (`sourceCondition()` en `db.ts`, ahora compartida con el filtro y los contadores), así que "de Tecnova" significa lo mismo en las tres partes. **"Todos" no es un alcance válido** (400): no hay una acción masiva sobre el catálogo entero a un clic. La ruta `/products/whatsapp/category` de la entrada anterior se reemplazó por esta (nunca estuvo desplegada).
- **(3) Aviso de catálogo casi vacío**: antes de aplicar, el panel calcula cuántos productos quedarían en el feed (`feedResultante`) y, si la acción lo deja **vacío** o con **menos de un cuarto** de lo que hay hoy, pide un **segundo `confirm`** con el aviso. La aritmética y el texto viven en `src/shared/wa-feed.ts` con tests propios: es la parte que no puede estar mal y no se prueba mirando el navegador. El mensaje del caso vacío dice la consecuencia real, que no es obvia: el feed responde **error a propósito** para no borrar el catálogo de Meta, así que WhatsApp sigue mostrando los productos viejos hasta que se marque algo de nuevo. Con el feed ya vacío no avisa (no hay nada que proteger).
- **El contador del panel ahora es el tamaño real del feed**: marcados **y publicados y con foto** (las tres condiciones que aplica el feed), antes contaba los marcados publicados aunque no tuvieran foto, así que podía prometer más filas de las que Meta recibe. Es también la referencia contra la que se calcula el aviso, y coincide con las filas del archivo (verificado: 369 en el panel = 370 líneas del CSV con el encabezado).
- **(2) El feed se sirve desde una copia en KV** (`wa:feed:cache:v1`, `expirationTtl` de 5 minutos): la descarga que acierta en la copia **no lee D1**. La copia se tira en **cada cambio**: las marcas de WhatsApp y — vía `markCatalogPending`, que es el hook por donde ya pasaban el panel, la sincronización y las auto-importaciones — cualquier escritura del catálogo. Son 1-2 escrituras de KV **por cambio, nunca por request**, que es lo que lo mantiene dentro del plan gratis; el TTL es el techo de frescura, no la única garantía. La invalidación es **best-effort a propósito**: si KV no responde, la escritura que sí se guardó no falla (queda el registro en Workers Logs y la copia vence sola). El feed **vacío no se cachea nunca** (el guard anti-borrado sigue mandando) y sin token o con token inválido no se lee ni D1 ni la copia.
- **Medido, y qué SÍ y qué NO compra el caché** (369 productos marcados, en local): la descarga que lee D1 tardó **520 ms** con 370 líneas; la servida desde KV **137 ms** sin leer D1 (~370 filas). Con la frecuencia mínima de Meta (1 por hora) son ~8.900 filas/día contra las 5.000.000 del plan gratis (**0,2%**), así que por cuota el caché no era imprescindible: lo que compra es **absorber ráfagas y reintentos** de una URL que lleva el token en la query (o sea, que puede filtrarse) y bajar la latencia; lo que cuesta es una superficie de invalidación, que es la razón de tirar la copia en cada cambio en vez de confiar solo en el TTL.
- **Verificado en local por la interfaz real** (dev server 8787, D1 local, capturando los `confirm` reales del panel): la vista previa del origen Tecnova coincide **exactamente** con un `SELECT` independiente (369/0/369/0/0/0, `enFeed` 0) y la de manuales con su propio conteo (0); marcar el origen informó 369 y dejó el contador en 369 con 11 badges en la primera página (los de esa página); desmarcarlo primero pidió **dos** confirms, el segundo con el aviso de catálogo **vacío**; después, con 369 + 7 de mascotas (contador 376), quitar el origen pidió el aviso de **recorte grande** ("quedaría con 7 productos, de los 376 que hay hoy") y dejó 7; y la vista previa se recalcula sola tras cada acción ("369 ya marcados", "Hoy están en el feed 369"). Por HTTP: con 0 marcados el feed responde **500 sin cachear**; al marcar, la primera descarga vino de **d1** y la segunda de **kv**; desmarcar un producto por id (y también el alcance) la **invalidó** (volvió a `d1` y luego `kv`). Base local restaurada al terminar: 0 marcados.
- **Tests**: 6 nuevos del caché (`src/worker/wa-feed-cache.test.ts`: acierto/fallo, invalidación por `markCatalogPending` y directa, copia ilegible, 500 sin cachear, token inválido sin tocar nada), 6 del aviso (`src/shared/wa-feed.test.ts`, incluidos los umbrales exactos) y el alcance por origen en `db-upsert.test.ts` (más los `delete` que faltaban en los KV de mentira de tres archivos). Suite completa: **388 en 43 archivos**, typecheck y build en 0.
- **Commiteado, sin deploy**: commit `cec621b` (junto con la acción por categoría de la entrada siguiente); nada subido a Cloudflare.
- **Detalle del entorno local**: además de las marcas (que volvieron a 0), quedaron ~1221 filas con `updated_at` renovado en la D1 local por los ciclos de marcar/desmarcar de la prueba. No cambia ningún dato visible (título, precio, stock) y no toca producción.

## 2026-10-13 — Catálogo de WhatsApp: marcar una categoría entera, con vista previa

- **Pedido**: "permití marcar para el catálogo de WhatsApp todos los productos de una categoría de una sola vez, con vista previa de cuántos serían".
- **Diseño**: en Productos, fila nueva «📱 WhatsApp por categoría» con el mismo listado de categorías del panel, botones **Marcar la categoría** y **Quitar la categoría**, y una línea de vista previa que se recalcula al elegir la categoría. Servidor: `GET/POST /api/admin/products/whatsapp/category` (`src/worker/admin.ts`), `whatsAppCategoryPreview()` y `setWhatsAppCategory()` (`src/worker/db.ts`), UI en `src/web/admin.ts`.
- **Semántica de categoría**: la MISMA que el borrado masivo que ya existía (`category_id = ?1 OR subcategory_id = ?1`), así «marcar la categoría» no discrepa de «vaciar categoría». Un único `UPDATE`, sin bucles por producto.
- **Vista previa con números que cierran**: total, ya marcados, a marcar, con stock y foto, sin stock y sin foto. Los tres últimos se cuentan sobre la categoría **entera** (no solo sobre los que todavía no están marcados), así el texto sigue diciendo la verdad después de marcar y `conFoto + sinStock + sinFoto = total`. El primer intento contaba los publicables solo entre los no marcados y con la categoría ya marcada decía "se publicarían 0": corregido antes de cerrar. El `confirm` repite los mismos números antes de aplicar.
- **Verificado en local por la interfaz real** (dev server 8787, D1 local): la vista previa del panel para la categoría de 7 productos coincide **exactamente** con un `SELECT` independiente contra la D1 local (7 total / 7 marcados / 0 por marcar / 7 con foto / 0 sin stock / 0 sin foto); marcar la categoría informó 7 actualizados, dejó 7 badges 📱 y llevó el contador del panel a 7; desmarcar informó 7 y dejó el contador global en 0 (estado inicial restaurado, confirmado con SQL). Por HTTP: `preview` con 7 marcados → `POST {publish:false}` → `{"ok":true,"updated":7}` → `preview` con 0 marcados y 7 por marcar, con `conFoto` en 7 en los dos casos (el número que importa no cambia al marcar).
- **Tests**: 4 nuevos en `src/worker/db-upsert.test.ts` (vista previa, caso sin filas que no debe devolver `NaN`, marcar en una sola consulta, desmarcar) más la aserción de que los tres números forman partición con el total. Suite completa: **375 en 42 archivos**, typecheck y build en 0.
- **Commiteado, sin deploy**: commit `cec621b`; nada subido a Cloudflare.

## 2026-10-13 — Catálogo de WhatsApp: publicar productos elegidos de forma masiva

- **Pedido**: "cómo se puede hacer para publicar algunos productos seleccionados en el catálogo de WhatsApp, de forma masiva". Definido con el dueño: catálogo del perfil, vía **feed programado por URL** servido por el worker (ya tiene el catálogo de Commerce Manager vinculado a WhatsApp).
- **Por qué así**: WhatsApp no tiene carga masiva (ni en la app ni desde ningún panel). El catálogo de WhatsApp **es** un catálogo de Meta y Meta lo llena descargando un archivo de una URL; también acepta un CSV subido a mano o la Catalog API `items_batch` (exige app de Meta y token de sistema, descartada). El feed no agrega tokens de Meta, no escribe KV por request y encaja con los campos que Meta exige.
- **Diseño**: marca por producto `products.wa_publish` (migración `db/migrations/011-products-wa-publish.sql` + `schema.sql`) + endpoint `GET /api/whatsapp/feed.csv?t=<token>` (`src/worker/wa-feed.ts`) + generador puro del CSV (`src/shared/wa-feed.ts`) + acción masiva y sección de Ajustes en el panel.
- **Los syncs no borran la marca**: los upserts de importación listan columnas explícitas y no incluyen `wa_publish`, y la edición manual tampoco. Cubierto con tests nuevos en `db-upsert.test.ts`.
- **Campos del feed, mapeados contra los datos reales** (1365 publicados): `id` (máx. 80 caracteres; el límite de Meta es 100), `title` (máx. 93, recortado a 200), `availability` en inglés (`in stock` / `out of stock` / `preorder`), `condition` `new`, `price` como `3360.00 ARS` (ISO 4217, sin símbolo), `link` a `https://centerphone.com.ar/producto/<id>` e `image_link` del CDN de la fuente. **Un producto sin foto no entra** (haría fallar la validación de todo el feed) y **entran solo los publicados**: un producto sin stock tampoco se publica. Textos de respaldo donde el catálogo no los tiene: **995 de 1365 sin descripción** (se genera "… Nuevo, disponible en {tienda}. Consultanos por WhatsApp por stock, colores, memoria y formas de pago.") y **solo 150 con marca** (cae al nombre de la tienda).
- **Guarda anti-vaciado**: con 0 productos marcados el feed responde **500** en vez de un CSV vacío. Con la fuente configurada como "reemplazo completo", un archivo vacío **vaciaría el catálogo de WhatsApp**: así Meta marca la descarga como fallida y no toca nada.
- **Token en la URL** (Meta no manda cabeceras propias en la descarga): `whatsappFeedToken` en los ajustes, generado la primera vez que se abre Ajustes → Catálogo de WhatsApp, comparado en tiempo constante y **rotable** desde el panel. No viaja en el formulario de Configuración, así que guardar ajustes nunca lo pisa (verificado en el navegador: el input es `readonly` y **sin `name`**, no entra al FormData).
- **Verificado end-to-end en local** (dev server en 8787, D1 local migrada, todo por la interfaz real): login del panel → URL del feed → feed **200** con encabezado + 2 filas y **9 columnas en todas** (parseado con un parser CSV RFC 4180, no con un grep), precios `3360.00 ARS` y `4900.00 ARS`, links a la ficha, fotos https y descripciones generadas de ~190 caracteres. Además: 0 marcados → **500**; token inválido → **404**; sin token → **404**; un producto **sin stock marcado a mano no entra** al feed (y el contador del panel lo refleja: 2, igual que las filas); **desmarcar** un producto lo saca en la descarga siguiente; **guardar Configuración** no cambia el token (URL idéntica y feed en 200); **rotar** el token deja el viejo en 404 y el nuevo en 200.
- **En el navegador (panel logueado)**: la tabla muestra el badge `📱 WhatsApp` solo en los marcados, la barra dice "📱 Catálogo de WhatsApp: N productos marcados", los botones **Publicar en WhatsApp** / **Quitar de WhatsApp** aparecen al seleccionar filas, y la sección nueva de Ajustes abre con la URL del feed (83 caracteres, apuntando al dominio público —lo que se pega en Commerce Manager—), el contador y los botones **Copiar URL** (copió la URL real al portapapeles, con el toast "URL copiada") y **Regenerar URL**.
- **Extras**: el feed queda exceptuado del modo mantenimiento (el catálogo de WhatsApp sigue vendiendo con el sitio cerrado) y `robots.txt` lo excluye del rastreo (`Disallow: /api/whatsapp/feed.csv`); cada descarga deja en Workers Logs cuántos productos se publicaron y cuáles se saltearon, con el motivo.
- **Tests**: 18 nuevos (14 en `src/shared/wa-feed.test.ts` y 4 en `src/worker/db-upsert.test.ts`, incluido el troceado de 98 ids que respeta el límite de 100 parámetros de D1). Suite completa: **371 en 42 archivos**, typecheck y build en 0.
- **Pendiente del dueño (Meta)**: en Commerce Manager, catálogo → Fuentes de datos → Agregar fuente → **Feed programado** (URL), pegar la URL del panel, frecuencia (mínimo cada hora) y tipo de feed (recomendado **reemplazo completo**, para que desmarcar saque del catálogo); después validar 2-3 productos y confirmar que **ARS** se muestra bien antes de marcar todo. Paso a paso en `RUNBOOK_PRODUCCION.md`.
- **Publicado**: commit `26c7069` (16 archivos, +853/−8; incluye también los documentos de la limpieza de soft 404 que estaban sin commitear) y deploy `c6e5a236-fb27-4ae1-981a-229afde16099` (9 assets, bindings KV/D1/ASSETS/EMAIL/vars y el cron `0 * * * *` intactos, startup 4 ms). La migración `011` se aplicó **antes** del deploy a la D1 de producción: 1378 productos, 0 marcados y ningún `wa_publish` nulo.
- **Verificado en producción** (deploy `c6e5a236`): `/api/whatsapp/feed.csv` sin token y con token inventado → **404** (el token todavía no existe: se genera la primera vez que se abre Ajustes → Catálogo de WhatsApp); `/api/admin/whatsapp/feed-url` sin sesión → **401**; `/`, `/admin/`, `/sitemap.xml`, `/robots.txt`, `/api/catalog` y `/producto/5469` → 200; `/seguimiento` → 302; URL inexistente → 404. `robots.txt` ya sirve el `Disallow: /api/whatsapp/feed.csv` y el bundle del panel desplegado es el mismo que se probó en local (`admin-CPeHt1QM.js`).
- **Nota (entorno local, ya resuelto)**: la prueba de "guardar Configuración no pisa el token" hizo `PUT /api/admin/settings` en el **local** con cuerpos parciales y, como ese endpoint reemplaza todos los campos, quedaron vacíos nombre, WhatsApp, horarios, redes, pasos de "Cómo comprar", link de seguimiento y checkout. Se restauraron con los valores públicos de producción (`storeMode` incluido) preservando el token del feed. Producción nunca se tocó: los PUT de prueba fueron todos contra `127.0.0.1:8787`. Lección para la próxima: los PUT de prueba van con el formulario completo.
- **Pendiente**: pegar la URL del feed en Commerce Manager (paso a paso en `RUNBOOK_PRODUCCION.md`) y validar 2-3 productos antes de marcar todo el catálogo.

## 2026-10-13 — Limpieza del soft 404 en Search Console: investigación y procedimiento

- **Pedido**: "revisá en Search Console qué URLs quedaron indexadas como válidas por el soft 404 y prepará la solicitud de reindexación/limpieza".
- **No hay conector de Google**: Search Console no se puede leer desde acá (ni con la API de URL Inspection, que necesita OAuth). La lista tiene que salir de la cuenta del dueño.
- **Lo que sí se verificó sobre producción** (deploy `22cb6e14`): los 404 son reales (path inexistente, id vacío y `/producto/<id desconocido>`) y traen `Cache-Control: public, max-age=0, must-revalidate`, así que el borde no tiene un 200 viejo guardado; el sitemap tiene 1388 URLs y **24 de 24 muestreadas responden 200**; `robots.txt` sigue con `Allow: /`, `Disallow: /admin` y el `Sitemap:`.
- **Dato que ahorra trabajo**: la lista de URLs muertas **no se puede derivar de D1**. `stats_events` guarda el `product_id` truncado a 64 chars (`slice(0, 64)`), así que los 28 candidatos con tráfico son **falsos positivos** (productos vivos con id más largo); verificar por prefijo con `LIKE` lo rechaza D1 (`pattern too complex`, 7500) y hay que usar `substr(p.id, 1, length(e.product_id)) = e.product_id`. Los pedidos tampoco sirven: 15 de 16 ids siguen vivos y el ausente es el ítem sintético `descuento-transferencia`. Los productos que la fuente deja de traer quedan `hidden` y siguen respondiendo 200 (13 hoy).
- **Entregable**: sección nueva en `RUNBOOK_PRODUCCION.md` con el procedimiento paso a paso en Search Console (mirar «Soft 404» en Páginas → «Validar corrección»; «Quitar temporalmente» para las que no deben seguir apareciendo; reenviar el sitemap; confirmar en Rendimiento), el handoff del export de «Páginas» para clasificar cada URL, y la alternativa de instrumentar los 404 en Workers Logs.

## 2026-10-13 — Commit, push y deploy de accesibilidad + 404 real

- **Commit `25eea58`** y push a `main` (`b78ab3f..25eea58`, exit 0): 6 archivos (+147/−12) — `admin/index.html`, `src/web/admin.ts`, `src/web/form-labels.ts` (nuevo), `src/web/styles.css`, `src/worker/index.ts` y `changelog.md`.
- **Deploy `202beb9f-2a26-48b5-b052-30b8c3a9b432`** (exit 0): 9 assets, bindings (KV/D1/ASSETS/EMAIL/vars) y cron `0 * * * *` intactos, startup 3 ms.
- **Verificado en producción**: `/no-existe-xyz` y `/producto/no-existe-zzz` responden **404** con la página de error (antes 200); `/producto/5469` 200 con las metas OG inyectadas; `/`, `/admin/`, `/sitemap.xml` y `/robots.txt` 200; `/seguimiento` 302; `/api/nope` 404 JSON. Se sirve el CSS nuevo (`/assets/whatsapp-Dpo2cG19.css`, con `min-height:24px`, `padding:3px 0`, `.sr-only`) y el bundle nuevo del panel (`/assets/admin-D7x4iBt9.js`, con el módulo de etiquetas y su `MutationObserver`), más el `<label class="sr-only" for="login-password">` en el HTML de `/admin/`.
- **En el navegador sobre `centerphone.com.ar`**: home a 373px y 1280px, ficha a 308px → **0 elementos interactivos por debajo de 24×24** en header, chips y footer, desborde 0, alto de barra intacto (58px a 1280, 50px a ≤480) y el carrito visible en 24×24. El login del panel se anuncia como `textbox "Contraseña"` en el árbol de accesibilidad. Queda el link "Inicio" del breadcrumb de la ficha (19px): fuera de lo pedido y cubierto por la excepción de espaciado de la SC 2.5.8.
- **Corrección después del deploy (commit `cb8fe84`, deploy `22cb6e14-7946-41a7-a213-d52f40f9f7d4`)**: el barrido de formas de URL mostró que `/producto/` y `/producto/%20` (id vacío) seguían devolviendo el **shell de la ficha con 200** — la guarda del id vacío cortaba antes de la página de error. Ahora caen por `notFoundPage()` como cualquier id inexistente; `!res.ok` (asset roto) sigue devolviendo la respuesta del asset, que es el único caso donde no hay template que servir.
- **Verificación final en producción** (17 URLs, con `Cache-Control: no-cache`): **404** en `/producto/`, `/producto/%20`, `/producto/no-existe-zzz`, `/no-existe-xyz`, `/a/b/c`, `/no-existe.jpg`, `/admin/no-existe`, `/categoria/inexistente` y `/wp-login.php`; **200** en `/`, `/admin/`, `/producto/5469`, `/sitemap.xml`, `/robots.txt` y `/api/catalog`; **302** en `/seguimiento`; **404 JSON** en `/api/nope`.
- **Nota**: como esta entrada registra el deploy, no está en el asset desplegado — llega con el próximo. Es el patrón que ya seguía este changelog.

## 2026-10-13 — Accesibilidad (área táctil y etiquetas del panel) y 404 real

- **Pedido**: "arreglá lo que quedó de la auditoría de accesibilidad: targets táctiles de al menos 24px en header, chips y footer, y labels asociados en los formularios del panel" + "corregí el soft 404 de producción". Todo medido en el navegador sobre el dev server (8787), no leído del CSS.
- **Área táctil del header (WCAG 2.2 SC 2.5.8), medido**: los accesos eran texto sin padding → "Cómo comprar" 44×**15**px y "Seguimiento" 40×**15**px a 327px (56×**17** a 600px), el carrito 24×**16** y el link al mapa del footer **19**px de alto. Fix (`src/web/styles.css`): `padding-top/bottom: 4px` + `min-height: 24px` en `.topnav a`, `.topnav-btn` y `.topbar-link`, y carrito con 24×24 centrado. Detalle que costó: la regla va **después** de `.topnav-btn { padding: 0 }` porque ese shorthand pisaba el padding, igual que `font: inherit` pisaba el `line-height`. **El alto de la barra no cambió** (58px a 600, 50px a ≤480), así que los `top: 57px/51px` de la toolbar siguen alineados. El botón "Consultar" de las tarjetas medía 22px → `inline-flex` + `min-height: 24px`; `.footer-link` pasa de 19 a 28px con `inline-block` + padding (con `inline-flex` el texto largo dejaría de cortar línea). Resultado: **0 elementos interactivos por debajo de 24×24** en home (327/600/1280px) y en la ficha (308/339/1164px), con desborde 0 y el carrito siempre visible.
- **Verificado en el panel logueado**: **0 controles sin nombre accesible** en las 11 pestañas y en los 5 formularios/modales abiertos de verdad (Producto 12 controles con 9 enlazados, Configuración 35 con 26, Auto-importación 5 con 3 —y con el label del select ya existente enlazado—, Escala de precios 5 con 1 + las filas que se agregan después también quedaron nombradas, Pedidos 17, Archivar 1). Sin sesión también se verificó el login: pasó de ser un campo sin nombre a `textbox "Contraseña"` en el árbol de accesibilidad.
- **Soft 404 → 404 real**: el fallback del worker devolvía el cuerpo de `public/404.html` con el 200 del asset, así que una URL inexistente (y cualquier `/producto/<id>` sin producto) respondía **200** con la página de error — Google lo indexa como página válida y los monitoreos lo cuentan como OK. Nuevo helper `notFoundPage()` en `src/worker/index.ts` que devuelve ese HTML con **status 404**, usado por el catch-all `*` y por `/producto/*` cuando el id no existe. Medido en local: `/no-existe-xyz` 404, `/producto/no-existe` 404, `/producto/6160` 200 (con las metas OG inyectadas intactas), `/pedido/xyz` 404, `/api/nope` 404 JSON, `/` y `/sitemap.xml` 200.
- **Chequeos**: `npm run typecheck` exit 0, `npm test` **353/353** exit 0, `npm run build` exit 0.
- **Nota de la verificación (estado local, no del código)**: para abrir el panel con sesión se sembró una contraseña temporal en el KV local y se borró al terminar; el hash de `admin:password` que hubiera ahí (había un `admin:session-secret`, del cambio de contraseña del panel) se perdió en el proceso, así que el login local vuelve al `ADMIN_PASSWORD` de `.dev.vars`. `.dev.vars` quedó byte a byte igual (sha256 verificado).
- **Chips: ya cumplían, no se tocaron.** Medidos en 29px (481-800px, donde el CSS los compacta) y 32-33px por encima y por debajo, en home a 327/600/1280px.
- **Etiquetas del panel**: las ~50 plantillas escriben `<div class="field"><label>Texto</label><input></div>` sin `for` ni `id`, así que la etiqueta no estaba asociada a nada: el lector de pantalla anunciaba el campo sin nombre y el clic en el texto no lo enfocaba. Nuevo `src/web/form-labels.ts` (enganchado una sola vez en `boot()` de `src/web/admin.ts`): asocia por DOM las etiquetas sueltas (`label:not([for])` → id `fl-<name>` + `htmlFor`), le da nombre a los campos que no tienen etiqueta visible (placeholder → `aria-label`) y un `MutationObserver` lo repite sobre lo que se pinte después (modales, filas nuevas de la escala de precios). Se evita la trampa de la fila peso/volumen: cada label mira primero su contenedor directo y recién después el `.field` completo. `aria-label` explícito en los controles que no tienen etiqueta visible (buscar productos, buscar pedidos, filtro del historial de sync, categoría a vaciar, regla de Tecnova, mapeo de categorías, pasos del modal Cómo comprar) y utilidad `.sr-only` + `<label>` para la contraseña del login.

## 2026-10-13 — Commit, push y deploy de los arreglos de diseño y contraste

- **Commit `497c6fe`** y push a `main` (`aca5976..497c6fe`, exit 0): 5 archivos (+90/−12) — `src/web/styles.css`, `src/web/cart-ui.ts`, `index.html`, `product.html` y `changelog.md`.
- **Deploy `21b35866-569a-4e2b-b5cb-095bccc14f20`** (exit 0): 9 assets (home, ficha, 404, panel, los 4 bundles nuevos y `/changelog.md`), bindings (KV/D1/ASSETS/EMAIL/vars) y cron `0 * * * *` intactos, startup 3 ms.
- **Verificado en producción**: `/`, `/admin/`, `/sitemap.xml` y `/robots.txt` en 200; el CSS servido (`/assets/whatsapp-Bs1zf4Xx.css`) trae `minmax(0,1fr)`, `.modal-body`, `--muted-2`, `min-width:70px` y `:not(.cart-btn)`, con **0 restos** de `#65676b` ni `#e7f6ee`. En el navegador sobre `centerphone.com.ar`: home a 373px y ficha a 339px con **desborde 0**, carrito visible de 24px, `← Volver` en 71px, grilla 349=349, **0 fallas de contraste**, el modal sin recortes con la ✕ fija y clickeable tras agregar 18 pasos, y el **beacon de Cloudflare sigue inyectado** (la analítica no se rompió).
- **Nota**: como esta entrada registra el deploy, no está en el asset desplegado — llega con el próximo. Es el patrón que ya seguía este changelog.

## 2026-10-13 — Auditoría de diseño y contraste: header móvil, grilla y modales

- **Pedido**: "audita el diseño y los contrastes. verificar tambien los modaels ques no se corten en escritorio ni movil". Todo medido en el navegador sobre el dev server (8787), no leído del CSS.
- **Bug real (rompía función): el header móvil desbordaba el viewport y dejaba el carrito fuera de pantalla.** Medido: 63px a 373px de ancho, 93px a ~360 y 126px en la ficha (`scrollWidth` 436 con viewport 373). `html { overflow-x: hidden }` lo venía recortando en silencio, así que el 🛒 y parte de "Seguimiento" no se veían ni se podían tocar en celulares.
- **Fix del header** (`src/web/styles.css`, en `@media (max-width: 640px)`): la marca y los textos ceden con "…", el carrito conserva 24px (y mejora su target, que era de 16px) y "← Volver" mantiene un mínimo de 70px. Detalle que costó encontrarlo: en la ficha esos botones son **hijos directos de `.topbar`**, no van dentro de `.topnav`, y el bloque `≤640` posterior pisaba las reglas del `≤480` por orden — se cubrieron las dos formas. Verificado: desborde **0** a 439 y 483px, y en la ficha a 483px.
- **Bug real (visual): las tarjetas se cortaban en móvil.** `.grid` usaba `repeat(2, 1fr)`: un `1fr` tiene **mínimo automático (min-content)** y el ancho intrínseco de las fotos inflaba la pista (grilla de 349px con 395px de contenido) → la segunda columna se salía del viewport. Fix: `repeat(2, minmax(0, 1fr))`. Verificado: contenido 395→349px, tarjeta 197→170px, cero desborde.
- **Contraste: 3 fallas AA que eran restos del tema claro.** `.cart-total-sub` ("Subtotal" con recargo MP) y `.transfer-done-sub` usaban `#65676b` = **3.06:1** → `var(--muted)` (5.2:1); `.cart-transfer-btn` ("Coordinar por transferencia") era `#059669` sobre `#e7f6ee` = **3.38:1** y el único botón claro del sitio → secundario del tema oscuro (`var(--brand)` sobre `var(--panel-2)` = 6.62:1); token nuevo `--muted-2: #8fa3b3` para el precio de lista tachado y el hint del bloque de descuento (4.31 → 6.65:1).
- **Modales: no se cortan en ningún ancho probado** (1280×800, 1164×727, 1024×600, y de 312 a 439px): `max-height: 85vh` + scroll interno, ✕ siempre en vista. **Pero** el ✕ era `position: absolute` dentro de la caja scrolleable y se iba con el contenido (medido: top `-2437px`, `elementFromPoint` = `null`): con 18 pasos de prueba o un carrito con varios ítems quedaba inalcanzable. Ahora el scroll vive en un `.modal-body` nuevo (`index.html`, `product.html`, `cart-ui.ts`), así que el título y el ✕ quedan fijos. Además **Escape ahora cierra el carrito**, como ya hacían los otros dos modales.
- **Extra encontrado**: el estado "📦 Calculando envío…" (`.ship-quote-toggle`) no tenía regla propia y caía en el **botón nativo del sistema operativo**, fuera del tema; se le dio estilo propio (es `disabled`, así que el contraste no aplica por WCAG 1.4.3).
- **Auditoría de contraste**: **0 fallas** en home y ficha (escritorio y móvil) y en el login del panel; peores pares legítimos 5.02-7.6. Aviso metodológico: el primer auditor daba 0 fallas **falsamente** (bug de alfa en el blend → ratio `NaN`, y `NaN < 4.5` es `false`); se corrigió y se auto-verificó con pares conocidos (blanco/negro = 21.00, `#777`/blanco = 4.48).
- **Queda sin tocar (reportado)**: targets < 24px (chips y links del header de 15-20px de alto, WCAG 2.2 2.5.8); los inputs del panel no tienen `label` asociado (solo placeholder); el panel **logueado** no se auditó (sí su login y el `.modal-card` real renderizado con la hoja compartida).
- **Verificado**: build ✅, typecheck ✅, **353/353 tests** ✅, más las mediciones en el navegador. Sin commit ni deploy (no pedidos).

## 2026-10-13 — Commit y deploy de la verificación de analítica y SEO

- **Commit `ced6811`** y push a `main` (`850b33e..ced6811`, exit 0), orden del usuario («deploy commits push»). Solo docs: `RUNBOOK_PRODUCCION.md` (+51) y `changelog.md` (+27).
- **Deploy `7a826464-a796-4241-bb9f-d02f59accbf7`** (exit 0): **1 solo asset** subido (`/changelog.md`, lo único que cambió), 16 assets leídos, bindings (KV/D1/ASSETS/EMAIL/vars) y cron `0 * * * *` intactos, startup 8 ms. El worker no cambia de código, así que el bundle es el mismo de `55252441`.
- **Verificado en producción**: `/api/admin/changelog` autenticado sirve 225.572 bytes y la **primera línea ya es** la entrada «Seguimiento de visitas y SEO…» (o sea: la pestaña «Cambios» del panel la muestra); `/`, `/admin/` y `/sitemap.xml` responden 200; la CSP sigue permitiendo `static.cloudflareinsights.com` y `cloudflareinsights.com`, así que el beacon de Cloudflare quedó intacto.
- **Nota**: esta misma entrada está en el repo pero no en el asset desplegado — llegará con el próximo deploy. Es el patrón que ya seguía el changelog (las entradas que registran un deploy se commitean después).

## 2026-10-13 — Seguimiento de visitas y SEO: la analítica de Cloudflare ya funcionaba (sin cambios de código)

- **Pedido del usuario**: "agregar seo tracking de google, o lo que sea necesario para poder hacer el seguimiento de las visitas". Decidido: **Cloudflare Web Analytics** (visitas) + **Google Search Console** (SEO, verificación por DNS).
- **Hallazgo principal: no había nada que activar.** Cloudflare Web Analytics **ya estaba funcionando** en la zona: el ajuste `/zones/{id}/settings/rum` en `on`, el sitio con `auto_install: true` (`site_tag 926401e3…`) y su ruleset habilitado (regla `host: "*"` / `paths: ["*"]`, `is_paused: false`), sin Configuration Rules que lo desactiven. Y hay **datos registrados desde antes** de tocar nada (GraphQL `rumPageloadEventsAdaptiveGroups` por `siteTag`): `2026-10-12T22:00Z` → 1 pageview en `/admin/`; `2026-10-13T15:00Z` → 5 en `/` y 1 en `/producto/6160`.
- **Error de diagnóstico, documentado a propósito**: un primer análisis con **`curl`** concluyó que "la inyección automática de Cloudflare no funciona" (ni con User-Agent de Chrome, ni en cache MISS, sin `no-transform` en Cache-Control). Era un **falso negativo**: Cloudflare inyecta el snippet **solo en requests de navegadores reales**. Verificado en un navegador sobre producción: en una carga limpia, el DOM ya trae `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v4bc70e2c…" data-cf-beacon='{"version":"2024.11.0","token":"4f2e896f…","r":1,"spa":2}'>` y el beacon postea a `/cdn-cgi/rum` → **204**. La trampa quedó escrita en el runbook para que nadie vuelva a diagnosticarlo con `curl`.
- **Se implementó y se revirtió** un Plan B (inyectar el beacon nosotros desde el worker, con el token configurable desde el panel: módulo `src/worker/analytics.ts`, campo en settings, campo en el panel y 10 tests). Se revirtió **completo** al comprobar que el RUM automático funciona: dejarlo habilitado habría producido **doble beacon y doble conteo** ("solo puede haber un snippet por página"). Verificado además que el `Content-Length` de `/` y `/producto/6160` coincide exacto con el cuerpo servido, así que no había bug latente que justificara conservar el reescritor.
- **RUM reiniciado y restaurado**: se probó apagar y prender el ajuste (`off` → `on`) buscando re-provisionar la inyección; el estado final quedó **idéntico al original** (RUM `on`, `site_tag`, `auto_install`, ruleset `enabled`). No hacía falta, pero no dejó cambios.
- **SEO técnico verificado en producción**: `/robots.txt` 200 (`Allow: /`, `Disallow: /admin`, `Sitemap:`); `/sitemap.xml` 200 `application/xml; charset=utf-8`, **XML válido y 1388 URLs únicas** (1365 productos + 22 categorías + home), sin duplicados, sin `/admin`, todas `https://centerphone.com.ar/` sin `www`; `/pedido/:id` inexistente → 404 con `robots: noindex`.
- **Hallazgo menor, no corregido**: `/admin/` no lleva `noindex` (sí está `Disallow`-eado, con `no-store`, fuera del sitemap y sin links). Agregarlo a `admin/index.html` sería el cierre prolijo; no se hizo para no meter alcance fuera de lo pedido.
- **Verificado**: typecheck ✅, **353/353 tests** ✅, build ✅ — el **baseline quedó intacto** después del revert (solo esta entrada de changelog en el árbol).
- **La verificación de Search Console tampoco faltaba**: el segundo supuesto del plan (que había que verificar la propiedad) también era falso. El apex `centerphone.com.ar` **ya tiene** el TXT `google-site-verification=TKs0MJu7LiYX8g4LF5gU6kYvJkQjavaSKXBfbIjefLU`, creado el **2026-08-20** (el mismo día que el sitio de Web Analytics) y **resolviendo públicamente** (comprobado con DNS-over-HTTPS el 2026-10-13). La propiedad de dominio ya quedó verificada en su momento. Lo único que queda es dentro de Google y no se puede automatizar (no hay conector de Google): **confirmar** en Search Console que la propiedad figura verificada, **enviar el sitemap** si no está enviado y mirar los informes.
- **Balance del pedido**: las **visitas** (Cloudflare Web Analytics + panel) y el **SEO de Google** (Search Console con la propiedad ya verificada + sitemap válido) **ya estaban operativos**; este trabajo no necesitó ni código ni deploy, y su valor real fue **verificarlo y documentarlo** — más corregir dos diagnósticos equivocados. Pasos y trampas en `RUNBOOK_PRODUCCION.md` → «Analítica y SEO».
- **Pendiente real, para el usuario**: entrar a Search Console (confirmar verificación + enviar el sitemap) y, si se quiere, la mejora menor de `/admin/` sin `noindex`. Nada más.

## 2026-10-13 — Prueba end-to-end del saneo contra el D1 de producción

- **Pedido del usuario**: correr contra el D1 de **producción** la prueba de punta a punta que había quedado pendiente —alta de un producto temporal con texto doble-codificado, verificación de la fila y borrado.
- **Autenticación**: la contraseña de admin de producción **no** es la de `.dev.vars` (con esa misma clave: login **local** 200 `{"ok":true}` y login **prod** 401). La KV de producción no tiene `admin:password` (solo 7 claves, ninguna de contraseña), así que la vigente es el **secret `ADMIN_PASSWORD`** del worker. Se usó la clave que pasó el usuario, con **un solo** intento por vez para no caer en el rate-limit de login (5 fallidos/min por IP).
- **La prueba**: `POST /api/admin/products` con `title` = `Bater\u00c3\u00ada de prueba \u00e2\u20ac\u201d E2E prod`, `description` = `Descripci\u00c3\u00b3n con emoji \u00f0\u0178\u201c\u00b1 y precio \u00e2\u201a\u00ac` y `brand` = `S\u00c3\u00a1msung`, en **`status: hidden` y `availability: out_of_stock`** a propósito, para que el producto temporal no pudiera asomar en la tienda ni entrara al snapshot público.
- **Resultado (HTTP 201)**: la **respuesta del panel** llegó reparada («Batería de prueba — E2E prod», «Descripción con emoji 📱 y precio €», «Sámsung»). La **fila cruda en D1** (leída con `wrangler d1 execute --remote`, sin pasar por el worker) quedó con el **hex idéntico** al UTF-8 esperado: `title` `4261746572C3AD61…E28094204532452070726F64`, `brand` `53C3A16D73756E67`, `description` `446573637269706369C3B36E…F09F93B1…E282AC`. `source_url` quedó en `null` (las claves de identidad no se tocan).
- **Limpieza**: `DELETE /api/admin/products/e2e-mojibake-2026-10-13` → 200; `SELECT COUNT(*)` por ese id = **0**; total de productos en D1 = 1378. Como el alta/baja deja `catalog:pending:v1` en `true`, se regeneró el snapshot (`POST /api/admin/snapshot`) y el catálogo volvió al estado previo: **1365 productos publicados, `pending:false`**. Verificación final de lectura en prod: `/` y `/admin/` 200, `/api/catalog` 569 KB con **1365 productos y 0 firmas de mojibake, 0 U+FFFD**. Temporales (`.tmp-e2e/`, cookie jar) borrados; el único cambio en el repo es esta entrada del changelog.
- **Hallazgo lateral**: en producción hay dos secrets **basura** cuyo **nombre es el token** (`cfut_18fsYDup…`, `cfut_i90j2RJl…`) — el quirk del `wrangler secret put` interactivo que ya documenta el runbook. Inofensivos (ningún código los lee), pero conviene borrarlos.
- **Límite**: **no** se cerró la sesión con `POST /api/admin/logout` a propósito: ese endpoint **revoca todas las sesiones activas** (fix M4), incluida la del usuario en su panel. Se borró el archivo de cookie —nadie retiene el token— y la sesión expira sola en ≤1 h.
- **El límite de la entrada anterior queda cerrado**: ver la entrada «Auditoría de codificación en KV y D1 + blindaje del texto que se escribe».

## 2026-10-13 — Auditoría de codificación en KV y D1 + blindaje del texto que se escribe

- **Pedido del usuario**: revisar todos los valores de KV (settings y cualquier otra clave) y los datos de D1 buscando texto doble-codificado, reparando lo que aparezca con el mismo criterio, y commitear/deployar el arreglo.
- **Alcance auditado**: las **9 claves del KV local** (`config:*`, `catalog:*`, `tecnova:mapping:v1`, `admin:*`) y las **7 de producción**, más las **7 tablas de D1** (`categories`, `products`, `sync_log`, `price_rules`, `auto_imports`, `orders`, `stats_events`) en local y producción: **31 volcados, 55.305 strings**, incluidos los 1365 productos del snapshot de producción (569 KB) y los 1221 productos locales.
- **Resultado: 0 hallazgos.** Ningún valor con mojibake, ningún U+FFFD (daño irreversible) y ningún control C1 (U+0080–U+009F). **No hubo datos que reparar** más allá de los 4 campos de settings ya corregidos (entrada anterior).
- **El audit corre con la implementación real**, no con una copia de la regla: se compiló `src/shared/encoding.ts` y se ejecutó con node sobre los volcados, así que es exactamente el `looksLikeMojibake`/`fixMojibake` que usa el worker. **El arnés se validó sembrando mojibake a propósito** en un volcado: detectó y reparó los 2 casos sembrados (incluido el guion invisible de «envÃo»), así que el «0 hallazgos» es un resultado y no un chequeo que no puede fallar.
- **Blindaje extendido a D1** (`src/worker/db.ts`): el texto que se **escribe** pasa por el mismo módulo — `title`, `description`, `imageUrl` y `brand` de cada producto (en el upsert individual y en el lote que viaja por `json_each`), el `name` de las categorías y el `label` de las auto-importaciones. Deliberadamente **no** se tocan `id`, `sourceUrl` ni `parentId`: son claves de identidad (`source_url` se compara literal en hide/unhide, y cambiarle un byte haría que un producto se vea como desaparecido). Se aplica al escribir y no al leer para no pagar el saneo de 1365 productos en la ruta caliente del catálogo.
- **Consistencia panel ↔ D1** (`src/worker/admin.ts`): `sanitizeProduct` y el alta/edición de categorías usan los mismos helpers exportados, así la respuesta del panel muestra lo que realmente quedó guardado (antes el upsert reparaba y la respuesta devolvía el texto roto).
- **Verificado de punta a punta en local** (panel → worker → D1): un `POST /api/admin/products` con `Bater\u00c3\u00ada de prueba \u00e2\u20ac\u201d 4000mAh` y marca `S\u00c3\u00a1msung` queda como «Batería de prueba — 4000mAh» y «Sámsung» **tanto en la respuesta del panel como en la fila de D1** (leída cruda con `wrangler d1 execute`, sin pasar por el worker); el producto de prueba se borró después (0 filas restantes).
- **Tests**: 4 nuevos en `src/worker/db-upsert.test.ts` (repara el lote, **no** toca `id`/`sourceUrl` aun con mojibake, deja intacto el texto sano y la marca nula, repara el nombre de categoría sin tocar `id`/`parentId`). **353/353** ✅, typecheck ✅, build ✅.
- **Commit `ff06796`** y **deploy `55252441-6df8-4b68-9298-3f3ed0fa2fc7`** (orden del usuario): 4 archivos (`7c0f18e..ff06796`), bindings (KV/D1/ASSETS/EMAIL/vars) y cron `0 * * * *` intactos, startup 4 ms. El bundle construido para este deploy contiene el saneo (`repararTextoProducto` ×5, que no estaba en los bundles anteriores), así que la versión activa es la de este commit.
- **Verificado en producción (solo lectura)**: `/`, `/admin/` y `/manifest.webmanifest` 200; `/api/public/settings` con 26 campos y **0 con mojibake**; `/api/catalog` con **1365 productos y 0** con mojibake en título/descripción/marca. El bundle del panel no cambia de hash (`admin-u2Sv5q79.js`) porque el cambio es del worker, no del frontend.
- **Límite**: la prueba de punta a punta del camino de escritura (crear un producto con texto roto y borrarlo) se hizo **solo en local**; no se crearon productos en el D1 de producción porque eso toca datos del catálogo real y no estaba autorizado. Lo verificado en prod es el deploy, las lecturas y el contenido del bundle. → **Cerrado ese mismo día**: ver la entrada «Prueba end-to-end del saneo contra el D1 de producción».

## 2026-10-13 — Horarios y textos del panel: reparado el mojibake y blindado el guardado

- **Pedido del usuario**: el dato de horarios guardado en KV mostraba «SÃ¡bados» en el sitio y en el JSON-LD; arreglar el valor y blindar el guardado del panel.
- **Diagnóstico**: en el KV **local** había mojibake en 4 campos (`storeHours`, `howSteps`, `howTitle`, `checkoutNote`); en **producción, 0** (verificado contra `/api/public/settings`: solo los horarios, «Cómo comprar» y la nota del carrito estaban afectados, los tres visibles al público). El origen no es el panel actual —ya manda `Content-Type: application/json` con UTF-8— sino el **round-trip manual del JSON de KV que documenta el runbook**: bajar el valor con un redirect del shell, editarlo y volver a subirlo hace que en Windows un paso por el codepage ANSI reinterpreta los bytes (0xC3 0xA1 → «Ã¡»).
- **Nuevo `src/shared/encoding.ts`** (puro, sin `TextDecoder` porque workerd no garantiza los decodificadores legacy): `looksLikeMojibake` (firma clásica por byte de inicio de UTF-8: 2 bytes «Â/Ã», 3 bytes «â€…», 4 bytes «ðŸ…»), `fixMojibake` (invierte latin-1 **y** cp1252 —0x80 → «€», 0x93 → «“»—, hasta 3 pasadas por la doble corrupción «ÃƒÂ¡», y solo devuelve algo si la decodificación UTF-8 es estricta: sin secuencias truncadas, sobrecargadas ni surrogates) y `repairTextFields` (repara los strings de un objeto plano sin mutarlo).
- **Blindaje** (`src/worker/settings.ts`): `normalizeSettings` pasa los settings por `repairTextFields`, así que **la lectura y el guardado quedan cubiertos** — el sitio y el JSON-LD se ven bien al instante y el próximo guardado del panel persiste el texto corregido. Es en memoria: **no agrega escrituras a KV por request** (regla del free tier).
- **Panel** (`src/web/admin.ts`): el helper `api()` manda `application/json; charset=utf-8` explícito, sin depender del default del navegador.
- **Dato reparado**: se persistió el valor corregido en el KV local por el mismo camino del panel (GET + PUT autenticados). Verificado leyendo la KV **cruda**, sin pasar por el worker (`wrangler kv key get config:settings:v1 --local --text`): `storeHours` = «Sábados», `howTitle` = «Cómo comprar», `checkoutNote`/`howSteps` con tildes y **0 campos con mojibake de 31**.
- **Verificado en el sitio** (wrangler dev 8787 + navegador): footer «Sábados: 10:00 a 13:00 hs», `openingHours` del JSON-LD limpio, modal «Cómo comprar» con «Explorá/Buscá/filtrá/categoría» y la nota del carrito «Coordinamos envío o retiro… después del pago», sin «Ã» en ninguna vista.
- **Runbook** (`RUNBOOK_PRODUCCION.md`): el procedimiento manual de KV ahora usa `--text` al bajar, pide verificar el archivo antes de subirlo (comando `python` listo, probado contra un archivo roto y uno sano), avisa de `>`/`Out-File`/`Set-Content`/Notepad-ANSI y aclara que el worker repara al leer pero que el valor en KV queda sucio hasta la siguiente escritura.
- **Tests**: `src/shared/encoding.test.ts` (12: los valores reales del KV, cp1252 fuera de latin-1, emoji, saltos de línea, doble corrupción, texto sano intacto, secuencias truncadas, `repairTextFields` sin mutar). **349/349** ✅, typecheck ✅, build ✅.
- **Commit `af41c8d`** y **deploy `d06d804f-7cda-4756-a872-ff5d23682f47`** (orden del usuario): 6 archivos (`dbff2ca..af41c8d`), cron `0 * * * *` y bindings (KV/D1/ASSETS/EMAIL/vars) intactos, startup 5 ms.
- **Verificado en producción**: `/api/public/settings` con 26 campos y **0 con mojibake** (`storeHours` = «Sábados», `howTitle` = «Cómo comprar»); `/admin/` sirviendo el bundle nuevo (`admin-u2Sv5q79.js`, que ya manda `charset=utf-8`); `/`, `/manifest.webmanifest` y `/logo.jpg` 200; en el navegador la home muestra el footer con «Sábados» y el `openingHours` del JSON-LD limpio.
- **Ojo con el primer request post-deploy**: la descarga inicial de `/admin/` todavía devolvió el hash viejo (`admin-DEvA-Rpv.js`) — propagación de borde, no un asset sin subir: el hash nuevo ya estaba 200 y el segundo request ya referenciaba el nuevo. No hace falta redeploy.
- **Límite**: el blindaje no es observable en prod porque los datos de allá ya estaban sanos (el arreglo de datos fue del KV local); el deploy deja la reparación activa para cualquier valor sucio futuro, incluidos los campos que el endpoint público no expone.

## 2026-10-13 — Visibilidad para compartir (OG por producto), cinta de anuncio y SEO local

- **Pedido del usuario** (tres líneas elegidas en el plan aprobado): al compartir una ficha por WhatsApp/redes se veía el título genérico del sitio; dar un espacio de promo configurable desde el panel; y que Google tenga los datos del local y del buscador.
- **OG dinámicas de la ficha** (`src/worker/og.ts` nuevo + `src/worker/index.ts`): `GET /producto/*` ahora **inyecta el bloque `<!--OG:START-->…<!--OG:END-->` del template con los datos reales del producto** leídos de D1 (`og:title`, `og:description` con disponibilidad + precio, `og:image` de la foto, `og:url`/`canonical` con el id, `twitter:*` con `summary_large_image`). Se hace server-side porque **los scrapers de WhatsApp/Facebook/Instagram no ejecutan JS**. Si el id no existe o el asset falla, queda el bloque genérico del template (sin romper la ficha).
- **Cinta de anuncio configurable** (`src/web/announcement.ts` nuevo + `announcementBar` en `src/shared/types.ts`, `src/worker/admin.ts`, `src/web/types-web.ts`, `src/web/admin.ts`): campo de 120 caracteres en **Configuración › Cinta de anuncio** y barra `.announce` arriba del topbar en el catálogo y en la ficha. **Texto vacío = no se renderiza** y si se vacía desde el panel la cinta se quita al recargar. El texto se escapa siempre (lo escribe el dueño, pero igual va por `esc()`).
- **SEO** (`src/web/schema.ts`, `index.html`, `product.html`, `site.webmanifest` nuevo, `tools/build-web.js`): JSON-LD **`Store`** (nombre, teléfono, dirección, horarios, mapa y `sameAs` de IG/Facebook tomados del panel, omitiendo campos vacíos) y **`WebSite` con `SearchAction`** apuntando a un `?q=` real; `manifest.webmanifest` + `theme-color` (Android abre con el logo y el color del sitio) recopiados en cada build porque vite limpia `public/`.
- **Buscador por URL** (`src/web/catalog.ts`): `?q=…` precarga el buscador y filtra (lo usa el `SearchAction` de Google y sirve para compartir una búsqueda por WhatsApp).
- **Fix del pendiente documentado (2026-10-09)**: `catalog.ts` terminaba en `void init()` y su bundle también se carga en la ficha (`product.ts` importa `isFresh`/`cdnSrcset`), donde no existe `#content` → `TypeError: Cannot set properties of null (setting 'innerHTML')` en cada vista de ficha. Ahora `if (document.getElementById("content")) void init();`. Verificado: la excepción ya no aparece en consola en `/producto/6160`.
- **Tests nuevos**: `src/worker/og.test.ts` (escapes, precio/disponibilidad, imagen de respaldo, URL canónica) y `src/web/announcement.test.ts` (vacío/null/undefined, escape de HTML, texto recortado).
- **Verificado en local** (wrangler dev 8787 + navegador): `curl /producto/6160` devuelve `og:title` con el nombre real, `og:description` con `En stock · $3.360` y la foto del producto; `/producto/no-existe-xyz` cae al bloque genérico; `/manifest.webmanifest` responde 200 `application/manifest+json`; en el navegador la cinta se ve arriba del topbar con el texto configurado, el home expone los nodos `Store` (teléfono, dirección, horarios, mapa, 2 `sameAs`) y `WebSite` con el `target` del buscador, `?q=cable` precarga el buscador y filtra a 182 resultados, y la ficha muestra `Product` + `BreadcrumbList` + el `canonical`.
- **Datos de prueba restaurados**: la cinta se probó con un texto de demo y se volvió a dejar vacía en el KV local (el resto de los settings quedó idéntico al original).
- **Commit `9e40a7e`** y **deploy `e84a2bc0-6b7e-4580-ada6-59bfea6211ad`** (orden del usuario): 18 archivos (`0caa804..9e40a7e`), 10 assets subidos, **cron `0 * * * *` y bindings (KV/D1/ASSETS/EMAIL) intactos**, startup 3 ms.
- **Verificado en producción** (centerphone.com.ar): `/producto/6160` devuelve `og:title` con el nombre real, `og:description` con `En stock · $3.600` (precio de prod) y la foto del producto; `/producto/no-existe-xyz` cae al bloque genérico; `/manifest.webmanifest` 200 `application/manifest+json`; `/`, `/admin/`, `/logo.jpg` y `/favicon.png` 200. En el navegador: home con los nodos `Store` (teléfono, «Mendoza 2974 · Santa Fe», horarios **con «Sábados» correcto** — el mojibake es solo del KV local, mapa y 2 `sameAs`) y `WebSite` con el `target` del buscador, `?q=cable` filtra a 184 resultados, y **consola sin errores** en home y ficha (el `TypeError` del chunk compartido ya no aparece). La cinta no se ve en prod porque el KV de producción no tiene texto configurado: se activa cargándolo desde el panel.
- **Hallazgo preexistente, no tocado**: `storeHours` en el KV local guarda «SÃ¡bados» (UTF-8 interpretado como latin-1) — se ve igual en el footer y ahora también en el `openingHours` del JSON-LD; es dato viejo del KV, no de este cambio. → **Arreglado ese mismo día**: ver la entrada «Horarios y textos del panel: reparado el mojibake y blindado el guardado».

## 2026-10-13 — Panel: botón «🌐 Ver sitio» en el topbar

- **Pedido del usuario**: un link o botón en la parte superior del panel que lleve a la página principal / catálogo.
- **`admin/index.html`**: en el `<header class="topbar">`, entre el brand y «Salir», nuevo
  `<a class="btn btn-ghost topbar-site" href="/" target="_blank" rel="noopener">🌐 Ver sitio</a>` —
  reutiliza `.btn .btn-ghost` (mismo estilo que «Salir») y abre el catálogo en otra pestaña para no perder la sesión del panel.
- **`src/web/styles.css`**: `.topbar-site { margin-left: auto }` («Ver sitio» y «Salir» quedan alineados a la derecha,
  el brand a la izquierda) y ajuste mobile ≤480px (`.topbar .topbar-site { padding: 7px 10px; font-size: 12px }`).
- Verificado en local (wrangler dev 8787): desktop y 390px — los dos botones a la derecha del topbar, sin desborde
  horizontal, `href="/"` con `target="_blank"` y la regla mobile aplicada. Typecheck ✅, **327/327 tests** ✅, build ✅.
- **Commit `d129a0a`** y **deploy `e08b5021-b259-4601-a572-5af6bf8894f4`** (orden del usuario): worker + assets en producción, cron `0 * * * *` intacto. Verificado en centerphone.com.ar: `/admin/` responde 200 con el link `topbar-site` («🌐 Ver sitio») y la home 200.

## 2026-10-10 — Cotizador de envíos con Andreani (solo informativo)

- **Pedido del usuario**: calcular el costo de envío con la API de Andreani. Decisión: el precio es **solo informativo** — no entra al total de MercadoPago ni de transferencia; el cierre sigue por WhatsApp como hoy.
- **API Andreani** (verificado contra el SDK REST público y developers.andreani.com): login `GET /login` con Basic Auth → token en header `x-authorization-token`; cotización `GET /v1/tarifas?cpDestino=…&contrato=…&cliente=…&bultos[0][kilos]=…&bultos[0][volumen]=…&bultos[0][valorDeclarado]=…`. QA `apisqa.andreani.com`, prod `apis.andreani.com`. Requiere contrato + credenciales que entrega el agente (apis@andreani.com).
- **Nuevo `src/worker/andreani.ts`**: `andreaniLogin` (Basic Auth, token cacheado por isolate con TTL 25 min y re-login automático en 401, sin escribir KV), `andreaniQuote` (mapa defensivo de `tarifa` → centavos y `peso_aforado`) y `armarBulto` (suma kg/cm³ por cantidad y usa el precio del carrito como valor declarado).
- **Nuevo `GET /api/shipping/quote`** (`src/worker/index.ts`): recibe solo `cp` + `items=id:qty,…`; revalida el carrito contra D1 con `validateCart` (misma regla anti-fraude del checkout), rate-limit 20/min por IP y gating triple (toggle del panel + secrets `ANDREANI_USER/ANDREANI_PASSWORD` + contrato/cliente cargados; sin nada de eso responde `disabled:true`).
- **Settings** (`src/shared/types.ts`, `src/worker/admin.ts`, panel `src/web/admin.ts`): `shippingAndreaniEnabled/Contrato/Cliente`, `shippingPostalCode` (CP del local), `shippingPackageKilos/Volumen` (por unidad). Nueva sección «📦 Envíos (Andreani)» en Configuración; credenciales solo como secrets (`.dev.vars` local / `wrangler secret put` en prod).
- **Frontend** (`src/web/shipping-quote.ts` nuevo): bloque «📦 Calculá tu envío» con input de CP (persistido en localStorage `center_shipping_cp`, re-cotiza al cambiar el carrito) en el carrito (`cart-ui.ts`) y bajo el precio de la ficha (`product.ts`). Estados: form / loading / cotizado / error visible; el bloque se autodescarta (no se renderiza) si el worker responde `disabled`.
- **Tests**: `src/worker/andreani.test.ts` (8: armarBulto, mapeo tarifa/peso, URL con bultos anidados, reintentos por 401, credenciales faltantes) y `src/web/shipping-quote.test.ts` (13: CP, estados HTML, fetchQuote). **327/327** ✅, typecheck ✅, build ✅.
- **Verificado en local** (wrangler dev 8787 + navegador): ficha muestra el bloque con el calc; sin credenciales configura el 401 real de Andreani como error visible y sin secrets el worker responde `disabled` y el bloque no se muestra — el cotizador queda apagado hasta cargar contrato + credenciales. Sin deploy ni commit todavía.

## 2026-10-09 — Descuento por transferencia resaltado: banner en el carrito y línea en la ficha

- **Feedback del usuario** (anotado en la ficha de producción): el «10% de descuento» del carrito era un párrafo verde de 13px que no llamaba la atención.
- **Nuevo `src/web/transfer-banner.ts`** (módulo puro sin DOM, testable en node): `discountPercentFrom` (clamp 0-50, igual que el worker), `discountCentsFor` (`Math.round` sobre el total, **misma fórmula que `finalizeOrder`** para que el número del banner coincida con el congelado en el pedido), `cartTransferBanner` (HTML del banner) y `productTransferLine` (línea compacta de la ficha).
- **Carrito** (`src/web/cart-ui.ts`): el párrafo «Pagando por transferencia tenés N% de descuento» pasa a ser un bloque con pastilla «-N%», «Por transferencia», precio de lista tachado, total final en grande y «Ahorrás $X pagando por transferencia». Sin cambios de lógica: sigue apareciendo solo con descuento > 0 y el botón «Coordinar por transferencia» no se toca.
- **Ficha de producto** (`src/web/product.ts`): debajo del precio aparece «Por transferencia: $final $lista(tachado)» con pastilla «-N%», solo en modo tienda (`sellsOnline`) y con descuento > 0 — antes el descuento no se veía en ningún lado hasta abrir el carrito.
- **Estilos** (`src/web/styles.css`): `.cart-transfer` pasa a bloque con fondo `--term-green-soft` y borde `--brand`, pastilla verde con texto oscuro, tachado muted y total 19px bold; `.price-transfer` compacto para la ficha; ajuste ≤480px para el modal a pantalla completa.
- **Tests**: `src/web/transfer-banner.test.ts` (clamp, redondeo igual al worker, HTML con/sin descuento, montos) — **9 nuevos, 306/306** ✅, typecheck ✅, build ✅.
- Verificado en local (wrangler dev en 127.0.0.1:8788, el 8787 tenía un listener colgado): ficha con `-10% Por transferencia: $3.024 $3.360` (pill, tachado y verde aplicados), carrito con el banner completo (pastilla -10%, $3.360 tachado, $3.024 en grande, Ahorrás $336 y botón «Coordinar por transferencia» visible) y a 390px sin desborde (pill 15px / total 17px).
- **Commit `86e2133`** (orden del usuario): los 6 archivos del banner en `main`.
- **Deploy `cd27ba9b-cd07-4bf1-81f5-3d1539d46daf`** (2026-10-09 23:15 UTC, orden del usuario): worker + assets en producción, cron `0 * * * *` y bindings intactos. Verificado en centerphone.com.ar: los assets servidos (`catalog-DLUHgn2O.js` y `whatsapp-CTNKh7ji.css`, byte a byte iguales a los locales) traen las clases nuevas; en la ficha de `tecnova-147` se ve `-10% Por transferencia: $40.500 $45.000` (estilos aplicados) y el carrito muestra el banner completo con «Ahorrás $4.500» y el botón «Coordinar por transferencia».
- **Hallazgo preexistente** (verificado también en prod con el deploy anterior, no introducido por este cambio): la ficha tira en consola `TypeError … setting 'innerHTML'` del chunk compartido `catalog-*.js` — `product.ts` importa de `catalog.ts`, que ejecuta `void init()` al cargarse y su `#content` no existe en esa página. Queda pendiente un guard de una línea.

## 2026-10-09 — Tecnova: la categoría propia «VARIOS» se unifica en la raíz «Varios»

- **Cambio**: `DEFAULT_TECNOVA_CATEGORY_MAP` mapea `VARIOS` → `varios` (antes → `hogar`) en `src/shared/tecnova.ts`. Los 16 productos que Tecnova publica bajo su categoría propia «VARIOS» dejan de quedar perdidos en «Hogar» y pasan a la raíz **«Varios»**, junto a los que venían sin categoría (`""` → `varios`).
- **Ojo con el KV**: el mapping guardado en producción pisa al default, así que el snapshot del KV (`tecnova:mapping:v1`) se actualizó a `VARIOS: "varios"` en el mismo deploy; sin eso el cambio no habría tenido efecto en prod (el local tiene `targets: {}` y toma el default directo).
- **Verificado en local** (corrida real del job): **369 importados**, único salteado `«VARIOS»: precio inválido` (id 289, precio 0), y el reparto de Tecnova pasó de hogar 40 / varios 6 a **hogar 24 / varios 22** (electronica 245 / computacion 78 sin cambios) — es decir, los 16 migrados. Typecheck ✅, **297/297 tests** ✅ (1 nuevo), build ✅.
- **Commit `83ee674`** (orden del usuario): las dos tareas de Tecnova en un solo commit en `main` (fuente exclusiva por API + raíz «Varios»), con el changelog al día.
- **Deploy `8f06fb42`** (2026-10-09 17:31 UTC, orden del usuario): worker + assets en producción, cron `0 * * * *` y bindings sin cambios. Para poder verificar la corrida sin esperar 3,5 h se atrasó `last_run_at` del job de Tecnova a −25 h en la D1 de prod (un solo timestamp) para que el tick de las 18:00 UTC lo recuperara por la ventana de atraso de 24 h.
- **Verificado en producción** (corrida del cron 18:01 UTC / 15:01 AR): `sync_log` con `trigger=cron, status=ok, 369 importados` y el aviso `«VARIOS»: precio inválido` como único salteado; raíz `varios`/`Varios` **dada de alta** (activa, sin padre); reparto prod hogar 40 → **24** y varios 0 → **22**; `/api/catalog` público con la categoría `varios:Varios` y sus 22 productos (parlante TYG, luz LED, puntero Logitech, etc.).

## 2026-10-09 — Tecnova: los productos sin categoría ya no se saltean (raíz «Varios»)

- **Síntoma**: la auto-importación de Tecnova se saltaba siempre 7 productos y avisaba «7 productos de Tecnova se saltaron (categoría sin mapear o precio inválido)».
- **Causa**: esos 7 vienen con `categories: []` (lista vacía) en la API de Tecnova; `tecnovaCatKey("")` da la clave `""`, que no existía en `DEFAULT_TECNOVA_CATEGORY_MAP`, así que `rootId = ""` y la ficha se descartaba. No era una categoría desconocida: no traía ninguna. El id 289 «VARIOS» además tiene precio 0 (queda fuera, decisión del usuario).
- **Fix**: `DEFAULT_TECNOVA_CATEGORY_MAP` gana la entrada `"": "varios"` → raíz nueva **«Varios»** (editable desde el mapping del panel) en `src/shared/tecnova.ts`.
- **Fix**: `readTecnovaMapping` ahora mergea `defaults ∪ guardado` (lo guardado pisa al default) en `src/worker/tecnova.ts`. Sin el merge `ensureTecnovaCategories` no veía la clave nueva —el KV de producción guarda un snapshot de las 18 claves viejas y el local tenía `targets: {}`— y con el KV vacío el preview no mostraba ninguna fila para mapear. Un `"` explícito elegido en el panel sigue saltando la categoría.
- **Aviso**: `fetchJobItems` lleva al historial el motivo real de cada salteo (título + causa, hasta 4) en vez del conteo genérico.
- **Verificado en local**: corrida real del job → **369 importados** (363 + 6) y `"VARIOS": precio inválido, se salta` como único salteado; D1 con la raíz `varios`/`Varios` activa y los 6 productos en ella (parlante TYG, pack de planchas, mouse, auriculares, cargador iPhone, linterna); snapshot público con la categoría y los 6 productos. Reparto: electronica 245 / computacion 78 / hogar 40 / varios 6. Tests **296/296** ✅ (7 nuevos en `tecnova-mapping.test.ts` + 2 en `tecnova.test.ts`), typecheck ✅, build ✅. Sin deploy.
- **Sin cambios de esquema y sin tocar KV**: la raíz la da de alta el propio worker en la próxima corrida (también en producción).

## 2026-10-09 — Auto-importación de Tecnova: fuente exclusiva por API (la URL nunca se pudo leer)

- **Síntoma**: la auto-importación de `https://www.tecnova.com.ar/` fallaba siempre («El HTML era una categoría sin fichas extraíbles; No parece una tienda Shopify accesible…») y el job quedaba en error en el cron.
- **Causa**: la web de Tecnova es una SPA de ~2,7 KB: el HTML solo trae JSON-LD de `Organization`/`WebSite`, sin productos, así que `extractFromUrl` (JSON → TiendaNegocio → JSON-LD → Shopify) no encontraba nada. El importador oficial (API Supabase) solo existía como botón manual en la pestaña Importar.
- **Worker**: nuevo `fetchJobItems()` en `src/worker/autoimport.ts`; si la URL es de `tecnova.com.ar` (con o sin www, más subdominios) la ejecuta contra la API oficial en vez del importador genérico: `fetchTecnovaItems` → `tecnovaItemsToInternal` (mapping del KV o defaults) → `ensureTecnovaCategories` → `importItems` con `source_url` `https://tecnova.com.ar/` (igual que el import manual: mismo badge y mismo ocultado automático). Los productos saltados (categoría sin mapear o precio inválido) viajan como aviso al historial.
- **Nuevo `src/shared/tecnova-url.ts`**: `isTecnovaSourceUrl()`, `TECNOVA_PUBLIC_URL` y `TECNOVA_SOURCE_URL` en un módulo chico sin dependencias, para que la SPA del panel no se lleve puesto el importador de la API (`shared/tecnova.ts` los re-exporta).
- **D1 (límite del free tier)**: `upsertProductsBatch` manda las filas dentro de UN bind (JSON) y las expande con `json_each(?1) … WHERE true ON CONFLICT` — 50 filas por statement en vez de 7 (tope anterior por los 13 binds/fila). 370 productos pasan de **53 a 8 statements**: antes la corrida completa de Tecnova se pasaba de las **50 queries por invocación** que permite el plan gratis. El `WHERE true` no es decorativo: sin WHERE, SQLite confunde `ON CONFLICT` con el `ON` de un JOIN. El fallback producto por producto queda intacto si el chunk falla.
- **Panel**: campo **Fuente** en el formulario de auto-importación (`🔗 Link de catálogo` / `🛰️ Tecnova — catálogo completo (API oficial)`); con Tecnova la URL se fija en `https://www.tecnova.com.ar/` en solo lectura con su explicativo. Badge 🛰️ Tecnova en la fila del job, mención en el texto de la pestaña y botón **⏰ Programar actualización** junto a «Importar de Tecnova» en la pestaña Importar (salta a Auto-importaciones con la fuente ya elegida).
- **Deploy `90ed5e3d-1d73-4559-8d11-8e70914d60a9`** (2026-10-09 15:54 UTC, orden del usuario): worker + assets en producción, cron `0 * * * *` intacto y bindings sin cambios. El panel sirve `assets/admin-b1ovd42X.js` (verificado en centrophone.com.ar: contiene el campo Fuente, el atajo ⏰ y el texto de Tecnova); home y `/admin/` responden 200. Sin migración de esquema. Los cambios siguen sin commitear (no se pidió commit); esta línea del changelog entra en el próximo build.
- **Verificado en local** (wrangler dev + D1 local): el job que venía fallando importó **363 productos en 8,4 s** con `POST /sync` (7 saltados), segunda corrida idempotente (363) y el cron (`/cdn-cgi/local/scheduled`, con la ventana de atraso de 24 h) escribió `trigger=cron, status=ok, 363`. Con un log temporal en el fallback: **0** llamadas al upsert por producto → se usó el statement JSON. UI probada en navegador (Fuente→Tecnova bloquea la URL, guardado desde el modal, badge en la lista y atajo ⏰). Sin migración de esquema: los jobs existentes con esa URL empiezan a funcionar solos. Tests 287/287 ✅, typecheck ✅, build ✅.

## 2026-10-08 — Panel: botones de la tabla de Productos compactos en mobile

- En pantallas angostas (≤640px) los botones Editar/Borrar de la tabla pasan a padding 5px 8px y 12px (antes 9px 16px y 13px), y las celdas reducen su padding a 8px 6px.
- Medido a 390px: botón 81→61px, celda Acciones 185→146px, scroll horizontal total de la tabla 720→681px (vs 788px original sin compactar nada). En desktop (1000px) no cambia nada.
- Typecheck ✅, build ✅.

## 2026-10-08 — Panel: columna Origen compacta en mobile

- En pantallas angostas (≤640px) el badge de origen de la lista de Productos muestra solo el ícono (🛰️ / ✍️) y esconde el nombre (`.badge-src-name { display:none }`); el nombre completo queda en el tooltip.
- Antes el badge forzaba 129px de columna y "se comía" medio viewport en un teléfono; ahora son 30px y el scroll horizontal de la tabla bajó de 788 a 720px a 390px de ancho. En desktop no cambia nada (nombre visible, verificado a 1000px).
- Verificado en navegador local a 390px y 1000px. Typecheck ✅, build ✅.

- **Deploy `efc3aa7a`** (commit `38acb7c`): columna Origen en producción. El panel sirve `assets/admin-CHa7Jm11.js`, que contiene el encabezado «Título / Origen / Precio» y la lógica del badge (✍️ Manual, «Importado de …»); el CSS servido trae `.badge--src` con `white-space:nowrap`.

## 2026-10-08 — Panel: la insignia de origen pasa a una columna propia

- En la lista de Productos, la insignia de origen deja de estar pegada al título y ocupa una columna nueva «Origen» (entre Título y Precio), así no interrumpe el nombre del producto.
- Filas y encabezado alineados (Título · Origen · Precio · Categoría · Estado · Tags); el badge no corta línea (`white-space: nowrap`) y un reemplazo intermedio había dejado la celda de Tags fuera de la fila: corregido.
- Verificado en navegador local: 50 badges en su columna, búsqueda por código OK (badge en columna 3, no dentro del título), typecheck ✅ y build ✅.

## 2026-10-08 — Panel: filtro por origen en Productos

- Nueva fila de chips «Origen:» sobre la tabla: **Todos / 🛰️ Tecnova / 🛰️ Hacetupedido / ✍️ Manuales**, con la cantidad de productos de cada uno (una query SUM en vez de traer filas).
- El filtro se aplica en SQL (`source_url LIKE '%dominio%'`, o `IS NULL` para manuales) combinable con la búsqueda por texto y los chips de estado; reinicia la paginación al cambiarlo.
- Backend: `GET /api/admin/products?src=` con whitelist (tecnova/hacetupedido/manual), `ProductPageFilter.src` y `countProductsBySource()` en db.ts.
- Verificado en local con datos de prueba de los tres orígenes: cada chip filtra y queda marcado, los conteos coinciden con D1 (1 Tecnova / 836 Hacetupedido / 1 manual). Limpieza hecha. Tests 281/281 ✅, typecheck ✅, build ✅.

## 2026-10-08 — Panel: insignia de origen en la lista de Productos

- **Deploy `9d25cba9`** (commit `8ad2d92`): insignias de origen en producción. Panel sirve `admin-B_EUah_k.js` (hash idéntico al local, con `sourceBadge` dentro) y el CSS con `.badge--src`.

- Cada fila de la lista muestra de dónde salió el producto: **🛰️ Tecnova** (azul), **🛰️ Hacetupedido** (verde), **🛰️ TiendaNegocio** (ámbar), **✍️ Manual** (gris, alta a mano) o el dominio para otras fuentes. Usa `source_url`, con tooltip «Importado de …».
- Estilos nuevos `.badge--src*` en styles.css (compactos, 10px, junto al título).
- Verificado en local con los tres casos: producto de alta manual, uno de hacetupedido y uno con source_url de Tecnova. Limpieza hecha, sin datos de prueba.

## 2026-10-08 — Fix: los productos Tecnova aparecían «Sin stock» (ocultado por chunks)

- **Síntoma**: tras importar el catálogo completo de Tecnova, solo 11 productos quedaban visibles y el resto mostraba «Sin stock» / desaparecía del catálogo.
- **Causa**: el ocultado automático de `importItems` compara contra los ids del lote actual. Con el importador por chunks de 50, el ÚLTIMO chunk solo traía 11 ids, así que `hideProductsNotIn` ocultó los otros 350 productos que sí habían venido en los chunks anteriores (quedaron `status=hidden` = «Sin stock» en la ficha). El bug afectaba también al importador por URL con selecciones de más de 50 items.
- **Fix**: `importItems` acepta `skipHide` (chunks intermedios no ocultan) y `hideKeepIds` (el último chunk oculta contra la lista COMPLETA de ids de la fuente). El endpoint de Tecnova manda la lista completa de importables en el último chunk.
- **Reparación de datos**: UPDATE directo en D1 de producción reactivó los 350 ocultos (361 published, 0 hidden). Pendiente «Publicar catálogo» o el próximo sync para regenerar el snapshot.
- Verificado en local: importación completa de 8 chunks → 361 published, 0 deactivated; snapshot con 361 tecnova (344 in_stock, 17 preorder). Tests 281/281 ✅, typecheck ✅, build ✅.

## 2026-10-08 — Reglas: escalas (grupos) como unidad principal

- **Deploy `8f608c1d`** (commit `af73d49`): escalas en producción. El panel sirve `admin-BLm6-zBE.js` (mismo hash que el build local) y el asset contiene los marcadores del editor de escalas («Nueva escala (grupo)», vista de «Reglas sueltas (fuera de escala)»).

- **Selector de regla en Importar** (URL y Tecnova): primero los **grupos/escalas** (🗂️ con detalle de rangos, ej: «Prueba 40-30-20 (3 rangos: +50% · +40% · +30%)») y aparte, en un `optgroup`, las reglas sueltas. Así cada fuente usa su propia escala.
- **Pestaña Reglas rediseñada**: las reglas con grupo se muestran agrupadas en tarjetas por escala (rangos ordenados por precio mínimo, con «Editar escala» y «Borrar escala» que borra todo el grupo), y las reglas sin grupo en su propia tabla. Botones: «+ Nueva escala (grupo)» y «+ Regla suelta».
- **Nuevo editor de escala**: modal con filas dinámicas (mín / máx / recargo / nombre) — se crea o edita toda la escala de una vez. Al editar, borra los rangos viejos del grupo y crea los nuevos (la API no tiene PUT de grupo). Prioridad automática = orden de las filas.
- Verificado en local: creada una escala de prueba 50/40/30 con 3 rangos, apareció agrupada en Reglas y como opción 🗂️ en el selector del importador de Tecnova; después borrada sin dejar residuos. Tests 281/281 ✅, typecheck ✅, build ✅.

## 2026-10-08 — Importador de Tecnova: catálogo completo desde su API pública

- **Deploy `6d26c73c`** (commit `978eedf`): importador de Tecnova en producción. El panel sirve el asset `admin-C8pr9gap.js` (mismo hash que el build local con el botón) y `POST /api/admin/import/tecnova/preview` responde 401 sin sesión (montado y protegido). Verificación del flujo completo con login quedará en la primera importación real del admin.

- **Fuente**: la web de tecnova.com.ar es una SPA, pero su bundle expone la API REST de Supabase que alimenta el sitio (`jimqifdqqgthrwzjiyfr.supabase.co/rest/v1/products`, clave anon pública de su frontend, solo lectura). 368 productos en 18 categorías con precio minorista/mayorista, stock, imágenes y flags oferta/nuevo/destacado.
- **Reglas acordadas**: se importan TODAS las categorías (mapeo editable), sin mención del proveedor en el catálogo, precio base = minorista con regla de recargo elegible (ej: escala 40-30-20).
- **Nuevo `src/shared/tecnova.ts`**: fetch paginado de la API, mapping default de las 18 categorías (ALMACENAMIENTO→computacion, CABLES Y ADAPTADORES→electronica, VARIOS/BAZAR/JUGUETES→hogar, etc.), normalización a items internos (id estable `tecnova-<id>`, tags desde flags, disponibilidad desde stock + on_demand_lead_time). El mapping explícito del panel pisa al default; `""` = saltar la categoría.
- **Nuevo `src/worker/tecnova.ts`** (montado en `/api/admin/import/tecnova/*`): `POST /preview` (total, importables, skipped, muestra de 120, categorías propias con sus subcategorías, reglas activas) y `POST /import` por chunks de 50 reutilizando `importItems` (ocultado automático por source_url `https://tecnova.com.ar/`, snapshot al último chunk, sync_log por chunk). Crea categorías raíz nuevas si el mapping pide una inexistente. El mapping usado queda guardado en KV (`tecnova:mapping:v1`).
- **Panel** (pestaña Importar): botón «📥 Importar de Tecnova (catálogo completo)» → preview con tabla de mapeo por categoría (select con raíces y «↳ subcategorías», opción «Saltar categoría»), selector de regla de precio (o Automático) y muestra de 20 productos. Confirmación con aviso de cuántas categorías quedan sin importar, importación por lotes con barra de progreso.
- Tests: nuevo `tecnova.test.ts` (+11): mapping default, mapping explícito pisa default, `""` salta aunque haya default, centavos, stock/lead time → in_stock/out_of_stock/preorder, tags desde flags, id estable, saltos por título/precio vacío — **281/281** ✅, typecheck ✅, build ✅
- **Verificado end-to-end en local con la API real**: preview 361/368 (7 skipped: 6 con categoría vacía en la fuente + 1 sin precio), importación de 2 chunks (100 productos) con y sin regla forzada (+40% verificado: $38.000 → $53.200), sync_log con «chunk 1/8» y «chunk 2/8», mapeo visible en la UI del panel. Datos de prueba eliminados y snapshot republicado (828 productos).

## 2026-10-02 — Catálogo: los chips de subcategoría («↳ Almacenamiento») mostraban cero productos

- **Causa**: al filtrar por categoría el catálogo comparaba **solo** con `p.categoryId`, pero la subcategoría de un producto vive en `p.subcategoryId` (el normalizador deja la raíz en `categoryId` y la subcategoría en `subcategoryId`). En producción, «Almacenamiento» tiene **5 artículos con `subcategoryId = almacenamiento` y ninguno con ese `categoryId`**: al tocar el chip la lista quedaba vacía
- Verificado en el snapshot de producción: las 14 subcategorías tienen 0 productos como `categoryId` (ej. 238 productos son `electronica / iluminacion`)
- **Fix**: `inCategorySet()` acepta el artículo si coincide **la raíz o la subcategoría**. Vive en `src/web/category-filter.ts` (módulo puro) para poder testearla sin DOM — importar `catalog.ts` en un test revienta porque el módulo agarra elementos del documento al cargarse
- **El chip tampoco quedaba marcado**: al elegir una subcategoría, `subcategoriesOf(subId)` devolvía vacío y la fila de subcategorías desaparecía. Ahora la fila se arma con las hermanas (las de su raíz), así que el chip elegido sigue visible y marcado
- **De paso, la ficha**: el breadcrumb mostraba solo la raíz («Inicio › Electrónica › artículo») y el enlace mandaba a la raíz. Ahora es «Inicio › Electrónica › Almacenamiento › artículo», con `?cat=` apuntando a cada nivel, y el JSON-LD `BreadcrumbList` incluye la subcategoría
- Tests: nuevo `catalog-filter.test.ts` (+5): subcategoría, raíz, raíz+subcategorías, sin filtro y artículo sin categoría — **270/270** ✅, typecheck ✅, build ✅
- Verificado en local con datos reales: un artículo con `subcategoryId` aparece al tocar su chip (1 tarjeta, antes 0), el chip queda activo y la ficha muestra el breadcrumb con los dos niveles. Los datos de prueba se restauraron después. Deploy `3c0fd9e6` y comprobado en producción: `/?cat=almacenamiento` → «5 de 5» con los 5 artículos de Almacenamiento (Kingston 64 GB, micro SD, pendrive, lector de memoria, Kingston 256 GB), el chip «↳ Almacenamiento» visible junto a sus hermanas y la ficha `/producto/7671` con el breadcrumb «Inicio › Computación › Almacenamiento › …»

## 2026-10-02 — Estadísticas: el gráfico de visitas por día ahora sí dice cuántos valores representa

- **Problema**: el gráfico de líneas solo tenía un `<title>` nativo del SVG en cada punto. Con radio 2,5 px había que acertarle al punto y esperar un segundo: en la práctica nadie veía cuántas visitas marcaba cada día. Además el eje Y no estaba rotulado, así que la altura de la línea no significaba nada
- **Tooltip propio**: al pasar el mouse por cualquier parte del gráfico (no hace falta apuntar al punto) aparece un recuadro con «mié 30-09 · 2 visitas», se marca ese día con una línea vertical y un punto más grande, y el valor queda también escrito bajo el gráfico
- **Eje Y rotulado** con líneas punteadas en el máximo y la mitad (`niceMax`: 7 visitas → sube a 8, 124 → 150), para poder leer la escala de un vistazo
- **Barras por hora**: tooltip al posarse encima con el rango y el número («14:00–14:59 · 23 visitas»), y el texto aclara cuál es la barra más larga
- **Textos explicativos** en ambos paneles: qué representa cada punto/línea y que se puede pasar el mouse
- Arreglado de paso el rótulo de la última fecha, que se salía del `viewBox` y quedaba cortado («02/1» en vez de «02/10»)
- `bindTips()` reutilizable por cualquier elemento con `data-tip`; el tooltip se posiciona con `position: fixed` y da la vuelta si no entra a la derecha del cursor
- Tests 265/265 ✅, typecheck ✅, build ✅. Verificado en local con el mouse: 3 posiciones distintas del gráfico (inicio, medio y final) muestran el día y las visitas correctas. Deploy `dd966b07` y comprobado en producción: hover sobre «mar 29-09» → «mar 29-09 · 20 visitas», eje Y en 30/15/0 y las 24 barras de hora con su tooltip

## 2026-10-02 — El panel ya no regenera el catálogo en cada edición: se publica al sincronizar

- **Causa**: cada alta, edición o baja manual (y cada cambio de categoría) llamaba a `regenerateSnapshot`, que **lee todo el catálogo** en D1. Con ~1.000 productos, guardar el formulario de un producto consumía ~1.000 filas leídas; editar 20 productos seguidos, ~20.000. Es la segunda fuente de quema de cuota después de las importaciones por fuente
- **Fix (lo pedido: literal)**: las escrituras del panel ya no regeneran el snapshot. En su lugar marcan `catalog:pending:v1` en KV con un write chico. El catálogo público se actualiza **al sincronizar** (cron o «Sincronizar ahora»), al importar, o con el botón «Publicar ahora» / «Publicar catálogo» del panel
- **Nada se pierde**: banner global en el panel («Hay cambios sin publicar en el sitio») con «Publicar ahora» y un ✕ para descartarlo; los toasts de guardado/baja dicen «(se publica al sincronizar)»; y el bloque «Estado del catálogo» del dashboard muestra una fila «Sitio público» con la hora de la última publicación o, si hay cambios, «Cambios sin publicar (fecha)»
- El banner se refresca solo al cambiar de pestaña (`GET /catalog-status`: dos `KV.get` chicos, sin leer el snapshot) y se apaga solo al publicar, sincronizar o importar
- `POST /snapshot` sigue siendo el que publica (invalida el caché por versión con `KV_CATALOG_VERSION_KEY` y ahora limpia la marca). `regenerateSnapshot` limpia la marca, así que también lo hacen el cron y la importación
- **Efecto en la cuota**: editar productos desde el panel pasa de ~1.000 filas leídas por edición a **cero**. Solo las sincronizaciones (una por corrida) leen el catálogo completo
- **Ojo**: entre que se edita y se publica, el sitio público muestra el catálogo anterior (la ficha de `/producto/:id` sí lee D1 y se actualiza al instante). Por eso el banner y el texto de los toasts
- **Bug que encontró la prueba en el navegador**: el polling del dashboard (cada 15 s) reescribía el bloque «Estado del catálogo» y borraba la fila «Sitio público» del render inicial. Ahora el polling también consulta `/catalog-status`
- Tests: nuevo `catalog-publish.test.ts` (+8) que verifica que alta/edición/baja de producto y de categoría y el borrado masivo **no** leen el catálogo y sí marcan pendiente, y que publicar regenera y limpia la marca — **265/265** ✅, typecheck ✅, build ✅

## 2026-10-02 — Modo del sitio: «Tienda» o «Catálogo» con un solo selector

- Nuevo selector en **Configuración → Modo del sitio**: **Modo Tienda** (carrito, MercadoPago, transferencia y consulta por WhatsApp) o **Modo Catálogo** (solo precios de referencia y consulta por WhatsApp)
- **Una sola fuente de verdad**: `storeMode` deriva `paymentsEnabled` en `normalizeSettings()`. Antes eran dos campos independientes que podían contradecirse (activar el pago online «en catálogo» y que el sitio muestre un carrito que el backend después rechaza). El checkbox viejo de «Activar pago online» se reemplaza por el selector
- **Modo Catálogo apaga**: los botones «Comprar» y «Agregar» del catálogo y de la ficha, el botón del carrito del header y el modal de checkout. Los precios y el botón «Consultar por WhatsApp» quedan
- **El backend también cierra**: `POST /api/orders/transfer` ahora devuelve 503 en modo catálogo. Antes solo `/api/checkout` chequeaba el flag, así que un carrito viejo o un cliente generado a mano podía cerrar una venta por transferencia
- `sellsOnline()` centraliza la decisión del frontend para que el catálogo y la ficha no puedan mostrarse distintos
- **Compatibilidad**: una config guardada antes del modo se deriva de su checkbox de pagos (con pagos → tienda, sin pagos → catálogo). Sin config guardada arranca en catálogo, igual que antes
- **Bug encontrado por los tests**: la primera versión miraba `storeMode` ya mezclado con los defaults, y el default «tienda» tapaba la derivación — una tienda que tenía los pagos apagados se habría abierto sola al desplegar. Ahora se mira el objeto crudo
- El `PUT /settings` solo toca el modo si viene en el body: un guardado parcial no deja la tienda en modo catálogo por accidente (mismo criterio que el resto de campos)
- En el panel el grupo de pagos se atenúa al elegir catálogo pero **no se deshabilita**: un input `disabled` no viaja en el FormData y sus valores se perderían al guardar
- Tests: +8 (normalización del modo y el 503 de transferencia) — **257/257** ✅, typecheck ✅, build ✅
- Verificado en local en las dos direcciones: catálogo → 20 productos con «Consultar», 0 «Comprar»/«Agregar», sin carrito y ambos endpoints en 503; volver a tienda → 20 «Agregar», 20 «Comprar» y el modal de carrito de vuelta
- Nuevo helper `tools/patch_lineendings.py`: varios archivos del repo tienen finales de línea mezclados (LF, CRLF) y un reemplazo de texto a medias se aplicaba en silencio, dejando cambios fuera del commit

## 2026-10-02 — Cuota de D1: el catálogo se regenera una vez por corrida, no una por fuente

- **Incidente**: `D1_ERROR: Your account has exceeded D1's free tier daily row read limit` — se agotó la cuota diaria de filas leídas (5 M/día del plan gratis) y con ella la pestaña Auto-importaciones y el Dashboard empezó a devolver 500 «Error interno». Se restablece a medianoche UTC (21:00 Argentina)
- **Causa**: cada importación regeneraba el snapshot, que **lee todo el catálogo**. Con 21 fuentes eso son 21 lecturas completas por corrida; el cron las repitía cada hora (~2,8 M filas/día solo en snapshots)
- **Fix**: `importItems` acepta `skipSnapshot`; el cron, el «Ejecutar ahora» de un request y la corrida encolada del panel importan sin regenerar y **regeneran el snapshot una sola vez al terminar**. El panel lo hace en el `finally`, así que también queda consistente si se cancela a mitad
- Con los 21 jobs: de 21 lecturas completas por corrida a 1 (~86 % menos). Verificado en local mirando las peticiones: 7 syncs + 1 `/snapshot`
- `ranAlgo()` decide si vale la pena regenerar: la entrada «(pendientes)» que agrega el corte por tiempo del cron no cuenta (no hay nada nuevo que publicar)
- Tests: +3 — **249/249** ✅, typecheck ✅, build ✅
- **Pendiente de revisar**: cada alta/edición/baja manual de un producto desde el panel también regenera el snapshot completo; editar muchos productos seguidos va a comer cuota. Queda anotado para más adelante

## 2026-10-02 — Panel: «Ejecutar ahora» fuente por fuente, con progreso real y botón Cancelar

- **Problema**: el botón mandaba **todas** las fuentes en un solo `POST /auto-imports/run`. El propio worker advierte que en producción eso corta el Worker por el límite de CPU del plan gratis y deja la sincronización a medias
- Ahora recorre los jobs **de a uno** (`POST /sync {jobId}` por fuente), así ninguna request se pasa del límite y una que falle no frena el resto
- El progreso dejó de ser virtual (subía solo por tiempo): ahora es real — «(4/7) 127.0.0.1:8899/test-hide-1.json · 252 importados», con el porcentaje según las fuentes hecha
- **Botón «Cancelar»** durante la corrida: corta al terminar la fuente en curso y deja el resumen de lo hecho («Cancelada — 5 de 7 fuente(s) · 695 importados»)
- El resumen final conserva el desglose por fuente y distingue las que dieron error
- Verificado en local con el flujo real: ejecutar → cambiar a Dashboard → volver (barra restaurada en 43 % con «(4/7)») → cancelar (5 de 7 fuentes, botón habilitado y «Cancelar» eliminado)
- 246/246 tests ✅, typecheck ✅, build ✅

## 2026-10-02 — Panel: la sincronización sigue visible al cambiar de pestaña

- **Qué pasaba**: al darle a **Ejecutar ahora** en Auto-importaciones y cambiar de pantalla, la barra de progreso desaparecía (vive en el DOM de esa vista) y al volver parecía que la sincronización se había perdido, aunque seguía corriendo
- La corrida es una promesa viva en el navegador: no se cancela al cambiar de pestaña. Ahora su estado vive en un objeto `autoRun` a nivel de módulo (`running`, %, paso actual, resumen final) y `restoreAutoRun()` lo repinta al volver a la vista
- Al volver **durante** la corrida: se recupera la barra con el mismo porcentaje y paso activo, y el botón «Ejecutar ahora» sigue deshabilitado
- Al volver **después** de que terminó: se muestra el resumen («✓/⚠ Sincronización terminada» + desglose por fuente). El resumen se guarda hasta que el usuario lo ve y se descarta solo si pasa más de 5 minutos
- El handler de «Ejecutar ahora» se mudó a `startAutoRun()`, con `finally` para que el botón nunca quede bloqueado ni la corrida se marque activa si el fetch falla
- **Bug encontrado probando**: se creaba una caja de progreso vacía al volver a la vista sin nada que mostrar, y el resumen se borraba a los 12 s de terminar, así que si volvías más tarde no veías nada
- Verificado en local con el flujo real (Ejecutar ahora → Dashboard → volver): barra restituida al 78 % con el paso «Importando y aplicando reglas» activo, y resumen final al volver después de que terminó
- 246/246 tests ✅, typecheck ✅, build ✅

## 2026-10-02 — Reversión: la tienda vuelve a solo las 7 categorías y sus subcategorías

- **Motivo**: los 63 jobs/categorías que se habían agregado no fueron pedidos — el usuario solo quiere las subcategorías **de las 7 categorías que él creó a mano**. La opción que se le ofreció («33 subcategorías + 13 raíces nuevas») estaba redactada sin advertir que metía **17 categorías raíz nuevas** al menú de la tienda
- **Qué se borró**: los 63 jobs de importación nuevos, las 53 categorías que crearon (17 raíces + 30 subcategorías + 5 de nivel 3 huérfanas) y los **4.645 productos** que importaron
- **Cómo se borró sin tocar lo del usuario**: primero se desactivaron los 63 jobs y se re-corrieron los 21 originales, porque un producto que aparece en varias páginas tiene su `source_url` reescrito por el último job que lo importó (82 productos del usuario estaban apuntando a una URL nueva). Recién con los 990 originales teniendo ya su URL correcta se ejecutó `DELETE FROM products WHERE source_url IN (62 URLs de los jobs nuevos)`: **4.645 filas, 0 productos de otras fuentes**
- **Estado final**: 7 categorías raíz (Electrónica, Computación, Hogar, Belleza y Cuidado Personal, Rodados y Accesorios, Artículos para Fumadores, Mascotas) + las 14 subcategorías de Electrónica y Computación, **982 productos publicados** (712 con subcategoría) y 21 jobs activos. Verificado en la tienda: aparecen solo los 7 chips de raíz
- **Lo que se conserva de este trabajo**: el fix del límite de 100 parámetros de D1 (`chunkSizeFor`) y el `COALESCE` de subcategoría — ambos siguen haciendo falta aunque no haya jobs nuevos
- Nota: si alguna vez se quieren recuperar los jobs borrados, el changelog de la entrada siguiente tiene el detalle de qué eran

## 2026-10-02 — Cobertura completa del sitio: 63 jobs nuevos y catálogo de 5.635 productos *(revertido)*

- **Investigación**: el árbol de `hacetupedido.com` tiene **32 categorías raíz y 47 subcategorías**. Las que el usuario pidió abrir (Belleza, Hogar, Rodados, Artículos para Fumadores, Mascotas) **son hojas del árbol: no tienen subcategorías** — sus productos ya se importan bien como categoría simple
- **Alcance real**: se agregaron los nodos que faltaban del sitio — **17 categorías raíz planas** (Ferretería, Relojes, Deportes, Bebés, Camping, Variedades, Equipaje, Verano, Invierno, Platos de Sitio, Navidad, Vestimenta, Librería, Bazar, Maquillaje, Globos, Celebraciones, Souvenirs, Juguetería, Decoración, Descartables, Velitas y Navidad y Año Nuevo) y **46 subcategorías** de Juguetería, Descartables, Celebraciones, Bazar, Globos, Decoración y Souvenirs. Total **84 jobs** en producción
- **Bug encontrado al crearlos**: las URLs nuevas=nolfloorarron `?page=all`, así que cada job traía solo la primera página (exactamente 24 productos cada uno). Corregido con `PUT /auto-imports/:id` y re-corriendo los 63
- **Bug propio de los scripts**: el `PUT` se mandaba como POST (404) — el `call()` por defecto no fija método
- **Job desactivado**: `Sorbetes` (`/productos/sorbetes1`) — la página responde «categoría sin fichas extraíbles»; es la única raíz del sitio sin productos
- **Cron**: presupuesto de corrida de **20s → 45s** en `autoimport.ts`. El límite real del plan gratis es de CPU (los cron pueden correr 15 min) y casi todo el tiempo de una importación es esperar a la fuente; con 20s los jobs de 30-46s nunca llegaban a terminar y se reintentaban para siempre
- **Replanificación de los 84 jobs** por peso medido: cada job que no entra en el presupuesto (Globos · Metalizados, 46s) queda **solo en su hora**; el resto se agrupa hasta 43s por corrida. Carga total 825s de 1032s disponibles
- **Resultado**: el catálogo pasó de **990 a 5.635 productos** (5.627 publicados), **3.742 con subcategoría (66%)** y **79 categorías** (31 raíces + 48 subcats) — el árbol completo del sitio salvo Sorbetes
- `GET /api/catalog` sirve un snapshot de **2.13 MB** (el límite de valor de KV free es 25 MB, así que entra) y las importaciones escriben ~83 snapshots/día, muy por debajo de las 1000 escrituras/día del plan gratis
- **Deploy**: `be6e6b2c-a430-41be-9534-9afdd530ef80` (presupuesto del cron). Commit `85ee539`
- **Descubierto en el smoke**: la tienda estaba con `maintenanceMode = true` (el flag «Cerrar el catálogo al público» del panel), por eso todas las rutas públicas devolvían 503 con `Retry-After: 3600`. No lo había activado ninguna importación (`/api/admin/*` está en la lista de bypass). Desactivado reenviando el objeto de settings completo: el `PUT /settings` **reemplaza** el objeto entero, así que un PUT parcial con un solo campo habría borrado WhatsApp, CBU, horarios y redes — verificado que ningún otro campo cambió
- **Jerarquía de Globos**: los 5 jobs de **nivel 3** (Con confetti, Cromados, Lisos, Formas, Números) traían `father_title` del nivel 2, así que crearon «Globos Metalizados Foil» como categoría raíz y 5 subcategorías duplicadas. Desactivados esos 5 jobs (la URL plana no distingue el nieto), re-parentada la categoría al nivel correcto y borradas las 5 huérfanas. Re-sync de los 2 jobs de nivel 2 (769 + 239 productos)
- **Verificado en la tienda**: 5.627 productos publicados, filtro `?cat=globos` con 1.041 productos y las 3 subcategorías (Accesorios e infladores, Globos Látex, Globos Metalizados Foil) anidadas con `↳`
- **Cobertura**: el árbol del sitio tiene 32 raíces y 47 subcategorías; están las 31 raíces con job activo (falta `Sorbetes`, que la fuente devuelve vacía) y las 47 subcategorías
- 246/246 tests ✅, typecheck ✅, build ✅

## 2026-10-02 — Importación: batches que ya no superan el límite de parámetros de D1

- **Bug raíz** (encontrado al probar en producción): `BATCH_SIZE = 30` generaba sentencias de **391 parámetros** y D1 acepta como máximo **100** ⇒ el batch de productos **fallaba siempre** y caía al `upsertProduct` individual (sin `COALESCE`), por eso un job raíz seguía borrando la subcategoría ya conocida
- `db.ts`: nuevo `chunkSizeFor(bindsPerRow)` que calcula el tamaño de chunk a partir del límite real de D1 (`MAX_PARAMS_PER_STATEMENT = 100`); `PRODUCT_CHUNK = 7` (92 params), `CATEGORY_CHUNK = 24` (97), `ID_CHUNK = 98`. Reemplaza al `BATCH_SIZE` fijo en `upsertCategoriesBatch`, `upsertProductsBatch`, `hideProductsNotIn` y `unhideProductsIn`
- Nuevo test `src/worker/db-chunk.test.ts` (4 casos) que fixa los tamaños de chunk y que nunca se pase del límite
- **246/246** tests ✅, typecheck ✅, build ✅
- **Segundo bug encontrado en el smoke de producción** (`D1_ERROR` en el job raíz): las sentencias de `hideProductsNotIn`/`unhideProductsIn` usan `?1` (source_url) + N ids + `?N+2` (updated_at) = **N+2** parámetros, así que `ID_CHUNK=99` daba 101 y reventaba ⇒ `chunkSizeFor` ahora recibe `reserved` (los binds fijos de la sentencia) y `ID_CHUNK = chunkSizeFor(1, 2)` = 98 ids
- **Corridos los 14 jobs por subcategoría** (de a uno por el límite de CPU del plan gratis), todos `ok`, sin errores: Iluminación 246, Cables 98, Adaptadores 71, Cargadores 52, Baterías 47, Parlantes 44, Auriculares 32, Accesorios 30, Consolas 26, Audio/Video 24, Mouses 23, Micrófonos 11, Almacenamiento 5, Radios 4
- **Estado del catálogo**: 990 productos, **705 con subcategoría** repartidos en las 14 subcategorías nuevas (Electrónica ×12, Computación ×2). Los ~285 restantes son de las categorías planas (Belleza, Hogar, Rodados, Fumadores, Mascotas) y de los productos que solo existen en la página raíz
- Jobs: los 14 jobs de importación por subcategoría (Electrónica ×12 y Computación ×2) quedaron creados y **activos** en producción con horarios escalonados (07:00 → Auriculares, Cables, Computación·Almacenamiento; 08:00 → Cargadores y Fuentes, Adaptadores y Conversores, Mouses y Teclados; 09:00 → Consolas y Videojuegos, Parlantes, Micrófonos; 15:00 → Baterías/Pilas/Cargadores, Accesorios para Celulares, Iluminación; 16:00 → Radios, Audio/Video/Controles Remotos), todos con la regla de precio `group:40-30-20`

## 2026-10-02 — Subcategorías en la importación de productos

- El parser de TiendaNegocio (`itemsFromTiendaNegocio`) ahora lee `father_title` de la página de categoría: cuando la URL es de una **subcategoría**, cada producto se importa con la **categoría padre** y la **subcategoría** de la página. Las páginas raíz siguen como categoría simple (sin subcategoría)
- La infraestructura de subcategorías ya existía (schema `parent_id`/`subcategory_id`, normalizador, selector del panel, chips de subcategorías en la tienda) pero esta fuente nunca las alimentaba
- `upsertProductsBatch`: `subcategory_id = COALESCE(excluded.subcategory_id, products.subcategory_id)` — un job raíz que no conoce la subcategoría ya no la borra (la edición manual desde el panel sigue pudiendo vaciarla)
- Tests: +2 (página de subcategoría y página raíz) — **242/242** ✅, typecheck ✅, build ✅. Verificado contra la fuente real: Auriculares→Electrónica/Auriculares (33), Almacenamiento→Computación/Almacenamiento (5), Mascotas→sin subcategoría (7)
- Pendiente (requiere deploy): agregar los jobs de importación de las 14 subcategorías de Electrónica (12) y Computación (2)

## 2026-10-02 — Botón ⟳ Actualizar en Pedidos

- Nuevo botón **⟳ Actualizar** en la cabecera de la lista (junto al buscador): re-pide la lista al servidor **manteniendo filtro, página y búsqueda** — ya no hace falta cambiar de chip o recargar la página para ver si entró un pedido nuevo
- UX: se deshabilita y muestra «⟳ Actualizando…» durante el fetch, toast «Lista actualizada» al terminar y toast de error si falla
- La selección masiva (`ordSelected`) sobrevive al actualizar, igual que al paginar
- 240/240 tests ✅, typecheck ✅, build ✅ (bundle `admin-CjC0hn89.js`)

## 2026-10-02 — Búsqueda por teléfono/email y WhatsApp directo desde Pedidos

- La búsqueda del panel ahora matchea **nombre, id, email y teléfono**: el teléfono compara dígitos normalizados («342 555 1234», «+54 9…» o «3425551234» encuentran lo mismo)
- En la columna Comprador el **teléfono es un link a WhatsApp** (`wa.me/<número>`, solo con número válido) para escribirle al comprador de cualquier pedido — no solo de los pagados
- Placeholder nuevo: «Buscar por nombre, teléfono, email o id…»
- Backend en `orderWhere`: `payer_email LIKE` + teléfono crudo y sin signos (`REPLACE` anidado, solo si la query tiene dígitos) — SQL validado contra D1 local con fixtures
- Tests: +3 (teléfono con espacios, teléfono solo dígitos, email) + 1 que asserta la forma del WHERE; el mock de la vista paginada ahora emula email/teléfono — **240/240** ✅, typecheck ✅, build ✅
- **Fix post-deploy**: `orderWhere` une los conds con AND y el teléfono en un grupo aparte hacía que toda query con dígitos (incluida la búsqueda por id) devolviera 0 en prod — todo quedó en un solo grupo OR
- Deploys: **`b9638782-14af-4503-a9a0-104f163d4a6c`** (con el bug AND) y corrección **`2c07cbde-7ecb-4e16-8c7d-97225ae55d32`**; smoke en prod: id, teléfono con/sin espacios, email y nombre

## 2026-10-02 — Restaurar devuelve el pedido a su estado anterior

- **Bug**: al restaurar, un pedido cancelado/rechazado volvía como **pendiente** — `adminSetOrderUnarchive` solo distinguía paid/pending y perdía el estado previo
- El archivo ahora guarda el estado previo en la nueva columna `pre_archive_status` (migración 010) y el restore vuelve **exactamente** a ese estado; el campo se limpia al restaurar
- Filas archivadas antes de la migración (NULL) mantienen el fallback anterior: paid si `paid_at`, si no pending
- Migración `db/migrations/010-orders-pre-archive-status.sql` (+ `schema.sql`, `Order.preArchiveStatus` opcional)
- **Aplicada a D1 remota** + fix de datos: los 8 pedidos archivados quedaron con `pre_archive_status` correcto (todos eran cancelled) — commit `c621a2a`, deploy versión **`5820fd14-234a-4751-9e1f-42dcb07c2f8f`**
- Smoke E2E en producción: restaurar «Prueba Final» volvió como **cancelled** (antes salía pending) y se volvió a archivar con su nota; los 8 archivados responden `preArchiveStatus: cancelled`
- Tests: +2 (roundtrip cancelled/rejected con limpieza del campo, fallback de fila legada), mock y seed actualizados — **236/236** ✅, typecheck ✅, build ✅

## 2026-10-02 — Fix: el botón 🗂️ Archivar individual no abría el modal

- **Bug**: el `forEach` del botón «Ya avisé» (`data-ord-wa`) quedó sin cerrar y el bloque de archivar quedó **anidado adentro** — los handlers de archivar solo se ataban si había botones de WhatsApp en la tabla. Con 0 botones «Ya avisé» (caso actual), clic en 🗂️ Archivar = nada, sin error en consola
- Peor caso del mismo bug: con N botones WA, cada fila recibía N handlers de archivar (N modales superpuestos)
- Fix: `data-ord-archive` y `data-ord-wa` ahora son dos bloques independientes con su propio `forEach`
- 234/234 tests ✅, typecheck ✅, build ✅ (bundle `admin-BguwQkp_.js`)

## 2026-10-02 — Fix: faltaban los checkboxes de selección masiva en la tabla

- El archivo masivo se había desplegado con el botón y los handlers, pero **sin los checkboxes**: no había forma de elegir pedidos (los pasos de HTML no se habían escrito)
- Se agregan el checkbox «marcar todos (esta página)» en el `<th>` de la tabla y el checkbox por fila `.ord-sel` (los archivados quedan sin checkbox, igual que el diseño original)
- 234/234 tests ✅, typecheck ✅, build ✅ (bundle `admin-De_1x1CA.js`)
- Fix commiteado (`62fff5b`) y desplegado: versión **`fed696c4-fdfa-4a55-92f5-aefb6a070878`**
- **Validación punta a punta en producción**: 4 pedidos de prueba («Prueba CBU producción», «Deploy Persistencia», «Prueba Webhook», «Prueba Final») archivados desde el panel con una sola confirmación — `POST /orders/archive-bulk` `200`, chips Todos 15→11 / Cancelados 12→8 / Archivados 0→4, nota 📝 visible en cada fila, `archived_at`/`archived_by`/`archive_note` persistidos en D1 y las 4 filas sin checkbox con botón «↩ Restaurar»

## 2026-10-01 — Deploy: archivo masivo de pedidos + motivo opcional

- **Migración 009 aplicada a D1 remota**: columna `archive_note` en `orders` (verificada con un SELECT directo)
- Deploy versión **`8af7fca6-bab9-482b-a02a-1bde22fa858f`** (cron `0 * * * *` intacto; bindings KV/EMAIL/DB/ASSETS/CF_ACCOUNT_ID/CF_SITE_ORIGIN presentes)
- Sube: acción masiva de archivar (checkbox por fila + seleccionar todo, una sola confirmación con nota compartida, `POST /api/admin/orders/archive-bulk`), motivo opcional en el archivo individual y fix del TS2304 de `ordSelected`
- Smoke de producción: home `200`, `/admin/` `200`, `GET /api/admin/orders` sin sesión `401`, `POST .../archive-bulk` sin sesión `401`, bundle `admin-CPItkUBm.js` `200` con `archive-bulk` presente en el JS servido
- Commit `0098984` pushado a `main`

## 2026-10-01 — Archivo masivo de pedidos (una sola confirmación)

- Checkbox en el encabezado de la tabla de pedidos (**seleccionar todo la página**) y checkbox por fila (los archivados quedan sin checkbox); los ids elegidos sobreviven a paginar y se limpian al cambiar de chip o de vista
- Botón **🗂️ Archivar seleccionados** junto al buscador (contador de seleccionados); abre **un único modal** con nota opcional compartida y al confirmar archiva todo de una vez
- Nuevo endpoint `POST /api/admin/orders/archive-bulk` (sesión admin): recibe `{ ids[], note? }`, máximo 100 por lote, dedupe + ids vacíos ignorados, responde `{ ok, requested, archived, notFound }`
- Tests: 3 nuevos en `orders-patch.test.ts` (lote con nota compartida, dedupe/basura/notFound, 400/401) — **234/234** ✅, typecheck ✅, build ✅
- Fix: faltaba la declaración de `ordSelected` en `src/web/admin.ts` (error TS2304)

## 2026-10-01 — Motivo opcional al archivar pedidos

- El modal de archivar ahora incluye un campo **«Motivo (opcional, queda en el historial)»** (textarea, máx. 200 caracteres); se puede archivar sin escribir nada
- El motivo se guarda en la nueva columna `archive_note` y aparece en la pestaña Pedidos bajo el badge de estado de los archivados: `📝 <motivo>`
- Al **restaurar** el pedido, el motivo se limpia junto con `archived_at`/`archived_by`
- Backend: `adminSetOrderArchive` acepta `note` (trim + acote a 200, vacío → null), el endpoint `POST /api/admin/orders/:id/archive` la recibe del body, `rowToOrder` expone `archiveNote`
- Migración `db/migrations/009-orders-archive-note.sql` (+ `schema.sql`) — **pendiente aplicar a D1 remota al próximo deploy**
- Tests: 3 nuevos en `orders-patch.test.ts` (guardado + limpieza al restaurar, vacío/ausente → null, acote a 200) — **231/231** ✅, typecheck ✅, build ✅

## 2026-10-01 — Deploy: archivo de pedidos + fix del filtro «Nuevo»

- **Migración 008 aplicada a D1 remota**: columnas `archived_at` y `archived_by` en `orders` (verificadas con `PRAGMA table_info`)
- Deploy versión **`e00e1a04-f299-428d-b360-908bfbf89a04`** (cron `0 * * * *` intacto; bindings KV/EMAIL/DB/ASSETS/CF_ACCOUNT_ID/CF_SITE_ORIGIN presentes)
- Sube: archivar/restaurar pedidos (botón con modal de confirmación, chip «Archivados», endpoints `/api/admin/orders/:id/archive` y `/unarchive`) + fix del filtro «Nuevo» del catálogo (tag o fresco)
- Smoke de producción: home `200`, `/admin/` `200`, `/api/admin/orders` sin sesión `401`, `POST .../archive` sin sesión `401`, bundle `catalog-2Afgiw5t.js` `200` con la lógica del filtro nuevo verificada en el JS servido
- 228/228 tests ✅, typecheck web + worker ✅, build ✅

## 2026-10-01 — Fix: el filtro «Nuevo» del catálogo no mostraba los productos nuevos

- El chip «Nuevo» del catálogo solo buscaba el **tag** `new` (poco usado: los productos importados casi nunca lo traen), pero el badge «Nuevo» de las tarjetas es el **automático por frescura** (`created_at` dentro de `freshHours`, 48 h por defecto) — por eso el filtro devolvía vacío mientras las tarjetas mostraban badges
- Fix en `src/web/catalog.ts` (`applyFilters`): el tag `new` ahora matchea **tag a mano O producto fresco** (`isFresh` con el `freshHours` de las settings), respetando «Desactivado» (0 h) cuando está configurado así
- El filtro ahora devuelve exactamente lo mismo que se ve en las tarjetas; `featured`/`offer` quedan igual
- 228/228 tests ✅, typecheck ✅, build ✅

## 2026-10-01 — Archivar pedidos (historial de cancelados y pruebas)

- Nuevo estado `archived` en pedidos: botón **🗂️ Archivar** en cada fila con **confirmación en modal** («¿Archivar este pedido? Se guardará en el historial...») y botón **↩ Restaurar** para deshacer
- Chip **Archivados** en la pestaña Pedidos: muestra el historial (fecha de archivo y quién lo archivó); el filtro «Todos» **excluye** los archivados para no ensuciar la vista operativa
- Endpoints `POST /api/admin/orders/:id/archive` y `/unarchive` (sesión admin): archivo idempotente (no pisa la fecha original) y restauración a `paid` si tenía `paid_at`, o a `pending` si no
- Migración `db/migrations/008-orders-archived.sql` (+ `schema.sql`): columnas `archived_at` y `archived_by` en `orders` — **pendiente aplicar con `wrangler d1 execute` al desplegar**
- `OrderStatus` suma `archived`; `rowToOrder` expone `archivedAt`/`archivedBy`; `counts` del endpoint incluye `archived` para el chip
- Tests: 11 en `orders-patch.test.ts` (PATCH con login + archive/unarchive con confirmación, idempotencia, restauración a paid/pending, 401/404/400) y 6 en `orders-pagination.test.ts` (paginación con el filtro `status=archived` y exclusión de archivados en «Todos»)
- **228/228 tests** ✅, typecheck web + worker ✅

## 2026-10-01 — Fix de convergencia tienda → centerphone.com.ar

- `sync.ts`: el fallback de `purgeCatalogEdgeCache` cambió de `celu-store.pilin123.workers.dev` a `https://centerphone.com.ar` (en producción el origin del request ya era correcto; el fallback sólo afecta al purgado de caché cuando se activan CF_ZONE_ID/CF_API_TOKEN)
- `wrangler.jsonc`: agregada var `CF_SITE_ORIGIN=https://centerphone.com.ar` (antes caía al `url.origin` del request; ahora es explícito en producción para las `back_urls` de MercadoPago y la purga de caché)
- Validación de la tienda: el dashboard converge a `centerphone.com.ar` ✅ — WhatsApp usando `whatsappPhone` configurable desde el panel, carrito envía sólo `{id,qty}` (precios recalculados server-side desde D1), checkout MP usa `CF_SITE_ORIGIN` para `back_urls` y responde 200 rápido + verificación async del webhook, redirect 301 www→dominio sin www activo, canonical y Open Graph apuntando al dominio correcto, tracking protegido con `ALLOWED_TRACK_HOSTS = {centerphone.com.ar, www.centerphone.com.ar}`

## 2026-10-01 — Tests de la paginación de Pedidos (espejo de Productos)

- Nuevo `src/worker/orders-page.test.ts`: 5 tests del endpoint paginado `GET /api/admin/orders` (espejo de `products-page.test.ts`)
- Mock de D1 mínimo pero fiel: filtra por status/q (LIKE con ESCAPE '\\') y pagina con LIMIT/OFFSET; los totales por estado (COUNT(*) GROUP BY) no cargan filas
- Cubierto: 401 sin sesión, primera página con default 50 + counts por estado, paginación limit=2/page=2, búsqueda server-side por nombre/id (q=perez → 2), filter por status=paid
- 6 pedidos de prueba (pending/paid/cancelled/rejected) con precios congelados y datos de MP; datos ASCII para búsqueda case-insensitive fiable
- No se pudo ejecutar la suite (sin shell/node en el host): los tests se validan tipológicamente contra la misma firma que los tests de productos que ya pasan

## 2026-10-01 — Deploy: paginación de Productos en producción

- Push `8f45c3c..86cec33` a `pilincapo/TIENDA_CENTERPHONE` y deploy: versión **`86b90a6d-fef8-4817-88d5-95680cb33830`** (cron `0 * * * *` intacto; bindings KV/EMAIL/DB/ASSETS/CF_ACCOUNT_ID presentes)
- Smoke de producción: home `200`, `/admin/` `200` sirviendo el bundle nuevo (`assets/admin-Dp-LNw3C.js`), `/api/admin/products` sin sesión `401`, `/api/admin/security-events` `401`, `www.centerphone.com.ar` → `301` a dominio sin www
- La tienda pública sigue igual (catálogo + WhatsApp + carrito); el cambio es solo del panel: ahora Productos carga 50 por página con paginador, búsqueda server-side y recarga de la misma página al borrar/editar — 199/199 tests ✅, typecheck ✅

## 2026-10-01 — Paginación en la vista de Productos del panel

- La pestaña Productos ya no carga los 830 productos de una: ahora pide de a **50 por página** (paginador «‹ Anterior / Página X de Y / Siguiente ›» abajo de la tabla)
- La búsqueda pasó a hacerse **en el servidor**: escribe y a los 350 ms trae las coincidencias ya paginadas (busca por título o código); mantiene el foco del buscador al recargar
- Los chips «Todos» y «Sin stock» muestran totales reales sin cargar filas (ej.: Todos 829 / Sin stock 1) y combinan con la búsqueda
- Borrar, editar y guardar ya **no te mandan a la primera página**: recargan la misma página donde estabas; «Re-publicar todos» y «Vaciar categoría» operan sobre todas las páginas de una vez (lado servidor)
- Endpoint `GET /api/admin/products` paginado: `?page&limit&q&status` → `{products, total, page, pages, limit, counts}` con 3 consultas en paralelo (límite 1-200, página 1-500, `q` máx. 100 caracteres); sin sesión sigue respondiendo 401 (guardia de tests)
- Verificado en local con la base real: 830 productos → 17 páginas de 50, página 2 distinta de la 1, búsqueda «samsung» → 2 resultados, filtro «Sin stock» → 1 producto, sin errores de consola; typecheck ✅ y **199/199 tests** ✅ (5 nuevos del endpoint paginado)
- Sin cambios visuales en la tienda pública; solo el panel

## 2026-10-01 — Deploy: guardia de repairpro versionada + resumen semanal conectado

- Push `7b81a4b..6dd126c` a `pilincapo/TIENDA_CENTERPHONE` y deploy: versión **`9415c8e9-8a8b-4236-a2d1-a18932e7e190`** (cron `0 * * * *` intacto; binding `env.EMAIL (pilin123@gmail.com)` activo)
- Suben: copia versionada del guardia de repairpro (`tools/repairpro-guard.js`), módulo del resumen semanal (`digest.ts`) y binding de envío restringido a pilin123@gmail.com
- Smoke de producción: tienda (home/admin 200, `security-events` 401 sin sesión, changelog 401, login falso 401) y guardia de repairpro (`.env`/`wp-login.php` → 404, `/` → 200, `/api/auth/me` → 401)
- Verificado el circuito completo del resumen: los escaneos bloqueados quedan registrados como `seguridad: escaneo bloqueado (404) {path}` en Workers Logs (comprobado en vivo con 2 sondas)
- Único paso pendiente para que el email salga: crear el secret `CF_LOGS_TOKEN` (API token con permiso Account · Workers Observability · Read)

## 2026-10-01 — Guardia en repairpro: 404 para rutas de escáneres

- Los escáneres que pedían `/.env`, `/api/.env`, `wp-login.php`, `wlwmanifest.xml`, etc. recibían el HTML de la app (fallback del SPA); ahora reciben **404**
- Implementación: worker `repairpro-guard` (sin estado, sin bindings) puesto DELANTE de repairpro mediante la ruta `repairpro.centerphone.com.ar/*` — patrón de encadenado ruta→custom-domain de Cloudflare; responde 404 a los fragmentos sospechosos (`.env`, `.git`, `.php`, `wp-*`, `wlwmanifest`, `xmlrpc`, `phpmyadmin`) y pasa el resto al worker original con `fetch(request)`
- Con observability activada: cada bloqueo queda registrado como `seguridad: escaneo bloqueado (404) {path}` — el resumen semanal lo va a mostrar
- Verificado en producción: 9/9 rutas sospechosas → 404; legítimas intactas (`/` 200, `/track-lite` 200, `/api/auth/me` 401, `/favicon.ico` 200); tienda y miplantel sin tocar
- Revertible en segundos borrando la ruta; repair2.centerphone.com.ar (el clon) sigue sin guardia — misma receta cuando quiera

## 2026-10-01 — Resumen semanal de seguridad por email (preparado, pendiente de configuración)

- El worker ahora incluye `runWeeklyDigest()`: los lunes a las 9:00 de Argentina consulta los logs de TODOS los workers de la cuenta y envía un email de texto con: eventos de seguridad (login fallidos/OK, salidas sin sesión, webhooks) y respuestas 4xx/5xx por worker (rutas más rechazadas, IPs, escaneos bloqueados)
- Idempotente: 1 envío por semana (marca en KV); si la API de logs falla no envía ni marca (se reintenta la hora siguiente)
- Configuración lista: **Email Routing habilitado** en centerphone.com.ar (el dominio no recibía correo: 0 MX; ahora "ready" con MX de Cloudflare), casilla destino **pilin123@gmail.com** agregada y ya verificada en la cuenta, binding `send_email` restringido a esa única casilla en wrangler.jsonc (validado con `wrangler deploy --dry-run`: `env.EMAIL (pilin123@gmail.com)`)
- **Falta solo**: el secret `CF_LOGS_TOKEN` (API token con permiso Account · Workers Observability · Read) y el deploy para activar todo; sin token, el resumen se saltea sin romper nada
- Typecheck ✅, **194/194 tests** ✅ (7 nuevos: huso horario argentino UTC-3, armado del texto, sin config no hace nada, idempotencia, fallo de API sin marcar semana)

## 2026-10-01 — Deploy: pestaña "Seguridad" en producción

- Push `7130d27..0ce86b7` a `pilincapo/TIENDA_CENTERPHONE` y deploy: versión **`5d085448-b58f-4514-9819-6d5b13dd8ce7`** (cron `0 * * * *` intacto; la var `CF_ACCOUNT_ID` quedó ligada)
- Smoke de producción: home 200, `/admin/` 200 con el bundle nuevo (pestaña Seguridad presente), `/api/admin/security-events` sin sesión → 401, `/changelog.md` → 401, login falso 401
- La pestaña muestra las instrucciones de configuración hasta crear el token de Cloudflare (`wrangler secret put CF_LOGS_TOKEN`); después se llena sola

## 2026-10-01 — Revisión de logs de repairpro y otros workers (sin filtraciones)

- Auditoría de los otros workers de la cuenta (repairpro, repairpro-clon, repairpro-vivo, liga-amateur) buscando actividad sospechosa: 2.000 eventos en 7 días, casi todo uso legítimo desde Argentina (la IP de casa/oficina concentra ~1.020 consultas del panel)
- **Sondas de escáner detectadas y contenidas**: `/.env`, `/api/.env`, `/api/v1/.env`, `/api/staging/.env`, `/wp-login.php`, `wlwmanifest.xml` desde IPs de hosting extranjeras (Holanda y EE.UU.) — las que apuntan a la API quedaron en **401** y las estáticas devolvieron el HTML de la app (fallback de SPA), verificado cuerpo incluido: 0 secretos expuestos
- Los 401 en serie de `/api/users/…/settings/profile` salen de la IP propia con sesión vencida del panel (ruido normal, no ataque); un solo intento de login con curl, sin fuerza bruta
- Sin errores 5xx, sin inundaciones de 404, sin tráfico anómalo por volumen; el 200 del `/.env` estático es cosmético (sería más limpio un 404) — anotado como mejora opcional

## 2026-10-01 — Pestaña "Seguridad" en el panel

- Nueva pestaña **Seguridad** en el grupo Sistema: muestra los últimos eventos `seguridad:` del worker (24 h) leídos del Workers Logs de Cloudflare vía su API — intentos de login fallidos/OK, salidas sin sesión y avisos del webhook de pago — con hora, badge ⚠/ℹ y botón Actualizar
- Endpoint `GET /api/admin/security-events` protegido por sesión (agregado a la guardia `admin-guard`): sin `CF_LOGS_TOKEN` responde `configured:false` y la pestaña muestra los 2 pasos para configurarlo; con la misma filosofía que MercadoPago, sin token el resto del panel funciona igual
- Configuración: `CF_ACCOUNT_ID` ya queda como var en `wrangler.jsonc`; falta crear el API token (permiso Account · Workers Observability · Read) y guardarlo con `npx wrangler secret put CF_LOGS_TOKEN` — hasta entonces la pestaña muestra las instrucciones (los eventos igual se están grabando)
- Nuevo módulo `src/worker/security-log.ts` (consulta con timeout, normaliza y ordena más-nuevos-primero, sin exponer secretos) + 11 tests nuevos: typecheck ✅, **183/183 tests** ✅, build ✅
- Verificado en local con el dev server: pestaña en el menú, login del panel OK, sin token muestra instrucciones, y la vista con eventos renderiza bien (demo estática con datos de ejemplo, borrada después)

## 2026-10-01 — Log de seguridad: login, logout sin sesión y webhook de pagos

- El worker ahora deja registro (Workers Logs, retención corta del plan gratis) de: login fallido, login bloqueado por rate-limit, login OK, logout sin sesión (401) y cada webhook de MercadoPago con id real — recepción, confirmación de pago de pedido, pagos no encontrados (sondeos) y pagos aprobados sin pedido válido
- Sin datos sensibles en los logs: nunca contraseñas ni cookies — solo el evento, la IP de origen y los ids de pago/pedido (prefijo `seguridad:` para filtrar rápido)
- Se activó `observability` en wrangler.jsonc: sin eso los logs del worker no se capturan (por eso celu-store no aparecía en el dashboard mientras que repairpro sí)
- Tests nuevos: registro en login fallido/OK/logout sin sesión y en el webhook (recepción, confirmación, sondeo); typecheck ✅, 172/172 tests ✅

## 2026-10-01 — Revisión de logs del worker (sin hallazgos)

- Se revisaron los logs de producción del worker buscando llamadas sospechosas al login, logout y webhook de pagos: el worker no guarda log por request (solo errores) y en 7 días **cero errores y cero warnings** — ninguna excepción ni fallo interno
- Métricas de 14 días vía API de Cloudflare: 46.675 requests, 0 errores de ejecución, tráfico diario estable (197–6.473/día) sin picos anómalos típicos de escaneo o ataque
- Limitación conocida: los 401 de clave incorrecta y los 429 del rate-limit no quedan registrados (el worker no los loguea, por diseño y privacidad); si algún día hace falta rastrear intentos, habría que agregar un log mínimo de seguridad

## 2026-10-01 — Deploy: auditoría de accesos sin sesión en producción

- Push `6dd31a7..2ddc5b4` a `pilincapo/TIENDA_CENTERPHONE` y deploy: versión **`4be43a51-15f5-4fb8-94ba-48e5dff01b89`** (cron `0 * * * *` intacto)
- Smoke de producción: home 200, `/admin/` 200, **logout sin cookie → 401** (fix nuevo verificado en el sitio real), changelog sin cookie 401, `/changelog.md` 401, login falso 401, pedido inexistente 404
- Privacidad verificada con un pedido real de producción: `GET /api/orders/:id` devuelve solo estado, ítems, total, nombre y fechas — sin teléfono ni email del pagador

## 2026-10-01 — Auditoría de accesos sin sesión: 2 agujeros corregidos

- Se revisó **todos** los endpoints del worker (admin, checkout, pedidos, SEO, settings públicos) buscando rutas que respondan sin login, como pasó con el changelog. Dos hallazgos y corrección:
- **`/api/admin/logout` exigía sesión (ahora sí)**: sin login, cualquiera podía desloguear al admin (mata todas las sesiones activas) y quemar la cuota de escritura de KV del free tier con llamadas repetidas; el endpoint se movió a la zona protegida, y el panel ya tolera la respuesta 401 si la sesión venció
- **`/api/orders/:id` expone menos datos**: la API pública de la página del pedido devolvía el pedido completo (incluidos teléfono del comprador, email del pagador de MP e ids internos de MP); ahora responde solo lo que la página necesita — estado, ítems, total, nombre, fecha — el teléfono y el email ya no viajan (el link del pedido puede compartirse por error)
- Nueva guardia automática `admin-guard.test.ts`: prueba que TODAS las rutas del panel respondan 401 sin sesión (login/logout flujo feliz incluido), para que el bug del changelog no se repita al agregar endpoints; tests de privacidad del pedido en `checkout.test.ts`
- Auditoría sin hallazgos (todo correcto): `/api/catalog`, `/api/products/:id` y `/api/public/settings` (sin tokens ni URLs de sync), webhook de MP (re-consulta la API antes de marcar pagado), `/pedido/:id` (credencial de 32 hex, muestra nombre/ítems pero no contacto), sitemap/robots (solo productos publicados), beacon `/api/track` (rechaza orígenes externos)
- Verificado: typecheck ✅, **170/170 tests** ✅, local: logout sin cookie 401, flujo login→logout OK, pedido público sin datos de contacto ✅

## 2026-10-01 — Deploy: pestaña "Cambios" en producción

- Push `33bc0bb..4e432f2` a `pilincapo/TIENDA_CENTERPHONE` (pestaña Cambios + fix de seguridad) y deploy: versión **`2f8a4b52-bee6-4c42-bde6-2afca1813732`** (cron `0 * * * *` intacto)
- Suben la pestaña Cambios, la copia del changelog a los assets (`changelog.md` en el build) y la protección del archivo (`run_worker_first` + 401 desde el worker)
- Smoke de producción: home 200, `/admin/` 200 con el bundle nuevo (pestaña presente), `/changelog.md` público → 401, `/api/admin/changelog` sin sesión → 401, login falso 401, pedido inexistente 404

## 2026-10-01 — Arreglo de seguridad: la API del changelog ahora exige sesión

- El smoke de producción encontró que `/api/admin/changelog` respondía 200 **sin** estar logueado: el endpoint había quedado registrado antes del middleware de sesión de `adminApp`, y en Hono los `use()` solo protegen las rutas declaradas después de ellos
- Fix: el endpoint se movió a la zona protegida (después del middleware, junto a `/session`); en local 158/158 tests ✅ y re-deploy con la versión final

## 2026-09-30 — Pestaña "Cambios" en el panel (changelog del sitio)

- Nueva pestaña **Cambios** en el grupo Sistema del panel: muestra todas las entradas de este changelog (188 al día de hoy) como tarjetas plegables, la más nueva abierta por defecto, con negritas y código renderizados; se actualiza sola con cada deploy (lee el changelog.md del repo, copiado a los assets por el build)
- **Privacidad**: el changelog es documentación interna, así que el archivo ya no es público — pedir `/changelog.md` directamente responde 401; el panel lo lee autenticado vía `/api/admin/changelog`
- Ajuste técnico del paso: el asset `/` ahora se pide con su URL original desde el worker (con la nueva configuración, pedir `/index.html` internamente devolvía 404)
- Verificado en local: pestaña en el menú, 188 entradas renderizadas, abrir/cerrar, sin HTML crudo inyectado; typecheck ✅, build ✅, 158/158 tests ✅

## 2026-09-30 — Pedido de prueba cancelado

- El pedido de prueba del CBU (`2e21452f…`, "Prueba CBU producción") quedó cancelado en producción: badge "Cancelado" en el panel (sin botón de cancelar restante) y la página pública del pedido muestra el estado cancelado; quedan 4 pedidos pendientes reales sin tocar

## 2026-09-30 — Deploy: CBU en transferencia + carrito con títulos largos

- Push `cb76401..3fdda8f` a `pilincapo/TIENDA_CENTERPHONE` (4 commits) y deploy: versión **`fbd7dde4-4393-41ce-ac05-3632caa5f9be`** (cron `0 * * * *` intacto)
- Suben: CBU/Alias visible con copiar en el cierre por transferencia, y el carrito que ya no se rompe con títulos largos (2 líneas + compactado en celular)
- Smoke: home 200, `/admin/` 200, CSS nuevo (`format-jw180wUx.css`) con `line-clamp`, `break-word`, `@media(max-width:480px)` y `cbu-box`/`cbu-copy`; pedido inexistente 404, seguimiento 200, login rechaza clave falsa (401)

## 2026-09-30 — Carrito: los títulos largos ya no rompen el modal

- Con un producto de nombre largo ("Cargador SIMPLE regulable de pilas AA AAA 18650 16340 14500 26650 en caja (HD-8990)") el modal del carrito se desarmaba: el título forzado a una sola línea empujaba la fila completa y aparecía **scroll horizontal** (el total y los botones quedaban afuera, con barra de desplazamiento lateral)
- Rediseño de la línea de producto: el título ahora **corta en 2 líneas** (con "…" si es más largo), la columna de precio/cantidad no se aplasta y el bloque se compacta en celulares (miniatura 44px, modal a ancho completo); verificado con el título más largo del catálogo a 1280px y 390px: cero scroll lateral, todo dentro del modal
- 158/158 tests ✅, build ✅

## 2026-09-30 — Prueba real del CBU en producción

- Pedido de prueba en producción con 2 productos ($61.200 → $55.080 con el 10%): la pantalla mostró la caja **"CBU / Alias para transferir — CENTERPHONE.MP"** con botón Copiar (verificado: copia al portapapeles y pasa a "✓ Copiado"), orden correcto (total → CBU → WhatsApp → ver pedido)
- Pedido de prueba `2e21452f9750459373faa9551076f929` quedó en producción (pendiente, sin pago); se puede cancelar o borrar desde el panel si molesta en el listado

## 2026-09-30 — Deploy: CBU/Alias en el cierre por transferencia

- Deploy a producción: versión **`d4dd2f00-c948-4da2-8c29-ddce276d8aa4`** (commit `c50065a`; cron `0 * * * *` intacto)
- Smoke: home 200, `/admin/` 200, bundle del catálogo (`catalog-BKg8GKHh.js`) con el bloque nuevo (`cbu-box`, `cbu-copy`, "CBU / Alias para transferir"), pedido inexistente 404, seguimiento 200, login rechaza clave falsa (401)
- En producción ya hay CBU/Alias cargado (`CENTERPHONE.MP`, visible en `/api/public/settings`): la caja aparece con datos reales desde ya; WhatsApp y pagos verificados (`whatsappOk: true`)

## 2026-09-30 — CBU/Alias visible al cerrar una compra por transferencia

- La pantalla "¡Pedido registrado!" del flujo por transferencia muestra ahora una **caja con el CBU/Alias y un botón "Copiar"** (uno toca = "✓ Copiado"; si el navegador bloquea el portapapeles, lo selecciona para copiar a mano), ubicada entre el total y el botón de WhatsApp: el cliente ve total → copia CBU → transfiere → avisa, sin tener que preguntar por los datos de la cuenta
- El dato sale del CBU/Alias configurado en el panel (ya llegaba al frontend; solo faltaba mostrarlo); **si no hay CBU cargado, la caja no aparece** y queda el aviso de que se lo pasan por WhatsApp, igual que antes — nada se bloquea
- Textos del cierre actualizados en consecuencia ("Transferí el total de abajo y avisá con el botón de WhatsApp…"); el mensaje de WhatsApp del worker sigue trayendo el CBU pre-cargado (sin cambios ahí)
- E2E en local: pedido por transferencia real con la caja mostrando "Alias: CENTERPHONE.AR", copiado verificado (portapapeles interceptado → "✓ Copiado"), orden visual correcto (total → CBU → WhatsApp → ver pedido) y link al pedido funcionando; typecheck ✅, build ✅, 158/158 tests ✅

## 2026-09-30 — Deploy: buscador de Productos + WhatsApp normalizado

- Deploy a producción: versión **`2d7aeaa6-d32a-4a3e-9558-0918f918c2f3`** (commits `4b8023a` y `bd2ee38`, push pendiente de orden explícita; cron `0 * * * *` intacto)
- Smoke: home 200, `/admin/` 200 sirviendo `admin-DmIug6E-.js` con el buscador ("prod-search" ×3, "Buscar por título"), login rechaza clave falsa (401), seguimiento 200
- **Número de WhatsApp de producción limpiado**: `+5493425819402` → `5493425819402` (edición directa del KV `config:settings:v1` vía API de Cloudflare, JSON completo reescrito sin tocar los otros 22 campos; verificado releyendo la clave y en `/api/public/settings` con `whatsappOk: true`) — queda consistente con lo que el panel pide y la normalización nueva del worker mantiene de acá en más

## 2026-09-30 — Buscador en la pestaña Productos

- Campo **"Buscar por título o código…"** junto a los chips de Productos: filtra las filas **mientras se tipea** (sin recargar la tabla de 979 productos), muestra "N de M coinciden" y "Marcar todos" pasa a marcar solo las filas visibles con el filtro activo
- Busca por título y código de producto, sin distinguir mayúsculas; al borrar la búsqueda vuelven todas
- Verificado en local: búsqueda con coincidencias (2 de 829), sin resultados ("0 de 829"), limpiar restaura todo, y selección múltiple respeta el filtro; typecheck ✅, build ✅

## 2026-09-30 — Operación: fuente "Hogar" re-sincronizada a mano

- La auto-importación "Hogar" (hacetupedido) estaba atrasada >24h (última corrida 29/9 05:01 con el cron); se forzó su corrida manual por el modo seguro de una-fuente-por-request: **135 productos actualizados, 1 marcado sin stock, sin errores**, nueva corrida 30/9 05:37 y la pestaña quedó sin fuentes atrasadas
- De paso se confirmó que "Ejecutar ahora" de la pestaña Auto-importaciones fuerza TODAS las fuentes en un solo request (riesgo del límite de CPU del plan gratis); el modo seguro por-job ya existía para "Sincronizar ahora"

## 2026-09-30 — Deploy: arrastre de pasos + aviso sin guardar

- Push `8cdd290..c88c90b` a `pilincapo/TIENDA_CENTERPHONE` y deploy a producción: versión **`2bf68866-8cd7-4309-9898-322ba26a9370`** (cron `0 * * * *` intacto)
- Suben las 2 mejoras: reordenar pasos de "Cómo comprar" arrastrándolos (manija ⠿) y aviso de "cambios sin guardar" al cambiar de pestaña en Configuración
- Smoke en producción: home 200 con 40 tarjetas y modal "Cómo comprar" con los 5 pasos reales; `/admin/` 200 sirviendo bundle nuevo (`admin-RFRH24Ez.js` con `how-grip`/`dragstart`/aviso sin guardar, CSS `format-COtO7oYA.css` con `.how-grip`/`.drop-before`/`.dragging`); login rechaza contraseña falsa (401), seguimiento 200, pedido inexistente 404

## 2026-09-30 — Aviso de "cambios sin guardar" en Configuración

- Al tocar cualquier campo de Configuración queda "marcado" que hay cambios: si cambiás de pestaña del menú, pregunta **"Hay cambios sin guardar… ¿Querés salir igual?"** — quedarse conserva la edición y re-alinea el menú con la pestaña; salir descarta y navega normal
- No molesta de más: si volvés a los valores originales (des-hacés a mano) el aviso se desarma, y después de guardar bien ya sale sin preguntar; si no tocaste nada, tampoco pregunta
- Incluye al editor de pasos: escribir/borrar/reordenar filas también dispara el aviso (agregar una fila vacía no, porque no cambia nada guardado)
- Corregidos en el camino dos tropiezos propios: un falso positivo (el aviso aparecía apenas abrir la pestaña, porque el estado base se capturaba antes de que el editor llenara el campo oculto) y un error de inicialización que dejaba la vista en blanco
- Verificados los 6 casos en local (sin cambios/sale, con cambios/se queda, con cambios/sale, des-hacer sale sin aviso, editar pasos avisa, guardar desarma); typecheck ✅, build ✅, 158/158 tests ✅

## 2026-09-30 — "Cómo comprar": reordenar pasos arrastrándolos

- Cada paso del editor tiene ahora una **manija ⠿**: se arrastra la fila y se suelta donde se la quiera (marca verde en la zona de destino, mitad superior = antes, mitad inferior = después); lo tipeado entra al reorden sin perderse
- Los botones ↑ / ↓ siguen existiendo como alternativa (útil en celular, donde el arrastre no funciona)
- Verificado en local: arrastre real de un paso hacia abajo y de vuelta a su lugar, con preview sincronizado; typecheck ✅, build ✅, 158/158 tests ✅

## 2026-09-30 — Deploy: panel simplificado (4 mejoras)

- Push `5bf3747..0bebb2c` a `pilincapo/TIENDA_CENTERPHONE` y deploy a producción: versión **`cb83ed8f-fccd-4ca9-bcb5-0247456c9c7d`** (cron `0 * * * *` intacto)
- Suben las 4 mejoras del panel: Configuración en 5 secciones plegables, Dashboard resumido con estadísticas en criollo, casilla "Repetir automáticamente" en Importar y editor visual de "Cómo comprar"
- Smoke en producción: home 200 con 40 tarjetas de catálogo, modal "Cómo comprar" con los 5 pasos reales, `/admin/` 200 sirviendo el bundle nuevo (`admin-CxqEPG1J.js` con `cfg-group` y "Repetir automáticamente", CSS `format-uOi3oYNE.css` con `.cfg-group`/`.how-list`), login rechaza contraseña incorrecta (401), seguimiento 200, pedido inexistente 404
- Nota: `/api/products` responde 404 (la API pública es otra ruta; el catálogo se renderiza igual); el webhook de pagos desde curl sin firma da 404 (comportamiento esperado: valida origen)

## 2026-09-30 — Editor visual de "Cómo comprar"

- El campo de pasos deja de ser una caja de texto con `**negritas**`: ahora son **filas numeradas** con botones subir (↑) / bajar (↓) / quitar (✕), "Agregar paso", y una **vista previa en vivo** con el estilo real de la tienda (flecha verde + negritas) para ver cómo queda antes de guardar
- Guarda exactamente el mismo formato de siempre (una línea por paso, `**negrita**` opcional): la tienda muestra lo mismo que venía mostrando, no hizo falta tocar nada del sitio público
- Corregido en el camino un bug del primer intento: al agregar una fila vacía no aparecía y se pisaba el último paso real; ahora las filas vacías se dibujan siempre
- E2E en local: cargar los 5 pasos existentes, editar con negrita (preview la marca), reordenar, agregar, quitar y guardar → los 5 pasos intactos en settings y en el modal real de la tienda. Typecheck ✅, build ✅, 158/158 tests ✅

## 2026-09-30 — Importar: casilla "Repetir automáticamente"

- Al analizar un link en la pestaña Importar, aparece la casilla **"Repetir automáticamente todos los días"** al pie del resultado (con o sin productos): al marcarla se despliega nombre opcional, grilla de horarios (hora Argentina, pre-cargada 09:00 y 21:00, tope 3) y el botón "Guardar repetición diaria"
- Crea la auto-importación con la **misma regla de precio elegida en Importar** vía POST /auto-imports (normalización https incluida); aviso final con los horarios elegidos y link a la pestaña Auto-importaciones, donde el link queda listado y editable
- La grilla de horarios del modal de Auto-importaciones ahora comparte código con el box (un solo lugar para los 24 botones y el tope de 3)
- E2E verificado en local: box generado, tope de 3 respetado, guardado real → fila persistida en D1 (URL, label, horarios, regla), visible/editable en Auto-importaciones y luego eliminada. Build ✅, typecheck ✅, 158/158 tests ✅

## 2026-09-30 — Dashboard resumido y en lenguaje cotidiano

- El Dashboard del panel deja de repetir avisos: los textos "se actualiza solo cada 15 segundos" de Estado por fuente e Historial se quitaron (la auto-actualización se mantiene igual), y la fila "Error —" ya solo aparece cuando hay un error real
- "Salud del cron (7 días)" pasa a **"Actualizaciones automáticas — últimos 7 días"**: plegado para no ocupar pantalla, con las columnas y valores renombrados ("Corridas" → "Actualizaciones", "Tasa de éxito global" → "Salieron bien el %", "Duración promedio" → "Tardan en promedio")
- Los datos de las 4 secciones (Estado del catálogo, Estado por fuente, estadísticas 7 días e Historial) no cambian; build ✅, typecheck ✅, 158/158 tests ✅, verificado por DOM en local

## 2026-09-30 — Configuración en secciones plegables

- La pestaña Configuración pasa de una lista larguísima de campos sueltos a **5 secciones que se abren y cierran** tocándolas: **Tienda** (nombre, dirección, horarios, redes y link de seguimiento — abierta por defecto), **Ventas** (WhatsApp, moneda y texto «Cómo comprar»), **Pagos online (MercadoPago)** (toggle, nota de envío, recargo, descuento, CBU e indicador del token), **Mantenimiento** (toggle + mensaje) y **Seguridad** (cambio de contraseña del panel)
- El indicador «Sincronización» queda como texto fijo arriba del botón guardar (apunta a Auto-importaciones)
- Guardado con un solo botón, igual que antes: se verificó guardar sin cambios → toast «Configuración guardada» y los 20 campos intactos; ninguna clave de settings cambió
- Marker terminal `[+]` / `[-]` en cada sección (CSS `.cfg-group`); build ✅, typecheck ✅, 158/158 tests ✅, verificado por DOM + screenshots en local

## 2026-09-30 — Deploy: "Sin stock" como filtro dentro de Productos

- Deploy `6e794dc9-e7a5-4fc7-97bf-0064a8c11fe4` (commit `5bf3747`); en producción el menú quedó con 9 pestañas (sin "Sin stock") y el filtro de sin-stock activo en el sistema del panel

## 2026-09-30 — Deploy: estilos unificados + menú del panel reordenado

- Deploys con commit `1051180` (estilos terminal en páginas del worker + mensaje "Ya avisé" con detalle) y `d5549a8` (menú agrupado con contador de pendientes); versión activa `b26889e9-cf20-44a9-ade8-be10566ff900`
- Smoke en producción: home 200, pedido 404, seguimiento 200, webhook 200, y el `/admin/` sirviendo el menú agrupado (4 `menu-group`) con el badge de pendientes en el bundle (`admin-8iwTez5u.js`)
- La página /pedido/:id sirve la versión con tema terminal (JetBrains Mono en el HTML)

## 2026-09-30 — Menú del panel reordenado en grupos

- Las 10 pestañas planas (que se partían en 3 líneas mezcladas con la marca) pasan a **4 grupos en columnas con etiqueta**: **Ventas** (Pedidos, Estadísticas), **Catálogo** (Productos, Categorías, Sin stock), **Importación** (Importar, Auto-imp., Reglas) y **Sistema** (Dashboard, Configuración)
- Criterio de orden: lo más usado primero (Ventas), abastecimiento agrupado, y lo esporádico al final; los hashes de rutas no cambian (#orders, #products, …), así que los links guardados siguen funcionando
- **Contador ámbar de pedidos pendientes** junto a la pestaña Pedidos (aparece al entrar a la pestaña y se actualiza con cada acción; se oculta en 0, tope 99+)
- Nombres cortos en el menú ("Auto-imp.", "Reglas"); los títulos dentro de cada vista quedan completos. Marca y botón Salir en la barra de arriba
- Responsive: en <900px los grupos compactan y en <640px se apilan uno debajo del otro (verificado a 420px)
- 158/158 tests ✅, typecheck ✅; vistas verificadas por DOM (dashboard/products/rules/orders)

## 2026-09-30 — Mensaje de "Ya avisé" del panel con el detalle del pedido

- El WhatsApp que abre el botón "Ya avisé" ya no manda el texto genérico: ahora sigue el mismo estilo que la página /pedido/:id — saludo con el nombre del comprador, confirmación con el nombre de la tienda, id de pedido, ítems y total (formatPrice con el símbolo configurado)
- Fix colateral: la pestaña Pedidos tenía el símbolo de moneda hardcodeado "$"; ahora usa `currencySymbol` de la configuración
- Verificado en el panel local capturando el mensaje: "Hola Juan Transferencia! Te confirmo que tu pago en CenterPhone Celulares quedó acreditado ✅ / Pedido: 04b9f12e… / • 1x Pila TyE CR2016 blister x 5 / Total: $3.024 / ¿Coordinamos la entrega cuando quieras?"

## 2026-09-30 — Estilos unificados al tema terminal en las páginas del worker

- Mantenimiento, `/pedido/:id` (con sus 4 estados y el 404) y la intermedia de `/seguimiento` abandonan el estilo claro genérico (system-ui, blanco, bordes redondeados) y usan **el mismo tema terminal/CRT del sitio**: fondo `#0b0f14`, panel `#10161d`, borde `#33475e`, texto `#d7e2ea`, verde `#3fb950`, JetBrains Mono, sombras duras y scanlines
- Badges de estado con los mismos colores que el panel: ámbar (`pending`), verde (`paid`), rojo (`cancelled`/`rejected`) — el JS de auto-refresh también actualiza el color del badge al cambiar el estado
- Botones WhatsApp iguales a los del sitio (verde `#3fb950` con texto oscuro y sombra dura); descuento y acreditación en verde; hint de pendiente en ámbar
- CSP de las 3 páginas ampliada para Google Fonts (JetBrains Mono), igual que el sitio principal
- Verificado visualmente en local (screenshot de las 3 páginas con mantenimiento activo); 158/158 tests ✅, typecheck ✅

## 2026-09-30 — Deploy del modo mantenimiento

- Deploy `4bc11e78-d6e5-4c54-8708-fb6342a3d966`; en producción la tienda sigue abierta (`maintenanceMode: false`), smoke OK (home 200, webhook 200, pedido 404, admin 200) — listo para activar desde Configuración cuando haga falta

## 2026-09-30 — Modo mantenimiento: cerrar el catálogo sin perder a los clientes

- **Toggle + mensaje en Configuración** (`maintenanceMode` / `maintenanceMessage`): al activarlo, todo el sitio público responde **503** con una página del worker (🛠️, mensaje configurable, botón grande de **WhatsApp** y links a **Instagram/Facebook** del panel); `Retry-After` y `no-store` para que no quede cacheada ni indexada
- **Excepciones pensadas para operar**: panel (`/admin`, `/api/admin`) para poder desactivarlo, seguimiento de pedidos (`/pedido/:id`, `/api/orders/:id`) para compradores que ya pagaron, `/api/payments/webhook` (que MP no reciba 503) y `/seguimiento`; los estáticos (assets, favicon, 404) también pasan. `/api/orders/transfer` NO está exenta: es una ruta de compra (la detectó el test)
- Checkout por MP y por transferencia quedan bloqueados (no se pueden crear pedidos que nadie va a cerrar mientras el catálogo está cerrado); el webhook sigue procesando pagos pendientes de antes
- Implementado como middleware en `maintenance.ts` montado antes de todas las rutas; CSP sin scripts (`script-src 'none'`, la página es HTML/CSS puro)
- Tests nuevos (exentas/bloqueadas/HTML) — **158 en total** ✅, typecheck ✅
- E2E en local: tienda cerrada con WhatsApp/redes visibles (verificado por curl y screenshot), panel 200, pedido real visible, webhook 200; desactivado por API vuelve el 200

## 2026-09-30 — Deploy del botón de transferencia

- Deploy `9d97c1e4-fb67-47b0-b6f4-cf695c582e75` con `POST /api/orders/transfer` vivo en producción (400 sin body = validación activa) y el bundle nuevo con el botón
- Settings de producción correctos: descuento 10% activo, recargo MP 0%, CBU vacío (cargarlo desde Configuración → Pagos)

## 2026-09-30 — Botón "Coordinar por transferencia" en el carrito (pedido sin pasar por MercadoPago)

- **Nueva ruta `POST /api/orders/transfer`**: mismas validaciones, rate limit y anti-fraude que `/api/checkout` (recalcula todo desde D1, `sameSiteOrigin`), pero SIN preferencia de MP; descuenta el descuento configurado y congela el ajuste como ítem `descuento-transferencia` (negativo) en `items_json`
- **Refactor**: `finalizeOrder(c, settings, mode)` comparte validación+persistencia entre ambos checkouts; el modo `mp` suma el recargo y `transfer` resta el descuento — un solo INSERT por pedido (eliminado el intento de `updateOrderTotals`)
- **Carrito**: botón verde "Coordinar por transferencia" (visible solo con descuento > 0) bajo "Pagar con MercadoPago"; crea el pedido y muestra pantalla de éxito con el total a transferir, el link `/pedido/:id` y el botón WhatsApp con el mensaje pre-cargado (ítems, descuento, total final y CBU/alias configurable nuevo `transferCbu`)
- **Fix**: `formatPrice` ahora maneja negativos ("-$294") y `rowToOrder` ya no aplasta los precios negativos a 0 (el clamp defensivo rompía el ítem de descuento)
- **Panel**: campo CBU/alias en Configuración → Pagos
- Tests: 3 nuevos de `/api/orders/transfer` (descuento congelado sin tocar MP, sin ajuste con descuento 0, validaciones/403) — **154 en total** ✅, typecheck ✅
- Verificado E2E en local: pedido `3fadbca8…` pending con total $2.646 (de $2.940, 10% off), página del pedido mostrando "-$294" y el vendedor lo cierra igual que cualquier otro

## 2026-09-30 — E2E del flujo de transferencia: consulta → pedido → pagado a mano → aviso

- Flujo completo probado en local (mismo código en producción): la nota del carrito muestra el total con descuento ($3.360 → $3.024) y el mensaje de "Consultar este pedido" sale con la línea "Con el 10% de descuento por transferencia: $3.024"
- Detalle del flujo real descubierto: la consulta por WhatsApp no crea pedido (texto libre); para que el vendedor lo tenga en el panel el comprador completa el checkout de MP pero no lo paga — el pedido queda `pending` y se cierra a mano con la transferencia
- Panel: "✓ Pagado" pasó el pedido a `paid` (apareció "💬 Ya avisé"), cuyo click abrió WhatsApp al comprador (texto pre-cargado) y marcó `notified_wa=1` — verificado en D1 y con /pedido/:id en "✅ Pago confirmado"

## 2026-09-30 — Deploy y configuración del recargo/descuento en producción

- Deploys `e69ccaab` (feature) y `3ced5b0a` (fix de UI) con el recargo MP y el descuento por transferencia; el panel de producción sirve el bundle con los campos nuevos
- **Configuración aplicada en la KV remota** (escritura directa preservando las 20 keys): `mpSurchargePercent: 0` (sin recargo — decisión del vendedor) y `transferDiscountPercent: 10` (incentivo a transferir)
- Verificado en producción con el carrito real: producto de $68.160 muestra la nota "Pagando por transferencia tenés 10% de descuento: total $61.344" y el mensaje de WhatsApp incluye la línea del descuento; con recargo 0% el total se muestra simple (fix de condición `surchargePercent > 0` en vez de monto)
- `/api/public/settings` refleja los valores; los campos quedan editables desde Configuración → Pagos del panel

## 2026-09-30 — Recargo por pago con MercadoPago y descuento por transferencia (configurables en el panel)

- **Dos ajustes nuevos en Configuración → Pagos**: `mpSurchargePercent` (recargo % del pago online, se cobra de verdad) y `transferDiscountPercent` (descuento % por transferencia, informativo); ambos enteros 0-50, fuera de rango = 0 (`clampPercent`)
- El recargo se **congela como ítem extra** (`recargo-mp`) dentro de `items_json` y entra al `total_cents` del pedido: /pedido/:id, el panel y la preferencia de MP muestran SIEMPRE el mismo número — y el % queda congelado al momento de comprar, aunque el vendedor lo cambie después
- Carrito: muestra subtotal + "Total con pago online (incluye recargo de N%)" y una nota verde con el total con descuento por transferencia; el mensaje de WhatsApp de "Consultar este pedido" incluye la línea del descuento
- El descuento NO lo cobra el sistema: es una herramienta de venta para el cierre por WhatsApp (el vendedor coordina el cobro)
- Tests: nuevo caso del recargo server-side (ítem extra en la preferencia + total del pedido congelado) — **151 en total** ✅, typecheck ✅

## 2026-09-30 — Limpieza de la cola de pedidos de producción

- El pedido de verificación `5aae15d9…` quedó cancelado (el vendedor lo canceló desde el panel); no hay pedidos `pending` en la D1 remota: solo 2 `paid` (el real de Valeria Pain vía webhook y uno marcado a mano) y 4 `cancelled` de pruebas
- Backfill con la API de MP: el pedido `57b79490…` quedó con `payer_email: valeriapain@gmail.com` (del pago `approved` confirmado). El **preference id no es recuperable**: MP no lo incluye en el payload del pago, así que los pedidos anteriores al deploy quedan sin él
- `e840c82a…` ($9.230, Jorge Esquivel) verificado contra la lista completa de pagos de MP del 29–30/9: **ningún pago coincide** (ni monto ni external_reference) — se pagó por fuera de MercadoPago y se marcó a mano desde el panel; queda sin `mp_payment_id` a propósito (no se inventan ids), pendiente cobro/registro fuera del sistema

## 2026-09-30 — Deploy a producción: persistencia de datos de MP + panel de Pedidos

- Deploy `9a07ccc7-1122-4735-9864-c283d5d036ec` (sucesor de `bd1c4a85`) con la persistencia y la mejora del panel; el `/admin/` sirve el bundle nuevo (`admin-BQtVfl_N.js`)
- **Verificado en producción**: `POST /api/checkout` real creó el pedido `5aae15d9…` ($840) con `mp_preference_id` guardado en D1 remota por primera vez (antes quedaba siempre NULL)
- Smoke post-deploy OK: home 200. El `payer_email` se llenará con el próximo pago real vía webhook
- Cancelar el pedido de verificación quedó como tarea pendiente del vendedor (o lo usa para probar el flujo de pago completo)

## 2026-09-30 — Panel de Pedidos: preferencia de MP visible junto al estado

- La celda de Estado de la pestaña Pedidos ahora también muestra el id de preferencia de MP (`Pref …`), truncado a 22 caracteres con el id completo en el tooltip; se suma al `MP <payment_id>` existente y al email del pagador bajo el comprador
- Los pedidos anteriores al deploy de la persistencia no tienen esos datos en D1: las celdas se muestran solo cuando el pedido los tiene
- 150/150 tests ✅, typecheck ✅

## 2026-09-30 — Persistencia de payer_email y mp_preference_id desde el flujo de pagos

- **`mp_preference_id` por fin se guarda**: existía `setOrderPreference` en `orders.ts` pero nadie la llamaba — ahora `POST /api/checkout` persiste el id de preferencia que devuelve MP (permite rastrear el checkout y asociar notificaciones futuras de MP)
- **`payer_email` en el webhook**: `fetchPayment` ahora extrae `payer.email` de la re-consulta a la API de MP (con trim) y `updateOrderStatus` lo persiste junto con `mp_payment_id` — el email del pagador ya no queda solo en MP
- **Fix colateral en `sameSiteOrigin`**: el header `Host` no está siempre disponible (undici lo filtra en tests); ahora cae al host de la URL del request, mismo resultado en producción y testeable en vitest
- Tests nuevos en `checkout.test.ts` (4): webhook persiste email+payment id, no baja un pedido paid, pedido desconocido no toca nada, checkout guarda el preference id y recalcula el precio desde D1, y 503 sin token — **150 en total** ✅, typecheck ✅

## 2026-09-30 — Webhook de MercadoPago verificado con el pago real en producción

- Cerrado el circuito E2E con el pago real del 2026-09-29: el pedido `57b79490f746a0ac461a4e69c4863c5e` (Valeria Pain, $840, Encendedor TAYO) quedó **`paid` con `mp_payment_id: 181520554414`** — dato que solo escribe el webhook al confirmar
- Verificación cruzada contra la API de MP (`GET /v1/payments/181520554414`): `status: approved` / `accredited`, monto 840, `external_reference` = el pedido, `test_mode` null y payer `valeriapain@gmail.com` — el webhook actuó correctamente sin configuración en el panel de MP
- Nota para mejora: el webhook hoy guarda solo `mp_payment_id`; el email del pagador queda en MP y la columna `payer_email` de D1 queda vacía (agregar su persistencia en el webhook)
- Pedidos de prueba de hoy (`e1bd9bcb...` para reintentar el E2E, y `d9f1f044...`) cancelados sin pago

## 2026-09-30 — Fix B2: rate limit del login admin con regla WAF en el borde

- Cerrada la única debilidad de la auditoría: regla WAF de rate limiting en la zona `centerphone.com.ar` para `POST /api/admin/login` (fase `http_ratelimit`, regla "Rate limit login admin (fix B2)", id `9c74f29bad9e4e1e8d67cc39a046e3e5`)
- Límites del free plan descubiertos vía errores de la API: el período y el `mitigation_timeout` solo admiten **10 segundos**, y las características exigen `cf.colo.id` además de `ip.src` (el conteo se hace por colo)
- Diseño final: 5 requests cada 10s por IP → `block` durante 10s (≈30/min sostenido, más estricto que el límite en memoria de la app, que queda como segunda capa)
- Verificado contra producción: ráfaga de 8 logins → 5×`401` + 3×**`429`** del borde (~50ms, sin llegar al worker); a los 12s vuelve a responder `401` al expirar el bloqueo
- `CHECKLIST_SEGURIDAD.md`: nuevo caso 3.2b para reprobar la regla con curl, y conclusión de la auditoría actualizada
- Creada vía API (`PUT /zones/{zone}/rulesets/phases/http_ratelimit/entrypoint`); en el dashboard queda visible en Seguridad → Reglas

## 2026-09-29 — Fix de configuración de pagos en producción (secret + toggle)

- **Secret mal creado corregido**: el intento anterior de `wrangler secret put` había guardado el token como **nombre** del secret (request interactivo: pide nombre y valor por separado). Creado `MERCADOPAGO_ACCESS_TOKEN` con el token renovado como valor y borrado el secret-artefacto. Confirmado que usa la credencial RENOVADA: el `pref_id` de MP arranca con el app id nuevo (`13230033`)
- **Toggle `paymentsEnabled` estaba en `false` en la KV de producción** (el guardado desde el panel nunca llegó o se hizo antes del deploy): activado directamente en KV remota (`config:settings:v1`), preservando el resto de los valores
- Verificado end-to-end en producción: `POST /api/checkout` crea preferencia real (producto $840), pedido en D1 remota con precio recalculado server-side, `/pedido/:id` en vivo y checkout de MP cargando con los medios de pago del vendedor
- Lección: `npx wrangler secret list` muestra solo nombres — si el valor queda vacío el worker responde 503 "pago online no habilitado" sin más pista

## 2026-09-29 — Deploy a producción: carrito + MercadoPago en centerphone.com.ar

- Migración D1 **remota** aplicada (tabla `orders` + índice, 8 tablas + `_cf_KV`) y deploy `bd1c4a85` con todo el flujo de pagos
- Verificado en producción: home 200, `/api/admin/orders` sin sesión 401, webhook responde, `/pedido/:id` inexistente 404, checkout **503 correcto** hasta activar el toggle en el panel
- Pendiente del usuario: renovar el token de MP (el anterior quedó expuesto en el chat), cargarlo con `wrangler secret put MERCADOPAGO_ACCESS_TOKEN` y activar "Pagos online" en Configuración → Pagos del panel de producción
- El webhook no requiere configuración en MP: la `notification_url` viaja en cada preferencia

## 2026-09-29 — Token MP configurado + fix de auto_return/back_urls en local

- Token de acceso de MercadoPago cargado en `.dev.vars` (local); `payments/status` ahora reporta `configured: true` y **el checkout crea preferencias reales**: verificado end-to-end con el checkout de MP abierto en navegador ("¿Cómo querés pagar?" con saldo del vendedor)
- **Fix: `auto_return` condicional** — MP rechaza la preferencia (`auto_return invalid. back_url.success must be defined`) cuando las `back_urls` no son https (caso local `http://127.0.0.1`). Ahora `auto_return` + `notification_url` solo se envían si `siteUrl` es https: en producción idéntico a antes, en local MP muestra el botón "Volver al sitio" y el webhook se puede probar con túnel https (cloudflared)
- `CF_SITE_ORIGIN` comentado en `.dev.vars` durante las pruebas (las `back_urls` apuntan a localhost); en producción no hace falta: cae al `url.origin` real del request
- Nota de seguridad: el token compartido por chat es de **producción** (`APP_USR-`) — recomendación de renovarlo desde el panel de MP; solo vive en `.dev.vars` (gitignoreado)
- 146/146 tests ✅ tras los cambios

## 2026-09-29 — Carrito + pago online con MercadoPago (Checkout Pro)

- **Nueva vía de cierre de venta**: carrito en `localStorage` con botones **Agregar** / **Comprar** en cards y ficha (solo "En stock"; sin stock sigue solo por WhatsApp), modal de carrito con cantidades (+/−), total, nota de envío configurable y opción de "Consultar este pedido" por WhatsApp
- **Checkout Pro**: `POST /api/checkout` valida el carrito **recalculando todos los precios desde D1** (el cliente solo manda `{id, qty}` — nunca precios ni totales), guarda el pedido en la nueva tabla `orders` con precios congelados y devuelve la URL de MercadoPago. Sin token configurado, `503` y el sitio funciona exactamente como antes
- **Webhook anti-fraude**: `POST /api/payments/webhook` responde 200 enseguida y con `waitUntil` **re-consulta el pago a la API de MP** (`GET /v1/payments/:id` con el secret); solo marca "pagado" si es `approved`, no es `test_mode` y la `external_reference` corresponde a un pedido conocido (idempotente, no baja un pedido de paid)
- **Página `/pedido/:id`** (HTML en worker con nonce, `noindex`): estado en vivo (auto-refresh 5s), detalle de ítems, total y botón **WhatsApp pre-cargado** con el detalle del pedido para coordinar entrega. El id de 32 hex es la única credencial (intratable)
- **Panel**: pestaña **Pedidos** con filtros por estado, detalle de comprador/ítems/MP ID, acciones (marcar pagado, cancelar, "Ya avisé" que abre WhatsApp al comprador), y sección **Pagos** en Configuración con toggle `paymentsEnabled`, nota de checkout, indicador de token configurado sí/no y instrucciones del secret + webhook
- Secret nuevo `MERCADOPAGO_ACCESS_TOKEN` (`.dev.vars` local con valor vacío; en producción `npx wrangler secret put`). `AGENTS.md` actualizado: carrito + pagos quedan dentro del alcance del proyecto
- Settings nuevos: `paymentsEnabled` (default off) y `checkoutNote`. `publicSettings` los expone al frontend
- Tests: 21 nuevos (validación server-side del carrito, cliente MP con fetch mockeado, carrito localStorage) — **146 en total** ✅. Typecheck ✅
- Schema D1: tabla `orders` + índice (aplicada en local; en producción correr `wrangler d1 execute celu-store-db --remote --file=db/schema.sql` al deployar)

## 2026-09-29 — Checklist manual de auditoría de seguridad post-deploy

- Nuevo `CHECKLIST_SEGURIDAD.md`: 7 secciones con comandos curl listos para copiar y resultado esperado de cada caso
- Cubre: cabeceras (A1), tracking (A2), login + rate limit, flags de cookies, logout que revoca (M4), cambio de contraseña que cierra otras sesiones y persistencia en KV (M1), https forzado (B1/B3), límite de descarga (M3) y smoke test funcional del panel
- Incluye tabla de resultados con la primera fila ya registrada (auditoría del deploy `189fe0d4`)

## 2026-09-29 — Fixes M4+B1+B3: logout que revoca sesiones y https forzado en URLs configurables

- **M4 — Logout revoca la sesión**: `POST /api/admin/logout` guarda un epoch de revocación en KV (`admin:sessions-revoked-before`); el middleware rechaza todo token emitido antes de ese epoch (inferido del token: `expiry - TTL`). Una cookie copiada (máquina compartida) muere en el logout, no recién al expirar. Margen de 5s hacia atrás por desvíos de reloj entre isolates. 1 lectura de KV por request admin (lecturas gratis ilimitadas en el free tier)
- **B1 — https forzado en fuentes**: nuevo helper `forceHttpsUrl` en `settings.ts` (normaliza agregando `https://` si falta; **rechaza** `http://` explícito). Aplicado a: URLs de auto-importaciones (400 si no es https válida), `sourceUrl` de `/import` y `syncUrl` en settings
- **B3 — https en /seguimiento**: el destino (`trackUrl`) se pasa por `forceHttpsUrl`; un valor viejo en `http://` cae al fallback https en vez de derivar a texto claro
- Las URLs de settings del panel (maps/instagram/facebook/track) ahora pasan por la misma validación estricta
- Tests: 12 nuevos en `session-revoke.test.ts` (revocación en KV, tokens viejos rechazados / nuevos aceptados, persistencia del epoch, `sessionIssuedAt`, y 7 casos de `forceHttpsUrl`). **125 en total** ✅
- Verificado en vivo (local): login → logout → **la misma cookie da 401** (antes seguiría válida); re-login OK; auto-import con `http://` → 400; sin esquema → se guarda como `https://`; `/seguimiento` con setting http cae al fallback https

## 2026-09-29 — Deploy a producción de los fixes de seguridad (A1+A2+M1+M3)

- Deploy `189fe0d4` a centerphone.com.ar con cabeceras de seguridad, tracking protegido, contraseña persistida en KV y límite de descarga
- Verificado en producción: CSP/XFO/nosniff/Referrer-Policy/Permissions-Policy en `/`, `/admin/` y `/seguimiento`; `Cache-Control: no-store` en el panel (fix B4 de yapa); tracking externo 403 / propio 204; login con password incorrecta 401 (la real intacta); catálogo API OK; www → apex 301; nonce en `/seguimiento`
- Ajuste post-deploy 1: la regla `no-store` de `_headers` ahora cubre también `/admin` y `/admin/` (antes solo `/admin/index.html`, que no matchea el path sin sufijo)
- Ajuste post-deploy 2: la CSP bloqueaba el beacon de Cloudflare Web Analytics (inyectado por el proxy en producción) — agregado `static.cloudflareinsights.com` a `script-src` y `cloudflareinsights.com` a `connect-src`. Verificado en navegador: consola limpia con 980 productos renderizados
- **Nota**: al cambiar la contraseña desde el panel en producción, ahora persiste en el KV del deploy (no hace falta `wrangler secret put`)

## 2026-09-29 — Fix M1: contraseña admin persistida en KV + invalidación de sesiones

- **El cambio de contraseña desde el panel ahora persiste de verdad**: hash PBKDF2 (SHA-256, 100k iteraciones, salt aleatorio) guardado en KV (`admin:password`). Antes solo mutaba `env.ADMIN_PASSWORD` en el isolate actual — otros isolates seguían aceptando la vieja y al redeployar volvía
- **Invalidación de sesiones activas**: al cambiar contraseña se rota el secret de sesión (KV `admin:session-secret`); todas las cookies firmadas con el secret anterior quedan inválidas (otras pestañas/dispositivos tienen que volver a entrar). La sesión que hizo el cambio se re-emite con el nuevo secret para no cortarse a sí misma
- Nuevo módulo `src/worker/admin-credentials.ts`: `verifyAdminPassword` (KV con fallback al secret `ADMIN_PASSWORD` para migración sin pasos manuales), `changeAdminPassword`, `getSessionSecret` (KV → `ADMIN_SESSION_SECRET` → `ADMIN_PASSWORD`, con cache por isolate — de paso implementa el espíritu de M2)
- `verifySessionToken` ahora usa `timingSafeEqualStr` (compatible Node/workerd; antes dependía de `crypto.subtle.timingSafeEqual` que solo existe en workerd)
- Login, middleware de sesión y `POST /api/admin/password` usan los nuevos helpers. El panel muestra "Contraseña cambiada y guardada. Las otras sesiones activas quedaron cerradas."
- Tests: 7 nuevos en `admin-credentials.test.ts` (PBKDF2 verify/salt único, fallback de migración, KV manda sobre secret, persistencia del hash, rotación de secret invalida tokens viejos, cadena de fallbacks del secret). **112 en total** ✅
- Verificado en vivo (local): login con contraseña de `.dev.vars` (migración) → cambio → la vieja da 401 y la nueva 200 **tras reiniciar el server completo** (isolate nuevo, prueba clave de M1); sesión de otro "dispositivo" → 401 tras el cambio; password restaurada a `admin123` al final. Hash visible en KV local via `wrangler kv key get`
- Nota para producción: el KV es el del deploy (`celu-store-db` KV namespace) — no requiere `wrangler secret put` para cambiar la contraseña nunca más

## 2026-09-29 — Fixes de seguridad A1+A2+M3 (cabeceras, tracking, límite de descarga)

- **A1 — Cabeceras de seguridad**: nuevo módulo `src/worker/security.ts` con middleware en `index.ts` (aplicadas después de `next()`, con recreación de la respuesta si los headers son inmutables — caso de la Response cruda de ASSETS en `/`). CSP con nonce por request (sin `unsafe-inline` en scripts), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Cobertura doble: rutas dinámicas vía middleware, assets estáticos vía nuevo `_headers` (copiado a `public/` en el post-build). `/admin/index.html` además con `Cache-Control: no-store`. La página `/seguimiento` mantiene su único script inline pero ahora con nonce (y CSP propia más estricta con `strict-dynamic`)
- **A2 — Tracking protegido**: `POST /api/track` rechaza (403) requests sin Origin/Referer propio o de otro dominio. En producción solo acepta `centerphone.com.ar`/`www`; en local también `localhost`/`127.0.0.1` para no romper el desarrollo. Evita el inflado de métricas y el consumo de cuota D1 del free tier
- **M3 — Límite de descarga**: `fetchText` en `extract.ts` ahora usa `readBodyCapped` (8MB máx): rechaza por `Content-Length` antes de descargar o corta el stream a mitad si el body supera el tope — una fuente gigante no puede reventar la memoria del isolate
- `wrangler.jsonc`: `run_worker_first` vuelve a solo `["/"]` (probar de enrutar `/admin/*` por el worker rompía el serving del panel — 404)
- Tests: 14 nuevos (10 de `security.ts` + 4 de `readBodyCapped`), 105 en total. Typecheck ✅, build ✅
- Verificado en vivo (local): cabeceras presentes en `/`, `/api/*`, `/admin/`, `/seguimiento` y `/assets/*.js`; tracking local 204 / externo 403; catálogo renderiza 829 productos con imágenes de CDN (CSP no rompe); `/seguimiento` auto-deriva (nonce ejecuta); login admin intacto

## 2026-09-29 — Auditoría de seguridad (solo informe, sin cambios de código)

- Revisión completa de auth/sesiones, rutas admin y públicas, SQL, XSS, secrets y extracción de fuentes
- Informe con hallazgos por severidad en `INFORME_SEGURIDAD.md`: sin cabeceras de seguridad (CSP/XFO) y `/api/track` sin límites como prioridad alta; cambio de contraseña por-isolate, secret de sesión, límite de tamaño en `fetchText`, logout no invalida token, etc.
- Lo verificado como correcto: HMAC timing-safe, cookies HttpOnly/Secure/SameSite, SQL 100% parametrizado, secrets fuera del repo, escapado HTML consistente, rate limit de login

## 2026-09-23 — Panel de salud semanal del cron en el Dashboard

- Nuevo panel **"Salud del cron (7 días)"** entre "Estado por fuente" y el historial:
  - Tarjetas: corridas totales, exitosas/con error, **tasa de éxito global** y **duración promedio** de importación
  - Tabla por fuente: corridas, OK, errores, tasa de éxito y duración media (agrega `sync_log` de los últimos 7 días por `detail` = URL)
- Colores de tasa: **verde ≥90%**, naranja ≥70%, **rojo <70%** — las filas con tasa <70% se resaltan con fondo rojo y muestran ⚠ con el último error en tooltip
- Endpoint `GET /api/admin/sync/health` (protegido, igual que el resto del admin) con nuevo módulo `src/worker/health.ts`
- Se carga en paralelo con el resto del dashboard (`Promise.all`) — no agrega demora; si falla, el dashboard funciona igual sin el panel
- Verificado en local con datos reales: 76 corridas / 79% global / 9.6s promedio, mascotas 100% (19 corridas), fuentes de prueba muertas en rojo al fondo. Typecheck ✅, **91/91 tests** (3 nuevos) ✅ · deploy `21ebd068`

## 2026-09-23 — Recuperación automática de fuentes atrasadas en el cron

- Complemento del alerta anterior: si un job activo con horarios tiene `lastRunAt` de hace **más de 24h** (el cron lo salteó por timeout/corte de CPU), el **próximo tick del cron lo recupera aunque no sea su horario**
- La lógica vive en `isDueNow`, así que aplica a todos los caminos que deciden si un job corre
- No aplica a jobs inactivos ni sin horarios (los mismos criterios del alerta)
- Si nunca corrió (`lastRunAt` null) se respeta su horario normal — la primera corrida esperada no cuenta como atraso
- Tests: nuevo caso con 6 aserciones (atrasado +25h corre en cualquier tick, +23h respeta horario, null/inactivo/sin horarios no se recuperan). 88/88 ✅ · deploy `c0389651`

## 2026-09-23 — Alerta de fuentes atrasadas (>24h) en Auto-importaciones y Dashboard

- Un job **activo con horarios** cuyo `lastRunAt` tiene más de 24 horas se marca en rojo con badge **"⚠ atrasado >24h"**: detecta fuentes que el cron dejó de ejecutar (la anomalía que daba Auto-importaciones "todo OK" con fuentes muertas)
- Marca en ambas vistas: tabla de Auto-importaciones y panel "Estado por fuente" del Dashboard (fila resaltada + badge)
- No marca jobs sin horarios (nunca corren por cron, no es anomalía) ni inactivos (desactivados a propósito)
- Verificado en local con un job forzado a hace 2 días (badge y fila resaltada en ambas vistas). Typecheck ✅, deploy `0adcabe8`

## 2026-09-23 — Dashboard: estado por fuente + historial que ya no pierde corridas

**Causa raíz del "solo 2 links en el historial"**: cuando una fuente se colgaba, consumía todo el presupuesto de CPU y **mataba la invocación del cron entera** — las filas del historial se escribían al final (fire-and-forget) y se perdían. Hogar (con sus 502 intermitentes) era la que tumbaba las corridas de las 08:00.

- `fetchText` con **timeout de 20s** por intento: una fuente colgada ahora falla limpio (con reintento) en vez de matar el cron
- `logRun` es **awaitable**: la fila del historial se escribe ANTES de terminar la invocación y sobrevive a cualquier corte posterior
- Si el cron corta por presupuesto, la fila **"(pendientes)"** queda registrada en el historial con las fuentes que no corrieron
- `/sync/log` devuelve **`fuentes`**: lastRunAt/lastStatus de cada link de Auto-importaciones
- Dashboard: nuevo panel **"Estado por fuente"** con fuente, horarios, último intento y estado de cada link — responde "¿los 7 links están sincronizando?" de un vistazo, con refresco dinámico cada 15s
- La pestaña Auto-importaciones no cambia (sigue mostrando el detalle de cada job con su último error)
- Verificado en producción (home/fichas 200). Typecheck ✅, 87/87 tests ✅, deploy `62a82ffd`

## 2026-09-23 — Página intermedia de /seguimiento con Volver al catálogo

- `/seguimiento` ya no redirige directo: sirve una **página intermedia** propia (liviana, sin assets) con "📦 Te llevamos al seguimiento"
- **"← Volver al catálogo"** always visible: el cliente vuelve al home con un clic (el track-lite de RepairPro es externo y no se puede modificar)
- Auto-redirect con cuenta regresiva de 3s (`location.replace`, no ensucia el historial) + botón "Ir al seguimiento ahora" para los impacientes; el destino está en el `href` (funciona sin JS)
- `noindex` y `Cache-Control: no-store`: la página no se indexa ni se cachea (el destino cambia con el panel)
- El evento `track_view` sigue registrándose igual (la lógica de tracking no cambió)
- Verificado en local y producción. Typecheck ✅, deploy `8b13ec89`

## 2026-09-23 — Desglose de /seguimiento por ciudad y horario en Estadísticas

- Nuevas agregaciones en `getStatsSummary`: usos de `track_view` agrupados por ciudad/región (top 12) y por hora Argentina (24 barras, mismo formato que el histograma de visitas)
- Panel: nueva sección **"📦 Seguimiento de envíos (/seguimiento)"** con dos columnas (ciudad + horario), visible solo cuando hay usos registrados en el período
- Permite responder: ¿desde dónde y a qué hora consultan por su pedido? (ej. si se concentra de noche, convence publicar el horario de despacho en el modal Cómo comprar)
- Verificado en local: 4 usos de prueba registrados con geo (Santa Fe) y agrupación correcta. Typecheck ✅, 87/87 tests ✅, deploy `97b38b3c`

## 2026-09-23 — Auditoría de links externos: solo WhatsApp y Maps abren en pestaña nueva

- Barrido de todos los `target="_blank"` y `window.open` del sitio público
- Corregido: Facebook e Instagram (footer y modal de contacto, 4 lugares en `store-modals.ts`) ya no abren en pestaña nueva
- Se mantienen con pestaña nueva (por diseño): WhatsApp (botón flotante, botones de consulta, modales) y Maps (dirección del footer y modal)
- Los links internos del panel de admin (`/producto/...`) siguen abriendo en pestaña nueva para no perder el contexto de estadísticas — no son parte del sitio público
- Typecheck ✅, deploy `0236d50f`

## 2026-09-23 — Botón Seguimiento abre en la misma pestaña

- Quitado `target="_blank"` del botón Seguimiento del header (`index.html` y `product.html`): navega en la misma pestaña como el resto de la barra
- Deploy `18766f6d`, verificado en producción

## 2026-09-23 — Tracking de usos del atajo /seguimiento

- Nuevo tipo de evento `track_view` en estadísticas: cada vez que alguien entra a `/seguimiento` se registra con geo (país/ciudad/región de Cloudflare) y referrer externo
- El registro vive en el propio handler del redirect (try/catch: la medición nunca rompe el redirect)
- Panel: nueva tarjeta **"usos de /seguimiento"** en las estadísticas, junto a vistas, búsquedas y consultas WhatsApp — para medir el interés en envíos/seguimiento de pedidos
- Verificado end-to-end en local (redirect → evento en D1) y en producción (302 → track-lite). Typecheck ✅, 87/87 tests ✅, deploy `cb8900ff`
- Nota de entorno: el puerto 8787 local quedó ocupado por el dev server de otro proyecto (ZonaLiga); las pruebas locales de este proyecto corren en el 8788

## 2026-09-23 — Botón Seguimiento usa el atajo /seguimiento (redirect dinámico)

- `index.html` y `product.html`: el botón "Seguimiento" del header apunta ahora al atajo corto `/seguimiento` en vez de la URL completa hardcodeada
- El worker resuelve el destino dinámicamente: lee `trackUrl` del panel (KV) y redirige con **302** — si cambiás la URL en el panel, el atajo corto la respeta al instante, sin redeploy
- Fallback: si el campo está vacío en el panel, va a `https://repairpro.centerphone.com.ar/track-lite`
- `store-modals.ts`: ya no sobrescribe el href del botón (solo oculta/muestra según haya URL configurada)
- Verificado en producción: `/seguimiento` → 302 → track-lite ✅, botón del home con `href="/seguimiento"` ✅. Typecheck ✅, 87/87 tests ✅, deploy `e51da559`

## 2026-09-23 — Redirección /seguimiento → track-lite

- Nueva ruta 301 en el worker: `centerphone.com.ar/seguimiento` → `https://repairpro.centerphone.com.ar/track-lite`
- Verificada en producción: 301 con `Location` correcto. Typecheck ✅, deploy `0e14aa7c`

## 2026-09-22 — Detector de marcas ampliado (electro, audio, accesorios)

- Análisis de los 830 títulos sin marca del catálogo: barrido de palabras frecuentes y de términos en MAYÚSCULAS para identificar marcas reales vs. genéricos
- Nuevas marcas en `src/shared/brands.ts`: **Time** (33 productos), **GTS** (13), **Ecopower** (11), Seisa, Oryx, Hytoshy, QCY, Redragon, Energizer, Greatnice, Zeus
- Impacto: **113 títulos más** detectan marca (fallback por título del JSON-LD, sin re-importar). El resto (~717) son realmente sin marca (LED, cables genéricos, pilas sueltas) y quedan correctamente sin nodo `brand`
- Descartados deliberadamente como falsos positivos: KITTY/CAPIBARA/ASTRONAUTA (diseños de lámparas), RCA (conector), MACHO/HEMBRA/BLANCA (atributos)
- Tests nuevos: detección de las marcas del catálogo + no confusión con conectores/diseños. Typecheck ✅, **87/87 tests** ✅

## 2026-09-22 — Re-validación en Rich Results Test: brand aceptado, Brand sin name corregido

- Re-prueba de la ficha `/producto/6160` tras el deploy de marca + BreadcrumbList: **3 elementos válidos** (Fragmentos de productos, Fichas de comerciantes y el nuevo **Rutas de exploración/BreadcrumbList, sin problemas**) y 0 errores críticos
- **El warning de brand/GTIN desapareció**: Google ahora lee la marca (detectada por título o guardada en la columna `brand`) — antes era "no se ha proporcionado ningún identificador internacional"
- Fix menor detectado por la re-validación: cuando un producto no tiene marca guardada ni detectable (ej. accesorios genéricos), se emitía `{"@type":"Brand"}` sin `name` y Google lo marcaba como warning — ahora el nodo `brand` se omite si no hay nombre (`schema.ts`)
- Warnings restantes, todos opcionales e inevitables sin sistema de reseñas ni política formal: `review`, `aggregateRating` (Fragmentos) y `hasMerchantReturnPolicy`, `shippingDetails` (Fichas de comerciantes)
- Typecheck ✅, 85/85 tests ✅, deploy `da061244`

## 2026-09-22 — Typecheck del worker restaurado (7 errores preexistentes)

- `npm run typecheck` completo (web + worker) volvió a estar verde: estaba roto por drift de tipos de sesiones anteriores que esbuild no detecta (el runtime funcionaba igual)
- `sync.ts`: `detail: null` en los dos `insertSyncLog` y `isLastChunk` agregado al tipo de `importOptions`
- `admin.ts`: import de `SyncLogEntry`; `sanitizeProduct` completa `createdAt`/`sourceUrl`/`brand` (preserva los existentes); `jobs[].name` → `j.label` (el campo real de `AutoImport`, el frontend nunca usaba `name`)
- `db.ts`: `Dict` ahora se exporta (lo importaba `stats.ts`)
- `password` endpoint: eliminado el `execSync` de `node:child_process` que nunca puede correr en workerd (el cambio de contraseña sigue funcionando en caliente por isolate; para persistirlo sigue valiendo `wrangler secret put ADMIN_PASSWORD`)
- Nuevo `PENDIENTES.md`: registro la verificación en Search Console cuando Google re-rastree las fichas

## 2026-09-22 — BreadcrumbList JSON-LD en la ficha (rich snippets de migas)

- Nuevo `breadcrumbJsonLd()` en `src/web/schema.ts`: genera el JSON-LD `BreadcrumbList` con posiciones 1..n y URLs absolutas
- La ficha inyecta un segundo `<script type="application/ld+json">` (nodo `#json-ld-breadcrumbs`, reemplazado en cada render, nunca acumulado) con el trail **Inicio › Categoría › Producto** — espeja exactamente la miga visible del sitio (si el producto no tiene categoría, sale solo Inicio › Producto)
- URLs canónicas del dominio propio: `https://centerphone.com.ar/`, `/?cat=<id>` y `/producto/<id>`
- Google puede mostrar la ruta de categorías en el resultado de búsqueda en lugar de la URL cruda
- Verificado en local con navegador: JSON-LD con 3 escalones idéntico a la miga visible, 2 nodos JSON-LD coexistiendo en el head. Typecheck ✅, **85/85 tests** (2 nuevos) ✅

## 2026-09-22 — Detección de marca al importar + brand en el JSON-LD

- Nuevo `src/shared/brands.ts`: detector de marca por título con lista de aliases (Redmi/Poco→Xiaomi, Galaxy→Samsung, iPhone→Apple, Xperia→Sony, Kindle→Amazon, etc.) que matchea palabra completa y gana la coincidencia más temprana
- `normalizeExternalItems` ahora guarda `brand` en cada producto: usa el campo explícito de la fuente (`brand`/`marca`) si viene, si no detecta del título
- Nueva columna `products.brand` (migración `007-product-brand.sql`, aplicada en local): se persiste en `upsertProduct` y `upsertProductsBatch` con `COALESCE` para no pisar la marca ya guardada cuando una fuente no la trae
- El JSON-LD de la ficha incluye `brand { @type: Brand, name }` — **con fallback**: para los ~990 productos importados antes de la columna, se detecta del título en el momento del render (sin re-importar nada)
- Cierre del único pendiente no crítico del Rich Results Test (marca/GTIN). Los tests detectan el caso "Funda Samsung para iPhone 15" → Samsung (primera coincidencia)
- Verificado en local con navegador: ficha real pre-columna sale con `brand: Apple` detectado del título. Typecheck ✅, **83/83 tests** (7 nuevos) ✅
- **En producción**: migración 007 aplicada a D1 remota (columna `brand` verificada), commit `1049bb2`, deploy `d28fe896`. Ficha real en centerphone.com.ar con `brand` y `BreadcrumbList` verificados en navegador

## 2026-09-22 — Validación Rich Results Test de Google (ficha /producto/6160)

- Resultado: **2 elementos válidos detectados** — "Fragmentos de productos" y "Fichas de comerciantes" — con **0 errores críticos**. El JSON-LD pasa la validación de Google a la primera
- Problemas no críticos marcados (todos campos **opcionales**): `review`/`aggregateRating` (no hay sistema de reseñas — no se fakean), `brand`/GTIN (requeriría columna nueva con marca real del proveedor), `shippingDetails`/`hasMerchantReturnPolicy` (definir política de envíos/devoluciones si algún día se quiere el sello de comerciante verificado)
- Sin cambios de código: solo documentación de la validación

## 2026-09-22 — Rich snippets: JSON-LD schema.org/Product en la ficha

- Nuevo `src/web/schema.ts`: genera el JSON-LD con nombre, imagen, SKU, precio ARS (formato decimal que exige Google), disponibilidad (InStock/OutOfStock/PreOrder mapeada desde `availability` + `hiddenNoStock`), condición nueva y vendedor
- Inyectado en el `<head>` en cada render de ficha (nodo reemplazado, no acumulado); Google ejecuta el JS de la SPA y lo lee del DOM
- Base para que las fichas muestren precio y stock en resultados de búsqueda (rich snippets / ficha de producto de Search Console)
- Verificado en local y producción (`/producto/6160`): JSON válido con precio y disponibilidad correctos. Typecheck ✅, 76/76 tests ✅, deploy `9eddbacb`

## 2026-09-22 — Meta tags SEO del home (title, canonical, Open Graph)

- Title y description reales con la marca; `canonical` a `https://centerphone.com.ar/`; Open Graph completo (`og:title`, `og:description`, `og:image` con el logo, `og:url`, `og:site_name`) + `twitter:card` — la vista previa al compartir por WhatsApp/redes ahora muestra logo y nombre
- El JS actualiza `og:title` con el storeName del panel (el panel manda sobre el default)
- **Fix incluido**: al montar seoApp en la raíz, el fallback `app.all("*")` dejaba de capturar `/` y el home servía 404.html (detectado y corregido en producción; `app.get("/")` explícito)
- Verificado en producción: home con title/og/canonical ✅, www redirect ✅, fichas ✅, sitemap/robots/API ✅. Typecheck ✅, 76/76 tests ✅

## 2026-09-22 — SEO: sitemap.xml dinámico + robots.txt

- `sitemap.xml` generado on-the-fly desde D1: home (prioridad 1.0), categorías activas con `?cat=` (el formato que ya entiende el frontend) y todas las fichas de productos **publicados** (los ocultos/sin stock quedan excluidos de la indexación). Verificado en producción: 991 URLs
- Cacheado 24h en el edge con la Cache API (`CF-Cache-Status: HIT` verificado) — los bots no generan consultas a D1 en cada rastreo
- `robots.txt`: permite todo excepto `/admin`, declara el sitemap
- Nuevo módulo `src/worker/seo.ts` montado en la raíz del worker; typecheck ✅, 76/76 tests ✅, deploy `2941cc90`
- Alta en Google Search Console: pendiente del usuario (requiere su cuenta de Google); el sitemap ya está listo para declarar

## 2026-09-22 — Redirect 301 de www.centerphone.com.ar al dominio sin www

- Middleware en el worker: si el host es `www.centerphone.com.ar`, redirige 301 conservando path y query. Consolida SEO en un solo host (evita contenido duplicado)
- Detalle de plataforma descubierto: el home (`/`) se servía como asset estático **antes** de invocar el worker, así que el redirect no aplicaba ahí. Fix: `run_worker_first: ["/"]` en wrangler.jsonc (solo `/` pasa por el worker; el resto de assets se sirve directo)
- Verificado en producción: home de www → 301 → 200 final en dominio sin www ✅; fichas ídem ✅; dominio directo y workers.dev sin cambios ✅; `/api/catalog` sigue en HIT ✅. Deploy `3579f34a`

## 2026-09-22 — Dominio propio centerphone.com.ar + caché edge real

- **Custom domains verificados**: `centerphone.com.ar` y `www` ya apuntaban al worker (zona activa, confirmada vía API). El sitio responde 200 por el dominio
- **Caché edge real implementado con la Cache API del worker** (no con Cache Rules de zona: las reglas de zona no aplican a responses de Workers en custom domains). Primera visita ejecuta el handler y guarda en el cache del PoP; siguientes sirven desde el borde sin tocar D1/KV. Verificado: `CF-Cache-Status: HIT` en `/api/catalog` ✅
- **Invalidación por versión**: la clave de cache incluye `catalog:v` (KV); `regenerateSnapshot` hace bump de la versión, así el catálogo nuevo se ve al instante sin depender del TTL. Un write chico de KV por regeneración (free tier OK)
- Page Rule de prueba creada y eliminada (no aporta: duplicaba el cache de zona sin invalidación instantánea)
- `.dev.vars`: `CF_ZONE_ID` y `CF_SITE_ORIGIN=https://centerphone.com.ar` agregados. Pendiente para producción (opcional, solo si se vuelve a Cache Rules): `npx wrangler secret put CF_API_TOKEN`
- Verificado en producción: dominio 200, `/api/catalog` HIT, home HIT. Typecheck ✅, 76/76 tests ✅, deploy `93d6486c`

## 2026-09-21 — Auditoría de performance (re-medición post optimizaciones)

- Re-medición con el skill `performance` tras las mejoras de WebP/eager/preconnect. **Baseline**: TTFB 28-52ms, FCP 257ms, LCP 783ms (caché tibia) / 1374ms (CDN en frío), CLS 0, TBT ~87ms
- **Budget**: JS total ~20KB (límite 300KB) ✅ · CSS 25KB (límite 100KB) ✅ · fuentes via Google Fonts con preconnect ✅ · 0 scripts de terceros ✅ · página total muy por debajo de 1.5MB ✅
- **Sin acciones correctivas necesarias**: los 5 pesos de JetBrains Mono solicitados (400-800) están todos en uso en el CSS (no hay recorte posible); las imágenes "originales" detectadas eran lazy below-fold aún no resueltas (falso positivo); el LCP dominante es latencia del CDN del proveedor, no código propio
- Nota: el FCP 2530ms de la primera medición fue warm-up de compilación de wrangler dev, no un problema real

## 2026-09-21 — Deploy: fallback de imágenes

- Commit `1b8fef8` pusheado y deploy `9b751fa0`. **Verificado en producción**: home 200, bundle con el fallback activo ✅

## 2026-09-21 — Fix: imágenes que no cargaban tras recargar (fallback del CDN)

- **Diagnóstico**: las 983 URLs del CDN responden bien individualmente (verificado 1 por 1) — el fallo es por **ráfaga**: al recargar con caché fría, el navegador pide ~20 variantes WebP nuevas a la vez y el CDN del proveedor (también detrás de Cloudflare) a veces rechaza/aborta alguna, dejando la card sin imagen hasta otra recarga
- **Fix**: fallback automático con `onerror` — si la variante WebP falla, la img cae al original (que el CDN sirve sin transformación) en cascada de un solo intento (sin bucles); aplicado en cards del home, imagen principal de la ficha y thumbnails de relacionados
- Verificado: error simulado → fallback recupera la imagen; 20/20 cards con fallback activo y 0 rotas tras recarga limpia. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Deploy: estadísticas en producción

- Migración 006 aplicada en D1 remota (tabla `stats_events` + índices). Commit `d03c4eb` (11 archivos, +432/−2) pusheado y deploy `93e50d30`
- **Verificado en producción**: `POST /api/track` responde 204, un `home_view` real quedó registrado con geo (AR/Santa Fe), `/api/admin/stats` protegido con login (401 sin sesión), home 200 ✅

## 2026-09-21 — Estadísticas: gráfico de líneas de visitas por día

- **Gráfico SVG por día** arriba del histograma horario: línea con puntos interactivos (tooltip con fecha y cantidad), área bajo la curva, labels de fecha cada N días y escala que se adapta al período (7/30/90 puntos)
- Sin librerías: SVG generado a mano (path + polyline), 0KB extra de JS
- La serie incluye días sin visitas (en cero) para que la línea sea continua; agrupa `product_view` + `home_view` en hora Argentina
- Verificado en preview: 7 puntos en 7 días, 30 puntos en 30 días, tooltips activos. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Estadísticas en el panel: visitas, búsquedas, horarios y zonas

- **Nueva pestaña "Estadísticas"** en el panel con selector de período (7/30/90 días) y 8 secciones: resumen de totales (fichas vistas, búsquedas, consultas WhatsApp, visitas al home), histograma de visitas por hora (hora Argentina), artículos más visitados (top 20 con categoría), más consultados por WhatsApp, búsquedas frecuentes, búsquedas **sin resultados** (para detectar stock faltante), visitas por país, principales ciudades y origen (referrer)
- **Tracking sin servicios externos** (free tier): tabla `stats_events` en D1 (migración 006), endpoint público `POST /api/track` con beacon `sendBeacon` desde el home, la ficha y el buscador; la geo (país/ciudad/región) sale de `request.cf` que Cloudflare provee gratis en cada request — verificado: registra "Santa Fe" en local
- **Anti-inflado**: dedupe por sesión (una ficha cuenta 1 vez por sesión vía sessionStorage); búsqueda con debounce 1.2s; beacons inválidos se ignoran sin romper nada; retención de 90 días con purga automática en el cron horario
- Verificado de punta a punta: eventos reales desde el home y la ficha quedan en D1 con geo, pestaña renderiza las 8 secciones, selector de período funciona. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Deploy: toolbar, WebP responsive y caché edge

- Commit `6c67b32` pusheado (7 archivos, +98/−12) y deploy `d774a93e`. **Verificado en producción**: home HTTP 200, `/api/catalog` con `s-maxage=300`, bundle nuevo con srcset WebP activo ✅

## 2026-09-21 — LCP: imágenes responsive WebP del CDN + prioridad above-fold

- **Medición baseline** (local): TTFB 29ms, FCP 171ms, **LCP 549ms** — la primera imagen del CDN (1024px PNG de hasta 373KB servida para una card de 308px)
- **Descubrimiento clave**: el CDN de tiendanegocio soporta resize on-the-fly: la misma imagen a 320px en WebP pesa **12-19KB vs 157-373KB del original (−90%)**
- **`srcset` responsive**: las cards piden `?width=320&format=webp` (1x) y `?width=640&format=webp` (2x) con `sizes` según breakpoint; la ficha usa 480/960. Fallback al original en CDNs no soportados
- **Above-fold con prioridad**: las primeras 4 cards van `loading="eager" fetchpriority="high"` (el `lazy` en el visible sin scroll retrasa el LCP); el resto sigue lazy. Imagen principal de la ficha: eager + high
- **Ahorro real medido**: 20 cards pasan de ~2-4MB a ~300-500KB de imágenes; el navegador elige el WebP si lo soporta (97%+ de los browsers)
- Verificado en preview: cards y ficha cargan WebP del CDN (`?width=320&format=webp`), srcset/sizes correctos, eager/lazy repartidos bien. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Caché edge de /api/catalog (opcional, configurable)

- **`s-maxage=300` en `/api/catalog`**: con una Cache Rule de Cloudflare que cachee el API, el edge sirve el catálogo sin ejecutar el worker (0 ms de CPU por visita cacheada)
- **Purga automática**: cada `regenerateSnapshot` (importaciones, sync, ediciones del panel) purga el edge vía API de Cloudflare (`CF_ZONE_ID` + `CF_API_TOKEN` como secrets opcionales) — el catálogo nuevo aparece al instante, no espera 5 minutos
- Sin los secrets configurados todo funciona igual que antes (la purga se omite); el free tier de Workers no se ve afectado (la purga es 1 request por regeneración, dentro del límite)
- Verificado: header nuevo servido en local, typecheck ✅, 76 tests ✅

## 2026-09-21 — Toolbar en móvil 390px + fix de scroll horizontal

- **Verificación a 390px**: la fila superior entra cómoda (268px de contenido en 370px disponibles — Ordenar a la izquierda, contador a la derecha); chips de categorías/tags scrollean con degradado "has-more"; targets de tap ≥29px
- **Fix global**: `overflow-x: hidden` en `html` — las filas scrolleables de la toolbar propagaban scroll horizontal al documento (el body medía 2075px con viewport de 671px); verificado que el scroll de usuario queda bloqueado y el scroll interno de chips sigue funcionando
- Typecheck ✅, 76 tests ✅

## 2026-09-21 — Toolbar: alineación reordenada

- **Fila superior**: "Ordenar" a la izquierda y contador "20 de 829" a la derecha (`space-between`, antes ambos amontonados a la derecha con espacio vacío a la izquierda)
- **Chip "Limpiar (N)"**: alineado a la derecha de su fila de tags (`margin-left: auto`), separado de Nuevo/Destacado/Oferta
- Verificado en preview: alineación correcta, filtro Oferta muestra el chip a la derecha, limpiar restaura las 20 cards. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Deploy: mejoras de performance

- Commit `e45a751` pusheado (7 archivos, +27/−4) y deploy `ee996ffa`. **Verificado en producción**: home HTTP 200, `/api/catalog` sirve `Cache-Control: public, max-age=60, stale-while-revalidate=300` ✅

## 2026-09-21 — Auditoría de performance del home

- **Baseline medido** (local, home con 830 productos): TTFB 15ms, FCP ~170ms, LCP 641ms (una imagen del CDN externo), CLS 0.000, JS total ~70KB comprimido. Base sólida; los cuellos de botella reales eran el peso del catálogo y las imágenes externas
- **Snapshot liviano** (`/api/catalog`): descripción recortada a 160 chars (suficiente para la búsqueda del home) y `source_url` fuera del JSON (solo lo usa el panel, que lee de D1). Sin comprimir: 420KB → **305KB (−27%)**; comprimido en tránsito: **42KB → 35KB**
- **Cache-Control en `/api/catalog`**: `max-age=60, stale-while-revalidate=300` — el navegador no re-descarga el catálogo en navegaciones internas durante 1 minuto
- **Preconnect a `cdn.v2.tiendanegocio.com`** en home y ficha: las imágenes del proveedor (el LCP real del home) ahorran el handshake TLS del primer request (~100-300ms)
- **`decoding="async"`** en las imágenes de cards y relacionados: el decode no bloquea el hilo principal
- CLS ya era 0.000 (las cards usan `aspect-ratio: 1` en CSS) ✅; sin scripts de terceros ✅; JS < 300KB del presupuesto ✅
- Verificado: 20 cards renderizan, bundle con los cambios, typecheck ✅, 76 tests ✅

## 2026-09-21 — Deploy: reintentos automáticos

- Deploy a Cloudflare (`7c1ed976`): reintentos ante 522/5xx del origen. Commit `1bf9f62` pusheado. **Verificado en producción**: mascotas (7 importados) y hogar (135 + 1 sin stock) sincronizan OK — las 7 fuentes operativas

## 2026-09-21 — Reintentos automáticos: mascotas y hogar fallaban con 522 del sitio de origen

- **Diagnóstico**: mascotas y hogar no se actualizaban porque el sitio de origen (hacetupedido.com, también detrás de Cloudflare) responde a veces con **522 intermitente** — hogar importó 136 productos a las 15:24 y a las 15:46 dio 522 con la misma URL
- **Fix**: `fetchText` ahora reintenta **3 veces con espera creciente** (3s, 4.5s) ante 522/524/otros 5xx, 429 y fallos de red; los 4xx permanentes (404, 403) no se reintentan
- Verificado en local: mascotas (7 productos) y hogar (135 + 1 sin stock) importan OK. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Deploy: pausas automáticas contra el error 522

- Deploy a Cloudflare (`d53e9e81`): importación por lotes de 50 con pausa, pausas entre fuentes y presupuesto de tiempo en el cron. Commit `162d321` pusheado; 76 tests ✅; home HTTP 200 verificado en producción

## 2026-09-21 — Importación con pausas automáticas para evitar el error 522

- **Importar** ahora manda la selección en **lotes de 50 productos con pausa de 800ms** entre requests: cada request chico queda lejos del límite de CPU del plan gratis, que era lo que cortaba las listas grandes (522/"Error interno")
- El worker registra cada lote en el historial ("chunk 2/5") y el **ocultado por sin stock y el snapshot solo se ejecutan en el último lote** (un lote intermedio nunca esconde productos del lote siguiente)
- La barra de progreso muestra el avance real: "Lote 2/5 · 50 importados hasta ahora"
- **Sincronizar ahora**: pausa de 2 segundos entre fuente y fuente
- **Cron**: presupuesto de tiempo de ~20s; si se acerca al límite, corta limpio y registra "N fuente(s) pendientes para el próximo tick" en lugar de morir a mitad de una fuente
- Probado: 150 productos en 3 lotes → 150/150 importados, 3 filas en el historial, sin errores. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Sincronización manual fuente por fuente (fix: solo entraban 5 de 7)

- **Causa**: "Sincronizar ahora" mandaba todas las fuentes en UN request; en producción el límite de CPU del plan gratis de Cloudflare (~30s) cortaba el Worker a mitad de camino y solo entraban ~5 de 7 fuentes grandes
- **Fix**: el dashboard ahora encola las fuentes (`GET /api/admin/sync/jobs`) y las corre **de a una por request** (`POST /api/admin/sync {jobId}`); cada request procesa una única fuente y queda muy por debajo del límite
- `autoimport.ts` refactorizado: `runOneJob` compartido entre cron, "Ejecutar ahora" y sync manual; `runAllAutoImportsNow` queda solo como fallback (fuentes chicas)
- La barra de progreso muestra "Fuente i/N: url" y acumula importados/sin stock/errores de todas las corridas
- Siguen corriendo **todos** los links (activos o no): el flag "Activa" solo controla el cron automático
- Probado en local: fuente grande (678 importados) y fuente inválida (error con motivo) vía el nuevo modo un-por-request. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Deploy: banners de error, badge Sin stock y toolbar con Ordenar fijo

- Deploy a Cloudflare (`38ee5604`): banner de error en dashboard y Auto-importaciones, badge "Sin stock" en fichas por link directo, select Ordenar en fila fija. Commit `5196de2` pusheado; 76 tests ✅; home HTTP 200, login OK y catálogo con 984 productos verificados en producción
- Contraseña de producción renovada a `8AZzU3JMyYUNTesN` (solo letras/números, sin caracteres ambiguos): la anterior con `!` daba problemas de tipeo. Secret actualizado vía `wrangler secret put` y login verificado

## 2026-09-21 — Banner de error también en Auto-importaciones

- La pestaña **Auto-importaciones** ahora muestra el mismo aviso rojo del dashboard cuando la última corrida de auto-importación (cron o "Ejecutar ahora") falló: fecha, URL de la fuente y el motivo completo del error
- Mismo comportamiento de descarte: botón ✕ que se recuerda por sesión y reaparece si hay un error nuevo; desaparece solo cuando la próxima corrida es exitosa
- Complementa el detalle por-job que ya mostraba cada fila de la tabla
- Probado de punta a punta: error forzado → banner con causa; descartar → oculto; corrida exitosa → banner eliminado. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Dropdown "Ordenar" siempre visible aunque haya muchas categorías

- El select **Ordenar** salió de la fila scrolleable de chips y pasó a una **fila fija propia** (junto al contador "X de Y"): con muchas categorías ya no queda fuera de pantalla ni hace falta scrollear la toolbar para encontrarlo
- En móvil chico (≤480px) se compacta: tipografía más chica y `max-width: 46vw` para que siempre entre junto al contador
- Verificado: con overflow de chips (846px de contenido en 634px visibles) el select sigue visible dentro del viewport, funciona el cambio de orden (probado menor precio) y la toolbar sticky lo mantiene a la vista al scrollear. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Badge "Sin stock" en la ficha por link directo

- Los productos ocultos (sin stock en la fuente) ahora responden en su ficha `/producto/:id` en lugar de dar 404: si alguien entra por un link compartido o indexado, ve la ficha con **badge "Sin stock"** y el aviso "⚠️ Este producto ya no está disponible" (con sugerencia de ver los relacionados)
- El API entrega el producto oculto con `availability: out_of_stock` + flag `hiddenNoStock` y `related: []` (se ignoran los relacionados de un oculto)
- El botón flotante de WhatsApp se oculta en fichas sin stock (no tiene sentido consultar por algo que no está); el botón "Consultar por WhatsApp" de la ficha se mantiene para preguntar por reposición
- Sigue excluido del catálogo y del snapshot público: nadie llega a él salvo por link directo
- Probado de punta a punta: oculto un producto → su ficha muestra badge, aviso y sin botón flotante; re-publicado → todo vuelve a la normalidad. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Aviso destacado en el dashboard cuando la última sync falló

- Banner rojo al inicio del dashboard: **"⚠ La última sincronización falló"** con fecha/hora y el detalle completo del error
- Botón ✕ para descartar (se recuerda por sesión: no vuelve a aparecer hasta que haya un error NUEVO con otra fecha)
- Se actualiza en vivo con el polling de 15s: si una corrida del cron falla mientras mirás el panel, el banner aparece solo; si la próxima corrida es exitosa, desaparece solo
- Probado de punta a punta: error forzado con auto-importación inválida → banner visible con el motivo (404 + estrategias fallidas); descartar → oculto; recargar → sigue oculto; sync exitosa → banner eliminado automáticamente. Typecheck ✅, 76 tests ✅

## 2026-09-21 — Prueba de stress: importación de fuente grande (679 productos)

- Importada `hacetupedido.com/productos/electronica?page=all`: **679 productos, 678 importados, 1 salteado** ("Auricular vincha FORTNITE" con precio inválido) en ~70s — sin errores de D1 gracias a los batches
- El historial muestra el detalle completo: `678/679 (1 fall.) · 69s` + el aviso con el nombre del artículo salteado y su motivo
- Reimportación consecutiva: mismo resultado consistente, sin duplicados ni productos ocultados de más
- El catálogo local quedó con 830 productos publicados (678 de electrónica)

## 2026-09-21 — Deploy: detalle de errores, contador de sin stock y vista Sin stock

- Deploy a Cloudflare (`95106a36`): motivo real de errores en sync_log, columna `items_deactivated` (migración 005 aplicada remote y verificada), pestaña **Sin stock** con re-publicación, fix de `source_url`. Commit `535e9a0` pusheado a GitHub; 76 tests ✅; home HTTP 200

## 2026-09-21 — "Oculto" renombrado a "Sin stock" en todo el panel

- Los productos que la fuente deja de traer en realidad están **sin stock** (así lo indicaste): pestaña **"Ocultos" → "Sin stock"**, título de la vista, textos explicativos y estados en la lista de Productos
- Historial del dashboard: "· N ocult." → **"· N sin stock"** con tooltip "Productos de la fuente que ya no vinieron en el listado: quedaron sin stock"
- Barras de progreso y toasts de sync/auto-importaciones: "ocultado(s)" → "sin stock"
- Formulario de producto: opción "Oculto" → "Sin stock"
- Sin cambios en la base ni en el API (el estado interno sigue siendo `hidden`); es solo terminología de la interfaz

## 2026-09-21 — Historial: cuántos productos se ocultaron en cada corrida

- Nueva columna `items_deactivated` en `sync_log` (migración **005**, aplicada en local): cada fila del historial registra cuántos productos de la fuente se ocultaron por no venir en el listado
- **Bug corregido de paso**: los productos importados nunca recibían su `source_url` (el comentario decía "importItems lo completa" pero nadie lo hacía), por lo que el ocultado automático nunca encontraba productos previos de la fuente y **no ocultaba nada**. Ahora `importItems` asigna la URL antes de guardar
- UI: la celda de cantidades del historial muestra "· N ocult." en amarillo con tooltip explicativo (además de los fallidos en rojo)
- Las 3 vías de sync (cron, manual, importación desde el panel) registran la cifra
- Probado de punta a punta: import de 2 productos → reimport de 1 → historial registra `1 ocult.`; 76 tests ✅, typecheck ✅

## 2026-09-21 — Más detalle y errores completos en el historial de importaciones

- **Errores con motivo real de la base**: cuando un producto falla al guardarse, se registra el mensaje de error de D1 (antes solo el título). El reintento individual captura la causa por producto, con contexto del error del chunk
- **Excepciones no controladas ahora quedan en el historial**: si la importación manual revienta (fetch roto, D1 caído), se registra en `sync_log` con mensaje + ubicación (primera línea del stack) y se responde 500 con el motivo — antes se perdía el rastro en un 500 sin log
- **Rechazos también se registran**: body inválido (sin URL/JSON/selección) queda en el historial como error con su causa
- **Fuente sin productos ya no figura como "ok"**: `importItems` marca la corrida como error con el aviso "La fuente no devolvió productos…" — antes quedaba `ok` con total 0 y confundía
- Errores de extracción/corrida del cron y auto-importación incluyen la ubicación del stack para diagnóstico
- Probado de punta a punta: URL inexistente → historial con error y detalle; body vacío → historial con rechazo; importación real de mascotas (7 productos) → ok en 936 ms. Typecheck ✅, 76 tests ✅

## 2026-09-20 — Deploy: lote de panel editable y desactivación automática

- Deploy a Cloudflare (`79f38dc6`): desactivación automática de productos fuera de fuente (migración 004 ya aplicada remote), badge Nuevo configurable, modal Cómo comprar editable, cambio de contraseña en panel, logout por inactividad. Commit `48644bf` pusheado; 76 tests ✅; home HTTP 200 y settings nuevas verificadas en producción

## 2026-09-20 — Ventana del badge "Nuevo" configurable

- Nuevo campo en Configuración: **badge "Nuevo" automático** con opciones **24 horas / 48 horas / 7 días / Desactivado** (antes fijo en 48h)
- `settings.freshHours` (horas, 0 = off) viaja en `PublicSettings`; el grid y la ficha leen la config al vuelo — cambiar el valor en el panel surte efecto con solo recargar el catálogo
- El tooltip del badge se adapta: "Cargado en las últimas 24/48 horas", "Cargado en los últimos 7 días"
- Probado en local: 48h→2 badges, 7 días→20 badges (tooltip correcto), desactivado→0 badges; restaurado a 48h. 76 tests ✅

## 2026-09-20 — Cierre de sesión automático por inactividad (1 hora)

- La sesión del panel ahora dura **1 hora** (antes 12h): cookie con Max-Age 3600 y token con TTL 1h (`SESSION_TTL_MS`)
- **Sliding renewal**: con uso activo la sesión se renueva sola — cada request que llega con menos de 30 min de vida restante extiende la cookie 1h más. Nunca te corta mientras trabajás
- **Aviso previo**: el frontend chequea cada 30s; a los 55 min sin actividad muestra "Tu sesión se va a cerrar en ~5 min…" y a los 60 min hace logout con mensaje claro en el login
- Actividad = clic, tecla, mouse, scroll o touch en el panel. 76 tests ✅, typecheck ✅

## 2026-09-20 — Título y nota de retiro del modal "Cómo comprar" configurables

- Dos campos nuevos en Configuración: **"Título del modal Cómo comprar"** y **"Nota de retiro del modal"**
- La nota custom soporta `**negrita**` y acepta dirección/horarios propios; si queda vacía se usa el default con la dirección del panel (`📍 Retiro en el local: …`)
- El título vacío también vuelve al default "Cómo comprar". Aplica a home y ficha (modal compartido)
- Verificado de punta a punta: título custom + nota con negrita renderizada correctamente; restaurado el default. 76 tests ✅

## 2026-09-20 — Desactivación automática de productos que ya no vienen en la importación

- Cada producto importado de una URL queda asociado a esa fuente (nueva columna `source_url`, migración 004 aplicada en local y producción). Los de alta manual (source_url NULL) nunca se tocan
- En cada corrida (cron, "Sincronizar ahora", importar por URL): si un producto de esa misma fuente ya NO aparece en el listado actual, se **oculta** (status hidden, no se borra) — desaparece del catálogo público automáticamente; si vuelve a aparecer, se **reactiva** solo
- Funciones nuevas `hideProductsNotIn`/`unhideProductsIn` en db.ts; `importItems` acepta `sourceUrl` y devuelve `deactivated`; placeholder SQL con numeración explícita (los `?` anónimos mezclados con `?N` rompen D1)
- UI: barra de progreso y toasts muestran "X ocultado(s)"; resumen por fuente con `+importados/-ocultados`
- Probado de punta a punta en local: import A+B → ambos published; import solo A → B hidden y fuera del catálogo ✅; reimport A+B → B reactivado ✅. 76 tests ✅

## 2026-09-20 — Contraseña de producción robusta + cambio desde el panel

- **Contraseña de producción cambiada**: la débil "admin" fue reemplazada por una generada al azar (16+ caracteres). Verificado en producción: login con "admin" → 401 ❌, con la nueva → 200 ✅
- **Nueva opción "Cambiar contraseña del panel"** en Configuración del admin: pide contraseña actual + nueva (mínimo 8, distinta de la actual) + repetición, con validación de coincidencia en el cliente y en el servidor
- Endpoint `POST /api/admin/password`: verifica la actual (timing-safe), persiste el secret en Cloudflare vía wrangler y lo aplica en caliente para la sesión. En local devuelve `persisted: false` (avisa que .dev.vars es manual)
- Nuevo script `tools/change-password.mjs` para cambiarla por CLI (actualiza .dev.vars y/o el secret)
- Verificado en local: contraseña incorrecta rechazada ✅, mínimos validados ✅, login con la nueva OK ✅. 76 tests ✅
- **Importante**: el usuario debe guardar la nueva contraseña de producción en un lugar seguro — no se puede recuperar, solo reemplazar

## 2026-09-20 — Pasos del modal "Cómo comprar" configurables

- Nuevo campo **"Pasos de Cómo comprar"** en Configuración: un paso por línea, con soporte de `**negrita**` para resaltar (ej: `**Mandanos un WhatsApp** con el modelo`)
- Si el campo queda vacío se usan los pasos por defecto del HTML de la página (nunca se rompe)
- Cadena completa: `StoreSettings.howSteps` → `PublicSettings` → textarea en el panel → `fillHowSteps()` renderiza con escape de HTML (anti-inyección) y negritas
- Verificado de punta a punta en local: guardo 3 pasos custom con negrita → modal muestra exactamente eso; restaurado el texto por defecto. 76 tests ✅, typecheck ✅

## 2026-09-20 — Badge "Nuevo" para productos frescos

- Los productos cargados en las **últimas 48 horas** muestran un badge azul **"Nuevo"** al inicio de los badges, tanto en la tarjeta del grid como en la ficha (con tooltip "Cargado en las últimas 48 horas")
- Distinto del tag manual "Nuevo" (verde): este es automático por fecha de alta (`created_at`), estilo `badge--fresh` azul para diferenciarlos visualmente
- Nuevo campo `createdAt` en el tipo `Product`, mapeado desde `created_at` en `rowToProduct` (los productos importados lo reciben gratis: el upsert ya guarda `created_at`)
- Verificado en local: producto de prueba con `created_at` reciente muestra el badge; los productos reales importados por el cron hace menos de 48h también lo muestran. 76 tests ✅, typecheck ✅

## 2026-09-20 — Deploy: botón Seguimiento

- Deploy a Cloudflare (`4f502c04`) con el botón Seguimiento configurable, su URL verificada en producción y el cambio de envío del modal. Commit `1715d33` pusheado a GitHub; 76 tests ✅ antes de subir; home HTTP 200

## 2026-09-20 — Modal "Cómo comprar": envío

- Paso 5 cambiado en el modal (home y ficha): ~~"Envíos a todo el país"~~ → **"Envío gratis en la ciudad de Santa Fe"** o retiro en el local
- Verificado en preview (texto actualizado en el modal abierto). Typecheck ✅, build ✅

## 2026-09-20 — Link de Seguimiento configurable desde el panel

- Nuevo campo **"Link de Seguimiento (botón del header)"** en Configuración → Datos del comercio (después de Facebook). El botón "Seguimiento" del header usa esa URL
- Si el campo queda **vacío**, el botón desaparece del header (home y ficha). Por defecto viene `https://repairpro.centerphone.com.ar/track-lite`
- Cadena completa: `StoreSettings.trackUrl` (shared) → `PublicSettings` (worker) → campo en el form del admin → `fillStoreInfo` aplica href u oculta el botón
- Verificado de punta a punta en local: guardar vacío oculta el botón ✅, restaurar la URL lo muestra ✅. 76 tests ✅, typecheck ✅

## 2026-09-20 — Botón "Seguimiento" en el header

- Nuevo botón **Seguimiento** en la nav del header (junto a "Contacto"), tanto en el home como en la ficha de producto. Abre en otra pestaña `https://repairpro.centerphone.com.ar/track-lite` (el sistema de seguimiento de reparaciones)
- Mismo estilo `.topnav-btn` que "Cómo comprar" y "Contacto" (regla nueva `a.topnav-btn` para que el link herede el look del botón sin subrayado)
- Verificado en preview: botón visible con el link correcto, header sin overflow. Typecheck ✅, build ✅

## 2026-09-19 — Deploy: historial completo de sincronizaciones

- Deploy a Cloudflare (`09ee94cb`) con el historial de todas las corridas (cron + manuales) y la columna detail
- Migración 003 aplicada a la base de producción (columna detail verificada en sync_log); 76 tests ✅ antes de subir; home HTTP 200

## 2026-09-19 — Historial completo de sincronizaciones

- Ahora TODA corrida queda registrada en sync_log: las auto-importaciones del cron (automáticas) y las manuales (botones del panel), cada una con su URL de origen (columna nueva `detail`, migración 003)
- Dashboard del admin: tabla del historial con fecha, origen (Automática/Manual/Importación), detalle (URL), estado, importados y error; filtro por tipo y últimas 50 corridas
- Simplificado el endpoint /auto-imports/run (reusa runAllAutoImportsNow)
- Verificado localmente: corridas manuales con URL e importados registrados; filtro del historial funcionando

## 2026-09-19 — Deploy: contador, selector de horarios y fixes visuales

- Deploy a Cloudflare (`2776a439`): contador "X de Y" en la toolbar, selector de horarios como lista con máx. 3, fix del modal de auto-importaciones, fotos sin scanlines, fix de capas de los popups (centrado + cierre al clic afuera) y fix del toolbar sticky
- 76 tests ✅ antes de subir; home HTTP 200 en producción

## 2026-09-19 — Selector de horarios rediseñado (máx. 3)

- El formulario de auto-importaciones reemplaza la grilla de checkboxes por una lista scrolleable de horarios (3 columnas, ✓ verde en los elegidos)
- Límite de 3 horarios por auto-importación: al intentar un cuarto muestra aviso en rojo y bloquea; contador en vivo "N de 3 seleccionados"
- Guardado verificado end-to-end en el preview; pendiente de deploy

## 2026-09-19 — Fix: popups tapados por las fotos (capas del tema terminal)

- Causa: al dejar las fotos sin scanlines (z-index 1000), quedaron POR ENCIMA de los modales (z-index 100) — el popup se veía roto, desplazado y con un recuadro gigante "transparente", y el clic afuera pegaba en la foto
- Escala de capas reordenada: scanlines 999 < fotos 1000 < UI sticky/flotante 1001 < modales 1003 < toast 1004
- Caja del popup con fondo más contrastado (#131b25) para que no parezca transparente
- Verificado en preview (home y ficha): popup centrado, sólido, por encima de las fotos y cierre al clic afuera; pendiente de deploy

## 2026-09-19 — Fotos de producto sin scanlines

- Las scanlines CRT cubrían también las fotos de producto (se veían "rayadas"); ahora las imágenes del grid, la ficha y las miniaturas del admin quedan por encima de la capa de efecto
- El efecto terminal se mantiene en toda la interfaz (fondos, textos, bordes); verificado en preview; pendiente de deploy

## 2026-09-19 — Fix: modal de auto-importaciones roto en el admin

- El modal de Nueva/Editar auto-importación se veía roto y sin scroll: la clase `.modal` del admin quedaba pisada por la del modal público (position:fixed a pantalla completa) agregada con el tema terminal
- Renombrada la caja del admin a `.modal-card` con sus propios estilos (max-height 90vh, overflow auto, sombra dura)
- Verificado en preview: Nueva y Editar se abren centradas, con scroll interno y datos precargados correctos; pendiente de deploy

## 2026-09-19 — Contador de productos en la toolbar

- Caja "X de Y" a la derecha de la fila de etiquetas: muestra los productos visibles sobre el total del filtro actual (ej: "20 de 143")
- Se actualiza al usar "Cargar más", cambiar filtros/orden/búsqueda y se oculta cuando no hay resultados
- Verificado en preview: 20 de 143 → 40 de 143 tras cargar más; pendiente de deploy

## 2026-09-19 — Deploy: paginador "Cargar más" en producción

- Deploy a Cloudflare (`c311525d`) con el botón "Cargar más" (20 por página) y el fix del hueco del toolbar sticky
- 76 tests ✅ antes de subir; verificado en producción que el JS del home incluye el paginador

## 2026-09-19 — Botón "Cargar más" en vez de scroll infinito

- Eliminado el scroll infinito del catálogo: ahora muestra 20 productos y un botón "Cargar más (N restantes)" que agrega 20 por clic
- Botón con estilo terminal (sombra dura, hover con desplazamiento) centrado bajo el grid
- Verificado en preview: 20 iniciales → 40 tras un clic → contador decreciente correcto; pendiente de deploy

## 2026-09-19 — Revisión visual del tema terminal

- Ajustado el `top` sticky de la toolbar de 63px/65px a 57px: el header mide 58px con el nuevo tema y quedaba un hueco de 5px
- Revisados en preview: home (hero, toolbar, tarjetas), modal Cómo comprar, ficha con tarjeta HORARIOS/LOCAL y login del admin — todo consistente con el tema
- Pendiente de deploy

## 2026-09-19 — Deploy: tema terminal en producción

- Deploy a Cloudflare (`fa4d1c60`) con el tema terminal/CRT, íconos oficiales de WhatsApp/Facebook/Instagram y el popup de Contacto completo
- 76 tests ✅ antes de subir; verificado HTTP 200 y fuentes JetBrains Mono servidas en producción

## 2026-09-19 — Íconos de redes en el popup de Contacto

- La fila REDES del modal de Contacto ahora muestra los logos SVG de Instagram y Facebook junto a cada link (igual que en el footer)
- Nuevo estilo `.social-link` con alineación ícono-texto y hover verde
- Verificado por DOM en el preview; pendiente de deploy

## 2026-09-19 — Íconos oficiales de WhatsApp, Facebook e Instagram

- Botón flotante: logo oficial de WhatsApp (SVG inline) en vez del emoji 💬, en home y ficha
- Footer: íconos SVG identificatorios de Facebook e Instagram junto a cada link
- Modal de Contacto: ítem de WhatsApp con su logo
- Verificado en preview (SVGs presentes y coloreados); pendiente de deploy

## 2026-09-19 — Vuelta al tema terminal/CRT

- Restaurado el estilo terminal/CRT a pedido del usuario (el claro minimalista queda en el historial de git): fondo `#0b0f14`, verde terminal `#3fb950`, tipografía JetBrains Mono, esquinas rectas, sombras duras y scanlines sutiles
- Hero con prompt `visitante@centerphone:~$ ls productos/` y cursor parpadeante; footer con `step_01` y encabezados `##`
- Verificado en preview por DOM: home, ficha, modales y tienda; pendiente de deploy

## 2026-09-19 — Subida a GitHub

- Agregado `.freebuff/` al `.gitignore` (logs locales fuera del repo)
- Commit y push de todo el rediseño claro + branding configurable a `pilincapo/TIENDA_CENTERPHONE` (`30d1e9c`)

# Changelog

## 2026-09-19 (16)
- **Orden por defecto aleatorio en el catálogo**: la página principal carga con "Aleatorio" seleccionado y un seed nuevo en cada visita, así el orden cambia entre recargas y todos los productos se promocionan. "Limpiar filtros" vuelve al aleatorio. Verificado: dos recargas consecutivas muestran órdenes distintos.

## 2026-09-19 (15)
- **Importar solo por links**: eliminados el textarea de JSON y la zona de arrastre de archivos de la pestaña Importar. Queda URL + regla de precio + Analizar.

## 2026-09-19 (14)
- **Eliminados los campos de sync clásica de Configuración** (URL del JSON, token Bearer e intervalo): la sincronización se gestiona íntegramente desde Auto-importaciones. El backend se mantiene por compatibilidad; los valores guardados no se tocan al guardar el formulario.

## 2026-09-19 (13)
- **Fix: el dashboard mostraba siempre "error"**: el estado del catálogo solo lo actualizaba la sync clásica por URL (no usada), quedando clavado en el viejo error "No hay URL de sincronización configurada". Ahora las corridas de auto-importaciones (cron y manuales) también actualizan el estado en KV.

## 2026-09-19 (12)
- **Conteo de productos por categoría en el panel**: nueva columna "Productos" en Categorías con badge de cantidad (las categorías padre suman sus subcategorías) y desglose "X pub." cuando hay ocultos. Endpoint `/categories` devuelve `counts` vía `countProductsByCategory` (GROUP BY, una query).

## 2026-09-19 (11)
- **Panel dinámico sin recargas**: sincronizar y ejecutar auto-importaciones ya no re-renderizan la vista (sin scroll ni perdida de estado); historial y estado del catálogo se actualizan in-place al terminar, más auto-refresh cada 15 s con polling; la barra de progreso muestra resumen real (fuentes, importados, salteados/errores, resumen por URL); botones deshabilitados durante la corrida. Deploy `9c1456de`.

## 2026-09-19 (10)
- **Barra de progreso en las tres operaciones del panel**: generalizado `showProgress` para aceptar pasos custom. Dashboard "Sincronizar ahora" (Descargando → Importando → Generando snapshot), Auto-importaciones "Ejecutar ahora" (Descargando → Extrayendo → Importando), e Importar ya lo tenía. Los toasts de sync ahora avisan cantidad de artículos salteados.

## 2026-09-19 (9)
- **Deploy a producción** (versión `0d829461`): salto de items sin precio con corrida ok/avisos, detalle de error en Auto-importaciones, y todo lo del commit `4ae1155`. 76 tests OK antes de subir. GitHub y producción quedaron sincronizados.

## 2026-09-19 (8)
- **Push a GitHub** (commit `4ae1155`): historial de sincronizaciones con causa de errores, salto de items sin precio, detalle de error en Auto-importaciones, README arreglado y `.freebuff/` quitado del repositorio.

## 2026-09-19 (7)
- **Los items con precio inválido ya no fallan la sincronización**: se saltan individualmente (con aviso "X: precio inválido, se salta el artículo") y la corrida continúa con el resto. La corrida queda `ok` si al menos un producto se importó; los avisos se muestran con ⓘ en el historial y en Auto-importaciones (los errores reales de red/extracción siguen en rojo ⚠). Solo es error si ningún producto pudo importarse. Test actualizado al nuevo comportamiento.

## 2026-09-19 (6)
- **Detalle de error en Auto-importaciones**: cada job de la tabla muestra ahora la causa del último error bajo el estado (⚠ en rojo, tooltip con el texto completo), vía nuevo endpoint `/auto-imports/last-run?url=` que lee la última corrida de esa URL en `sync_log`.

## 2026-09-19 (5)
- **README.md arreglado**: se resolvió el conflicto de merge sin resolver (quedaba con marcadores `<<<<<<< HEAD` / `>>>>>>> origin/main` desde un merge anterior). Se conservó la documentación completa actualizándola al estado real: auto-importaciones con grupos de reglas, historial con causas de error, borrar por categoría, precios enteros, correo del botón "Consultar" sin link del producto, corrección del puerto del dev server (8787) y contador de tests (76).

## 2026-09-19 (4)
- **Deploy a producción** (versión `502894b2`): historial con causa de errores de sincronización, mensajes claros de fallos de red/DNS, y despliegue del grafo de conocimiento (solo local, en `.gitignore`). 76 tests OK antes de subir.

## 2026-09-19 (3)
- **Grafo de conocimiento del proyecto (graphify)**: se generó `graphify-out/` con `graph.json` (362 nodos, 809 relaciones, 30 comunidades etiquetadas), `GRAPH_REPORT.md` (auditoría) y `graph.html` (visualización interactiva). Ignorado en `.gitignore` como artefacto local. Detección adicional: `README.md` tiene un conflicto de merge sin resolver.

## 2026-09-19 (2)
- **Prueba de punta a punta del historial de errores**: se creó una auto-importación con dominio inexistente, se ejecutó y el historial registró la causa clara ("No se pudo conectar con el dominio…"). Mejorado `fetchText` para traducir los fallos opacos de red/DNS del runtime a mensajes comprensibles. La auto-importación de prueba fue eliminada; la entrada de error queda en el historial como registro.

## 2026-09-19
- **Errores de sincronización con causa real**: los fallbacks del extractor ya no ocultan el motivo de la descarga (timeout, DNS, estado HTTP); las corridas de auto-importación registran todos los errores, no solo el primero; el historial del panel muestra hasta 90 caracteres con tooltip del texto completo y los toasts listan todos los motivos de fallo.

Formato: `- [fecha]_[hora] — descripción de la modificación`. Una entrada por cambio, la más nueva arriba.

## 2026-09-18 — Deploy a producción (6b3aeaa8)

- Subido el rediseño completo: tema claro minimalista (Inter, verde esmeralda, esquinas redondeadas, botón flotante circular), hero limpio y centrado robusto de modales. Verificado post-deploy: home 200, settings públicas correctas (storeName, dirección, horarios, WhatsApp). Cron horario activo.

## 2026-09-18 — Modales: centrado robusto + sombra

- Los popups "Cómo comprar" y "Contacto" ya estaban centrados (flex) y cerraban con clic afuera, ✕ y Escape — verificado por DOM. Refuerzo: `.modal-box` con `margin: auto` para que el centrado no recorte la parte superior cuando el contenido es más alto que la pantalla, y sombra difusa para separarlos del fondo.

## 2026-09-18 — Rediseño: tema claro minimalista (reemplaza al terminal/CRT)

- Nuevo estilo visual según referencia del usuario (capturas): fondo blanco, tipografía **Inter** (sans-serif) en lugar de JetBrains Mono, acento **verde esmeralda** `#0e9f6e`, esquinas redondeadas (`--radius: 10px`), chips con forma de píldora, tarjetas con sombra suave al hover, botón flotante de WhatsApp **circular verde** estilo oficial. Eliminados los efectos CRT: scanlines, sombras duras, prompt de terminal y cursor parpadeante — el hero ahora lleva eyebrow de texto simple y buscador con lupa. **Se preservan todos los datos y funcionalidad**: WhatsApp, dirección, horarios y redes siguen saliendo del panel; filtros, orden, scroll infinito, modales y ficha sin cambios. Verificado en preview: home, toolbar, tarjetas, modal Cómo comprar, ficha con tarjeta de horarios/local. 76 tests ✅. Pendiente de deploy.

## 2026-09-18 — Deploy a producción (33c123b1)

- Subido todo lo acumulado de la sesión: QA móvil 390px (header de ficha, precios largos con ellipsis, tablas del admin con `.table-scroll`), degradado "hay más chips" en la toolbar, header dinámico con fix del brand-tag oculto, y eliminación total del hardcodeo de marca. Verificado en producción: home 200, settings con storeName/dirección correctos.

## 2026-09-18 — Hardcodeo de marca eliminado por completo

- Últimos restos de "CenterPhone" grabado en el código: `alt` del logo en home/ficha (ahora "Tienda", que el JS reemplaza por el storeName), `footer-brand` del home (vacío de reserva, lo llena `fillStoreInfo`), fallback del título de ficha (ya no fuerza la marca si no hay storeName) y placeholder del campo en el panel ("Mi Tienda"). Verificado con nombre de prueba "Tecno Store Santa Fe": **cero apariciones** de "CenterPhone" en el texto renderizado de home, ficha y admin; restaurado el nombre real. Todo el branding sale ahora del único campo "Nombre de la tienda" del panel.

## 2026-09-18 — Header dinámico: bug del tag oculto corregido

- Al probar el header dinámico con otro nombre ("Tecno Store Santa Fe") se descubrió que la segunda palabra (verde) **no aparecía**: los HTML reservan el span `brand-tag` con el atributo `hidden`, y `applyBrandName` solo ajustaba `style.display`, que pierde contra la regla global `[hidden] { display: none !important }`. Ahora `applyBrandName` setea `tagEl.hidden = !rest` — verificado en home y ficha: "Tecno" blanco + "Store Santa Fe" verde junto al logo, y restaurado "CenterPhone" + "Celulares".

## 2026-09-18 — QA móvil 390px: 2 roturas corregidas

- **Ficha de producto a ≤390px**: el header desbordaba (~479px: marca + "Volver" + "Cómo comprar" + "Contacto"). Ahora a ≤390px se oculta "Contacto" (el popup sigue accesible desde el botón flotante y la store-card), el link "Volver" baja a 12px y cede espacio — verificado: header exacto en 390px sin overflow. (En el home la regla ya existía pero los botones de la ficha no estaban dentro de `.topnav`, por eso no aplicaba.)
- **Tarjetas con precio largo ($1.234.567)**: precio + botón "Consultar" no entraban en las ~150px de una tarjeta de 2 columnas. Ahora el precio cede con `text-overflow: ellipsis` y el botón no se achica — la fila entra exacta (verificado con clon a 146px).
- **Admin: tablas desbordaban a 390px** (Productos medía 621px). Las 6 tablas del panel quedaron envueltas en `.table-scroll` (overflow-x auto): scrollean horizontal dentro del panel sin romper el layout. Verificado en las vistas Dashboard/Productos/Reglas/Auto-importaciones.
- Auditado sin roturas: hero, buscador, toolbar (scroll + degradado), grilla 2 col, modales (caja de 358px a 390, sin overflow), store-card, relacionados, breadcrumbs (envuelven a 2 líneas, sin desborde), botón flotante y footer.

## 2026-09-18 — Degradado "hay más chips" en la toolbar

- Las filas de chips de la toolbar muestran un **degradado de desvanecimiento en el borde derecho** (mask-image de 28px) mientras quede contenido por scrollear, y desaparece al llegar al final. Lógica `updateToolbarMasks()` + listener de scroll delegado (un solo listener) + refresco en resize. Verificado en preview: degradado al inicio (chip cortado se desvanece), se quita al scrollear al final y reaparece al volver.

## 2026-09-18 — Marca y títulos unificados con storeName (sin hardcodear)

- **Header dinámico**: `applyBrandName()` (en el módulo compartido) divide el nombre del panel en primera palabra (blanca) + resto (verde) y actualiza los spans `.brand-name`/`.brand-tag` del header del home y de la ficha, junto con el alt del logo y el title del link. Los HTML ya no traen "CenterPhone" grabado (texto neutro de reserva si la API falla).
- **Títulos de pestaña**: home `{nombre} — Catálogo`, ficha `{producto} — {nombre}`, admin `Admin — {nombre}` (el admin lo resuelve desde `/api/public/settings` antes del login, junto al h1 "Admin · {nombre}").
- **Footer**: la marca del pie ya seguía al storeName; ahora todo el branding sale de un solo campo del panel.
- Verificado end-to-end: cambio a "Tecno Store Santa Fe" → header "Tecno" + "Store Santa Fe", títulos y footer actualizados en las 3 páginas; restaurado "CenterPhone Celulares".

## 2026-09-18 — Popup de Contacto en la ficha de producto

- La ficha ahora tiene también el botón **"Contacto"** en el header (junto a "Cómo comprar") que abre el mismo modal del home: Local con link a Maps, Horarios, WhatsApp y Redes, con el botón verde "Escribinos por WhatsApp" — todo alimentado por los datos configurables del panel vía el módulo compartido `store-modals.ts` (no hubo que tocar product.ts: `setupModals` ya cableaba `nav-contact`).
- Verificado en preview: botón abre el modal con los 4 ítems y el WA del panel; cierre por ✕; header de la ficha sigue entrando en una línea.

## 2026-09-18 — Nombre de la tienda configurable (storeName)

- Nuevo campo **"Nombre de la tienda"** en Configuración (junto a los datos del comercio), guardado en `StoreSettings` como `storeName` (max 60 chars, con default "CenterPhone Celulares").
- **Dónde se aplica**: título de la pestaña del home ("{nombre} — Catálogo") y de la ficha ("{producto} — {nombre}"), y el texto de marca del footer. El header con logo se mantiene como está (imagen + texto estático). Nota: el título de la ficha lo pisa `fillStoreInfo` si se llama después — ordenado para que cada página ponga el suyo.
- Verificado end-to-end: cambio a "Mi Tienda de Prueba" vía API → título del home, título de ficha y footer reflejan el cambio; restaurado el nombre real. 76 tests ✅.

## 2026-09-18 — Horario y dirección en la ficha de producto

- Debajo de los botones de acción de la ficha ahora hay una **tarjeta con HORARIOS y LOCAL** (dirección con link ↗ a Google Maps), alimentada por los mismos datos configurables del panel (`fillStoreInfo` en el módulo compartido `store-modals.ts`). Si algún campo está vacío en el panel, la tarjeta se oculta entera o el ítem no aparece.
- De paso: header de la ficha compactado en ≤640px ("Volver al catálogo" cede espacio, 13px) — verifico que marca + volver + "Cómo comprar" entren en una línea sin overflow; `white-space: nowrap` en el link.

## 2026-09-18 — Hover en chips y botones de la toolbar

- Los chips de la toolbar ahora tienen el mismo efecto hover que las tarjetas: **elevación de 2px + borde verde + sombra difusa**, con transición de 0.22s y feedback `:active` que baja a su posición. Los chips activos (seleccionados) suman un anillo verde translúcido al hover. El select "Ordenar" también responde con borde verde + sombra. De paso: `white-space: nowrap` en la nav del header para que "Cómo comprar" no se parta en dos líneas en pantallas angostas.

## 2026-09-18 — Toolbar de filtros verificada y corregida en móvil

- **Scroll horizontal de chips**: filas `.tb-row` con overflow-x auto y scrollbar oculta — verificado que scrollean hasta el final ("Ordenar" accesible) y vuelven a "Todos" al inicio, con y sin subcategorías.
- **Corregido solape del sticky**: el toolbar usaba `top: 57px` fijo, pero el header mide 67px en ≥481px y 53px en ≤480px (compacto). Ahora: `top: 67px` desktop, `67px` en tablets angostas (481–800px) y `53px` en ≤480px — verificado sin solape ni hueco en 581px y en los dos regímenes de header.
- **Header compacto a ≤390px**: nav reducida a 12px y se ocultan "Productos" y "Contacto" (quedan marca + "Cómo comprar") para que marca + nav entren en 390px sin envolver. Chips a 11.5px/6-11px y spacer oculto en móvil para que el scroll de la fila llegue justo al select "Ordenar".

## 2026-09-18 — Botón "Cómo comprar" en la ficha de producto

- La ficha ahora tiene el botón "Cómo comprar" en el header (junto a "← Volver al catálogo") que abre el mismo modal del home: 5 pasos + nota de retiro con la dirección del panel + botón de WhatsApp. Los modales y el llenado de datos del comercio se **extrajeron a un módulo compartido** (`store-modals.ts` + `types-web.ts`), usado por catalog.ts y product.ts — una sola implementación para las dos páginas.
- Verificado en preview: ficha abre el modal (nota "📍 Retiro en el local: Mendoza 2974 · Santa Fe", WA con el número del panel, cierre por ✕) y el home sigue funcionando igual con el módulo compartido.

## 2026-09-18 — Datos del comercio configurables desde el panel

- Nuevos campos en **Configuración** (admin): dirección del local, link de Google Maps, horarios (textarea, una línea por rango), Instagram y Facebook. Se guardan en `StoreSettings` (KV, con merge a defaults para bases existentes — no hace falta migración) y salen por `/api/public/settings`.
- **Popups y footer dinámicos**: "Contacto" y "Cómo comprar" (nota de retiro con la dirección) y las columnas del footer (horarios, dirección ↗ a Maps, botones de redes) se arman desde esas settings; los ítems vacíos no se muestran. Los datos hardcodeados en `index.html` se reemplazaron por contenedores que completa `fillStoreInfo()` en catalog.ts. URLs normalizadas (https automático) y limitadas en el worker.
- Verificado end-to-end en local: PUT /api/admin/settings con otros datos → popup/footer reflejan el cambio (y desaparecen los vacíos); restaurados los valores originales. 76 tests ✅.

## 2026-09-18 — Hover mejorado en las tarjetas de producto

- El hover de `.card` pasó de un leve `-2px` a **elevación suave de 5px + borde verde + sombra difusa** (dos capas), con transición más fluida (0.22s ease para transform/borde/sombra). `:active` vuelve a 2px para dar feedback táctil al presionar.

## 2026-09-18 — Filtro de precio quitado del catálogo

- Eliminado el botón "Precio ▾" de la toolbar (rangos rápidos + rango manual Mín/Máx) y toda su lógica (`priceMin`/`priceMax` del state, filtrado, contadores, CSS de `.tb-drop`/`.tb-panel`). La barra queda: categorías + Nuevo/Destacado/Oferta + Ordenar. El orden por precio sigue disponible en el selector "Ordenar".

## 2026-09-18 — Popups "Cómo comprar" y "Contacto" en el header

- "Cómo comprar" y "Contacto" dejaron de ser anclas al footer (que con el scroll infinito ya no existía como "final fijo") y ahora **abren modales**: guía en 5 pasos + botón WhatsApp el primero; local, horarios, WhatsApp y redes el segundo. Ambos con el link de WhatsApp dinámico configurado en el panel, cierre por ✕, clic afuera y Escape, y bloqueo del scroll de fondo mientras están abiertos. El footer del home se mantiene con el mismo contenido para quien scrollea hasta el final.

## 2026-09-18 — Botón "Consultar" con texto en las tarjetas

- El botón de WhatsApp de cada tarjeta pasó del ícono solo (💬) a **"Consultar"** con texto. Paddings ajustados (6/12px, 13px; en móvil 4/9px, 12px) y `white-space: nowrap` para que no se corte. Verificado en preview: texto "Consultar", misma fila que el precio y sin desbordar la tarjeta.

## 2026-09-18 — Header con navegación y footer nuevo (mockup)

- **Header**: agregada nav derecha con "Productos" (ancla `#catalog`, al hero), "Cómo comprar" y "Contacto" (ambos anclan a `#how`, el pie de página). En móvil la nav se compacta (13px).
- **Footer nuevo**: reemplaza la sección "Cómo comprar" — tarjetas **01 Explorá / 02 Consultá / 03 Coordinamos** con numerito verde arriba (estilo mockup) y debajo 4 columnas: marca con tagline, **HORARIOS** (L–V 9–19, Sáb 10–13), **VISITÁNOS** (Mendoza 2974 · Santa Fe ↗, link a Google Maps) y **SEGUINOS** (botones Facebook / Instagram con borde). CSS `.topnav` + `.footer*` reemplazan a `.how*` (el `id="how"` se conserva, el lazy-observer de catalog.ts sigue funcionando).
- Verificado en preview: ancla "Cómo comprar" scrollea al footer (footerTop=10), 143 tarjetas cargadas por scroll infinito y el footer al final con el diseño del mockup.

## 2026-09-18 — Botón de WhatsApp junto al precio en las tarjetas

- El botón "💬 Consultar" pasó de franja inferior ancha a un botón compacto redondeado **dentro de la tarjeta, en la misma línea que el precio** (a la derecha de este, en `.card-foot`). Abre WhatsApp directo sin entrar a la ficha. En móvil queda más chico (5px/10px, 13px).

## 2026-09-18 — Marca completa en la ficha de producto

- El header de la ficha (`product.html`) decía solo "CenterPhone": le faltaba el span "Celulares" que sí tenía el home. Agregado con las mismas clases (`brand-name`/`brand-tag`). Además, en pantallas ≤480px el link "← Volver al catálogo" cede espacio (13px, alineado a la derecha) y el logo se compacta, para que la marca nunca se corte.

## 2026-09-18 — Imágenes de tamaño uniforme

- La ficha de producto dibujaba la imagen a su tamaño natural: una imagen alta/larga estiraba el contenedor y deformaba la vista. Ahora `.product-detail .img img` usa `width/height: 100%` + `object-fit: cover` (recorte centrado en cuadrado). Reforzado también `.card-img` (home y relacionadas) con `overflow: hidden` y `display: block`. Verificado: home 12/12 tarjetas exactamente 368×368, ficha 748×748 con imagen de 640×640 recortada al cuadrado.

## 2026-09-18 — Rediseño del catálogo: 7 mejoras del home

- **Orden**: nuevo grupo "Ordenar por" en filtros — Más recientes / Menor precio / Mayor precio / Aleatorio (seed estable para que las tarjetas no "salten" al hacer scroll).
- **Rangos de precio rápidos**: chips (Todos / < $300 mil / $300–600 mil / $600 mil–1 M / > $1 M) además del rango manual.
- **Scroll infinito**: se cargan 12 productos y se agregan de a 12 al acercarse al final de la página.
- **WhatsApp en cada tarjeta**: botón "💬 Consultar" en cada artículo sin entrar a la ficha; el mensaje ya **no incluye el link del producto** (también en la ficha).
- **Móvil a 2 columnas**: grilla fija de 2 columnas en pantallas chicas para ver más artículos a la vez.
- **Botón flotante de consultas**: ya existía; verificado su funcionamiento.
- **Sección "Cómo comprar"** al final del home: 3 pasos + contacto (Mendoza 2974 Santa Fe, horarios, Instagram @centerphonesantafe). Imágenes cargadas diferidas con IntersectionObserver.

## 2026-09-18 — Regla: sin deploy automático

- Nueva instrucción en `AGENTS.md`: los agentes trabajan solo con la versión local (dev server) y **no corren `npm run deploy`** ni suben nada a Cloudflare salvo orden explícita del usuario ("deploy", "subir a producción", etc.).

## 2026-09-18 — Marca con estilo unificado

- "Celulares" pasó de badge con borde a texto del mismo tamaño/peso que "CenterPhone", solo en verde — según referencia visual. Deploy `8fd65904`.

## 2026-09-18 — Marca compacta en el header

- El badge "Celulares" pasó del borde derecho del header a estar pegado al nombre: "⚡logo⚡ CenterPhone [Celulares]" — todo junto a la izquierda. Deploy `6cc19678`.

## 2026-09-18 — Logo y favicon de la tienda

- Archivos de marca (logo del personaje con el zapato-telefono + favicon) agregados en `brand/` y copiados a `public/` por el post-build (`tools/build-web.js`) — necesario porque `vite build` limpia `public/` con `emptyOutDir` y los borraba. Logo en el header del home, ficha de producto y admin (reemplaza al chip ⚡/⚙️); favicon en las 3 páginas. Verificado local y producción (`a3cff2b2`).

## 2026-09-18 — Rediseño del home (paleta verde)

- Nuevo look según mockup: header con chip de logo verde (⚡ CenterPhone) + badge "Celulares", hero con eyebrow CATÁLOGO y título grande "Tecnología que necesitás", buscador integrado en el hero. Paleta global cambiada de azul a verde (#2fd772) con fondo más oscuro; tarjetas, badges, botones, WhatsApp flotante y ficha de producto heredan la nueva paleta. Deploy `1def6edc`.

## 2026-09-18 — Horarios de auto-importación solo horas enteras + cron horario

- **Formulario de auto-importación**: el textarea libre de horarios se reemplazó por una grilla de 24 casillas (00h–23h) — solo se pueden elegir horas enteras (ej: 8h, 20h). El worker además valida (`HH:00`) y normaliza.
- **Cron de Cloudflare**: cambiado de `*/15 * * * *` (cada 15 min) a `0 * * * *` (cada 1 hora en punto). `isDueNow` simplificado: matchea la hora; horarios con minutos de configuraciones viejas corren en su hora entera (compatibilidad). Deploy `b950d8a4`.

## 2026-09-18 — Fix botón "Sincronizar ahora" del dashboard

- **Causa del error**: el botón ejecutaba la sync clásica (una única URL JSON de `Configuración → syncUrl`), que estaba vacía → "No hay URL de sincronización configurada". El catálogo real se alimenta por Auto-importaciones.
- **Fix**: si hay auto-importaciones activas, el botón ahora corre todas ahora mismo (ignorando horarios), con su regla/grupo asignado y marcando la última corrida. Sin auto-importaciones activas, cae a la sync clásica. El toast distingue el modo. Verificado local y producción (7 productos importados; el 522 intermitente de hacetupedido se resolvió al reintentar). Deploy `3d69d226`.

## 2026-09-18 — Botón "Importar seleccionados" siempre visible

- **UI Importar**: barra de acciones sticky arriba de la lista de productos analizados, con "Importar seleccionados" siempre visible al scrollear (antes había que bajar hasta el final de la tabla). Incluye Marcar/Desmarcar todos y contador en vivo de seleccionados; el botón de abajo se mantiene como alternativa. Verificado en preview (sticky funciona a 800px de scroll). Deploy `2751cfb8`.

## 2026-09-18 — Links importados quedan en Auto-importaciones (desactivados)

- **Bug corregido**: al confirmar la importación desde el preview, la UI solo enviaba los `items` (sin la URL), así que el link nunca se registraba en Auto-importaciones. Ahora el frontend pasa la URL analizada hasta el confirm y la incluye en el POST.
- Cada link importado manualmente por primera vez queda en la pestaña Auto-importaciones **desactivado** (`active: false`, sin horarios ni regla) — listo para que el usuario lo seleccione y configure. Si el link ya existía como job, se preserva su configuración (solo se actualiza la regla si se usó una distinta de "automático"). Verificado local: URL nueva → job `active: false` ✅; URL existente activa → permanece activa ✅. Deploy `1d8f7ae5`.

## 2026-09-17 — Barra de progreso al importar

- **UI Importar**: barra de progreso animada (con avance virtual suave mientras responde el worker) en las dos fases: al analizar la fuente (Descargando → Extrayendo → Calculando precios) y al confirmar la importación (Guardando → Actualizando catálogo y snapshot). Muestra %, texto de fase, pasos con ✓/✗ y llega al 100% con el resultado antes de mostrar la lista. Deploy `d14d08c8`.

## 2026-09-17 — Renombrado: "Celu Store" → "CenterPhone Celulares"

- Cambio de nombre en títulos de página (catálogo, ficha de producto, admin), marca del header en las 3 vistas, login del admin y README. El nombre interno del worker (`celu-store`) y la URL `celu-store.pilin123.workers.dev` quedan como están (son identificadores de despliegue, no visibles como marca). Verificado en producción.

## 2026-09-17 — Borrado múltiple de productos y por categoría entera

- **UI Productos**: checkboxes por fila con "marcar todos", botón "🗑️ Borrar seleccionados" con contador, y selector "Vaciar categoría" (borra todos los productos de la categoría elegida, sin borrar la categoría). Confirmación con cantidad antes de cada borrado.
- **API**: `POST /api/admin/products/bulk` acepta `{ids: [...]}` o `{categoryId}` (incluye productos con esa categoría como subcategoría); regenera el snapshot al final (una sola vez). 400 si falta el cuerpo válido.
- **Verificado en local**: bulk por ids (2), por categoría (1), 400 sin cuerpo, 0 restantes. Deploy `8f912c61`.

## 2026-09-17 — Detección de rangos superpuestos en Reglas de precios

- **Nuevo `findOverlaps`** en `src/shared/pricing.ts`: detecta pares de reglas activas cuyos rangos se pisan, con la zona exacta de conflicto (fromCents/toCents) y qué regla gana (mismo criterio que el modo automático: prioridad, luego rango más específico). Rangos contiguos ($0–$10.000 y $10.001–∞) NO cuentan; un límite compartido en un único precio sí (límites inclusivos).
- **UI**: la pestaña Reglas muestra un panel amarillo de advertencia con cada superposición ("X e Y se superponen en $Z — $W: gana X (+N%)") + recomendación de ajuste; las filas de reglas en conflicto se resaltan con ⚠️.
- **Tests**: +6 (75 en total): solape total, parcial, contigüidad, límite compartido, prioridad del ganador, ignorar inactivas, grupos distintos. Verificado en la UI local (3 advertencias con las reglas de prueba superpuestas) y producción (reglas del usuario sin solapes ✅). Deploy `9621f73b`.

## 2026-09-17 — Auto-importaciones programadas

- **Nueva pestaña "Auto-importaciones"**: los links importados manualmente se registran solos en una tabla; cada uno se puede activar, elegirle regla individual o grupo de precios (o automático), y asignarle horarios de actualización (hora Argentina, varios por link).
- **DB**: tabla `auto_imports` (url, label, price_rule_id, times JSON, active, last_run_at, last_status) — schema + migración `db/migrations/002-auto-imports.sql` aplicada en local y producción.
- **Worker**: CRUD `/api/admin/auto-imports` (+ `POST /auto-imports/run` con `{all:true}` para forzar todos, o sin body para respetar horarios). El cron cada 15 min ejecuta `runAutoImports`: cada horario corre en su ventana de 15 min ("09:10" corre en el tick de 09:00). Registro automático de URLs al importar por link (`rememberImportUrl`).
- **UI**: tabla con toggle Activa, regla/grupo aplicado, badges de horarios, última corrida (estado + fecha), botón "Ejecutar ahora", formulario con textarea de horarios (uno por línea, validación HH:MM).
- **Tests**: +3 (68 en total — `nowArgentina`, `isDueNow` con ventanas, jobs inactivos). Verificado end-to-end en local (modo cron con horario = ahora → 1 corrida, 7 productos con escala aplicada) y producción (job creado con grupo "40-30-20" y horarios 09:00/21:00).
- Nota operativa: hacetupedido.com sigue intermitente con 522 desde data centers de Cloudflare — el job reintenta en el próximo horario; correr de nuevo suele alcanzar.

## 2026-09-17 — Precios siempre en pesos enteros (sin decimales)

- **Nuevo `roundToPeso`** en `src/shared/pricing.ts`: redondea centavos al peso entero más cercano. Usado por el parser de precios (`parsePriceCents`), los tres motores de recargo (automático, grupo, forzada), `sanitizeProduct` y `sanitizeRule` del worker, y el normalizador de importación.
- **Formularios**: precio de producto y min/max de reglas ahora son `step="1"` (enteros), con leyenda "número entero, sin decimales".
- **Efecto**: cualquier precio con centavos que llegue de una fuente externa ("$1.299,99") se guarda redondeado ($1.300), y los recargos que den centavos ($10.001 +30% = $13.001,30) quedan en $13.001. El front ya formateaba sin decimales.
- **Tests**: +1 y expectativas ajustadas (65 en total). Verificado en local y producción: "$2.400,50" → base $2.401 → +40% → $3.361 exacto.

## 2026-09-17 — Fix: precio final no coincidía con el recargo esperado

- **Causa**: reglas superpuestas (una regla suelta +30% "$10.001–∞" competía con los tramos de la escala) y el preview no mostraba qué regla se aplicaba → el recargo final parecía arbitrario.
- **Preview transparente**: `/import/preview` ahora devuelve `applications[]` (precio base → final, nombre de la regla y % aplicado por producto) y la tabla del importador muestra "Precio a importar" (final tachado sobre el base) y la columna "Regla aplicada" (o "sin regla").
- `applyRuleGroup` dejó de depender de `applyPriceRules` (separación de lógica tras un ajuste de filtros intermedio).
- **Verificado en producción**: grupo "40-30-20" aplicando $5.000→$7.000 (+40%), $15.000→$18.000 (+20%), $30.000→$36.000 (+20%), con la regla visible en cada fila. 64 tests OK.
- Nota: si dos reglas activas solapan un mismo precio, gana mayor prioridad y a igual prioridad el rango más angosto — ahora siempre visible en el preview. Se recomienda no superponer rangos de la misma escala.

## 2026-09-17 — Fix: categorías perdidas y doble recargo al importar la selección

- **Categorías**: al confirmar la selección del preview, los items llegan ya normalizados (`categoryId` como slug) y el normalizador no los reconocía → la categoría no se creaba y el producto quedaba sin categoría. Ahora `normalizeExternalItems` acepta `categoryId`/`subcategoryId` y crea las categorías (con nombre legible desde el slug: "ropa-de-mascotas" → "Ropa de mascotas").
- **Doble recargo**: el preview aplicaba la regla/grupo y el import la aplicaba de nuevo sobre el precio ya recargado. Ahora el import de una selección (`source: "selección"`) NO re-aplica reglas (`skipRules`) — los precios ya vienen finales.
- **priceCents explícito**: `price_cents`/`priceCents` se toman tal cual (están en centavos); solo `price`/`precio` se parsean como texto de usuario. Antes un JSON con priceCents se multiplicaba ×100.
- **Tests**: +3 (64 en total). Verificado end-to-end en local y producción: selección del preview con grupo "Escala prueba" → precios correctos ($2.400→$3.360, $15.000→$19.500, sin doble recargo) y categoría "Mascotas" creada.
- Nota: si en producción no aparece el campo "Grupo" en el formulario de reglas, es caché del navegador — Ctrl+F5.

## 2026-09-17 — Grupos de reglas de precios (escalas)

- **Concepto**: varias reglas pueden compartir `groupName` y forman una **escala** (ej: "Escala 2026" = $0–$10.000 → +40%, $10.001–$20.000 → +30%, $20.001+ → +20%). En Importar se puede seleccionar el **grupo entero** (opción `group:<nombre>` en `priceRuleId`) y cada producto recibe el recargo del tramo que le corresponde según su precio.
- **DB**: columna `group_name` en `price_rules` (schema + migración `db/migrations/001-price-rules-group.sql` aplicada en local y producción).
- **Motor** (`src/shared/pricing.ts`): `applyRuleGroup` (aplica el tramo del grupo que matchee el precio), `groupNames` (lista de grupos). `applyRuleSet` acepta `"group:<nombre>"`.
- **Worker**: `sanitizeRule`/`upsertPriceRule`/`rowToPriceRule` con grupo.
- **UI**: campo "Grupo" en el formulario de reglas (con autocompletado de grupos existentes), columna Grupo en la tabla, y en Importar el selector muestra primero los grupos ("🗂️ Grupo: X (escala completa)") y luego las reglas individuales.
- **Tests**: +6 (61 en total): tramos contiguos, huecos entre tramos, aislamiento entre grupos, límites exactos. Verificado end-to-end en local y producción con la escala de 3 tramos contra hacetupedido.com (7 productos, cada uno con el recargo de su tramo).

## 2026-09-17 — Reglas de precios por rango

- **Nuevo `src/shared/pricing.ts`**: motor de reglas — `applyPriceRules` (automático por rangos: gana mayor prioridad, a igual prioridad el rango más específico) y `applyForcedRule` (forzada: se aplica siempre aunque el precio esté fuera del rango, decisión explícita del usuario).
- **DB**: tabla `price_rules` (name, min_cents, max_cents nullable, percent, active, priority) + CRUD en `/api/admin/price-rules`.
- **Integración**: `importItems` (usada por import manual, importador UI y cron de sync) aplica las reglas activas automáticamente; el importador permite forzar una regla puntual vía `priceRuleId`. El preview muestra precios ya con recargo.
- **UI**: nueva pestaña "Reglas de precios" (CRUD con nombre, rango min/max, % recargo — admite negativo, prioridad, activa) y selector "Regla de precio a aplicar" en Importar (Automático o una concreta).
- **Tests**: +12 del motor de precios (55 en total). Verificado end-to-end con hacetupedido.com: automática (+40% solo a precios bajo $10.000) y forzada (+25% a todos). Regla de ejemplo "Recarga baratos" creada en producción.

## 2026-09-17 — Importador: extracción desde URL (TiendaNegocio + JSON-LD + Shopify)

- **Nuevo `src/shared/ldjson.ts`**: parser de JSON-LD schema.org (`@type: Product`, `CollectionPage/ItemList` con URLs de fichas, offers con price/lowPrice, availability, @graph anidado).
- **Nuevo `src/shared/tiendanegocio.ts`**: parser del estado embebido `1-state` de tiendas TiendaNegocio — productos de la categoría con precio (usa `promo` si hay, marca oferta), stock, imagen y **categoría de la página**, todo desde un solo fetch, sin explorar fichas individuales. Decodifica el escaping `&q;/&s;/&a;`.
- **Nuevo `src/worker/extract.ts`**: `extractFromUrl()` con cascada de estrategias: ① JSON directo ② estado TiendaNegocio ③ JSON-LD (ficha o categoría→fetch de fichas, máx 40) ④ Shopify `/products.json`. UA de navegador y redirect follow.
- **API**: `/api/admin/import/preview` ahora devuelve `{source, found, products, errors}`; `/api/admin/import` acepta `{items: [...]}` para importar solo la selección marcada en la UI.
- **UI importador**: auto-análisis al pegar un link, lista con checkboxes (marcar todos/ninguno), thumbnails, precios formateados y confirmación de la selección. Botón renombrado a "Analizar".
- **Categorías automáticas**: el importador crea la categoría de la página si no existe (verificado: "Mascotas" desde hacetupedido.com).
- **Tests**: +13 (43 en total). Typechecks OK. Deploy a producción verificado con `https://www.hacetupedido.com/productos/mascotas`: 7 productos con precios correctos y categoría creada.
- Nota operativa: las URLs de **categoría** de hacetupedido.com a veces devuelven 522 desde Cloudflare Workers (protección anti-bot contra data centers) pero funcionan desde la red local; las **fichas individuales** (`/producto/6160`) responden bien también desde producción. Si una categoría falla desde producción, reintentar o importar desde local.

## 2026-09-17 — Catálogo de producción vaciado

- Ejecutado `db/seed-clear.sql` en D1 remota (0 productos, 0 categorías) y snapshot KV regenerado vacío vía `POST /api/admin/snapshot`.
- Nota operativa: tras borrar la clave KV por CLI, la API pública sirvió el snapshot viejo ~3 min por propagación entre colos de Cloudflare. Los cambios hechos desde el panel no sufren esto (regeneran snapshot al instante). Verificado: `/api/catalog` → 0 productos, home sin tarjetas, ficha 404.

## 2026-09-17 — Deploy a producción

- **Deployado a Cloudflare**: `https://celu-store.pilin123.workers.dev` — D1 `celu-store-db` (id b56c2cb6…), KV `CELU_KV` (id 71875a43…), schema + seed remotos aplicados, secretos `ADMIN_PASSWORD` (temporal: `admin`, cambiar YA) y `ADMIN_SESSION_SECRET` (al azar) configurados, cron `*/15` activo.
- **Fix `tools/setup.mjs`**: `d1 create` y `kv namespace create` no soportan `--json` en wrangler 4.134 — ahora parsea los ids del output legible y hace fallback a `d1 list --json` si la DB ya existía.

## 2026-09-17 — Verificación end-to-end y fixes

- **Fix CSS**: `[hidden] { display: none !important }` — la clase `.login` con `display: flex` pisaba el atributo `hidden` y el login quedaba visible junto al dashboard.
- **Fix routing**: `GET /producto/*` sirve `product.html` vía binding ASSETS y fallback de páginas a `404.html` (antes devolvía JSON 404 en rutas de página).
- **Rate-limit** de login: 5 intentos fallidos por minuto por IP (en memoria, por isolate — por diseño, sin DO para mantener $0).
- **Fix types**: `@cloudflare/workers-types` v5 (peer de wrangler 4.134); `waLink/waMessage/waLinkText` aceptan `Pick<StoreSettings,…>`.
- **Smoke test completo en local**: home, `/api/catalog`, ficha + relacionadas, link de WhatsApp correcto (`wa.me/…?text=…`), login (mal/bien/rate-limit OK), CRUD de productos, categorías, import con previsualización, sync sin URL (error amigable), settings, log.
- **Datos**: eliminados todos los datos de prueba del smoke test; catálogo local queda con los 10 productos del seed (11 menos el oculto). Aclaración: el PUT de categorías puede re-parentar una categoría raíz importada — corregido a mano.

## 2026-09-17 — Build inicial completo

- **Config**: proyecto `celu-store` con npm scripts (dev, build, test, setup, deploy), tsconfig dual (web/worker), Vite MPA (index, product, admin) a `public/`, wrangler.jsonc con D1 + KV + cron `*/15`, `404.html` generado post-build.
- **Shared** (`src/shared/`): tipos (`Product`, `Category`, `StoreSettings`, snapshot), `parse.ts` (precios a centavos con formatos AR/US, tags con sinónimos español, disponibilidad, slugify), `normalize.ts` (mapeador genérico del importador con aliases es/en, categorías automáticas, errores por ítem), `whatsapp.ts` (links wa.me con mensaje precargado), `format.ts` (precio con Intl es-AR).
- **Worker** (`src/worker/`): Hono con rutas públicas (`/api/catalog` desde KV, `/api/products/:id` + relacionadas, `/api/public/settings`), admin (`/api/admin/*`: login con cookie HMAC + rate-limit 5/min por IP, CRUD productos/categorías con regeneración de snapshot, sync manual, log, settings, import con preview), `sync.ts` (fetch a URL JSON, upsert en D1, snapshot en KV, estado para cron), `scheduled()` que sincroniza según intervalo configurado, routing de páginas (`/producto/*` → ficha, fallback `404.html`).
- **DB** (`db/`): `schema.sql` (products, categories, sync_log), `seed.sql` (7 categorías + 11 celulares de ejemplo), `seed-clear.sql` para vaciar.
- **Frontend** (`src/web/` + HTML): catálogo con búsqueda, filtros (categoría/subcategoría, precio, tags, `?cat=`), grid responsive, estados de carga/vacío/error con retry; ficha de producto con breadcrumb, badge de stock, relacionadas y botón "Consultar por WhatsApp"; admin SPA (login, dashboard con sync/snapshot/historial, productos con modal CRUD, categorías, importador con drag&drop y previsualización, configuración).
- **Tests**: 30 tests unitarios (parsers, normalizador, WhatsApp) — todos verdes.
- **Tooling**: `tools/setup.mjs` (crea D1/KV remotos, aplica schema+seed, configura secretos), `.dev.vars` local, README completo.
