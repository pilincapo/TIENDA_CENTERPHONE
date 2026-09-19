// Enlaces de WhatsApp con mensaje precargado.

import { formatPrice } from "./format";
import type { Product, StoreSettings } from "./types";

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isValidPhone(phone: string): boolean {
  const digits = normalizePhone(phone);
  return digits.length >= 10 && digits.length <= 15;
}

export function waMessage(
  settings: Pick<StoreSettings, "whatsappPhone" | "currencySymbol">,
  product: Product
): string {
  const price = formatPrice(product.priceCents, settings.currencySymbol);
  return `Hola! Me interesa "${product.title}" (${price}). ¿Sigue disponible?`;
}

export function waLink(
  settings: Pick<StoreSettings, "whatsappPhone" | "currencySymbol">,
  product: Product,
  _baseUrl?: string
): string {
  const text = waMessage(settings, product);
  return `https://wa.me/${normalizePhone(settings.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}

export function waLinkText(
  settings: Pick<StoreSettings, "whatsappPhone">,
  text: string
): string {
  return `https://wa.me/${normalizePhone(settings.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}
