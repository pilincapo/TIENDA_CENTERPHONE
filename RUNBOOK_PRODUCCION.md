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

El guardado desde el panel puede no llegar (ej. hecho antes del deploy). Para
activarlo directo en la KV remota preservando el resto de los valores:

```bash
# 1. Bajar el valor actual
npx wrangler kv key get "config:settings:v1" --namespace-id=71875a431359487e954c86f15edf54ae > settings.json
# 2. Editar paymentsEnabled: true (y checkoutNote si corresponde)
# 3. Subirlo
npx wrangler kv key put "config:settings:v1" --path settings.json --namespace-id=71875a431359487e954c86f15edf54ae
```

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
