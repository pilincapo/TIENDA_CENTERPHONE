// Filtro de categorías del catálogo (módulo puro: sin DOM, se testea directo).

/** ¿El artículo pertenece a alguna de las categorías elegidas (raíz o subcategoría)?
 *
 *  La subcategoría de un producto NO está en `categoryId` sino en
 *  `subcategoryId` (el normalizador deja la raíz en categoryId y la
 *  subcategoría en subcategoryId), así que comparar solo con `categoryId`
 *  dejaba los chips «↳ Subcategoría» —«Almacenamiento», por ejemplo— siempre en
 *  cero resultados.
 */
export function inCategorySet(
  p: { categoryId: string | null; subcategoryId: string | null },
  ids: Set<string>,
): boolean {
  if (ids.size === 0) return true;
  return (p.categoryId !== null && ids.has(p.categoryId)) || (p.subcategoryId !== null && ids.has(p.subcategoryId));
}