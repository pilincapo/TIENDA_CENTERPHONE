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
