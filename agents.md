# agents.md — Instrucciones para agentes

## Idioma
- **Responder siempre en español**, en toda conversación y en toda documentación escrita.
- Comentarios de código y commits también en español.
- Identificadores de código se quedan en inglés estándar (`products`, `syncLog`, etc.).

## Este proyecto
- Catálogo de celulares con cierre de venta por **WhatsApp** (sin carrito, sin pagos).
- Stack fijo: Cloudflare Workers + D1 + KV + Hono + Vite (vanilla TS). **Todo gratis**: no introducir servicios ni planes pagos, no superar límites del free tier (ej: no escribir en KV por request).
- El número de WhatsApp, moneda y sync se configuran desde el panel (`/admin/`), no hardcodear.

## Convenciones de trabajo
- Mantener los archivos **chicos** (los writes largos se corrompen; preferir varios archivos medianos).
- Verificar cada archivo escrito leyéndolo de vuelta antes de seguir.
- Al terminar **cualquier** modificación, agregar una entrada en `changelog.md` (ver formato allí).
- No commitear ni pushear sin pedido explícito del usuario.
- **NO hacer deploy automático**: trabajar solo con la versión local (dev server en `127.0.0.1:8787`). NO correr `npm run deploy` ni subir nada a Cloudflare/producción salvo que el usuario lo pida explícitamente con una orden como "deploy", "subir a producción", "publicar", etc. Verificar los cambios siempre en local.
- Secrets: solo en `.dev.vars` (local) o `wrangler secret put` (producción). Nunca en el repo.
