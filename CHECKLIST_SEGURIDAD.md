# Checklist de auditoría de seguridad — Panel admin en producción

Para auditar `https://centerphone.com.ar` después de un deploy. Cada caso indica
el comando (o paso manual) y el **resultado esperado**. Si un caso falla, revisar
el fix asociado en `INFORME_SEGURIDAD.md` (referencias A1, A2, M1, M4, B1...).

Marcar cada casilla al verificar. Tiempo estimado: 15-20 minutos.
Requisito: terminal con `curl` (Git Bash / PowerShell con curl.exe).

---

## 1. Cabeceras de seguridad (fix A1)

### 1.1 Home
```bash
curl -s -D - -o /dev/null https://centerphone.com.ar/ | grep -i 'content-security\|x-frame\|x-content-type\|referrer-policy\|permissions-policy'
```
**Esperado**: las 5 cabeceras presentes. La CSP debe incluir:
`script-src 'self' 'nonce-...' https://static.cloudflareinsights.com` y `frame-ancestors 'none'`.

### 1.2 Panel admin (asset estático + _headers)
```bash
curl -s -D - -o /dev/null https://centerphone.com.ar/admin/ | grep -i 'content-security\|x-frame\|cache-control'
```
**Esperado**: CSP + `X-Frame-Options: DENY` + **`Cache-Control: no-store`** (el HTML del login no debe ser cacheable).

### 1.3 Página de seguimiento (nonce dinámico)
```bash
curl -s -D - https://centerphone.com.ar/seguimiento | grep -o 'script nonce="[a-f0-9]\{8\}' | head -1
```
**Esperado**: un nonce presente (32 hex). Dos request seguidos deben dar nonces distintos.
**Esperado además**: el `href` del botón empieza con `https://` (fix B3).

### 1.4 El sitio sigue funcionando con la CSP (navegador)
Abrir `https://centerphone.com.ar/` → F12 → pestaña Console → recargar.
**Esperado**: **cero errores rojos** (si aparece "Refused to load... violates CSP", algo quedó bloqueado: anotar el dominio faltante). Verificar que se ven productos con imágenes.
Repetir en `/admin/` (pantalla de login visible) y `/seguimiento` (deriva a los 3s).

---

## 2. Tracking protegido (fix A2)

```bash
# 2.1 Origin externo
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://centerphone.com.ar/api/track \
  -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  -d '{"type":"home_view"}'
```
**Esperado**: `403`.

```bash
# 2.2 Sin Origin (bot/curl en producción)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://centerphone.com.ar/api/track \
  -H 'Content-Type: application/json' -d '{"type":"home_view"}'
```
**Esperado**: `403`.

```bash
# 2.3 Origin propio
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://centerphone.com.ar/api/track \
  -H 'Origin: https://centerphone.com.ar' -H 'Content-Type: application/json' \
  -d '{"type":"home_view"}'
```
**Esperado**: `204`.

### 2.4 Las métricas reales no se rompieron (navegador)
Navegar el catálogo, entrar a una ficha, volver. Panel → Estadísticas.
**Esperado**: las visitas del día siguen contando (el propio navegador envía Origin propio).

---

## 3. Login y rate limit

### 3.1 Contraseña incorrecta
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://centerphone.com.ar/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"incorrecta-xyz"}'
```
**Esperado**: `401`.

### 3.2 Rate limit del login (5 intentos/min)
Ejecutar 7 veces seguidas:
```bash
for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w "%{http_code} " -X POST https://centerphone.com.ar/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"mal-$i"}'; done; echo
```
**Esperado**: algunos `401` y luego **`429`** ("Demasiados intentos"). Esperar 1 minuto antes de seguir con los otros tests (o el rate limit te bloquea a vos).
Nota: el límite es por isolate (fix pendiente B2 con WAF); si no aparece 429, anotarlo pero no es regression.

### 3.3 Sin cuerpo JSON
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://centerphone.com.ar/api/admin/login
```
**Esperado**: `401` (nunca 500).

### 3.4 Rutas admin sin sesión (no debe filtrar nada)
```bash
for p in products categories settings auto-imports stats "sync/log"; do
  printf "%-14s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" "https://centerphone.com.ar/api/admin/$p"
done
```
**Esperado**: **todas `401`**. Si alguna devuelve 200 y datos, es un hallazgo grave.

---

## 4. Cookies de sesión

### 4.1 Flags de la cookie al hacer login
```bash
curl -s -D - -o /dev/null -X POST https://centerphone.com.ar/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"TU-PASSWORD-REAL"}' | grep -i set-cookie
```
**Esperado**: `celu_session=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`.
(Cuatro flags obligatorias: `HttpOnly`, `SameSite=Lax`, `Secure`, `Max-Age` acotado.)

### 4.2 Cookie falsificada rechazada
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://centerphone.com.ar/api/admin/session \
  -H 'Cookie: celu_session=9999999999999.aaaa'
```
**Esperado**: `401` (firma HMAC inválida).

### 4.3 Logout revoca la sesión (fix M4) — usar el panel
1. Login desde el panel (navegador).
2. Copiar la cookie `celu_session` de DevTools → Application → Cookies.
3. Cerrar sesión desde el panel (botón Salir).
4. Volver a enviar un request con la cookie copiada:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://centerphone.com.ar/api/admin/session \
  -H 'Cookie: celu_session=PEGA-AQUI-LA-COOKIE'
```
**Esperado**: `401`. **Este es el caso clave de M4**: antes del fix daría `200`.

### 4.4 Cambio de contraseña cierra las otras sesiones (fix M1)
1. Login en el navegador **y** en una ventana incógnito (o copiar la cookie a un curl como en 4.3).
2. Desde el navegador: cambiar la contraseña (Configuración → Cambiar contraseña).
3. En la ventana incógnito / curl: intentar seguir usando la cookie vieja.
**Esperado**: incógnito → `401`; el navegador que cambió la contraseña sigue logueado (`persisted: true` en el toast).
4. Login con la contraseña nueva en incógnito: **debe funcionar**.
5. **Importante**: dejar anotada la contraseña nueva y repetir este test 10 minutos después y tras el próximo deploy — debe seguir siendo la nueva (persistencia en KV, el corazón de M1).

---

## 5. URLs https forzadas (fixes B1/B3)

### 5.1 Auto-importación con http:// rechazada
```bash
# (con cookie de sesión válida)
curl -s -X POST https://centerphone.com.ar/api/admin/auto-imports \
  -H 'Cookie: celu_session=...' -H 'Content-Type: application/json' \
  -d '{"url":"http://insegura.com/lista","label":"test"}' -w "\n%{http_code}\n"
```
**Esperado**: `400` con error "Falta una URL válida (https)".
(Verificar que el job de prueba se borra si se crea uno con https.)

### 5.2 /seguimiento nunca deriva a http
```bash
curl -s https://centerphone.com.ar/seguimiento | grep -o 'href="[^"]*"' | grep -v 'https://\|href="/"'
```
**Esperado**: sin resultados (todos los href externos son https).

---

## 6. Límite de descarga (fix M3) — opcional, solo si hay sospecha

En local (no en producción, para no quemar cuota):
```bash
# against dev server
curl -s -X POST http://127.0.0.1:8788/api/admin/import \
  -H 'Cookie: ...' -H 'Content-Type: application/json' \
  -d '{"url":"https://httpbin.org/bytes/20000000"}' -w "\n%{http_code}\n"
```
**Esperado**: error claro "supera el límite de 8MB", nunca un isolate colgado.

---

## 7. Panel funcional tras el hardening (smoke test)

- [ ] Login al panel funciona con la contraseña vigente
- [ ] Dashboard carga (Estado por fuente, Salud del cron, historial)
- [ ] Auto-importaciones lista las fuentes
- [ ] Estadísticas muestra datos del día
- [ ] Configuración guarda (probar un cambio menor y revertirlo)
- [ ] Catálogo público: productos, búsqueda, ficha, botón WhatsApp
- [ ] `/seguimiento` deriva al destino configurado

---

## Resultado de la auditoría

| Fecha | Versión | Casos fallados | Notas |
|---|---|---|---|
| 2026-09-29 | `189fe0d4` (post-deploy A1+A2+M1+M3) | 1.4 beacon CF (corregido en `189fe0d4`), resto OK | CSP bloqueaba beacon de Cloudflare Analytics; agregado a la CSP |
| | | | |

**Regla de oro**: si algo falla, NO revertir a lo rápido — consultar `INFORME_SEGURIDAD.md`
y el changelog, que documentan por qué cada control existe.
