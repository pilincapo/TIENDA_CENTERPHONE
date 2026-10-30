// Coincidencia de consultas por fragmentos de palabras, ignorando tildes.

function searchWords(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Cada término debe aparecer dentro de alguna palabra del texto. */
export function matchesSearch(query: string, text: string): boolean {
  const terms = searchWords(query);
  if (terms.length === 0) return true;

  const words = searchWords(text);
  return terms.every((term) => words.some((word) => word.includes(term)));
}
