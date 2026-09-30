// Integración mínima con MercadoPago Checkout Pro (gratis, por venta).
// Sin SDK: dos llamadas a la API REST con fetch. El ACCESS_TOKEN vive solo
// como secret del worker (MERCADOPAGO_ACCESS_TOKEN), nunca en el repo.

import type { OrderItem } from "../shared/types";

const MP_API = "https://api.mercadopago.com";

export interface MpPreferenceResult {
  ok: boolean;
  preferenceId?: string;
  initPoint?: string;
  error?: string;
}

interface MpPreferenceResponse {
  id?: string;
  init_point?: string;
  message?: string;
}

interface MpPaymentResponse {
  id?: number;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  test_mode?: boolean;
  transaction_amount?: number;
}

/** Título acotado por ítem (MP tiene límites por descripción). */
export function mpItems(items: OrderItem[]): { id: string; title: string; quantity: number; unit_price: number; currency_id: string }[] {
  return items.map((i) => ({
    id: i.id.slice(0, 60),
    title: i.title.slice(0, 120),
    quantity: i.qty,
    unit_price: i.priceCents / 100,
    currency_id: "ARS",
  }));
}

/**
 * Crea la preferencia de Checkout Pro. Devuelve el init_point (URL del
 * checkout de MP) para redirigir al comprador. external_reference = orderId:
 * es lo que MP nos devuelve en el webhook para identificar el pedido.
 */
export async function createPreference(opts: {
  token: string;
  orderId: string;
  items: OrderItem[];
  buyerName: string;
  buyerPhone: string;
  siteUrl: string;
}): Promise<MpPreferenceResult> {
  const payerName = opts.buyerName.trim();
  const body = {
    items: mpItems(opts.items),
    external_reference: opts.orderId,
    payer: {
      name: payerName !== "" ? payerName : "Cliente",
      phone: { number: opts.buyerPhone.slice(0, 32) },
    },
    back_urls: {
      success: `${opts.siteUrl}/pedido/${opts.orderId}`,
      pending: `${opts.siteUrl}/pedido/${opts.orderId}`,
      failure: `${opts.siteUrl}/pedido/${opts.orderId}`,
    },
    // MP exige https en back_urls para habilitar auto_return: en local
    // (http://127.0.0.1) se omite y MP muestra el botón "Volver al sitio".
    // notification_url explícita: permite probar el webhook apuntando a un
    // túnel https (ej. cloudflared) sin depender de la config de la app en MP.
    ...(opts.siteUrl.startsWith("https://")
      ? { auto_return: "approved" as const, notification_url: `${opts.siteUrl}/api/payments/webhook` }
      : {}),
    // El estado lo confirma SOLO el webhook re-consultando la API de MP:
    // la query string del retorno no es confiable (el usuario puede editarla).
    statement_descriptor: "CENTERPHONE",
  };
  try {
    const res = await fetch(`${MP_API}/checkout/preferences`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as MpPreferenceResponse | null;
      return { ok: false, error: detail?.message ?? `MercadoPago respondió ${res.status}` };
    }
    const data = (await res.json()) as MpPreferenceResponse;
    if (!data.id || !data.init_point) return { ok: false, error: "Respuesta inesperada de MercadoPago" };
    return { ok: true, preferenceId: data.id, initPoint: data.init_point };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red con MercadoPago" };
  }
}

/**
 * Re-consulta el pago a la API de MP (el webhook puede ser falso: cualquiera
 * que descubra la URL podría POSTear un payload inventado; la única fuente de
 * verdad es un GET autenticado con el ACCESS_TOKEN).
 */
export async function fetchPayment(token: string, paymentId: string): Promise<{ found: boolean; approved: boolean; externalReference: string | null; isTest: boolean }> {
  const empty = { found: false, approved: false, externalReference: null as string | null, isTest: false };
  try {
    const res = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return empty;
    const p = (await res.json()) as MpPaymentResponse;
    return {
      found: true,
      approved: p.status === "approved",
      externalReference: p.external_reference ?? null,
      isTest: p.test_mode === true,
    };
  } catch {
    return empty;
  }
}
