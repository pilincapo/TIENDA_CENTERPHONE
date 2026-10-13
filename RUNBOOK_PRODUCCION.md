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
