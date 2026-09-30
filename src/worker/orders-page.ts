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
import { waLinkText } from "../shared/whatsapp";
import { newNonce } from "./security";

export const orderPageApp = new Hono<{ Bindings: Env }>();

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
<meta name="robots" content="noindex"><title>Pedido no encontrado</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1c1e21;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<div><div style="font-size:44px">🔍</div><h1 style="font-size:20px">Pedido no encontrado</h1>
<p style="color:#65676b;font-size:14px">Revisá el link. Si pagaste recién, podés tardar unos segundos en aparecer.</p>
<a href="/" style="display:inline-block;margin-top:16px;color:#2563eb">← Volver al catálogo</a></div></body></html>`;
    return c.html(html, 404, { "Cache-Control": "no-store" });
  }

  const st = statusBadge(order.status);
  const itemsHtml = order.items
    .map((i) => {
      const ajuste = i.priceCents < 0; // ítem de descuento transferencia congelado
      const color = ajuste ? "color:#059669" : "";
      return `<tr><td style="padding:8px 4px;text-align:left;${color}">${ajuste ? esc(i.title) : `${i.qty}x ${esc(i.title)}`}</td><td style="padding:8px 4px;text-align:right;white-space:nowrap;${color}">${formatPrice(i.priceCents * i.qty, symbol)}</td></tr>`;
    })
    .join("");
  const note = settings.checkoutNote ? `<p style="color:#65676b;font-size:13px;margin:12px 0 0">${esc(settings.checkoutNote)}</p>` : "";
  const paidLine = order.status === "paid" && order.paidAt
    ? `<p style="color:#059669;font-size:13px;margin:4px 0 0">Acreditado el ${new Date(order.paidAt).toLocaleString("es-AR")}</p>`
    : "";
  const waHref = settings.whatsappPhone && isValidPhoneSafe(settings.whatsappPhone) ? waLinkText(settings, waTextFor(order, storeName)) : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pedido ${esc(order.id.slice(0, 8))}… — ${esc(storeName)}</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1c1e21;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px">
<div style="background:#fff;border-radius:16px;padding:32px 28px;max-width:440px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="font-size:40px" id="st-emoji">${st.emoji}</div>
  <h1 style="font-size:20px;margin:12px 0 4px" id="st-label">${st.label}</h1>
  <p style="color:#65676b;font-size:13px;margin:0 0 4px">Pedido <code id="order-id">${esc(order.id)}</code></p>
  ${paidLine}
  ${note}
  <div style="border-top:1px solid #eee;margin:16px 0 4px"></div>
  <table style="width:100%;border-collapse:collapse;font-size:14px" id="items">${itemsHtml}</table>
  <div style="border-top:1px solid #eee;margin:4px 0 12px"></div>
  <p style="font-size:16px;margin:0;text-align:left">Total <b id="total">${formatPrice(order.totalCents, symbol)}</b></p>
  <p style="color:#65676b;font-size:12px;margin:8px 0 0">Comprador: ${esc(order.buyerName)}</p>
  ${order.status === "pending" ? `<p style="color:#b45309;font-size:13px;margin:12px 0 0" id="pending-hint">Si ya pagaste, esta página se actualiza sola en unos segundos.</p>` : ""}
  ${waHref !== "" ? `<a id="wa-btn" href="${esc(waHref)}" target="_blank" rel="noopener" style="display:block;background:#25d366;color:#fff;text-decoration:none;border-radius:10px;padding:14px;font-weight:600;font-size:15px;margin-top:18px">💬 Coordinar entrega por WhatsApp</a>` : ""}
  <a href="/" style="display:block;margin-top:12px;color:#65676b;text-decoration:underline;font-size:14px">← Volver al catálogo</a>
</div>
<script nonce="${nonce}">
  // Refresco el estado cada 5s mientras la pestaña esté abierta (el pago se
  // confirma por webhook, que puede llegar después de que el usuario volvió).
  var ID = ${JSON.stringify(order.id)};
  function upd() {
    fetch("/api/orders/" + ID).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.order) return;
      var s = d.order.status;
      var map = { paid: ["✅", "Pago confirmado"], pending: ["⏳", "Esperando el pago"], cancelled: ["🚫", "Cancelado"], rejected: ["❌", "Pago rechazado"] };
      var m = map[s];
      if (m) {
        document.getElementById("st-emoji").textContent = m[0];
        document.getElementById("st-label").textContent = m[1];
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
