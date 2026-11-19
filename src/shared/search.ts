// Coincidencia de consultas por fragmentos de palabras, ignorando tildes.

function searchWords(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Grupos de sinónimos del rubro: el catálogo dice «celular» y la gente busca
// «teléfono», o al revés. Las palabras van sin tildes y en minúsculas (el mismo
// formato que searchWords), y son términos enteros: el matcheo sigue siendo por
// fragmento, así «celu» entra por «celular».
// Solo sinónimos del mismo artículo, no categorías vecinas: un grupo de más
// devuelve productos que no tienen nada que ver y ensucia la búsqueda.
const SYNONYM_GROUPS: string[][] = [
  ["celular", "celulares", "telefono", "telefonos", "movil", "moviles", "smartphone", "smartphones", "phone"],
  ["auricular", "auriculares", "audifono", "audifonos", "headset"],
  ["cargador", "cargadores", "adaptador", "adaptadores", "cargar"],
  ["funda", "fundas", "case", "estuche", "estuches"],
  ["vidrio", "vidrios", "templado", "templados", "mica", "micas", "protector", "protectores"],
  ["reloj", "relojes", "smartwatch", "smartwatches", "watch"],
  ["parlante", "parlantes", "altavoz", "altavoces", "bocina", "bocinas", "speaker", "speakers"],
  ["tablet", "tablets", "tableta", "tabletas", "ipad"],
  ["notebook", "notebooks", "laptop", "laptops", "portatil", "portatiles"],
  ["memoria", "memorias", "almacenamiento", "microsd"],
  ["bateria", "baterias", "pila", "pilas"],
  ["televisor", "televisores", "television", "televisiones", "tele", "tv"],
];

/**
 * Palabras del grupo de sinónimos al que pertenece un término de la consulta.
 *
 * Solo se expande hacia adelante (`startsWith`): «celu» y «celular» abren el
 * grupo de celulares, pero «iphone» no, aunque contenga «phone» — si no, buscar
 * iPhone devolvería todos los teléfonos del catálogo.
 */
function synonymGroup(term: string): string[] {
  for (const group of SYNONYM_GROUPS) {
    if (group.some((word) => word.startsWith(term))) return group;
  }
  return [];
}

/** Cada término debe aparecer dentro de alguna palabra del texto, o dentro de
 *  una palabra sinónima (ver SYNONYM_GROUPS). */
export function matchesSearch(query: string, text: string): boolean {
  const terms = searchWords(query);
  if (terms.length === 0) return true;

  const words = searchWords(text);
  return terms.every((term) => {
    const needles = [term, ...synonymGroup(term)];
    return needles.some((needle) => words.some((word) => word.includes(needle)));
  });
}
