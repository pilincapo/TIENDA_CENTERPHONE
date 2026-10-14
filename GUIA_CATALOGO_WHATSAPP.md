# Guía: publicar el catálogo en WhatsApp (paso a paso)

Esta guía es el detalle largo de cómo se publican productos en el catálogo de WhatsApp y qué
esperar. El resumen operativo está en [RUNBOOK_PRODUCCION.md](RUNBOOK_PRODUCCION.md); acá está
el paso a paso, los requisitos de Meta con sus fuentes, y lo que **no** se pudo confirmar.

Tres ideas que hacen falta para no perderse:

1. **El catálogo de WhatsApp es un catálogo de Meta.** No se cargan productos desde la app ni
   desde ningún panel de WhatsApp: se crea un catálogo en Commerce Manager y se lo vincula.
2. **Meta llena ese catálogo descargando un archivo de una URL.** No hay carga masiva manual; la
   única forma de mantener cientos de productos es un *feed programado* (una URL que Meta baja
   sola cada hora o cada día).
3. **Acá no se sube nada: se marca.** El panel marca productos y el worker sirve ese archivo
   ([wa-feed.ts](src/worker/wa-feed.ts) + [wa-feed.ts](src/shared/wa-feed.ts)).

---

## 0. Antes de empezar: qué necesitás

| Necesitás | Detalle |
|---|---|
| App **WhatsApp Business** en el teléfono | Es la vía para el catálogo básico. **No hace falta la API** (WhatsApp Business Platform) ni un proveedor. |
| Una cuenta de Meta Business con **Commerce Manager** | Ahí vive el catálogo: `business.facebook.com` → Commerce Manager. |
| El catálogo **vinculado a tu cuenta de WhatsApp** | El vínculo se hace una vez; después todo se maneja con datos. |
| Nada pago | Ni plan de Meta ni de Cloudflare: el feed lo sirve el mismo worker. |

Sobre verificación de empresa / revisión de comercio: **no se pudo confirmar** que sean requisito
general para el catálogo de la app (ver §6). Si al crear el catálogo Meta las pide, aparecen en
pantalla y no hay forma de evitarlas.

---

## 1. Preparar el feed en el panel (5 minutos)

En **Productos** hay tres formas de marcar, y todas conviven:

1. **Por selección:** tildás filas y usás **📱 Publicar en WhatsApp** / **📱 Quitar de WhatsApp**.
2. **Por categoría:** fila **📱 WhatsApp por categoría** → elegís la categoría → **Marcar la categoría**.
   Incluye las subcategorías (misma semántica que «Vaciar categoría»).
3. **Por origen:** fila **📱 WhatsApp por origen** → Tecnova, Hacetupedido o manuales → **Marcar el origen**.
   Es el camino corto para cargar una fuente entera.

Al elegir un alcance, el panel **cuenta antes de aplicar**: cuántos productos tiene el alcance,
cuántos ya están marcados, cuántos entrarían al feed (con stock y foto) y cuántos están hoy en el
feed. Ese texto se repite dentro del `confirm`.

**El contador de arriba** («📱 Catálogo de WhatsApp: N productos en el feed») cuenta exactamente
las filas que Meta va a recibir: marcados **y** publicados **y** con foto. Un producto marcado que
quedó sin stock, o sin foto, no cuenta ni entra.

**Los avisos que no hay que ignorar:** si la acción dejaría el feed vacío o con menos de un cuarto
de lo que hay hoy, el panel pide una **segunda confirmación**. Con el feed en cero Meta **no borra
nada, pero tampoco actualiza**: el endpoint responde error a propósito para no vaciar el catálogo,
así que WhatsApp sigue mostrando los productos viejos hasta que marques algo de nuevo.

**La URL del feed** está en **Ajustes → 📱 Catálogo de WhatsApp**: viene con el token en la query,
se puede **copiar** y **regenerar**. Al regenerarlo, la URL vieja deja de servir y hay que
actualizarla en Commerce Manager.

---

## 2. Probar el feed antes de tocar Meta

Reemplazá `<TOKEN>` por el que muestra Ajustes:

```bash
curl -sS -D - -o /tmp/feed.csv "https://centerphone.com.ar/api/whatsapp/feed.csv?t=<TOKEN>" | head -20
wc -l /tmp/feed.csv
```

Qué tiene que pasar:

| Resultado | Significa |
|---|---|
| `200`, `Content-Type: text/csv` y `X-Wa-Feed-Cache: d1` o `kv` | El feed está sirviendo. La primera descarga lee la base (`d1`); las siguientes salen de una copia en KV (`kv`). |
| `404` | El token no es el de los ajustes (o se regeneró y quedó el viejo). |
| `500` con «No hay productos marcados» | No hay nada marcado, o nada publicados-con-foto. **Es a propósito**: ver §7. |

El archivo tiene una fila de encabezado y una por producto, con 9 columnas.

---

## 3. Configurar la fuente en Commerce Manager

Los nombres de menú de Meta cambian de idioma y de versión; si algo no coincide, buscá la opción
equivalente (lo verificado está entre paréntesis).

1. Entrá a **Commerce Manager** y elegí tu catálogo.
2. **Catálogo → Fuentes de datos → + Agregar**, y elegí **Archivo de datos** (*Data file*).
3. Elegí **Usar una URL** (*Use a URL*) y pegá la URL del panel.
4. Configurá la **carga programada** y guardá.
5. **Frecuencia**: las opciones de Meta son **cada hora, cada día o cada semana**. La más seguida
   es **cada hora**; un feed programado **no puede actualizarse más de una vez por hora**.
6. **Tipo de actualización**:
   - **Reemplazo completo** (*replace*): el archivo es la verdad — lo que no está, se borra del
     catálogo. **Es lo recomendado acá**: así desmarcar un producto lo saca, y si una fuente deja
     de traerlo también.
   - **Actualización** (*update*): solo agrega y actualiza lo que viene en el archivo; lo que no
     aparece queda como estaba. Con este modo, desmarcar **no** saca nada del catálogo.
7. **País y moneda**: el catálogo tiene país y moneda propios. Poné Argentina y **ARS** (ver §6).

Fuentes: [Meta — Data feed en Commerce Manager](https://www.facebook.com/business/help/125074381480892) ·
[Feed programado](https://developers.facebook.com/documentation/ads-commerce/catalog/guides/scheduled-feeds) ·
[Frecuencias](https://www.facebook.com/business/help/2284463181837648) · consultadas el 2026-10-13.

---

## 4. Validar con 2-3 productos antes de marcar todo

La primera descarga puede tardar hasta una hora. Para no arriesgar el catálogo entero:

1. Marcá **2 o 3 productos** (por selección, no por origen/categoría).
2. Esperá la primera descarga y mirá **Catálogo → Productos** en Commerce Manager: si un ítem
   aparece con error, el detalle dice qué campo falla.
3. Confirmá dos cosas que solo se ven en la interfaz de Meta:
   - que el **precio en ARS** se muestre bien (no todo el mundo lo tiene confirmado, ver §6);
   - que la **foto** se vea (las fotos las sirve el CDN de la fuente, no este sitio).
4. Recién ahí marcá por categoría u origen.

---

## 5. Qué manda el feed

Meta pide **9 campos obligatorios** para catálogos de anuncios y commerce, y el feed los manda
siempre. Cómo se llena cada uno:

| Campo | De dónde sale |
|---|---|
| `id` | El id del producto (máx. 80 caracteres; Meta acepta hasta 100). |
| `title` | Título del producto, recortado a 200 (Meta pide máx. 200). |
| `description` | La del producto; si está vacía (pasa en **995 de 1365**), se genera un texto con título, categoría y tienda, porque Meta la exige. |
| `availability` | `in stock` / `out of stock` / `preorder` (en inglés, como pide Meta). |
| `condition` | `new` fijo (el catálogo es de productos nuevos). |
| `price` | `3360.00 ARS`: número, punto decimal y **código ISO**, sin símbolo. |
| `link` | `https://centerphone.com.ar/producto/<id>`. |
| `image_link` | La foto de la fuente (CDN), tal cual viene. |
| `brand` | La marca si se pudo detectar (**solo 150** la traen), si no el nombre de la tienda. |

Reglas del archivo: los campos con coma o comillas se escapan, los saltos de línea se aplanan y
**un producto sin foto o sin stock no entra** (queda registrado en los logs con el motivo).

Fuente de los requisitos: [Meta — Catalog Fields](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/fields)
(consultada el 2026-10-13). Formatos aceptados por Meta: CSV, TSV, RSS/ATOM XML y Google Sheets;
límite de 4 GB o 1.000.000 de ítems por feed.

### Estado real del catálogo (producción, medido el 2026-10-13)

Para esta guía se consultó la base de producción: **1365 productos publicados** (995 sin descripción,
1215 sin marca), **18 en preventa**, **22 con foto `.webp`** y **100 ya marcados para WhatsApp**
(todos de origen Tecnova). Los tres grupos que pueden hacer que Meta rechace ítems están detallados
en la tabla de §7, y hay algo para arreglar ya: **4 de los 22 con `.webp` están marcados**, o sea que
hoy Meta los está rechazando.

---

## 6. ¿Funciona en Argentina?

Se buscó en la documentación oficial de Meta el 2026-10-13. Lo que se pudo y lo que no:

**Lo que dice la documentación**

- El catálogo básico está pensado para la **app WhatsApp Business** (Android/iPhone) y **no
  requiere la API**: la Platform es una vía aparte, para mensajería programática.
  ([anuncio de Meta, 2019](https://about.fb.com/news/2019/11/introducing-catalogs-for-small-businesses/) ·
  [catálogos en Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/))
- El **formato de precio** que pide Meta es el que ya generamos: número, espacio y código ISO 4217,
  con punto decimal y sin símbolo (`12500.00 ARS` cumple la especificación).
  ([Catalog Fields](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/fields))
- **Meta admite ARS** en al menos un producto de cobro, pero esa lista es de *Games Payments*, no de
  catálogos. ([Supported Currencies](https://developers.facebook.com/documentation/games_payments/payments/reference/supportedcurrencies))
- Para vender en varios países con distintos precios, el mecanismo documentado son los **country
  feeds** (un feed localizado por país). ([Cómo crear un country feed](https://www.facebook.com/business/help/2144286692311411))

**Lo que NO se pudo confirmar (y por eso no se afirma)**

- **La lista vigente de países con catálogo de WhatsApp.** Lo único oficial que se encontró es el
  anuncio de lanzamiento del **7 de noviembre de 2019**, que nombra siete países (Brasil, Alemania,
  India, Indonesia, México, Reino Unido y EE. UU.) — **Argentina no aparece** — pero en el mismo
  texto Meta dice que se desplegaría «pronto en todo el mundo». En 2020 Meta afirmó que los
  **enlaces** a catálogos están disponibles globalmente. Esa lista de 2019 **no prueba** que
  Argentina esté excluida hoy… y tampoco prueba lo contrario.
- Si hace falta **verificación de empresa** o cuenta publicitaria para el catálogo de la app.
- Si Meta **exige que ARS coincida** con el país del catálogo, y con qué error rechazaría si no.
- Qué hace Meta con un **archivo vacío** (ver §7).

**Cómo confirmarlo en tu cuenta (5 minutos, es la verdad para este negocio)**

1. En **Commerce Manager**, abrí el catálogo y mirá si ofrece **Fuentes de datos → Agregar → Archivo
   de datos → Usar una URL**. Si esa opción está disponible, el feed programado funciona para tu cuenta.
2. En la **app WhatsApp Business** del teléfono, mirá si aparece la sección **Catálogo** y si te deja
   vincular el catálogo de Commerce Manager.
3. Marcá 2-3 productos, dejá que Meta descargue y revisá que aparezcan **con precio en ARS y foto**.

Eso resuelve en un rato lo que la documentación pública no aclara.

---

## 7. Problemas típicos

| Síntoma | Causa y qué hacer |
|---|---|
| El feed responde **500 «No hay productos marcados»** | Hay 0 marcados **o** ninguno de los marcados está publicado y con foto. **Es intencional**: con la fuente en «reemplazo completo», un archivo vacío vaciaría el catálogo de WhatsApp. Marcá algo y vuelve a servir. |
| **404** en el feed | Token viejo tras regenerarlo, o la URL quedó sin `?t=`. Copiá la nueva desde Ajustes y actualizala en Commerce Manager. |
| Meta **rechaza ítems por la imagen** | Tiene que ser **JPEG o PNG** y de al menos **500×500 px**. En el catálogo de producción hay **22 productos con foto `.webp`** (todos de origen Tecnova salvo uno manual), varios además por debajo de 500 px de ancho, y al revisarlos varias de esas URLs respondieron **404** en un segundo intento. **4 de esos 22 ya están marcados**, así que hoy Meta los rechaza: `tecnova-78`, `tecnova-88`, `tecnova-95`, `tecnova-97` (sacalos del catálogo o cambiales la foto). Los otros 18 no los marques hasta cambiarles la foto: `3962`, `tecnova-113`, `-114`, `-127`, `-129`, `-130`, `-131`, `-135`, `-139`, `-140`, `-144`, `-146`, `-155`, `-157`, `-159`, `-161`, `-169`, `-171`. |
| Meta rechaza ítems por **`availability`** | Hay **18 productos en preventa** (`preorder`). La página de campos de Meta lista `in stock` y `out of stock`, y el resto de los valores está documentado en otras páginas. Si aparecen rechazados, ese es el campo a mirar. |
| Meta rechaza por **precio** | El formato correcto es `12500.00 ARS` (punto, no coma; sin `$`). Esto ya lo genera el feed; si aparece el error, sospechá del país/moneda del catálogo. |
| El feed «andaba» y dejó de actualizarse | Si una fuente programada **falla varias veces, Meta puede pausar la programación**. Se reanuda desde **Settings → Schedules → Resume** ([ayuda de Meta](https://www.facebook.com/business/help/2041876302542944)). |
| Quiero **borrar** todo el catálogo de WhatsApp | **No** lo hagas sirviendo un archivo vacío: no está documentado cómo lo trata Meta. Desmarcá los productos y deja que un **reemplazo completo** con el resto los saque. |
| Marqué y el feed no cambia | La copia en KV se tira sola en cada cambio; mirá el encabezado `X-Wa-Feed-Cache` y el contador del panel. Si el contador no se movió, la acción no cambió nada (por ejemplo, ya estaba marcado). |

---

## 8. Operación del día a día

- **Cargar una fuente nueva**: marcá el origen entero y listo; los syncs posteriores **no borran la
  marca** (si un producto se va de la fuente, se oculta y sale del feed; si vuelve, entra solo).
- **Sacar algo del catálogo**: quitá la categoría o el origen, o desmarcá los productos.
- **Una vez por semana**: mirá el contador del panel (que coincida con lo que esperás), y en
  Commerce Manager **Productos** filtrá por error. Los avisos del worker quedan en Workers Logs
  (`wa-feed: N producto(s) publicados` y los salteados con su motivo).
- **Si se filtra la URL**: regenerá el token en Ajustes y actualizá la URL en Commerce Manager.
- **Las fotos** las sirve el CDN de la fuente: si una foto desaparece de la fuente, Meta puede
  rechazar ese ítem (el catálogo de WhatsApp no copia las imágenes).

---

## 9. Checklist final

- [ ] Catálogo creado en Commerce Manager y vinculado a la cuenta de WhatsApp Business.
- [ ] País **Argentina** y moneda **ARS** elegidos en el catálogo.
- [ ] Feed probado con `curl`: 200 y filas con 9 columnas.
- [ ] Fuente agregada por **URL**, frecuencia **cada hora**, tipo **reemplazo completo**.
- [ ] 2-3 productos validados en Commerce Manager **con precio y foto**.
- [ ] Los 22 productos con foto `.webp` quedaron afuera (o se les cambió la foto).
- [ ] Marcado el resto (por origen o categoría) y contador del panel acorde.
- [ ] Anotado en algún lado que el token se rota desde Ajustes y hay que actualizar Meta.
