// Beacons de estadísticas: fire-and-forget al worker. Nada de esto bloquea ni
// falla visible: si el tracking no responde, la página sigue igual.
// Deduplicación por sesión en sessionStorage: una misma ficha cuenta 1 vez por
// sesión (refrescar 10 veces no infla el contador).

const KEY = "stats_seen";

function seen(key: string): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    const set = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (set.has(key)) return true;
    set.add(key);
    sessionStorage.setItem(KEY, JSON.stringify([...set].slice(-200)));
    return false;
  } catch {
    return false;
  }
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
