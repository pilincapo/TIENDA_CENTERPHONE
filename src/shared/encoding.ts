// Reparación de texto doble-codificado: UTF-8 leído como latin-1 / cp1252.
//
// Caso real (2026-10-13): el campo «Horarios» del panel quedó guardado en el KV
// como «SÃ¡bados» — los bytes UTF-8 de «Sábados» interpretados como cp1252 — y
// así se veía en la tienda, en el footer y en el `openingHours` del JSON-LD.
// El origen es el round-trip manual del JSON de KV que documenta el runbook
// (bajar con un redirect del shell, editar y volver a subir): en Windows, un
// paso por el codepage ANSI reinterpreta los bytes.
//
// Puro y sin `TextDecoder`: workerd no garantiza los decodificadores legacy, así
// que la inversión se hace a mano y se testea en node.

/** Caracteres que cp1252 mapea en 0x80-0x9F (donde latin-1 tiene controles). */
const CP1252_HIGH: Record<string, number> = {
  "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84,
  "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02c6": 0x88,
  "\u2030": 0x89, "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c,
  "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93,
  "\u201d": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b,
  "\u0153": 0x9c, "\u017e": 0x9e, "\u0178": 0x9f,
};

/** Escapa un caracter como `\uXXXX` para meterlo en una clase de regex. */
function uEsc(ch: string): string {
  return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
}

/**
 * Byte de continuación válido: el rango crudo de latin-1 (U+0080-U+00BF) más los
 * caracteres que cp1252 pone en ese rango (0x80 → «€», 0x93 → «“», 0x9F → «Ÿ»…).
 * Sin la segunda parte no se detectaba, por ejemplo, «â€¦» o un emoji.
 */
const CONT = `[\\u0080-\\u00bf${Object.keys(CP1252_HIGH).map(uEsc).join("")}]`;

/**
 * Firma clásica del mojibake, por byte de inicio de UTF-8: 2 bytes (`Â`/`Ã`
 * para tildes y «ñ»), 3 bytes (`â€…` para «…», «—», comillas tipográficas) y
 * 4 bytes (`ðŸ…` para emoji). Deliberadamente acotado a estos inicios: es lo que
 * aparece al reinterpretar texto en castellano, y así un texto sano no entra al
 * decodificador (que además valida la secuencia completa).
 */
const MOJIBAKE_RE = new RegExp(
  `(?:[\\u00c2\\u00c3]${CONT}|\\u00e2${CONT}{2}|\\u00f0${CONT}{3})`
);

/** ¿El texto tiene la firma de un UTF-8 leído como latin-1/cp1252? */
export function looksLikeMojibake(s: string): boolean {
  return MOJIBAKE_RE.test(s);
}

/** Byte original de un caracter corrupto; null si el texto no era latin-1/cp1252. */
function charToByte(ch: string): number | null {
  const cp1252 = CP1252_HIGH[ch];
  if (cp1252 !== undefined) return cp1252;
  const code = ch.charCodeAt(0);
  return code <= 0xff ? code : null;
}

/** Corta la decodificación si el texto no entra en bytes (no era latin-1/cp1252). */
function toBytes(s: string): number[] | null {
  const bytes: number[] = [];
  for (const ch of s) {
    const b = charToByte(ch);
    if (b === null) return null;
    bytes.push(b);
  }
  return bytes;
}

/**
 * Decodifica UTF-8 de forma estricta: null si hay secuencia truncada, byte
 * inválido, forma sobrecargada, surrogate o punto fuera de rango. Es la red que
 * evita "reparar" texto sano que solo se parece al patrón.
 */
function utf8Decode(bytes: number[]): string | null {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 === undefined) return null;
    let cp: number;
    let len: number;
    let min: number;
    if (b0 < 0x80) {
      cp = b0;
      len = 1;
      min = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      len = 2;
      min = 0x80;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      len = 3;
      min = 0x800;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      len = 4;
      min = 0x10000;
    } else {
      return null;
    }
    for (let k = 1; k < len; k++) {
      const bk = bytes[i + k];
      if (bk === undefined || (bk & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (bk & 0x3f);
    }
    if (cp < min) return null; // forma sobrecargada
    if (cp > 0x10ffff) return null;
    if (cp >= 0xd800 && cp <= 0xdfff) return null; // surrogate suelto
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

/**
 * Texto reparado, o el original si no se puede reparar sin riesgo.
 *
 * Solo actúa si el valor tiene la firma de mojibake, si todos sus caracteres
 * entran en un byte y si la decodificación UTF-8 es válida y sale distinta. Se
 * repite hasta 3 veces porque una doble corrupción («ÃƒÂ¡») existe en la
 * práctica: cada vuelta tiene que pasar la misma validación.
 */
export function fixMojibake(s: string): string {
  let cur = s;
  for (let pass = 0; pass < 3; pass++) {
    if (!looksLikeMojibake(cur)) break;
    const bytes = toBytes(cur);
    if (!bytes) break;
    const decoded = utf8Decode(bytes);
    if (decoded === null || decoded === cur) break;
    cur = decoded;
  }
  return cur;
}

/**
 * Repara todos los valores string de un objeto plano (los settings lo son) sin
 * tocar números, booleanos ni null, y sin mutar la entrada. Las claves se
 * conservan tal cual.
 */
export function repairTextFields<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "string" ? fixMojibake(v) : v;
  }
  return out as T;
}
