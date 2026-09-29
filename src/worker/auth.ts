// Sesión de admin: cookie firmada HMAC-SHA256 (WebCrypto).
// Contraseña: hash PBKDF2 (100k iteraciones, salt aleatorio) persistido en KV.

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export function randomToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

// value = expiryMs + "." + firma(expiryMs)
// TTL base de la sesión; con sliding renewal se extiende en cada uso (ver admin.ts).
export const SESSION_TTL_MS = 1000 * 60 * 60; // 1 hora

export async function createSessionToken(secret: string, ttlMs = SESSION_TTL_MS): Promise<string> {
  const expiry = String(Date.now() + ttlMs);
  return `${expiry}.${await hmac(secret, expiry)}`;
}

/** Momento de emisión inferido del token: expiry - TTL (los tokens no guardan iat). */
export function sessionIssuedAt(token: string, ttlMs = SESSION_TTL_MS): number {
  const expiry = Number(token.split(".")[0]);
  return Number.isFinite(expiry) ? expiry - ttlMs : 0;
}

export async function verifySessionToken(secret: string, token: string | undefined, notBefore = 0): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;
  if (Number(expiry) < Date.now()) return false;
  // Tokens emitidos antes del epoch de revocación (último logout) se rechazan.
  if (sessionIssuedAt(token) < notBefore) return false;
  const expected = await hmac(secret, expiry);
  if (expected.length !== sig.length) return false;
  return timingSafeEqualStr(expected, sig);
}

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "celu_session") return rest.join("=");
  }
  return undefined;
}

export function sessionCookieHeader(token: string): string {
  return `celu_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`;
}

export function clearSessionCookieHeader(): string {
  return "celu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure";
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- Contraseña de admin persistida en KV (fix M1) ----
// El secret ADMIN_PASSWORD no se puede escribir desde un Worker (solo con
// `wrangler secret put`): si el panel cambia la contraseña en caliente, el
// cambio muere con el isolate y los demás isolates siguen aceptando la vieja.
// Solución: hash PBKDF2 en KV, escrito desde el panel, leído en cada login.

export const PASSWORD_KV_KEY = "admin:password";
// 100k iteraciones: ~100ms en el edge del free tier, suficiente para un login
// de admin (no hay usuarios públicos autenticando contra esto).
export const PBKDF2_ITERATIONS = 100_000;

export interface PasswordHash {
  salt: string;
  hash: string;
  iterations: number;
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
    key,
    256
  );
  return toHex(bits);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Genera el registro de hash para una contraseña nueva (salt aleatorio). */
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return { salt, hash: await pbkdf2(password, salt, PBKDF2_ITERATIONS), iterations: PBKDF2_ITERATIONS };
}

/** Verifica la contraseña contra el registro de KV (en tiempo constante). */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const computed = await pbkdf2(password, stored.salt, stored.iterations);
  return timingSafeEqualStr(computed, stored.hash);
}
