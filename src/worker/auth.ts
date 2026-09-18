// Sesión de admin: cookie firmada HMAC-SHA256 (WebCrypto).

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
export async function createSessionToken(secret: string, ttlMs = 1000 * 60 * 60 * 12): Promise<string> {
  const expiry = String(Date.now() + ttlMs);
  return `${expiry}.${await hmac(secret, expiry)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;
  if (Number(expiry) < Date.now()) return false;
  const expected = await hmac(secret, expiry);
  if (expected.length !== sig.length) return false;
  return crypto.subtle.timingSafeEqual(encoder.encode(expected), encoder.encode(sig));
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
  return `celu_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure`;
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
