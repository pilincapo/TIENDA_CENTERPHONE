// Resolución de la contraseña de admin y del secret de sesión contra KV.
// KV manda sobre el secret: así el cambio de contraseña desde el panel
// persiste entre isolates y deploys (el secret queda como fallback/backup).

import { PASSWORD_KV_KEY, hashPassword, timingSafeEqualStr, verifyPassword, type PasswordHash } from "./auth";
import { nowMs } from "./settings";
import type { Env } from "./db";

// Secret de sesión dedicado, rotado al cambiar la contraseña: invalida todas
// las sesiones activas (los tokens viejos fueron firmados con otro secret).
const SESSION_SECRET_KV_KEY = "admin:session-secret";
// Epoch de revocación (fix M4): el logout guarda la hora actual; el middleware
// rechaza todo token emitido antes de esa hora. Así la cookie copiada (ej: de
// una máquina compartida) muere en el logout, no recién al expirar.
const REVOKED_BEFORE_KV_KEY = "admin:sessions-revoked-before";
// Cache en memoria: si ya se leyó el secret de sesión, no re-leer KV en cada
// request dentro del mismo isolate (1 lectura menos por request admin).
const SESSION_SECRET_MEM = new WeakMap<object, string>();

/** Hash de la contraseña vigente, o null si no hay (usar el secret del env). */
export async function getStoredPasswordHash(kv: KVNamespace): Promise<PasswordHash | null> {
  const raw = await kv.get(PASSWORD_KV_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PasswordHash;
    if (typeof parsed.salt === "string" && typeof parsed.hash === "string" && typeof parsed.iterations === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Verifica la contraseña contra KV o, si no hay hash guardado, contra el secret. */
export async function verifyAdminPassword(env: Env, password: string): Promise<boolean> {
  const stored = await getStoredPasswordHash(env.KV);
  if (stored) return verifyPassword(password, stored);
  const secret = env.ADMIN_PASSWORD ?? "";
  if (secret === "") return false;
  // Fallback (migración): comparar SHA-256 de largo fijo — no filtra el largo de
  // la contraseña por timing (a diferencia de comparar los strings directos).
  const [a, b] = await Promise.all([sha256Hex(password), sha256Hex(secret)]);
  return timingSafeEqualStr(a, b);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Cambia la contraseña: escribe el hash en KV y rota el secret de sesión
 * (todas las sesiones activas quedan inválidas). Retorna el nuevo secret.
 */
export async function changeAdminPassword(env: Env, newPassword: string): Promise<string> {
  await env.KV.put(PASSWORD_KV_KEY, JSON.stringify(await hashPassword(newPassword)));
  const sessionSecret = toHex32();
  await env.KV.put(SESSION_SECRET_KV_KEY, sessionSecret);
  // Actualizar el cache de este isolate: la cookie re-emitida se firma con el
  // secret nuevo y el middleware debe validarla con el mismo.
  SESSION_SECRET_MEM.set(env, sessionSecret);
  return sessionSecret;
}

/** Secret HMAC para firmar sesiones: KV (rotado) ?? ADMIN_SESSION_SECRET ?? ADMIN_PASSWORD. */
export async function getSessionSecret(env: Env): Promise<string> {
  const cached = SESSION_SECRET_MEM.get(env);
  if (cached) return cached;
  const stored = await env.KV.get(SESSION_SECRET_KV_KEY);
  const secret = stored ?? env.ADMIN_SESSION_SECRET ?? env.ADMIN_PASSWORD ?? "";
  SESSION_SECRET_MEM.set(env, secret);
  return secret;
}

/**
 * Adelanta el epoch de revocación a "ahora": todos los tokens emitidos antes
 * de este momento quedan inválidos (los emitidos después, como un re-login
 * inmediato, siguen). El margen de 5s hacia atrás tolera desvíos de reloj
 * entre isolates sin dejar ventanas a cookies recién copiadas.
 */
export async function revokeActiveSessions(env: Env): Promise<void> {
  await env.KV.put(REVOKED_BEFORE_KV_KEY, String(nowMs() - 5000));
}

/** Epoch de revocación vigente (0 = ninguno). */
export async function getRevocationEpoch(env: Env): Promise<number> {
  const raw = await env.KV.get(REVOKED_BEFORE_KV_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toHex32(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
