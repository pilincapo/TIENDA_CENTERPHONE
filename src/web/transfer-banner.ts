// Descuento por transferencia: matemática + HTML, sin DOM (testable en node).
// El redondeo es SIEMPRE el de finalizeOrder en worker/checkout.ts
// (Math.round sobre el total), para que el número que ve el cliente en el
// banner/ficha coincida con el que el worker congela en el pedido.

import { formatPrice } from "../shared/format";

/** Porcentaje entero de descuento, acotado a 0-50 (misma regla que el worker). */
export function discountPercentFrom(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  if (Number.isNaN(n)) return 0;
  return Math.min(50, Math.max(0, n));
}

/** Centavos descontados (igual que el worker). */
export function discountCentsFor(totalCents: number, pct: number): number {
  if (pct <= 0 || totalCents <= 0) return 0;
  return Math.round((totalCents * pct) / 100);
}

/**
 * Banner del carrito: pastilla «-N%», precio original tachado, total final
 * grande y monto ahorrado. Vacío si no hay descuento configurado.
 */
export function cartTransferBanner(totalCents: number, pctRaw: unknown, symbol: string): string {
  const pct = discountPercentFrom(pctRaw);
  if (pct <= 0 || totalCents <= 0) return "";
  const final = totalCents - discountCentsFor(totalCents, pct);
  return `<div class="cart-transfer">
    <span class="cart-transfer-pill">-${pct}%</span>
    <div class="cart-transfer-main">
      <div class="cart-transfer-row">
        <span class="cart-transfer-label">Por transferencia</span>
        <s class="cart-transfer-was">${formatPrice(totalCents, symbol)}</s>
        <b class="cart-transfer-now">${formatPrice(final, symbol)}</b>
      </div>
      <span class="cart-transfer-save">Ahorrás ${formatPrice(totalCents - final, symbol)} pagando por transferencia</span>
      <p class="cart-transfer-hint">Elegí "Consultar este pedido" y lo coordinamos por WhatsApp.</p>
    </div>
  </div>`;
}

/**
 * Línea compacta bajo el precio de la ficha: pastilla «-N%» + precio final
 * por transferencia con el de lista tachado. Vacío si no hay descuento.
 */
export function productTransferLine(priceCents: number, pctRaw: unknown, symbol: string): string {
  const pct = discountPercentFrom(pctRaw);
  if (pct <= 0 || priceCents <= 0) return "";
  const final = priceCents - discountCentsFor(priceCents, pct);
  return `<div class="price-transfer">
    <span class="price-transfer-pill">-${pct}%</span>
    <span class="price-transfer-text">Por transferencia: <b>${formatPrice(final, symbol)}</b> <s>${formatPrice(priceCents, symbol)}</s></span>
  </div>`;
}
