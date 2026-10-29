# Informe de seguridad — CenterPhone Celulares

Auditoría del código (Worker, panel, vistas) sin modificar nada. Hallazgos ordenados por severidad.

## ✅ Lo que está bien (verificado)

- **Sesiones**: token firmado HMAC-SHA256 con `crypto.subtle`, comparación `timingSafeEqual`, TTL 1h con renovación sliding. Cookie `HttpOnly; Secure; SameSite=Lax`.
- **CSRF**: todas las mutaciones son POST/PUT/DELETE con cookie `SameSite=Lax` (los navegadores no envían la cookie en POST cross-site) y sin cabeceras CORS (default: nobody lee respuestas desde otro origen). Riesgo bajo.
- **SQL**: todas las queries a D1 usan `.bind()` con placeholders — no hay concatenación de input del usuario en SQL.
- **Secrets**: `ADMIN_PASSWORD` solo en `.dev.vars` (gitignored). No hay secrets en el repo ni en `wrangler.jsonc`.
- **Rate limit login**: 5 intentos/min por IP, comparación de password en tiempo constante.
- **Escapado HTML**: `esc()` bien implementado en las 4 vistas y aplicado consistentemente en títulos, URLs e IDs dinámicos.
- **IDs**: `newId()` usa `crypto.getRandomValues` (no `Math.random`).
- **Login sin enumeración de usuarios** (es un solo password).

## 🔴 Alta prioridad

### A1. Sin cabeceras de seguridad en ninguna respuesta
No hay CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` ni `Permissions-Policy`. Consecuencias:
- El panel `/admin/` puede embeberse en un iframe de un sitio atacante (clickjacking: te hacen clicar "borrar producto" sin verlo).
- Si algún día se cuela un XSS, sin CSP no hay red de seguridad.

**Corrección** (middleware global en `index.ts`, ~10 líneas):
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'
```
(Verificar antes que no haya `onclick=` inline en el frontend; si hay, ajustar CSP o migrar a listeners.)

### A2. `/api/track` público sin límites → pueden inflar tus estadísticas
Cualquier script/bot puede disparar `POST /api/track` miles de veces: llena `stats_events` (D1), falsifica tus métricas de visitas/WhatsApp y consume cuota del free tier.

**Corrección**: exigir cabecera `Origin` o `Referer` de tu propio dominio (rechazar si viene de otro host o si falta en producción) + validar `productId` contra el snapshot (solo registrar si el producto existe). Opcional: deduplicar por IP+producto en un periodo corto (en memoria del isolate, sin escribir KV).

## 🟠 Media prioridad

### M1. ~~Cambio de contraseña solo vive en el isolate actual~~ ✅ CORREGIDO (2026-09-29)
Hash PBKDF2 (100k iteraciones) en KV (`admin:password`), validado en login y cambio de contraseña con fallback al secret para migración. Al cambiar, se rota el secret de sesión en KV (`admin:session-secret`) → todas las sesiones activas quedan inválidas. Ver `src/worker/admin-credentials.ts`.

### M2. Sin `ADMIN_SESSION_SECRET` dedicado (probable)
El código usa `ADMIN_SESSION_SECRET ?? ADMIN_PASSWORD`: si el secret no está configurado en producción, **tu contraseña es la clave HMAC** de las sesiones. No es catastrophic, pero rota mal: al cambiar la contraseña (M1) se invalidan todas las sesiones de forma inconsistente entre isolates.

**Corrección**: `wrangler secret put ADMIN_SESSION_SECRET` con un valor aleatorio de 32+ bytes, y que el cambio de contraseña no lo toque.

### M3. HTML descargado sin límite de tamaño
`fetchText()` hace `res.text()` sin tope: una fuente que responda 500MB (o un atacante con tu password apuntando a un server propio) puede reventar la memoria del isolate del free tier.

**Corrección**: chequear `Content-Length` si viene, y capar la lectura (~5MB) con un reader manual antes de parsear.

### M4. ~~Logout no invalida la sesión~~ ✅ CORREGIDO (2026-09-29)
Epoch de revocación en KV (`admin:sessions-revoked-before`): el logout lo adelanta a "ahora - 5s" y el middleware rechaza tokens emitidos antes. Sobrevive isolates (está en KV).

## 🟡 Baja prioridad

### B1. ~~SSRF en extracción (riesgo acotado)~~ ✅ MITIGADO (2026-09-29)
`forceHttpsUrl` rechaza `http://` explícito en auto-importaciones, `/import` y `syncUrl` — solo se extrae desde https (el contenido viaja íntegro, sin manipulación en tránsito).

### B2. Rate limit de login en memoria
Se resetea con cada deploy y se salta fácil rotando isolates. Con Cloudflare free podés agregar una **regla de WAF** (rate limiting) sobre `/api/admin/login` desde el dashboard, sin código.

### B3. ~~`/seguimiento` redirige a `http://` si se configura así~~ ✅ CORREGIDO (2026-09-29)
El `trackUrl` se valida con `forceHttpsUrl`: http explícito cae al fallback https (un valor viejo guardado como http ya no deriva a texto claro).

### B4. `/admin/` (estáticos) cacheable
Los assets del panel no mandan `Cache-Control: no-store`; un proxy corporativo podría cachear el HTML del login. Menor, pero gratis de arreglar agregando `_headers` o un middleware.

### B5. `timingSafeEqualStr` filtra la longitud del password
Comparación de largo antes del XOR: expone el largo de la contraseña por timing. Irrelevante en la práctica (la diferencia es de microsegundos sobre red), pero se arregla comparando siempre contra un hash de largo fijo.

## Plan sugerido (si querés que lo aplique)

1. **A1** — middleware de headers de seguridad (impacto alto, 10 líneas, sin riesgo).
2. **A2** — validación de Origin en `/api/track` (protege tus métricas y la cuota D1).
3. **M3** — límite de tamaño en `fetchText` (evita muertes del cron por fuentes gigantes).
4. **M1/M2** — decidir estrategia de password/secret (requiere que corras 2 comandos `wrangler secret put`).

---

# Auditoría 2026-10-29 (segunda pasada, código actual)

Revisión completa del worker, el panel y las vistas con el skill `security-audit` de Cloudflare, más `npm audit`. Sin cambios de código: solo hallazgos. Las severidades son de explotabilidad **en este sitio**, no del CVSS genérico.

## Ya resuelto de la primera pasada (re-verificado en el código)

- **A1** ✅ cabeceras de seguridad en `security.ts` + `public/_headers`, con CSP y nonce por request para el único inline (`/seguimiento` es un redirect sin HTML propio: el nonce no tiene uso hoy, pero queda listo).
- **A2** ✅ `/api/track` exige `Origin`/`Referer` propio (`isAllowedTrackOrigin`).
- **M2** ⚠️ **parcial**: ver N5 (el fallback a `ADMIN_PASSWORD` sigue existiendo).
- **M3** ✅ `readBodyCapped` corta en 8MB con `Content-Length` y reader manual; timeouts de 20s por intento.
- **B3** ✅ `forceHttpsUrl` en `trackUrl`/`syncUrl`.
- **B4** ✅ **corregido el 2026-10-29**: el `no-store` de `_headers` solo aplicaba a `/admin/` — `/admin/index.html` y `/admin` eran líneas de ruta sin bloque de cabeceras debajo (wrangler lo avisaba como «No headers specified» y descartaba las 2 reglas). Ahora cada ruta tiene su bloque: 4 reglas válidas, 0 inválidas, y las tres respuestas del panel (`/admin` 307, `/admin/` 200, `/admin/index.html` 307) llevan `Cache-Control: no-store`.

## 🟠 Media (condicionada)

### N1. ~~SSRF acotado + reventón de subrequests en el importador por categoría JSON-LD~~ ✅ CORREGIDO (2026-10-29)
`src/worker/extract.ts` → `itemsFromCategoryDetail()` tomaba hasta **40 URLs literales del JSON-LD de un HTML de terceros** (`src/shared/ldjson.ts:80-98`, sin validar esquema ni host) y las pedía con `fetchText()`: `redirect: "follow"`, **3 intentos cada una**. Dos consecuencias:

1. **Subrequests**: 40 × 3 = hasta **120 subrequests en una sola invocación**, por encima del límite de **50** del plan gratis → la invocación entera falla y se pierde la importación (no solo las fichas).
2. **SSRF**: una fuente comprometida puede hacer que el worker pida `http://127.0.0.1:8787/…`, `http://localhost/…` o cualquier host interno alcanzable; el contenido de la respuesta se parsea y se guarda en el catálogo. En producción el daño es bajo (no hay metadata service de Cloudflare accesible), en local apunta al dev server.

**Corrección aplicada** (`src/worker/extract.ts`, con tests en `src/worker/extract.test.ts`):
- **`urlExternaPermitida()`** (exportada): solo URLs `http(s)` absolutas a hosts públicos. Bloquea loopback y redes privadas IPv4 (`0/8`, `10/8`, `127/8`, `169.254/16`, `172.16-31`, `192.168/16`, `100.64-127`), IPv6 interno (`::1`, `::`, `fe80:`, `fc00::/7`, `::ffff:`), y nombres locales (`localhost`, `*.localhost`, `*.local`, `*.localdomain`, `*.internal`, `*.home.arpa`). Las formas raras de IPv4 (decimal, hexadecimal) las normaliza `new URL` a cuadrado con puntos, así que caen en los mismos rangos.
- **Tope de 20 fichas** (`MAX_DETAIL_FETCH`), **en lotes de 3** (`DETAIL_CONCURRENCY`) y con **un solo intento** y 10s por ficha (`fetchFicha`): peor caso 1 + 20 = **21 subrequests** en lugar de 120.
- **Redirects**: se sigue el redirect, pero si la URL **final** (`res.url`) no es pública, el contenido no se lee ni se guarda (cubre el caso de una ficha pública que redirige a loopback).
- **Verificado con una categoría real** (la de Samsung, que publica `ItemList`): **17 de 19 fichas** importadas, `source=ldjson-detail`. Las fuentes configuradas del negocio no usan este camino (hacetupedido resuelve por TiendaNegocio: 7 y 24 productos, ~5s cada una), así que no hay regresión ahí. Detalle medido: lotes de 4 con timeout de 20s daban 92s; lotes de 6 hacían que el sitio cortara requests (2 de 19); con lotes de 3 y 10s quedó 17/19. Repetir la corrida seguida hace que el sitio limite por IP (1 de 19), o sea que la cobertura depende de la fuente, no solo del código.

## 🟡 Baja

### ~~N2. `/producto/<percent-encoding inválido>` responde 500 en vez de 404~~ ✅ CORREGIDO (2026-10-29)
`src/worker/index.ts`: `const id = decodeURIComponent(c.req.path.replace(/^\/producto\//, ""))` sin `try/catch`. Hono deja la ruta **cruda** cuando `decodeURI` falla (`node_modules/hono/dist/utils/url.js:68`, `tryDecodeURI`), así que `/producto/100%` lanzaba `URIError` → `app.onError` → **500**, en vez del 404 de cualquier id inexistente.

**Corrección aplicada**: helper `idDeProducto()` en `src/worker/index.ts` — decodifica con `try/catch` y, si el encoding es inválido, usa el texto tal cual (ese id no existe → 404). Tests de regresión en `src/worker/product-redirect.test.ts`: `%` suelto y escape inválido → 404 (antes 500, reproducido en rojo antes del fix), y un id bien encodificado (`cable%20usb-c`) sigue resolviendo la ficha con 200.

### N3. Sin `Strict-Transport-Security`
Ni `src/worker/security.ts` ni `public/_headers` mandan HSTS: la primera visita por `http://` (antes del 301) viaja en claro y queda explotable un ataque de downgrade si el navegador nunca vio el header. **Corrección**: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (sin `preload` hasta estar seguro de todos los subdominios).

### N4. Fuerza bruta del login: el único freno vive en memoria del isolate
`src/worker/admin.ts:38-56`: `loginAttempts` es un `Map` por isolate (5 intentos/min por IP). Se borra con cada deploy/cold start y no existe entre PoPs: con IPs rotativas el límite efectivo es cero, y no hay backoff ni bloqueo progresivo. La contraseña sigue siendo el único control real (PBKDF2 100k + timing-safe, bien).
**Corrección sin escribir KV por request**: una regla de **rate limiting del WAF** de Cloudflare (gratis, 1 regla) sobre `/api/admin/login`, y opcionalmente un contador en D1 solo por login fallido.

### N5. El secret de sesión puede degradar a la contraseña del panel
`src/worker/admin-credentials.ts`: `getSessionSecret = KV ?? ADMIN_SESSION_SECRET ?? ADMIN_PASSWORD`. Si nunca se cambió la contraseña desde el panel y no hay `ADMIN_SESSION_SECRET` configurado, la clave HMAC **es la contraseña**, y el mensaje firmado (la expiración) viaja en claro dentro de la cookie: cualquiera que capture una cookie puede hacer un ataque de diccionario **offline** (HMAC-SHA256 es rápido) hasta dar con la contraseña, que además abre el login.
**Corrección**: generar un secret aleatorio de 32 bytes y guardarlo en KV la primera vez (1 escritura, no por request) y eliminar el fallback a `ADMIN_PASSWORD`.

### N6. Endpoints públicos que gastan recursos externos sin tope robusto
- `POST /api/payments/webhook`: **una llamada a la API de MercadoPago por request**, sin rate limit → se puede usar de amplificador (cuota de MP y subrequests del worker). Un filtro barato: exigir `id` con `/^\d{1,20}$/` y descartar el resto antes de consultar.
- `GET /api/shipping/quote`: login + tarifa de Andreani, 20/min/IP en memoria; además expone si el cotizador está configurado.
- `POST /api/checkout` y `POST /api/orders/transfer`: un `INSERT` en D1 por request (10/min/IP en memoria), sin techo de filas `pending` → basura en el panel y cuota D1.

Nada de esto permite fraude (los precios se recalculan desde D1 y el webhook re-consulta el pago), es **costo/disponibilidad**. Mitigación barata: reglas de WAF + los filtros de formato de arriba.

## ⚪ Informativo

### N7. Inyección de fórmulas en el CSV de WhatsApp
`src/shared/wa-feed.ts` → `csvCell()` cumple RFC 4180 (comillas, comas, saltos) pero no neutraliza celdas que empiezan con `=`, `+`, `-` o `@`. Los títulos y marcas vienen de fuentes externas. Meta no evalúa fórmulas; el riesgo es que alguien abra el CSV en Excel. Fix trivial: prefijar `'` en esos casos.

### N8. Los chequeos de `Origin`/`Referer` no son autenticación
`isAllowedTrackOrigin` (`security.ts`) y `sameSiteOrigin` (`checkout.ts`) comparan el host de `Origin`/`Referer`, que cualquier cliente que no sea un navegador falsifica (curl). Frenan navegadores de terceros, no scripts. Consecuencia aceptada: cualquiera puede escribir eventos de métricas. Verifiqué que `query` se normaliza a 120 chars (`stats.ts`) y se renderiza con `esc()` en el panel (`src/web/admin.ts:3912-3916`), así que **no** hay XSS almacenado por esa vía.

### N9. Token del feed de WhatsApp en la query string
`/api/whatsapp/feed.csv?t=…`: por diseño (Meta no manda cabeceras). Implementado bien: 32 hex, comparación en tiempo constante, 404 sin token (no confirma la URL), `no-store`, `noindex`, copia en KV con TTL 300s invalidada en cada cambio del catálogo, y rotable desde el panel. Riesgo residual: el token queda en logs de acceso/`Referer`; si se filtra, **rotarlo** (es un botón).

### N10. Dependencias (`npm audit`)
- **Producción**: `hono@4.13.8`, **1 moderate** — [GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7): doble decodificación del path en `serveStatic` que permite saltear middleware. **No explotable acá**: el sitio no usa `serveStatic` (sirve con `env.ASSETS.fetch`). Igual conviene `npm audit fix` para pasar a la versión corregida.
- **Desarrollo** (`vite@7.3.6`, `undici` de wrangler/vitest): 2 critical, 6 high, 1 moderate según npm — todos en herramientas de build/test, no se despliegan al worker. `vite` incluye ejecución de comandos vía `launch-editor` en Windows: no correr el dev server de Vite en una máquina compartida sin actualizar.

## Re-verificado sin hallazgos (resumen)

- **SQL**: los 5 lugares con SQL dinámico (`db.ts:222/231`, `orders.ts:149/158`, `rename-ids.ts`, `stats.ts`) interpolan **solo fragmentos constantes**; todos los valores van por `.bind()` y las búsquedas escapan los comodines de `LIKE`.
- **`tecnovaApp` sí exige sesión**, aunque se monte fuera de `adminApp`: lo probé con un test temporal montando las dos apps como en `index.ts` → `POST /api/admin/import/tecnova/{preview,import}` sin cookie devuelve **401** (el `use("*")` de `adminApp` se registra como `/api/admin/*` y cubre el prefijo). Test borrado después.
- **Escapado**: panel (stats, pedidos, productos, historial de sync), `/pedido/:id` y `ogTagsHtml` (`escAttr`) escapan todo dato no confiable. `maintenanceHtml` también.
- **Checkout**: precios y totales recalculados desde D1, ocultos y "bajo pedido" no comprables, qty 1..10, máximo 20 líneas; el webhook ignora `test_mode` y pedidos ya pagados.
- **Sesión**: HMAC-SHA256, cookie `HttpOnly; Secure; SameSite=Lax`, revocación por epoch en KV, rotación de secret al cambiar la contraseña.
- **SEO/superficie**: `/changelog.md` bloqueado con 401, espejo workers.dev con `noindex`, redirecciones canónicas de un solo salto, `/404` con status real.

## Alcance y límites

No hubo pentest contra producción ni fuerza bruta real. `N2` se deduce del código y del comportamiento de Hono (no se disparó en el sitio). `N1` **ya está corregido** y cubierto por tests (`src/worker/extract.test.ts`: matriz de hosts bloqueados, tope de 10 fichas con 1 subrequest cada una, redirect a loopback descartado, ficha caída que no arrastra a las demás); los límites de subrequests y los rangos de IP se infieren de la documentación de Cloudflare. `N10` es el output literal de `npm audit` (dependencias fijadas por lockfile).
