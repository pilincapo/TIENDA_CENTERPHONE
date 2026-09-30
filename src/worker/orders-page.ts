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
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Pedido no encontrado</title>
<style>
  :root{--bg:#0b0f14;--panel:#10161d;--border-bright:#33475e;--text:#d7e2ea;--muted:#7d8f9f;--brand:#3fb950;--shadow:4px 4px 0 rgb(0 0 0 / .55);--font:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  body::before{content:"";position:fixed;inset:0;z-index:9;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgb(0 0 0/.12) 3px,transparent 4px);mix-blend-mode:multiply}
  .card{background:var(--panel);border:1px solid var(--border-bright);box-shadow:var(--shadow);padding:36px 28px;max-width:440px;position:relative;z-index:10}
  .emoji{font-size:44px}
  h1{font-size:18px;margin:16px 0 8px}
  p{color:var(--muted);font-size:14px;margin:0 0 8px;line-height:1.5}
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
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Pedido ${esc(order.id.slice(0, 8))}… — ${esc(storeName)}</title>
<style>
  :root{--bg:#0b0f14;--panel:#10161d;--panel-2:#161e27;--border:#223041;--border-bright:#33475e;
        --text:#d7e2ea;--muted:#7d8f9f;--brand:#3fb950;--brand-dark:#2e9e3f;--danger:#f85149;--amber:#e3b341;
        --shadow:4px 4px 0 rgb(0 0 0 / .55);
        --font:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  body::before{content:"";position:fixed;inset:0;z-index:9;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgb(0 0 0/.12) 3px,transparent 4px);mix-blend-mode:multiply}
  .card{background:var(--panel);border:1px solid var(--border-bright);box-shadow:var(--shadow);padding:32px 28px;max-width:460px;width:100%;position:relative;z-index:10}
  .st-emoji{font-size:40px}
  h1{font-size:18px;margin:12px 0 4px;font-weight:800}
  .st-badge{display:inline-block;padding:2px 10px;font-size:12px;font-weight:700;border:1px solid var(--border-bright);margin-bottom:10px}
  .st-badge.pending{color:var(--amber);border-color:var(--amber)}
  .st-badge.paid{color:var(--brand);border-color:var(--brand)}
  .st-badge.cancelled,.st-badge.rejected{color:var(--danger);border-color:var(--danger)}
  .order-id{color:var(--muted);font-size:13px;margin:0 0 4px}
  code{background:var(--panel-2);border:1px solid var(--border);padding:1px 6px}
  .paid-line{color:var(--brand);font-size:13px;margin:4px 0 0}
  .note{color:var(--muted);font-size:13px;margin:12px 0 0;line-height:1.5}
  hr{border:none;border-top:1px solid var(--border-bright);margin:16px 0 4px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  .total{font-size:16px;margin:0;text-align:left}
  .total b{color:var(--brand)}
  .buyer{color:var(--muted);font-size:12px;margin:8px 0 0}
  .pending-hint{color:var(--amber);font-size:13px;margin:12px 0 0}
  .wa-btn{display:block;background:var(--brand);color:#04180a;text-decoration:none;padding:14px;font-weight:700;font-size:14px;margin-top:18px;border:1px solid var(--brand);box-shadow:2px 2px 0 rgb(0 0 0/.45);text-align:center}
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
