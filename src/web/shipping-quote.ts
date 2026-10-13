// Cotizador de envíos (Andreani): bloque "📦 Calculá tu envío" para el carrito
// y la ficha. Puro cálculo + HTML principal (testing sin DOM) y una función de
// wiring DOM. El precio lo calcula el worker: acá solo se pide y se muestra.
//
// El envío es INFORMATIVO: no se suma al total del pago ni al descuento por
// transferencia (decisión del dueño). La venta sigue cerrándose igual.

import { formatPrice } from "../shared/format";
import type { PublicSettings } from "./types-web";

const CP_KEY = "center_shipping_cp";
const CP_RE = /^[0-9]{4,8}$/;

/** CP saneado de localStorage; null si falta o es inválido. */
export function savedPostalCode(): string | null {
  try {
    const raw = String(localStorage.getItem(CP_KEY) ?? "").replace(/\D/g, "");
    return CP_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Guarda el CP del comprador (persiste entre carrito y fichas). */
export function savePostalCode(cp: string): void {
  const clean = String(cp ?? "").replace(/\D/g, "");
  if (!CP_RE.test(clean)) return;
  try {
    localStorage.setItem(CP_KEY, clean);
  } catch {
    // storage bloqueado: la cotización funciona igual esta sesión
  }
}

/** Serializa las líneas del carrito a "id:qty,id:qty" para la API. */
export function cartItemsParam(lines: { id: string; qty: number }[]): string {
  return lines.map((l) => `${l.id}:${Math.max(1, Math.round(l.qty))}`).join(",");
}

export interface QuoteState {
  status: "input" | "loading" | "done" | "error";
  cp: string;
  priceCents: number;
  error?: string;
  /** hidden=true: ni se muestra el bloque (sin config, modo catálogo o carrito vacío). */
  hidden?: boolean;
}

/** HTML del bloque según estado (puro, sin DOM). hidden = no renderizar nada. */
export function shippingQuoteHtml(state: QuoteState, symbol: string): string {
  if (state.hidden) return "";
  if (state.status === "loading") {
    return `<div class="ship-quote"><button class="ship-quote-toggle" type="button" disabled>📦 Calculando envío…</button></div>`;
  }
  if (state.status === "done") {
    if (state.cp === "") return ""; // cotización anulada: nada que mostrar
    return `<div class="ship-quote ship-quote--done">
      <div class="ship-quote-row">
        <span class="ship-quote-ic">📦</span>
        <span class="ship-quote-label">Envío a ${state.cp} (Andreani):</span>
        <b class="ship-quote-price">${formatPrice(state.priceCents, symbol)}</b>
        <button class="ship-quote-edit" type="button" data-ship-edit>Cambiar CP</button>
      </div>
    </div>`;
  }
  // "input" y "error" comparten el formulario; el error va como nota.
  const cpAttr = state.status === "error" ? "" : ` value="${state.cp}"`;
  const err = state.status === "error" && state.error ? `<p class="ship-quote-error">${state.error}</p>` : "";
  return `<div class="ship-quote">
    <details ${state.status === "error" ? "open" : ""}>
      <summary>📦 Calculá tu envío</summary>
      <div class="ship-quote-form">
        <input type="tel" inputmode="numeric" maxlength="8" placeholder="Tu código postal" aria-label="Código postal" class="ship-quote-cp"${cpAttr} />
        <button type="button" class="ship-quote-go" data-ship-go>Calcular</button>
      </div>
      ${err}
    </details>
  </div>`;
}

/**
 * Estado inicial del bloque según settings y carrito. Con CP guardado cotiza
 * solo (status loading); sin CP muestra el formulario. hidden: no renderizar.
 */
export function quoteInitialState(settings: PublicSettings, lines: { id: string; qty: number }[]): QuoteState {
  if (!settings.shippingAndreaniEnabled || lines.length === 0) {
    return { status: "done", cp: "", priceCents: 0, hidden: true };
  }
  const cp = savedPostalCode();
  return cp ? { status: "loading", cp, priceCents: 0 } : { status: "input", cp: "", priceCents: 0 };
}

export function errorState(cp: string, error: string): QuoteState {
  return { status: "error", cp, priceCents: 0, error };
}

export function doneState(cp: string, priceCents: number): QuoteState {
  return { status: "done", cp, priceCents };
}
export async function fetchQuote(cp: string, lines: { id: string; qty: number }[]): Promise<{ ok: boolean; priceCents?: number; error?: string; disabled?: boolean }> {
  try {
    const res = await fetch(`/api/shipping/quote?cp=${encodeURIComponent(cp)}&items=${encodeURIComponent(cartItemsParam(lines))}`);
    const data = (await res.json().catch(() => null)) as { ok?: boolean; priceCents?: number; error?: string; disabled?: boolean } | null;
    if (!data) return { ok: false, error: "No se pudo cotizar el envío" };
    if (data.disabled) return { ok: false, disabled: true, error: "" };
    if (!data.ok || typeof data.priceCents !== "number") return { ok: false, error: data.error ?? "No se pudo cotizar" };
    return { ok: true, priceCents: data.priceCents };
  } catch {
    return { ok: false, error: "Error de red al cotizar" };
  }
}
