// Código de socio recordado en el navegador (localStorage).
//
// Es solo comodidad: el worker SIEMPRE revalida el código contra D1 al crear
// el pedido y recalcula el descuento. Si el navegador tiene un código viejo o
// inventado, el pedido se crea sin descuento.

const CODE_KEY = "celu_member_code";
const PERCENT_KEY = "celu_member_percent";

export function storedMemberCode(): string {
  try {
    return (localStorage.getItem(CODE_KEY) ?? "").trim().slice(0, 12);
  } catch {
    return "";
  }
}

export function storedMemberPercent(): number {
  try {
    const n = Math.round(Number(localStorage.getItem(PERCENT_KEY) ?? 0));
    return Number.isFinite(n) && n > 0 ? Math.min(50, n) : 0;
  } catch {
    return 0;
  }
}

export function saveMember(code: string, percent: number): void {
  try {
    localStorage.setItem(CODE_KEY, code.trim().toUpperCase().slice(0, 12));
    localStorage.setItem(PERCENT_KEY, String(Math.min(50, Math.max(0, Math.round(percent)))));
  } catch {
    // localStorage bloqueado: el código vale solo para esta sesión en memoria.
  }
}

export function clearMember(): void {
  try {
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem(PERCENT_KEY);
  } catch {
    // no-op
  }
}
