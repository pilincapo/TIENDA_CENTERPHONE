// Pestaña Configuración: datos de la tienda, envíos, pagos y catálogo de WhatsApp.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { ANNOUNCEMENT_MOTIONS, ANNOUNCEMENT_MOTION_LABELS, ANNOUNCEMENT_SPEEDS, ANNOUNCEMENT_SPEED_LABELS, MAX_ANNOUNCEMENT_PROMOS, MAX_ANNOUNCEMENT_PROMO_LEN } from "../../shared/types";
import { esc } from "../../shared/html";
import { MEMBER_TIERS, birthdayLabel, type Member } from "../../shared/loyalty";
import { api, el, toast } from "./ui";
import { render, setDirtyGuardArmed } from "./router";

export async function viewSettings(): Promise<void> {
  const { settings } = await api<{ settings: StoreSettings }>("/settings");
  el.view.innerHTML = `
    <div class="panel">
      <h2>Configuración de la tienda</h2>
      <p class="muted">Elegí una sección. Los cambios se guardan todos juntos con el botón «Guardar configuración», pase lo que pase en cualquiera de las demás.</p>
      <nav class="cfg-tabs" id="cfg-tabs" aria-label="Secciones de configuración">
        <button type="button" class="cfg-tab active" data-sec="tienda">🏪 Tienda</button>
        <button type="button" class="cfg-tab" data-sec="pagos">💳 Pagos y envíos</button>
        <button type="button" class="cfg-tab" data-sec="club">🎁 Club</button>
        <button type="button" class="cfg-tab" data-sec="cinta">📣 Apariencia</button>
        <button type="button" class="cfg-tab" data-sec="avanzado">⚙️ Catálogo y sistema</button>
      </nav>
      <form id="s-form">
        <details class="cfg-group" open data-sec="tienda">
          <summary>Tienda <span class="cfg-hint">nombre, dirección, horarios, redes y link de seguimiento</span></summary>
          <div class="cfg-body">
            <div class="field"><label>Nombre de la tienda</label>
              <input name="storeName" value="${esc(settings.storeName)}" placeholder="Mi Tienda"/></div>
            <div class="field"><label>Dirección del local</label>
              <input name="storeAddress" value="${esc(settings.storeAddress)}" placeholder="Mendoza 2974 · Santa Fe"/></div>
            <div class="field"><label>Link de Google Maps</label>
              <input name="storeMapUrl" value="${esc(settings.storeMapUrl)}" placeholder="https://maps.google.com/?q=…"/></div>
            <div class="field"><label>Horarios (una línea por rango)</label>
              <textarea name="storeHours" rows="2" placeholder="Lunes a viernes: 9:00 a 19:00 hs">${esc(settings.storeHours)}</textarea></div>
            <div class="field"><label>Instagram (URL)</label>
              <input name="instagramUrl" value="${esc(settings.instagramUrl)}" placeholder="https://www.instagram.com/…"/></div>
            <div class="field"><label>Facebook (URL)</label>
              <input name="facebookUrl" value="${esc(settings.facebookUrl)}" placeholder="https://www.facebook.com/…"/></div>
            <div class="field"><label>Link de Seguimiento (botón del header)</label>
              <input name="trackUrl" value="${esc(settings.trackUrl)}" placeholder="https://repairpro.centerphone.com.ar/track-lite"/></div>
          </div>
        </details>
        <details class="cfg-group" data-sec="cinta">
          <summary>Apariencia y mensajes <span class="cfg-hint">WhatsApp, moneda, «Cómo comprar», cinta y badge</span></summary>
          <div class="cfg-body">
            <div class="field"><label>Número de WhatsApp (con código de país, sin + ni espacios)</label>
              <input name="whatsappPhone" value="${esc(settings.whatsappPhone)}" placeholder="5491100000000"/></div>
            <div class="field"><label>Símbolo de moneda</label>
              <input name="currencySymbol" value="${esc(settings.currencySymbol)}" maxlength="3"/></div>
            <div class="field"><label>Título del modal "Cómo comprar"</label>
              <input name="howTitle" value="${esc(settings.howTitle)}" placeholder="Cómo comprar"/></div>
            <div class="field">
              <label>Pasos de "Cómo comprar" — un paso por fila; **texto** sale en negrita</label>
              <input type="hidden" name="howSteps"/>
              <ol class="how-list" id="how-list"></ol>
              <div class="row" style="margin-top:8px">
                <button type="button" class="btn" id="how-add">+ Agregar paso</button>
              </div>
              <p class="muted" style="margin-top:10px">Así se ve en la tienda:</p>
              <ol class="modal-steps how-preview" id="how-preview"></ol>
            </div>
            <div class="field"><label>Nota de retiro del modal (vacía = "Retiro en el local: {dirección}")</label>
              <input name="howPickupNote" value="${esc(settings.howPickupNote)}" placeholder="📍 Retiro en el local: Mendoza 2974"/></div>
            <div class="field"><label>Cinta de anuncio — una promo por fila (vacía = no se muestra)</label>
              <textarea name="announcementBar" rows="3" maxlength="604" placeholder="📦 Envío gratis en Santa Fe&#10;🔥 10% de descuento por transferencia">${esc(settings.announcementBar ?? "")}</textarea>
              <p class="muted" style="margin:6px 0 0;font-size:12px">Se ve en el catálogo y en las fichas de producto. Hasta ${MAX_ANNOUNCEMENT_PROMOS} promos de ${MAX_ANNOUNCEMENT_PROMO_LEN} caracteres: con más de una, rota sola una atrás de otra cada unos segundos, con el movimiento elegido abajo.</p></div>
            <div class="field"><label>Movimiento de la cinta (cómo se anima en la tienda)</label>
              <select name="announcementMotion">
                ${ANNOUNCEMENT_MOTIONS.map((v) => `<option value="${v}" ${(settings.announcementMotion ?? "none") === v ? "selected" : ""}>${ANNOUNCEMENT_MOTION_LABELS[v]}</option>`).join("")}
              </select>
              <p class="muted" style="margin:6px 0 0;font-size:12px">Solo se anima si la cinta tiene texto. Todas las opciones respetan la preferencia de «reducir movimiento» del sistema operativo.</p></div>
            <div class="field"><label>Velocidad de la animación y la rotación</label>
              <select name="announcementSpeed">
                ${ANNOUNCEMENT_SPEEDS.map((v) => `<option value="${v}" ${(settings.announcementSpeed ?? "normal") === v ? "selected" : ""}>${ANNOUNCEMENT_SPEED_LABELS[v]}</option>`).join("")}
              </select>
              <p class="muted" style="margin:6px 0 0;font-size:12px">Afecta tanto la animación como cada cuánto rota una promo atrás de otra. «Normal» es la velocidad por defecto.</p></div>
            <div class="field"><label>Badge "Nuevo" automático (productos cargados hace menos de…)</label>
              <select name="freshHours">
                <option value="24" ${settings.freshHours === 24 ? "selected" : ""}>24 horas</option>
                <option value="48" ${settings.freshHours === 48 || settings.freshHours === 0 ? "selected" : ""}>48 horas</option>
                <option value="168" ${settings.freshHours === 168 ? "selected" : ""}>7 días</option>
                <option value="0" ${settings.freshHours !== 24 && settings.freshHours !== 48 && settings.freshHours !== 168 ? "selected" : ""}>Desactivado</option>
              </select></div>
          </div>
        </details>
        <details class="cfg-group" open data-sec="tienda">
          <summary>Modo del sitio <span class="cfg-hint">tienda con ventas online, o solo catálogo</span></summary>
          <div class="cfg-body">
            <div class="field field--check">
              <label><input type="radio" name="storeMode" value="tienda" ${settings.storeMode !== "catalogo" ? "checked" : ""}/> <strong>Modo Tienda</strong> — venta online: carrito, pago con MercadoPago, transferencia y consulta por WhatsApp</label>
            </div>
            <div class="field field--check">
              <label><input type="radio" name="storeMode" value="catalogo" ${settings.storeMode === "catalogo" ? "checked" : ""}/> <strong>Modo Catálogo</strong> — solo precios de referencia y consulta por WhatsApp: sin carrito, sin pagos y sin creación de pedidos</label>
            </div>
            <p class="muted" id="store-mode-hint" style="margin:0"></p>
          </div>
        </details>
        <details class="cfg-group" data-sec="pagos">
          <summary>Pagos online (MercadoPago) <span class="cfg-hint">recargo, descuento y CBU</span></summary>
          <div class="cfg-body" id="pagos-body">
            <div class="field"><label>Nota de envío/retiro (se muestra en el carrito y en la página del pedido)</label>
              <input name="checkoutNote" value="${esc(settings.checkoutNote)}" placeholder="Coordinamos envío o retiro por WhatsApp después del pago."/></div>
            <div class="field"><label>Recargo por pagar con MercadoPago (%) — 0 = sin recargo</label>
              <input name="mpSurchargePercent" type="number" min="0" max="50" step="1" value="${settings.mpSurchargePercent}" placeholder="0"/></div>
            <div class="field"><label>Descuento por pagar con transferencia (%) — 0 = sin descuento</label>
              <input name="transferDiscountPercent" type="number" min="0" max="50" step="1" value="${settings.transferDiscountPercent}" placeholder="0"/></div>
            <div class="field"><label>CBU / alias para transferencias (opcional; va pre-cargado en el mensaje del pedido por transferencia)</label>
              <input name="transferCbu" value="${esc(settings.transferCbu ?? "")}" maxlength="120" placeholder="Alias: CENTERPHONE.AR"/></div>
            <p class="muted">El recargo se suma al total de MercadoPago al confirmar el pedido. El descuento por transferencia es informativo: se muestra en el carrito y en el cierre por WhatsApp (el cobro lo coordinás vos).</p>
            <p class="muted" id="payments-status">Verificando credenciales…</p>
            <p class="muted">El token <strong>no</strong> se configura acá: es un secret del worker.<br>
            • Local: agregá <code>MERCADOPAGO_ACCESS_TOKEN=TEST-…</code> a <code>.dev.vars</code>.<br>
            • Producción: <code>npx wrangler secret put MERCADOPAGO_ACCESS_TOKEN</code>.<br>
            • Webhook a configurar en MercadoPago (Tus integraciones → Webhooks): <code>https://tu-dominio/api/payments/webhook</code> — evento <em>Pagos</em>.</p>
          </div>
        </details>
        <details class="cfg-group" data-sec="pagos">
          <summary>📦 Envíos (Andreani) <span class="cfg-hint">cotizá el costo de envío con el CP del comprador</span></summary>
          <div class="cfg-body">
            <div class="field field--check">
              <label><input type="checkbox" name="shippingAndreaniEnabled" ${(settings.shippingAndreaniEnabled ?? false) ? "checked" : ""}/> Mostrar el cotizador de envíos en carrito y ficha</label>
            </div>
            <div class="field"><label>N° de contrato de Andreani (lo da tu agente; ej. AND00EST)</label>
              <input name="shippingAndreaniContrato" value="${esc(settings.shippingAndreaniContrato ?? "")}" maxlength="40" placeholder="AND00EST"/></div>
            <div class="field"><label>N° de cliente Andreani (ej. CL0003750)</label>
              <input name="shippingAndreaniCliente" value="${esc(settings.shippingAndreaniCliente ?? "")}" maxlength="40" placeholder="CL0003750"/></div>
            <div class="field"><label>Código postal del local (origen de los envíos)</label>
              <input name="shippingPostalCode" value="${esc(settings.shippingPostalCode ?? "")}" maxlength="8" placeholder="3000"/></div>
            <div class="field field--row">
              <div><label>Peso por unidad (kg)</label>
                <input name="shippingPackageKilos" type="number" min="0" max="1000" step="0.01" value="${settings.shippingPackageKilos ?? 0.5}"/></div>
              <div><label>Volumen por unidad (cm³)</label>
                <input name="shippingPackageVolumen" type="number" min="0" max="1000000" step="1" value="${settings.shippingPackageVolumen ?? 1080}"/></div>
            </div>
            <p class="muted">El comprador escribe su código postal y la cotización llama a la API de Andreani con el peso/volumen configurados. El envío es <strong>informativo</strong>: no suma al total del pago, se coordina al cerrar la venta.</p>
            <p class="muted">Las credenciales <strong>no</strong> se configuran acá: son secrets del worker.<br>
            • Local: agregá <code>ANDREANI_USER=…</code> y <code>ANDREANI_PASSWORD=…</code> a <code>.dev.vars</code>.<br>
            • Producción: <code>npx wrangler secret put ANDREANI_USER</code> y <code>ANDREANI_PASSWORD</code>.</p>
          </div>
        </details>
        <details class="cfg-group" data-sec="avanzado">
          <summary>📱 Catálogo de WhatsApp <span class="cfg-hint">publicá productos elegidos en tu catálogo de WhatsApp</span></summary>
          <div class="cfg-body">
            <p class="muted" style="margin:0">WhatsApp no tiene carga masiva: Meta descarga solo el archivo de abajo (cada hora o cada día) y con eso agrega, actualiza precios y saca productos del catálogo. Vos elegís qué publicar en la pestaña <strong>Productos</strong>: seleccioná las filas y tocá <strong>📱 Publicar en WhatsApp</strong>.</p>
            <div class="field"><label>URL del feed (se pega en Commerce Manager → tu catálogo → Fuentes de datos → Feed programado)</label>
              <input id="wa-feed-url" readonly/>
            </div>
            <div class="row" style="margin-top:8px">
              <button type="button" class="btn" id="wa-feed-copy">📋 Copiar URL</button>
              <button type="button" class="btn" id="wa-feed-rotate">🔄 Regenerar URL</button>
            </div>
            <p class="muted">Productos marcados ahora: <strong id="wa-feed-count">…</strong> <span id="wa-feed-bad"></span></p>
            <p class="muted">Cómo conectarlo (una sola vez):<br>
            1. Commerce Manager → tu catálogo → <strong>Fuentes de datos</strong> → <strong>Agregar fuente</strong> → <strong>Feed programado</strong> (por URL).<br>
            2. Pegá esta URL, elegí la frecuencia (lo más seguido que permite Meta es cada hora) y el tipo de feed.<br>
            3. Esperá la primera descarga (hasta 1 hora) y revisá <strong>Productos</strong> en Commerce Manager: los rechazados dicen qué campo falla.</p>
            <p class="muted">Tipo de feed: con <strong>reemplazo completo</strong> desmarcar un producto (o que la fuente deje de traerlo) lo saca del catálogo de WhatsApp; con <strong>actualización</strong> solo se agregan y actualizan, y lo que ya no va queda visible. Si no hay ningún producto marcado, el feed responde con error a propósito, para que Meta no vacíe el catálogo.</p>
            <p class="muted">Entran solo los productos <strong>publicados (en stock) y con foto</strong>; el precio se publica en <strong>ARS</strong> y los que no traen descripción o marca reciben un texto de respaldo armado con el título, la categoría y el nombre de la tienda.</p>
          </div>
        </details>
        <details class="cfg-group" data-sec="club">
          <summary>Club de socios <span class="cfg-hint">alta gratuita y descuento acumulable</span></summary>
          <div class="cfg-body">
            <div class="field field--check">
              <label><input type="checkbox" name="loyaltyEnabled" ${settings.loyaltyEnabled ? "checked" : ""}/> Activar el Club y el descuento para socios</label>
            </div>
            <div class="field"><label>Nombre del club</label>
              <input name="loyaltyName" value="${esc(settings.loyaltyName ?? "Club CenterPhone")}" maxlength="60" placeholder="Club CenterPhone"/></div>
            <div class="field"><label>Descuento inicial para nuevos socios</label>
              <select name="loyaltyDiscountPercent">${MEMBER_TIERS.map((t) => `<option value="${t}"${t === (MEMBER_TIERS.find((x) => x === Number(settings.loyaltyDiscountPercent ?? 0)) ?? MEMBER_TIERS[0]) ? " selected" : ""}>${t}%</option>`).join("")}</select>
              <p class="muted" style="margin:6px 0 0;font-size:12px">Niveles del club: <strong>5, 10 o 15 %</strong>. Cada socio se cambia desde <strong>Ventas → Club</strong>; acá elegís con cuánto entra uno nuevo. Se aplica primero sobre el subtotal y el descuento por transferencia después sobre el saldo.</p></div>
            <div class="field"><label>Texto de bienvenida (opcional)</label>
              <textarea name="loyaltyWelcomeText" rows="2" maxlength="400" placeholder="Sumate gratis y llevate un descuento en todas tus compras.">${esc(settings.loyaltyWelcomeText ?? "")}</textarea></div>
            <p class="muted">La página pública es <a href="/club" target="_blank" rel="noopener">/club</a>. El alta pide nombre, WhatsApp, email y cumpleaños (estos dos últimos opcionales); el cliente recibe un código SOC-XXXXXX y puede recuperarlo con el mismo WhatsApp. También podés prenderlo o apagarlo desde <strong>Ventas → Club</strong>: al apagarlo se quita en todo el sitio (página, carrito, descuento y sitemap).</p>
          </div>
        </details>
        <details class="cfg-group" data-sec="avanzado">
          <summary>🚫 Artículos excluidos <span class="cfg-hint">no se importan ni se muestran nunca</span></summary>
          <div class="cfg-body">
            <div class="field">
              <label>Un artículo por línea: el código o el link de su ficha</label>
              <textarea name="syncExcludeList" rows="5" placeholder="6233&#10;https://centerphone.com.ar/producto/6233">${esc(settings.syncExcludeList ?? "")}</textarea>
              <p class="muted" style="margin:6px 0 0;font-size:12px">La sincronización no los agrega ni los actualiza, y si ya están cargados se ocultan al guardar (el botón <strong>Publicar catálogo</strong> lo muestra en el sitio). Sirve para cualquier forma del link: <code>/producto/6233</code>, la URL completa de la tienda o el link del proveedor.</p>
              <p class="muted" style="margin:6px 0 0;font-size:12px">Sacar una línea <strong>no</strong> vuelve a publicar el producto: si querés mostrarlo de nuevo, se republica desde <strong>Productos → Re-publicar</strong>.</p>
            </div>
          </div>
        </details>
        <details class="cfg-group" data-sec="avanzado">
          <summary>Mantenimiento <span class="cfg-hint">cerrar la tienda al público</span></summary>
          <div class="cfg-body">
            <div class="field field--check">
              <label><input type="checkbox" name="maintenanceMode" ${settings.maintenanceMode ? "checked" : ""}/> Cerrar el catálogo al público (pantalla con WhatsApp y redes); el panel y los pedidos siguen funcionando</label>
            </div>
            <div class="field"><label>Mensaje para los clientes (opcional)</label>
              <input name="maintenanceMessage" value="${esc(settings.maintenanceMessage ?? "")}" maxlength="300" placeholder="Estamos actualizando la tienda para atenderte mejor. En un rato volvemos 🙌"/></div>
          </div>
        </details>
        <p class="muted">La sincronización del catálogo se gestiona desde la pestaña <strong>Auto-importaciones</strong>: cargás los links, les asignás horarios (hora Argentina) y el cron los actualiza solo. El historial de cada corrida queda en el Dashboard.</p>
        <button type="submit" class="btn btn-primary">Guardar configuración</button>
      </form>
      <details class="cfg-group" style="margin-top:24px" data-sec="avanzado">
        <summary>Seguridad <span class="cfg-hint">cambiar la contraseña del panel</span></summary>
        <div class="cfg-body">
          <form id="pw-form">
            <div class="field"><label>Contraseña actual</label>
              <input name="current" type="password" autocomplete="current-password"/></div>
            <div class="field"><label>Nueva contraseña (mínimo 8 caracteres)</label>
              <input name="next" type="password" autocomplete="new-password" minlength="8"/></div>
            <div class="field"><label>Repetir nueva contraseña</label>
              <input name="next2" type="password" autocomplete="new-password" minlength="8"/></div>
            <button type="submit" class="btn">Cambiar contraseña</button>
          </form>
        </div>
      </details>
    </div>`;
  const form = el.view.querySelector("#s-form") as HTMLFormElement;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    try {
      const saved = await api<{ hiddenProducts?: number }>("/settings", {
        method: "PUT",
        body: JSON.stringify({
          whatsappPhone: fd.get("whatsappPhone"),
          currencySymbol: fd.get("currencySymbol"),
          storeName: fd.get("storeName"),
          storeAddress: fd.get("storeAddress"),
          storeMapUrl: fd.get("storeMapUrl"),
          storeHours: fd.get("storeHours"),
          instagramUrl: fd.get("instagramUrl"),
          facebookUrl: fd.get("facebookUrl"),
          trackUrl: fd.get("trackUrl"),
          howSteps: fd.get("howSteps"),
          howTitle: fd.get("howTitle"),
          howPickupNote: fd.get("howPickupNote"),
          announcementBar: fd.get("announcementBar"),
          announcementMotion: fd.get("announcementMotion"),
          announcementSpeed: fd.get("announcementSpeed"),
          freshHours: Number(fd.get("freshHours")),
          storeMode: fd.get("storeMode") === "catalogo" ? "catalogo" : "tienda",
          checkoutNote: fd.get("checkoutNote"),
          mpSurchargePercent: Number(fd.get("mpSurchargePercent") ?? 0),
          transferDiscountPercent: Number(fd.get("transferDiscountPercent") ?? 0),
          transferCbu: fd.get("transferCbu"),
          loyaltyEnabled: (fd.get("loyaltyEnabled") ?? "") === "on",
          loyaltyName: fd.get("loyaltyName"),
          loyaltyDiscountPercent: Number(fd.get("loyaltyDiscountPercent") ?? 5),
          loyaltyWelcomeText: fd.get("loyaltyWelcomeText"),
          shippingAndreaniEnabled: (fd.get("shippingAndreaniEnabled") ?? "") === "on",
          shippingAndreaniContrato: fd.get("shippingAndreaniContrato"),
          shippingAndreaniCliente: fd.get("shippingAndreaniCliente"),
          shippingPostalCode: fd.get("shippingPostalCode"),
          shippingPackageKilos: Number(fd.get("shippingPackageKilos") ?? 0.5),
          shippingPackageVolumen: Number(fd.get("shippingPackageVolumen") ?? 1080),
          maintenanceMode: (fd.get("maintenanceMode") ?? "") === "on",
          maintenanceMessage: fd.get("maintenanceMessage"),
          syncExcludeList: fd.get("syncExcludeList"),
        }),
      });
      const ocultados = saved?.hiddenProducts ?? 0;
      toast(
        ocultados > 0
          ? `Configuración guardada · ${ocultados} artículo${ocultados === 1 ? "" : "s"} ocultado${ocultados === 1 ? "" : "s"} (se publica al publicar el catálogo)`
          : "Configuración guardada",
      );
      setDirtyGuardArmed(false); // guardado OK: salir de la pestaña ya no avisa
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });

  // ---- Catálogo de WhatsApp: URL del feed (+ rotación del token) ----
  // La URL se genera sola la primera vez que se abre esta pestaña: el token vive
  // en los ajustes y NO viaja en el formulario, así que guardar configuración
  // nunca lo pisa (el input tampoco tiene name: no entra al FormData).
  const waUrl = form.querySelector<HTMLInputElement>("#wa-feed-url");
  const waFeedCount = form.querySelector<HTMLElement>("#wa-feed-count");
  const waFeedBad = form.querySelector<HTMLElement>("#wa-feed-bad");
  if (waUrl) {
    waUrl.placeholder = "Obteniendo…";
    try {
      const info = await api<{ url: string; count: number; fotosNoAptas: number }>("/whatsapp/feed-url");
      waUrl.value = info.url;
      if (waFeedCount) waFeedCount.textContent = String(info.count);
      // Fotos que Meta rechaza: el ítem se manda igual, pero no se publica. Sin
      // este aviso, un producto marcado que no aparece en WhatsApp parece un
      // error del feed.
      if (waFeedBad) {
        waFeedBad.textContent = info.fotosNoAptas > 0
          ? ` — ⚠️ ${info.fotosNoAptas} con foto que Meta rechaza (WebP/SVG): cambiala por una JPEG o PNG de 500×500 px o ese producto no se publica.`
          : "";
      }
    } catch {
      waUrl.placeholder = "No se pudo obtener la URL (recargá la pestaña)";
    }
    waUrl.addEventListener("click", () => waUrl.select());
  }

  form.querySelector("#wa-feed-copy")?.addEventListener("click", () => {
    const url = waUrl?.value ?? "";
    if (url === "") return;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast("URL copiada"))
      .catch(() => {
        waUrl?.select();
        toast("Copiala con Ctrl+C", false);
      });
  });
  form.querySelector("#wa-feed-rotate")?.addEventListener("click", async () => {
    if (!confirm("¿Regenerar la URL del feed?\n\nLa que está configurada en Commerce Manager deja de funcionar: hay que pegar la nueva allá.")) return;
    try {
      const info = await api<{ url: string }>("/whatsapp/feed-url/rotate", { method: "POST" });
      if (waUrl) waUrl.value = info.url;
      toast("URL regenerada: actualizala en Commerce Manager");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });

  // Modo del sitio: explica en vivo qué pasa y marca el grupo de pagos.
  // Los campos de pago NO se deshabilitan (un input disabled no viaja en el
  // FormData y sus valores se perderían al guardar): solo se avisa y se atenúa.
  const modoHint = form.querySelector<HTMLElement>("#store-mode-hint");
  const pagosBody = form.querySelector<HTMLElement>("#pagos-body");
  const pintarModo = (): void => {
    const catalogo = form.querySelector<HTMLInputElement>('[name="storeMode"][value="catalogo"]')?.checked === true;
    if (modoHint) {
      modoHint.textContent = catalogo
        ? "Ahora el sitio es solo un catálogo: se ven precios y el botón de WhatsApp, pero no hay carrito ni forma de pagar, y el servidor rechaza la creación de pedidos."
        : "Ahora el sitio vende online: carrito, MercadoPago y transferencia, más la consulta por WhatsApp.";
    }
    if (pagosBody) pagosBody.style.opacity = catalogo ? "0.45" : "1";
  };
  form.querySelectorAll<HTMLInputElement>('[name="storeMode"]').forEach((r) => r.addEventListener("change", pintarModo));
  pintarModo();

  // Guardia de cambios sin guardar: compara el formulario contra cómo cargó.
  // Volviendo a los valores originales también se desarma (no molesta de más).
  const valoresForm = (): string => JSON.stringify([...new FormData(form).entries()]);
  // Se llena después del primer render del editor (abajo): el campo oculto howSteps
  // nace vacío en la plantilla y el editor lo llena; capturarlo antes marcaba
  // "cambios sin guardar" apenas se abría la pestaña.
  let valoresBase = "";
  form.addEventListener("input", () => { setDirtyGuardArmed(valoresBase !== "" && valoresForm() !== valoresBase); });
  // WhatsApp: al pegar/tipear se limpia al vuelo (solo dígitos, sin + ni espacios).
  const waInput = form.querySelector<HTMLInputElement>('[name="whatsappPhone"]');
  waInput?.addEventListener("input", () => {
    const limpio = waInput.value.replace(/\D/g, "").slice(0, 15);
    if (waInput.value !== limpio) {
      const pos = Math.min(waInput.selectionStart ?? limpio.length, limpio.length);
      waInput.value = limpio;
      waInput.setSelectionRange(pos, pos);
    }
  });

  // Editor visual de "Cómo comprar": filas reordenables con vista previa.
  // Guarda el mismo formato de siempre (una línea por paso, **negrita** opcional)
  // en el campo howSteps, así la tienda sigue mostrando exactamente lo mismo.
  const howHidden = form.querySelector<HTMLInputElement>('[name="howSteps"]')!;
  const howList = el.view.querySelector("#how-list") as HTMLElement;
  const howPreview = el.view.querySelector("#how-preview") as HTMLElement;
  let howSteps: string[] = settings.howSteps ? settings.howSteps.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  if (howSteps.length === 0) howSteps = [""];
  const boldHtml = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const renderHow = (): void => {
    // Dibuja SIEMPRE todas las filas, incluso vacías: filtrarlas acá hacía que
    // el paso nuevo de "Agregar" no apareciera y se pisara el último real.
    if (howSteps.length === 0) howSteps = [""];
    howList.innerHTML = howSteps.map((s, i) => `
      <li class="how-row" data-i="${i}" draggable="true">
        <span class="how-grip" title="Arrastrá para reordenar" aria-hidden="true">⠿</span>
        <span class="how-idx">${i + 1}</span>
        <input class="how-txt" value="${esc(s)}" aria-label="Paso ${i + 1} del modal Cómo comprar" placeholder="Tocá **Consultar** para preguntarnos por WhatsApp"/>
        <span class="how-ops">
          <button type="button" class="btn how-up" title="Subir" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn how-down" title="Bajar" ${i === howSteps.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn btn-danger how-del" title="Quitar paso">✕</button>
        </span>
      </li>`).join("");
  };
  const refreshHow = (): void => {
    howHidden.value = howSteps.filter((s) => s !== "").join("\n");
    howPreview.innerHTML = howSteps.map((s) => `<li>${boldHtml(s) || '<span class="muted">—</span>'}</li>`).join("");
    // El editor toca campos por código (que FormData sí ve): comparar contra el base.
    setDirtyGuardArmed(valoresForm() !== valoresBase);
  };
  // Mientras se tipea NO se re-dibuja la fila (perdería el foco): solo preview + valor.
  howList.addEventListener("input", (ev) => {
    const input = ev.target as HTMLInputElement;
    if (!input.classList.contains("how-txt")) return;
    const i = Number(input.closest(".how-row")?.getAttribute("data-i") ?? -1);
    if (i >= 0) howSteps[i] = input.value.trim();
    refreshHow();
  });
  howList.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button");
    if (!btn || btn.classList.contains("how-txt")) return;
    // Sincroniza con lo tipeado (conservando filas vacías para no romper índices).
    howSteps = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")].map((i) => i.value.trim());
    const i = Number(btn.closest(".how-row")?.getAttribute("data-i") ?? -1);
    if (btn.classList.contains("how-del")) {
      howSteps.splice(i, 1);
    } else if (btn.classList.contains("how-up") && i > 0) {
      const prev = howSteps[i - 1] ?? "";
      howSteps[i - 1] = howSteps[i] ?? "";
      howSteps[i] = prev;
    } else if (btn.classList.contains("how-down") && i < howSteps.length - 1) {
      const next = howSteps[i + 1] ?? "";
      howSteps[i + 1] = howSteps[i] ?? "";
      howSteps[i] = next;
    } else return;
    renderHow();
    refreshHow();
  });
  // Reordenar arrastrando (HTML5 DnD; en touch quedan los botones ↑/↓).
  let dragIdx = -1;
  howList.addEventListener("dragstart", (ev) => {
    const row = (ev.target as HTMLElement).closest(".how-row");
    if (!row) return;
    // Lo tipeado entra al array antes de mover, para no perder ediciones.
    howSteps = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")].map((i) => i.value.trim());
    dragIdx = Number(row.getAttribute("data-i") ?? -1);
    row.classList.add("dragging");
    ev.dataTransfer?.setData("text/plain", String(dragIdx));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
  });
  howList.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const over = (ev.target as HTMLElement).closest(".how-row");
    howList.querySelectorAll(".how-row").forEach((r) => r.classList.remove("drop-before", "drop-after"));
    if (!over || over.classList.contains("dragging")) return;
    const rect = over.getBoundingClientRect();
    over.classList.add(ev.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
  });
  howList.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const over = (ev.target as HTMLElement).closest(".how-row");
    howList.querySelectorAll(".how-row").forEach((r) => r.classList.remove("dragging", "drop-before", "drop-after"));
    if (!over || dragIdx < 0) { dragIdx = -1; return; }
    const target = Number(over.getAttribute("data-i") ?? -1);
    if (target < 0 || target === dragIdx) { dragIdx = -1; return; }
    const rect = over.getBoundingClientRect();
    let to = ev.clientY < rect.top + rect.height / 2 ? target : target + 1;
    if (to > dragIdx) to -= 1; // al sacar el elemento, los índices se corren
    const [moved] = howSteps.splice(dragIdx, 1);
    howSteps.splice(Math.max(0, Math.min(howSteps.length, to)), 0, moved ?? "");
    dragIdx = -1;
    renderHow();
    refreshHow();
  });
  howList.addEventListener("dragend", () => {
    howList.querySelectorAll(".how-row").forEach((r) => r.classList.remove("dragging", "drop-before", "drop-after"));
    dragIdx = -1;
  });
  el.view.querySelector("#how-add")?.addEventListener("click", () => {
    howSteps = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")].map((i) => i.value.trim());
    howSteps.push("");
    renderHow();
    refreshHow();
    const inputs = [...howList.querySelectorAll<HTMLInputElement>(".how-txt")];
    inputs[inputs.length - 1]?.focus();
  });
  renderHow();
  refreshHow();
  valoresBase = valoresForm(); // el hidden howSteps ya está lleno acá
  setDirtyGuardArmed(false);     // recién cargado: ningún cambio todavía

  // Indicador de credenciales de pago (configurado sí/no, sin exponer nada).
  void api<{ configured: boolean; enabled: boolean }>("/payments/status").then((st) => {
    const p = el.view.querySelector("#payments-status");
    if (p) p.innerHTML = st.configured
      ? `✅ Token de MercadoPago configurado. Toggle activo: <strong>${st.enabled ? "sí" : "no"}</strong>.`
      : `⚠️ <strong>Sin token</strong>: el pago online no funciona aunque el toggle esté activo. Configurá el secret <code>MERCADOPAGO_ACCESS_TOKEN</code> (instrucciones abajo).`;
  }).catch(() => {});

  // ---- Secciones de Configuración ----
  // La configuración es un form ÚNICO (el PUT /settings reemplaza el objeto
  // entero: un form por sección borraría el resto). Esta barra solo filtra qué
  // <details> se ve; el form entero se envía siempre, pase lo que pase.
  const secButtons = [...el.view.querySelectorAll<HTMLButtonElement>(".cfg-tab")];
  // Incluye también el <details> de Seguridad (cambio de contraseña), que vive
  // en el panel pero FUERA de #s-form: debe ocultarse con su sección igual.
  const secGroups = [...el.view.querySelectorAll<HTMLDetailsElement>(".cfg-group[data-sec]")];
  const showSection = (sec: string): void => {
    secButtons.forEach((b) => b.classList.toggle("active", b.dataset.sec === sec));
    secGroups.forEach((g) => { g.hidden = g.dataset.sec !== sec; });
    // El primer grupo de la sección se abre solo (los demás quedan plegados).
    const first = secGroups.find((g) => g.dataset.sec === sec);
    if (first) first.open = true;
  };
  secButtons.forEach((b) => b.addEventListener("click", () => showSection(b.dataset.sec ?? "tienda")));
  showSection("tienda"); // sección por defecto: lo más habitual al entrar

  // Cambio de contraseña del panel.
  const pwForm = el.view.querySelector("#pw-form") as HTMLFormElement;
  pwForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(pwForm);
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("next2") ?? "")) {
      toast("Las nuevas contraseñas no coinciden", false);
      return;
    }
    try {
      const res = await api<{ ok: boolean; persisted: boolean }>("/password", {
        method: "POST",
        body: JSON.stringify({ current: fd.get("current"), next }),
      });
      toast(res.persisted
        ? "Contraseña cambiada y guardada. Las otras sesiones activas quedaron cerradas."
        : "Contraseña cambiada en esta sesión solamente (no se pudo persistir)");
      pwForm.reset();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", false);
    }
  });
}
