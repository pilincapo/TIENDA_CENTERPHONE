# Changelog

Formato: `- [fecha] — descripción de la modificación`. Una entrada por cambio, la más nueva arriba.

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
