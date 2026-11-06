// Club de socios: vocabulario y matemática compartidos por worker y frontend.
//
// El descuento SIEMPRE lo recalcula el worker sobre los precios de D1; estas
// funciones existen para que el carrito muestre el mismo número y para validar
// el alta en un solo lugar.

/** Tope del descuento de socio (misma regla que recargo/descuento por transferencia). */
export const MAX_MEMBER_DISCOUNT_PERCENT = 50;

/**
 * Niveles del club. El panel asigna uno a cada socio (manual) y el nivel más
 * alto es el que se anuncia en la web ("hasta un 15% de descuento").
 */
export const MEMBER_TIERS = [5, 10, 15] as const;

/** Nivel más alto del club (para el texto público). */
export const MAX_MEMBER_TIER = 15;

export const MEMBER_CODE_PREFIX = "SOC";

/** Alfabeto sin caracteres ambiguos (0/O, 1/I/L): el código se dicta por teléfono. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export interface Member {
  id: string;
  code: string;
  name: string;
  /** Solo dígitos, normalizado (sin 54/9 ni 0 inicial). */
  phone: string;
  email: string | null;
  /** "MM-DD" o null. */
  birthday: string | null;
  active: boolean;
  /** Nivel del club (5, 10 o 15). null = usa el descuento base de la configuración. */
  discountPercent: number | null;
  source: "web" | "panel";
  createdAt: number;
  updatedAt: number;
  lastOrderAt: number | null;
}

/**
 * Normaliza un WhatsApp argentino a la forma que se guarda y se compara:
 * solo dígitos, sin código de país (54), sin el 9 de móvil y sin 0 inicial.
 * Así "342 581 9402", "+54 9 342 581 9402" y "0342 581 9402" son el mismo socio.
 */
export function normalizeMemberPhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 18);
  let local = digits;
  if (digits.length > 10) {
    if (digits.startsWith("549")) local = digits.slice(3);
    else if (digits.startsWith("54")) local = digits.slice(2);
  }
  return local.replace(/^0+/, "");
}

/** Un WhatsApp válido para el club: 8 a 11 dígitos después de normalizar. */
export function isValidMemberPhone(phone: string): boolean {
  return /^\d{8,11}$/.test(phone);
}

/**
 * El código de socio solo vale para el WhatsApp con el que se dio de alta.
 * Se comparan ambos normalizados para que «342 581 9402» y «+54 9 342 581 9402»
 * cuenten como el mismo número, pero un número distinto no pasa.
 */
export function memberPhoneMatches(memberPhone: string, buyerPhone: unknown): boolean {
  const buyer = normalizeMemberPhone(buyerPhone);
  return buyer !== "" && buyer === normalizeMemberPhone(memberPhone);
}

/** Nivel válido del club (5, 10 o 15); null si no es uno de los niveles. */
export function memberTierPercent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  return (MEMBER_TIERS as readonly number[]).includes(n) ? n : null;
}

/**
 * Descuento efectivo de un socio: su nivel y, si no tiene, el base de la
 * configuración (socios dados de alta antes de que existieran los niveles).
 */
export function effectiveMemberPercent(tierPercent: unknown, basePercent: unknown): number {
  return memberTierPercent(tierPercent) ?? memberDiscountPercent(basePercent);
}

/** Porcentaje entero del descuento de socio, acotado a 0-50. */
export function memberDiscountPercent(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_MEMBER_DISCOUNT_PERCENT, n);
}

/** Centavos que se descuentan (mismo Math.round que el worker). */
export function memberDiscountCents(totalCents: number, percent: number): number {
  const pct = memberDiscountPercent(percent);
  if (pct <= 0 || totalCents <= 0) return 0;
  return Math.round((totalCents * pct) / 100);
}

/** Código en mayúsculas y sin espacios; "" si no parece un código del club. */
export function normalizeMemberCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().slice(0, 12);
}

/** Formato SOC-XXXXXX (alfabeto sin 0/O/1/I/L). */
export function isValidMemberCode(code: string): boolean {
  return /^SOC-[2-9A-HJKMNP-Z]{6}$/.test(code);
}

/** Cuerpo aleatorio del código (el worker le agrega el prefijo). */
export function newMemberCodeBody(): string {
  const buf = crypto.getRandomValues(new Uint8Array(6));
  return [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/**
 * Cumpleaños a "MM-DD" (sin año). Acepta el valor de un <input type="date">
 * ("1995-05-12"), "12/05" (día/mes) o "05-12" (mes-día, como se guarda).
 * Devuelve null si la fecha no existe.
 */
export function birthdayMonthDay(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  let month = 0;
  let day = 0;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  const dash = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (slash) {
    // Formato argentino: día/mes.
    day = Number(slash[1]);
    month = Number(slash[2]);
  } else if (dash) {
    // Mismo orden en el que se guarda: mes-día.
    month = Number(dash[1]);
    day = Number(dash[2]);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Año 2000 (bisiesto): valida que el día exista en ese mes sin guardar el año.
  const probe = new Date(Date.UTC(2000, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "MM-DD" → "12/05" (para el panel). */
export function birthdayLabel(mmdd: string | null): string {
  if (!mmdd || !/^\d{2}-\d{2}$/.test(mmdd)) return "";
  return `${mmdd.slice(3, 5)}/${mmdd.slice(0, 2)}`;
}

/** true si el cumpleaños cae en el mes indicado (0 = enero). */
export function birthdayInMonth(mmdd: string | null, monthIndex: number): boolean {
  return !!mmdd && /^\d{2}-\d{2}$/.test(mmdd) && Number(mmdd.slice(0, 2)) === monthIndex + 1;
}

/** Primer nombre, para saludar sin exponer el apellido. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.slice(0, 40) ?? "";
}
