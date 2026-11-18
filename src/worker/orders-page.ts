// Página pública /pedido/:id: estado del pedido + botón de WhatsApp para
// coordinar la entrega. Patrón igual que /seguimiento: HTML generado en el
// worker con nonce CSP. El estado visible se refresca desde /api/orders/:id
// (el webhook puede confirmar el pago después de que el usuario ya esté acá).

import { Hono } from "hono";
import type { Env } from "./db";
import type { Order } from "../shared/types";
import { getSettings } from "./settings";
import { getOrder } from "./orders";
import { formatPrice } from "../shared/format";
import { esc } from "../shared/html";
import { waLinkText } from "../shared/whatsapp";
import { newNonce } from "./security";

export const orderPageApp = new Hono<{ Bindings: Env }>();

function statusBadge(status: Order["status"]): { label: string; cls: string; emoji: string } {
  switch (status) {
    case "paid": return { label: "Pago confirmado", cls: "paid", emoji: "✅" };
    case "cancelled": return { label: "Cancelado", cls: "cancelled", emoji: "🚫" };
    case "rejected": return { label: "Pago rechazado", cls: "rejected", emoji: "❌" };
    default: return { label: "Esperando el pago", cls: "pending", emoji: "⏳" };
  }
}

function waTextFor(order: Order, storeName: string): string {
  const symbol = "$";
  const lines = order.items.map((i) => `• ${i.qty}x ${i.title} — ${formatPrice(i.priceCents * i.qty, symbol)}`).join("\n");
  return `Hola! Acabo de pagar mi pedido en ${storeName}.\nPedido: ${order.id}\n${lines}\nTotal: ${formatPrice(order.totalCents, symbol)}\n¿Coordinamos la entrega?`;
}

orderPageApp.get("/pedido/:id", async (c) => {
  const id = c.req.param("id");
  const order = await getOrder(c.env.DB, id);
  const settings = await getSettings(c.env.KV);
  const storeName = settings.storeName || "CenterPhone Celulares";
  const symbol = settings.currencySymbol || "$";
  const nonce = newNonce();
  c.header("Content-Security-Policy", `default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'strict-dynamic'`);

  if (!order) {
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d1319">
<title>Pedido no encontrado</title>
<style>
  :root{--bg:#0d1319;--panel:#151d26;--panel-2:#1b242e;--border:#26333f;--border-bright:#38495a;
        --text:#e2e9ef;--muted:#93a4b3;--brand:#4cc45e;--radius:10px;--radius-sm:8px;
        --shadow:0 12px 26px rgb(0 0 0 / .38);
        --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,system-ui,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:38px 28px;max-width:440px;width:100%}
  .emoji{font-size:44px}
  h1{font-size:19px;margin:16px 0 8px;font-weight:800;letter-spacing:-.01em}
  p{color:var(--muted);font-size:14px;margin:0 0 8px;line-height:1.55}
  a{color:var(--brand);text-decoration:none;font-weight:600}
  a:hover{text-decoration:underline}
</style></head>
<body>
<div class="card"><div class="emoji">🔍</div><h1>Pedido no encontrado</h1>
<p>Revisá el link. Si pagaste recién, podés tardar unos segundos en aparecer.</p>
<a href="/">← Volver al catálogo</a></div></body></html>`;
    return c.html(html, 404, { "Cache-Control": "no-store" });
  }

  const st = statusBadge(order.status);
  const itemsHtml = order.items
    .map((i) => {
      const ajuste = i.priceCents < 0; // ítem de descuento transferencia congelado
      const color = ajuste ? "color:var(--brand)" : "";
      return `<tr><td style="padding:8px 4px;text-align:left;${color}">${ajuste ? esc(i.title) : `${i.qty}x ${esc(i.title)}`}</td><td style="padding:8px 4px;text-align:right;white-space:nowrap;${color}">${formatPrice(i.priceCents * i.qty, symbol)}</td></tr>`;
    })
    .join("");
  const note = settings.checkoutNote ? `<p style="color:var(--muted);font-size:13px;margin:12px 0 0">${esc(settings.checkoutNote)}</p>` : "";
  const paidLine = order.status === "paid" && order.paidAt
    ? `<p style="color:var(--brand);font-size:13px;margin:4px 0 0">Acreditado el ${new Date(order.paidAt).toLocaleString("es-AR")}</p>`
    : "";
  const waHref = settings.whatsappPhone && isValidPhoneSafe(settings.whatsappPhone) ? waLinkText(settings, waTextFor(order, storeName)) : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d1319">
<title>Pedido ${esc(order.id.slice(0, 8))}… — ${esc(storeName)}</title>
<style>
  :root{--bg:#0d1319;--panel:#151d26;--panel-2:#1b242e;--border:#26333f;--border-bright:#38495a;
        --text:#e2e9ef;--muted:#93a4b3;--brand:#4cc45e;--brand-dark:#3fae51;--on-brand:#04180a;
        --danger:#f85149;--amber:#e3b341;--radius:10px;--radius-sm:8px;
        --shadow:0 12px 26px rgb(0 0 0 / .38);
        --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,system-ui,sans-serif;
        --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:34px 28px;max-width:460px;width:100%}
  .st-emoji{font-size:40px}
  h1{font-size:19px;margin:12px 0 4px;font-weight:800;letter-spacing:-.01em}
  .st-badge{display:inline-block;padding:3px 11px;font-size:12px;font-weight:700;border:1px solid transparent;border-radius:999px;margin-bottom:10px}
  .st-badge.pending{color:var(--amber);background:rgb(227 179 65 / .12)}
  .st-badge.paid{color:var(--brand);background:rgb(76 196 94 / .14)}
  .st-badge.cancelled,.st-badge.rejected{color:var(--danger);background:rgb(248 81 73 / .12)}
  .order-id{color:var(--muted);font-size:13px;margin:0 0 4px}
  code{background:var(--panel-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:1px 6px;font-family:var(--mono)}
  .paid-line{color:var(--brand);font-size:13px;margin:4px 0 0}
  .note{color:var(--muted);font-size:13px;margin:12px 0 0;line-height:1.5}
  hr{border:none;border-top:1px solid var(--border);margin:16px 0 4px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  .total{font-size:16px;margin:0;text-align:left}
  .total b{color:var(--brand)}
  .buyer{color:var(--muted);font-size:12px;margin:8px 0 0}
  .pending-hint{color:var(--amber);font-size:13px;margin:12px 0 0}
  /* Recordatorio del derecho de revocación (Ley 24.240, art. 34 in fine):
     la confirmación de la compra a distancia es el momento natural para
     informarlo. Enlace estático a la política, misma CSP (self). */
  .revoca{font-size:13px;line-height:1.55;color:var(--muted);margin:16px 0 0;border-left:3px solid var(--amber);border-radius:0 var(--radius-sm) var(--radius-sm) 0;background:rgb(227 179 65 / .08);padding:10px 12px}
  .revoca a{color:var(--amber);font-weight:700;text-decoration:underline}
  .wa-btn{display:block;background:var(--brand);color:var(--on-brand);text-decoration:none;padding:14px;font-weight:700;font-size:14px;margin-top:18px;border-radius:var(--radius-sm);border:1px solid var(--brand);text-align:center}
  .wa-btn:hover{background:var(--brand-dark);border-color:var(--brand-dark)}
  .back{display:block;margin-top:12px;color:var(--muted);text-decoration:underline;font-size:14px}
  .back:hover{color:var(--brand)}
</style></head>
<body>
<div class="card">
  <div class="st-emoji" id="st-emoji">${st.emoji}</div>
  <h1 id="st-label">${st.label}</h1>
  <span class="st-badge ${st.cls}" id="st-badge">${st.label}</span>
  <p class="order-id">Pedido <code id="order-id">${esc(order.id)}</code></p>
  ${paidLine}
  ${note}
  <hr>
  <table id="items">${itemsHtml}</table>
  <hr style="margin:4px 0 12px">
  <p class="total">Total <b id="total">${formatPrice(order.totalCents, symbol)}</b></p>
  <p class="buyer">Comprador: ${esc(order.buyerName)}</p>
  <p class="revoca" id="revoca">Compraste a distancia: podés revocar la compra dentro de los 10 días corridos, sin justificar el motivo y sin registro. <a href="/politica-de-cambios-y-devoluciones#arrepentimiento">Botón de arrepentimiento</a></p>
  ${order.status === "pending" ? `<p class="pending-hint" id="pending-hint">Si ya pagaste, esta página se actualiza sola en unos segundos.</p>` : ""}
  ${waHref !== "" ? `<a class="wa-btn" id="wa-btn" href="${esc(waHref)}" target="_blank" rel="noopener">💬 Coordinar entrega por WhatsApp</a>` : ""}
  <a class="back" href="/">← Volver al catálogo</a>
</div>
<script nonce="${nonce}">
  // Refresco el estado cada 5s mientras la pestaña esté abierta (el pago se
  // confirma por webhook, que puede llegar después de que el usuario volvió).
  var ID = ${JSON.stringify(order.id)};
  function upd() {
    fetch("/api/orders/" + ID).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.order) return;
      var s = d.order.status;
      var map = { paid: ["✅", "Pago confirmado", "paid"], pending: ["⏳", "Esperando el pago", "pending"], cancelled: ["🚫", "Cancelado", "cancelled"], rejected: ["❌", "Pago rechazado", "rejected"] };
      var m = map[s];
      if (m) {
        document.getElementById("st-emoji").textContent = m[0];
        document.getElementById("st-label").textContent = m[1];
        var b = document.getElementById("st-badge");
        if (b) { b.className = "st-badge " + m[2]; b.textContent = m[1]; }
      }
      if (s !== "pending") {
        var h = document.getElementById("pending-hint");
        if (h) h.remove();
        clearInterval(t);
      }
    }).catch(function () {});
  }
  var t = setInterval(upd, 5000);
</script>
</body></html>`;
  return c.html(html, 200, { "Cache-Control": "no-store" });
});

function isValidPhoneSafe(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10;
}
