// Beacons de estadísticas: fire-and-forget al worker. Nada de esto bloquea ni
// falla visible: si el tracking no responde, la página sigue igual.
// Deduplicación en memoria, durante la carga de la página: una misma ficha
// cuenta 1 vez (refrescar no infla el contador) y no queda ningún registro de lo
// que miró el visitante en su dispositivo — nada de cookies ni de storage.

const seenKeys = new Set<string>();

/** Tope defensivo: una pestaña abierta durante horas no acumula memoria sin
 *  límite (con 200 claves distintas, lo más viejo vuelve a contarse). */
const MAX_SEEN = 200;

function seen(key: string): boolean {
  if (seenKeys.has(key)) return true;
  if (seenKeys.size >= MAX_SEEN) seenKeys.clear();
  seenKeys.add(key);
  return false;
}

export function track(type: "product_view" | "search" | "home_view" | "wa_click", data: { productId?: string; query?: string } = {}, dedupe = false): void {
  if (dedupe && seen(`${type}:${data.productId ?? data.query ?? ""}`)) return;
  const body = JSON.stringify({ type, ...data });
  try {
    navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
  } catch {
    void fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  }
}
