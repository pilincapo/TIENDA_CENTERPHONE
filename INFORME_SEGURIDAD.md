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
