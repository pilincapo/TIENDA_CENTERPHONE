// Escape de texto para interpolar en HTML generado por strings.
// Lo comparten el frontend (catálogo, ficha, carrito, panel) y el worker
// (páginas generadas: /pedido/:id y el modo mantenimiento).
// Escapa las cinco entidades peligrosas, incluida la comilla simple, para que
// el mismo helper sirva tanto en contenido como en atributos con comillas
// simples o dobles.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapa &, <, >, " y ' para usar el texto dentro de HTML o de un atributo. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPES[ch] as string);
}
