# Pendientes

Tareas de seguimiento a futuro. Cuando se completen, moverlas al changelog y borrarlas de acá.

## SEO — Google Search Console

- [ ] **Cerrar el ruido de URLs viejas** (medido el 2026-11-20 sobre 28 días: 51 clics / 3.550 impresiones):
  - `http://www.centerphone.com.ar/` acumula **353 impresiones y 11 clics** como página aparte de `https://centerphone.com.ar/` (196 y 4). La home está indexada y el 301 existe, pero Google sigue separando las variantes: conviene confirmar que el `rel=canonical` de la home apunta siempre a `https://centerphone.com.ar/` y que el sitemap no ofrece la versión con www.
  - Hay **dos sitemaps** enviados (`centerphone.com.ar` y `www.centerphone.com.ar`, 1.375 URLs cada uno). El de www es redundante: borrarlo evita «página con redirección» y señales duplicadas.
  - Google también ve `https://centerphone.com.ar/HOME` y `/home` como enlaces entrantes de la home: no rompen nada, pero conviene que no se enlacen desde ningún lado.
- [ ] **Contenido que se busca ≠ lo que hay**: las consultas con impresiones son accesorios genéricos («adaptador bluetooth para pc», «5 pin», «lectora externa para CD/DVD»). Antes de tocar títulos, revisar si esos productos están en stock: las fichas sin stock salen del catálogo público y es normal que no rankeen.
- [x] **Verificado el 2026-11-20**: propiedad `sc-domain:centerphone.com.ar` con permiso de propietario; home `PASS` (indexada, crawled as MOBILE, canonical a sí misma); sitemap descargado sin errores ni avisos. Falta revalidar una ficha puntual en [Rich Results Test](https://search.google.com/test/rich-results) si algún producto no muestra precio/stock en los resultados.
- Contexto: JSON-LD `Product` (con `brand` y `BreadcrumbList`) ya validado con 0 errores críticos.
