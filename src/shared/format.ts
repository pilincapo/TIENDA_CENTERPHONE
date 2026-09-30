// Formato y helpers compartidos.

import type { Availability, Tag } from "./types";
import { AVAILABILITY_LABELS, TAG_LABELS } from "./types";

const numberCache = new Map<string, Intl.NumberFormat>();

function numberFormat(symbol: string): Intl.NumberFormat {
  let fmt = numberCache.get(symbol);
  if (!fmt) {
    fmt = new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    numberCache.set(symbol, fmt);
  }
  return fmt;
}

export function formatPrice(cents: number, symbol: string): string {
  const value = Math.round(cents / 100);
  // Los ítems de ajuste (ej. descuento por transferencia) pueden ser negativos.
  const sign = value < 0 ? "-" : "";
  return `${sign}${symbol}${numberFormat(symbol).format(Math.abs(value))}`;
}

export function availabilityLabel(a: Availability): string {
  return AVAILABILITY_LABELS[a] ?? a;
}

export function tagLabel(t: Tag): string {
  return TAG_LABELS[t] ?? t;
}
