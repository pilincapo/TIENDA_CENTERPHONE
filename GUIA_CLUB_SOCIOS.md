# 🎁 Guía del Club de socios

Todo se maneja desde el panel (`/admin/`); no hace falta tocar código. La página pública es `/club`.

## Prender y apagar el club

**Ventas → Club** → casilla **Activar el club de socios**.

- **Activo**: se publica `/club`, el carrito pide el código y el descuento se aplica en cada compra.
- **Apagado**: `/club` muestra un aviso de pausa, el carrito deja de pedir código y no se descuenta nada. La lista de socios se conserva.

## Los tres niveles: 5, 10 y 15 %

Hay dos lugares distintos, y conviene no confundirlos:

**1. Descuento inicial para nuevos socios** — *Configuración → Club de socios*

Es el nivel con el que **entra un socio nuevo** (por la web o por el alta manual). Hoy está en **5 %**. Se elige de un select con 5 / 10 / 15.

**2. Nivel de cada socio** — *Ventas → Club*, columna **Descuento**

Cada fila de la tabla tiene un select con 5 % / 10 % / 15 %. Al elegir otro valor se guarda al instante (aviso «Nivel actualizado: X% de descuento») y desde ese momento el socio paga con ese descuento.

- Si debajo del select dice **base**, ese socio **no tiene nivel propio** y usa el descuento inicial.
- Un socio tiene **un solo nivel**: no se suman entre sí.
- **Ojo al bajar el inicial**: también alcanza a todos los que están en «base». Si alguien tiene que seguir con un porcentaje mayor, asignale el nivel a mano.
- El select sólo ofrece los tres niveles; hoy no hay opción en la pantalla para volver a «base» (sí existe por API, ver abajo).

### Ejemplo: base 5 % y un socio que conserva el 10 %

1. Configuración → Club → Descuento inicial: **5 %**.
2. Ventas → Club → buscás al socio → columna Descuento → **10 %**.
3. Resultado: los nuevos entran con 5 %, ese socio sigue con 10 % y el resto de los «base» queda en 5 %.

## Dar de alta un socio

- **Desde la web**: en `/club`, «Quiero ser socio» pide nombre y WhatsApp (email y cumpleaños son opcionales). También se puede desde el carrito.
- **Desde el panel**: Ventas → Club → **+ Agregar socio**. Pide nombre, WhatsApp, email, cumpleaños y **Nivel de descuento** (viene preseleccionado el inicial).
- El cliente recibe un código `SOC-XXXXXX`. En `/club` lo recupera volviendo a completar el alta con el mismo WhatsApp (le devuelve el mismo código).
- El **WhatsApp es la clave**: si la persona ya existe, se recupera su código en vez de duplicarla. Da igual si lo escribe con `+54 9` o sin eso.

## Cómo se usa en la compra

1. El cliente agrega productos y abre el carrito.
2. Pone su código de socio y el WhatsApp de la compra. Si el WhatsApp no es el del socio, el código se rechaza.
3. El descuento del club se aplica **primero** sobre el subtotal, y el de transferencia **después** sobre lo que queda (no se suman: van en cascada).
4. El porcentaje queda **congelado en el pedido**: si después le cambiás el nivel, los pedidos viejos no se modifican.
5. El sitio público promete «hasta un 15 %»; el porcentaje real se ve al aplicar el código.

## Gestión de la lista

- Buscador por nombre, código, WhatsApp o email, y filtros **Todos / Activos / Inactivos**.
- **Cumpleaños del mes** para armar una promo.
- **Compras** y **Gastado** cuentan sólo pedidos pagados.
- **Desactivar** no borra al socio: deja de recibir el descuento.
- El botón 📋 copia el código para mandarlo por WhatsApp.

## Preguntas frecuentes del cliente

Para responder por WhatsApp. Entre comillas va el texto que el cliente ve en pantalla.

**«No me acuerdo del código.»**
En `/club` vuelve a completar **«Quiero ser socio»** con el **mismo WhatsApp** del alta: el sitio le devuelve el mismo código en el acto, sin crear un socio nuevo. (La sección **«Ya soy socio»** sólo sirve para consultar si un código sigue activo.) Si ya lo usó en ese navegador, el carrito lo tiene guardado.

**«Me dice que el código no corresponde a este WhatsApp.»**
El código es personal y sólo vale con el número del alta. O pone el WhatsApp del alta en el carrito, o quita el código y compra sin descuento. El aviso en el checkout es: *«El código de socio no corresponde a este WhatsApp. Usá el número con el que te diste de alta o quitá el código.»*

**«Me dice que el código no está activo.»**
Puede ser que el alta no se haya completado, que la cuenta esté desactivada o que haya un error de tipeo. El código no tiene `0` (cero), `O`, `1`, `I` ni `L` justamente para dictarlo por teléfono: si escribió una `O` donde va un número, falla. Se recupera con el mismo WhatsApp desde `/club`; si sigue sin funcionar, revisá la ficha en el panel y reactivala.

**«No me toma el descuento y no dice nada.»**
- El club está en pausa (no aparece el bloque en el carrito).
- El código quedó guardado en otro teléfono o navegador: hay que volver a ingresarlo.
- El socio está **desactivado** en el panel.
- El carrito está vacío: el descuento se calcula sobre productos, no sobre el envío.

**«¿Cuánto descuento tengo?»**
El club va de **5 % a 15 %** según el nivel que tenga asignado. Al aplicar el código el carrito muestra el porcentaje real; el sitio sólo promete «hasta un 15 %».

**«¿Se suma al descuento por transferencia?»**
No se suman: se aplican **en cascada**. Primero el del club sobre el subtotal y después el de transferencia sobre lo que queda. Ejemplo con $100.000, 10 % de club y 10 % por transferencia: $100.000 → $90.000 → **$81.000** (no $80.000).

**«¿Vale para todo? ¿Tiene límite de usos?»**
Vale sobre el subtotal de productos de cada compra, sin tope de usos mientras la cuenta esté activa. El envío se cotiza aparte y no lleva descuento.

**«¿Se vence? ¿Puedo pasárselo a otra persona?»**
No vence, pero deja de aplicar si la cuenta se desactiva. No es transferible: está atado al WhatsApp del alta.

**«Me equivoqué al poner el WhatsApp.»**
El número no se edita ni desde la web ni desde el panel: es el identificador del socio. Se corrige en la base, por código de socio:

```bash
npx wrangler d1 execute celu-store-db --remote --command="UPDATE members SET phone = '3425819402' WHERE code = 'SOC-XXXXXX'"
```

El número va normalizado (sólo dígitos, sin `+54`, sin el `9` de móvil y sin `0` inicial). El código sigue siendo el mismo y desde ahí vale con el número nuevo.

**«¿Qué datos guardan?»**
Nombre y WhatsApp, más email y cumpleaños si los quiso cargar. Nada de tarjetas ni contraseñas: la suscripción es gratuita y sin cuenta.

## Para quien toque el código

- Niveles válidos: `MEMBER_TIERS` en `src/shared/loyalty.ts` (5, 10, 15).
- Dato: columna `members.discount_percent` (`NULL` = usar el inicial), migración `db/migrations/016-member-discount.sql`.
- API: `PATCH /api/admin/members/:id` con `{ "discountPercent": 15 }` (o `null` para volver a «base»); `POST /api/admin/members` acepta `discountPercent` en el alta.
- Cambiar el inicial sin pasar por el panel: KV `config:settings:v1`, campo `loyaltyDiscountPercent` (reescribir el JSON completo, no sólo la clave).
- Al publicar: correr la migración `016` con `--remote` **antes** del deploy, porque el worker consulta esa columna.
- Chequeo rápido del porcentaje efectivo de un socio (sin sesión):

  ```bash
  curl "https://centerphone.com.ar/api/loyalty/validate?code=SOC-XXXXXX"
  ```

  Devuelve `discountPercent`, el nombre y el estado del socio.
- Tests: `npm test -- loyalty` y `npm test -- checkout`.
