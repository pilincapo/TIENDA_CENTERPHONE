# Pendientes

Tareas de seguimiento a futuro. Cuando se completen, moverlas al changelog y borrarlas de acá.

## SEO — Google Search Console

- [ ] **Verificar en Search Console cuando Google re-rastree las fichas** (recordar al usuario / revisar en ~1-2 semanas):
  - Chequear que las fichas `/producto/*` aparezcan indexadas con rich snippets (precio, stock, marca, miga de categorías)
  - Revisar en **Sitemaps** que `sitemap.xml` se haya procesado sin errores (~991 URLs)
  - Validar una ficha puntual en [Rich Results Test](https://search.google.com/test/rich-results) si algo no aparece
  - Depende de: alta de la propiedad en Search Console (pendiente del usuario, requiere su cuenta de Google) y que Google re-rastree (días/semanas)
  - Contexto: JSON-LD `Product` (con `brand` y `BreadcrumbList`) ya validado con 0 errores críticos
