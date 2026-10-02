// El filtro de categorías del catálogo: la subcategoría de un producto vive en
// `subcategoryId`, NO en `categoryId`. Antes solo se comparaba `categoryId`, así
// que los chips «↳ Subcategoría» del toolbar（«Almacenamiento», por ejemplo）
// dejaban siempre la lista en cero resultados.
import { describe, expect, it } from "vitest";
import { inCategorySet } from "./category-filter";

const prods = {
  deSub: { categoryId: "electronica", subcategoryId: "almacenamiento" },
  deSub2: { categoryId: "electronica", subcategoryId: "cables" },
  soloRaiz: { categoryId: "hogar", subcategoryId: null },
  sinNada: { categoryId: null, subcategoryId: null },
};

describe("filtro de categorías del catálogo", () => {
  it("sin filtro (conjunto vacío) deja pasar todo, incluso lo que no tiene categoría", () => {
    expect(inCategorySet(prods.soloRaiz, new Set())).toBe(true);
    expect(inCategorySet(prods.sinNada, new Set())).toBe(true);
  });

  it("al elegir una SUBCATEGORÍA muestra los productos que la tienen en subcategoryId", () => {
    const ids = new Set(["almacenamiento"]);
    expect(inCategorySet(prods.deSub, ids)).toBe(true); // el bug: daba false
    expect(inCategorySet(prods.deSub2, ids)).toBe(false);
    expect(inCategorySet(prods.soloRaiz, ids)).toBe(false);
  });

  it("al elegir una RAÍZ sigue mostrando todo lo de esa raíz, con y sin subcategoría", () => {
    const ids = new Set(["electronica"]);
    expect(inCategorySet(prods.deSub, ids)).toBe(true);
    expect(inCategorySet(prods.deSub2, ids)).toBe(true);
    expect(inCategorySet(prods.soloRaiz, ids)).toBe(false);
  });

  it("raíz + sus subcategorías (lo que arma collectCategoryIds) incluye los dos casos", () => {
    const ids = new Set(["electronica", "almacenamiento", "cables"]);
    expect(inCategorySet(prods.deSub, ids)).toBe(true);
    expect(inCategorySet(prods.deSub2, ids)).toBe(true);
    expect(inCategorySet(prods.soloRaiz, ids)).toBe(false);
    expect(inCategorySet(prods.sinNada, ids)).toBe(false);
  });

  it("un artículo sin categoría queda fuera cuando hay un filtro activo", () => {
    expect(inCategorySet(prods.sinNada, new Set(["electronica"]))).toBe(false);
  });
});