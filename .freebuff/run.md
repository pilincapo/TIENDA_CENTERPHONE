# Run doc — Celu Store (preview de desarrollo)

App: Cloudflare Worker (Hono) que sirve el frontend estático + API en un solo puerto.

## 1. Reproducir artefactos (una vez, o tras cambiar el frontend)

```bash
npm install                 # deps (Node 20+)
npm run build               # vite build -> public/ + genera public/404.html
npx wrangler d1 execute celu-store-db --local --file=db/schema.sql
npx wrangler d1 execute celu-store-db --local --file=db/seed.sql   # datos de ejemplo
```

Secretos locales: `.dev.vars` en la raíz del checkout principal (D:\PROYECTOS\TIENDA_CENTER) con `ADMIN_PASSWORD` y `ADMIN_SESSION_SECRET`. Si este worktree no lo tiene, copiarlo del checkout principal (no commitear: está en .gitignore).

## 2. Correr el servidor

Puerto por defecto del preview: **8787** (default de wrangler; si está ocupado usar `--port <otro>`).

```bash
npx wrangler dev --port 8787
```

Detached (Windows, recipe del preview):

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npx.cmd' -ArgumentList 'wrangler','dev','--port','8787' -RedirectStandardOutput '.freebuff/preview.log' -RedirectStandardError '.freebuff/preview.log.err' -WindowStyle Hidden -PassThru).Id"
```

Verificar salud: `curl http://127.0.0.1:8787/api/catalog` debe devolver JSON con `products`.

## 3. Verificaciones rápidas

- `/` → catálogo con seed (10 productos publicados)
- `/producto/s24u` → ficha + botón WhatsApp
- `/admin/` → login con la password de `.dev.vars` (local: `admin123`)
- `npm test` → 30 tests, `npm run typecheck` → limpio
