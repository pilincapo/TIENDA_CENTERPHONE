// Integración mínima con la API REST de Andreani (cotizador de envíos).
// Sin SDK: dos llamadas con fetch. Credenciales como secrets del worker
// (ANDREANI_USER / ANDREANI_PASSWORD), nunca en el repo. El login Basic Auth
// devuelve el token en el header x-authorization-token (cacheado en el isolate,
// sin escribir en KV por request — regla del free tier).
//
// Documentación de referencia: developers.andreani.com y el flujo público del
// SDK REST comunitario (apis.andreani.com prod / apisqa.andreani.com QA).

const PROD = "https://apis.andreani.com";
const QA = "https://apisqa.andreani.com";

export interface AndreaniBulto {
  /** Peso real del bulto en kilos. También puede ir el volumen o el pesoAforado: al menos uno. */
  kilos?: number;
  /** Volumen del bulto en cm³. */
  volumen?: number;
  /** Valor declarado del contenido (para el seguro), en pesos. Obligatorio. */
  valorDeclarado: number;
}

export interface AndreaniQuoteParams {
  cpDestino: string;
  /** N° de contrato con Andreani (ej. AND00EST). */
  contrato: string;
  /** N° de cliente (ej. CL0003750). */
  cliente: string;
  bultos: AndreaniBulto[];
  /** OP: código de sucursal de imposición; si falta usa la configurada por contrato. */
  sucursalOrigen?: string;
  /** Entorno QA (default): apisqa.andreani.com. En prod se pasa false... con cuidado. */
  qa?: boolean;
}

export interface AndreaniQuoteResult {
  ok: boolean;
  /** Tarifa del envío en pesos ARS (cents decimales del API se redondean). */
  tarifa: number;
  /** Peso aforado que Andreani aplicó (kg). */
  pesoAforado: number | null;
  error?: string;
}

// Token de sesión cacheado POR ISOLATE: Andreani lo devuelve en un header y
// dura un tiempo razonable; en caducidad la respuesta da 401 y se re-loguea.
let cachedToken: { value: string; base: string; at: number } | null = null;
const TOKEN_TTL_MS = 25 * 60 * 1000; // reinicio por si la sesión larga expira antes

interface QuoteResponse {
  tarifa?: number;
  peso_aforado?: number;
  pesoAforado?: number;
  message?: string;
  detalle?: string;
}

/** Test-only: limpia el cache de token entre tests. */
export function andreaniResetCache(): void {
  cachedToken = null;
}

/** Login: GET /login con Basic Auth; el token viene en x-authorization-token. */
export async function andreaniLogin(
  user: string,
  password: string,
  qa: boolean,
): Promise<{ token: string | null; error?: string }> {
  if (user === "" || password === "") return { token: null, error: "Faltan credenciales de Andreani" };
  const base = qa ? QA : PROD;
  // Cache del token por isolate, por base (QA y prod tienen los suyos).
  if (cachedToken && cachedToken.base === base && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return { token: cachedToken.value };
  }
  try {
    const res = await fetch(`${base}/login`, {
      headers: {
        "Authorization": `Basic ${btoa(`${user}:${password}`)}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      cachedToken = null;
      return { token: null, error: `Andreani login respondió ${res.status}` };
    }
    const token = res.headers.get("x-authorization-token") ?? res.headers.get("X-Authorization-Token") ?? "";
    if (token === "") return { token: null, error: "Andreani login respondió sin token" };
    cachedToken = { value: token, base, at: Date.now() };
    return { token };
  } catch (e) {
    cachedToken = null;
    return { token: null, error: e instanceof Error ? e.message : "Error de red con Andreani" };
  }
}

/** Baja el token cacheado y lo vuelve a pedir si falta. Devuelve el motivo si no pudo. */
async function obtenerToken(env: { ANDREANI_USER?: string; ANDREANI_PASSWORD?: string }, qa: boolean): Promise<{ token: string | null; error?: string }> {
  if (cachedToken && cachedToken.base === (qa ? QA : PROD) && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    return { token: cachedToken.value };
  }
  cachedToken = null;
  const res = await andreaniLogin(env.ANDREANI_USER ?? "", env.ANDREANI_PASSWORD ?? "", qa);
  return res;
}

/**
 * Cotiza el envío: GET /v1/tarifas con query string (la API v1 recibe bultos
 * anidados en la URL, formato bultos[0][kilos]=…). Reintenta una sola vez si
 * el token expiró (401).
 */
export async function andreaniQuote(env: { ANDREANI_USER?: string; ANDREANI_PASSWORD?: string }, params: AndreaniQuoteParams): Promise<AndreaniQuoteResult> {
  const qa = params.qa !== false;
  const base = qa ? QA : PROD;
  const fail = (error: string): AndreaniQuoteResult => ({ ok: false, tarifa: 0, pesoAforado: null, error });

  // Bultos anidados en la query string (formato del SDK REST v1):
  //   bultos[0][kilos]=0.5&bultos[0][volumen]=1080&bultos[0][valorDeclarado]=450000
  const qs = new URLSearchParams();
  qs.set("cpDestino", params.cpDestino);
  qs.set("contrato", params.contrato);
  qs.set("cliente", params.cliente);
  if (params.sucursalOrigen) qs.set("sucursalOrigen", params.sucursalOrigen);
  for (const [i, b] of (params.bultos ?? []).entries()) {
    if (b.kilos != null && Number.isFinite(b.kilos)) qs.set(`bultos[${i}][kilos]`, String(b.kilos));
    if (b.volumen != null && Number.isFinite(b.volumen)) qs.set(`bultos[${i}][volumen]`, String(b.volumen));
    qs.set(`bultos[${i}][valorDeclarado]`, String(Math.round(Number(b.valorDeclarado ?? 0))));
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const sesion = await obtenerToken(env, qa);
    if (sesion.token === null) return fail(sesion.error ?? "No se pudo autenticar contra Andreani");
    try {
      const res = await fetch(`${base}/v1/tarifas?${qs.toString()}`, {
        headers: { "x-authorization-token": sesion.token, "Content-Type": "application/json" },
      });
      if (res.status === 401) {
        cachedToken = null; // token vencido: reintenta con login fresco
        continue;
      }
      const data = (await res.json().catch(() => null)) as QuoteResponse | null;
      if (!res.ok) {
        return fail(data?.message ?? `Andreani respondió ${res.status}`);
      }
      const tarifa = Number(data?.tarifa);
      if (!Number.isFinite(tarifa) || tarifa <= 0) {
        return fail("La respuesta de Andreani no trajo tarifa");
      }
      const aforado = Number(data?.peso_aforado ?? data?.pesoAforado);
      return {
        ok: true,
        tarifa: Math.round(tarifa * 100), // → centavos
        pesoAforado: Number.isFinite(aforado) ? aforado : null,
      };
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Error de red con Andreani");
    }
  }
  return fail("Andreani rechazó la sesión tras reintento");
}

// ---- Cálculo de bultos (compartido: el worker usa env, el panel settings) ----

/**
 * armaBultos: suma peso (kg) y volumen (cm³) del pedido según los productos
 * del carrito y los valores por unidad configurados en el panel.
 * valorDeclarado = precio de los productos (el seguro cubre eso).
 */
export function armarBulto(
  items: { priceCents: number; qty: number }[],
  porUnidad: { kilos: number; volumen: number },
): { kilos: number; volumen: number; valorDeclarado: number } {
  const cantidad = items.reduce((s, i) => s + Math.max(0, Math.round(Number(i.qty) || 0)), 0);
  const kilos = cantidad > 0 ? Math.max(0.1, Math.round((porUnidad.kilos * cantidad) * 100) / 100) : 0.1;
  const volumen = cantidad > 0 ? Math.max(100, Math.round(porUnidad.volumen * cantidad)) : 100;
  const valorDeclarado = items.reduce((s, i) => s + i.priceCents * Math.max(0, Math.round(Number(i.qty) || 0)), 0);
  return { kilos, volumen, valorDeclarado: Math.max(0, Math.round(valorDeclarado / 100)) }; // pesos
}
