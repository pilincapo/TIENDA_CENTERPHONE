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
