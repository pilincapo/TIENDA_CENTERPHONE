// Carrito de compras: estado en localStorage (persiste entre páginas).
// Guarda solo {id, qty}; el precio mostrado se recalcula del catálogo cargado.
// Si el carrito supera los límites del servidor (10 por ítem, 20 líneas), la
// validación de /api/checkout lo recorta rechazando el pedido: por eso el
// frontend usa los mismos máximos.

export interface CartLine {
  id: string;
  qty: number;
}

const KEY = "celu_cart_v1";
export const MAX_QTY_PER_ITEM = 10;
export const MAX_ITEMS = 20;

type Listener = () => void;
const listeners: Listener[] = [];

export function onCartChange(fn: Listener): void {
  listeners.push(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

function read(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is CartLine => !!l && typeof (l as CartLine).id === "string")
      .map((l) => ({ id: String(l.id), qty: Math.min(MAX_QTY_PER_ITEM, Math.max(1, Math.round(Number(l.qty) || 1))) }))
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function write(lines: CartLine[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage lleno o bloqueado: el carrito vive solo en memoria esta sesión.
  }
  emit();
}

export function cartLines(): CartLine[] {
  return read();
}

export function cartCount(): number {
  return read().reduce((s, l) => s + l.qty, 0);
}

/** Agrega qty unidades. Devuelve false si se supera el máximo del producto. */
export function cartAdd(id: string, qty = 1): boolean {
  const lines = read();
  const line = lines.find((l) => l.id === id);
  const next = (line?.qty ?? 0) + qty;
  if (next > MAX_QTY_PER_ITEM) return false;
  if (line) line.qty = next;
  else {
    if (lines.length >= MAX_ITEMS) return false;
    lines.push({ id, qty });
  }
  write(lines);
  return true;
}

export function cartSetQty(id: string, qty: number): void {
  const lines = read();
  const q = Math.min(MAX_QTY_PER_ITEM, Math.max(1, Math.round(Number(qty) || 1)));
  const line = lines.find((l) => l.id === id);
  if (!line) return;
  line.qty = q;
  write(lines);
}

export function cartRemove(id: string): void {
  write(read().filter((l) => l.id !== id));
}

export function cartClear(): void {
  write([]);
}
