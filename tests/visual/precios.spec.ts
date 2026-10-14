import { test, expect, type Page } from "@playwright/test";

// Los anchos donde el catálogo se usa de verdad (celulares) más el desktop.
const ANCHOS = [320, 360, 390, 414, 480, 768, 1280];

// "Precio cortado" es exactamente lo que el navegador define para el
// ellipsis: el contenido mide más que la caja (scrollWidth > clientWidth).
// En jsdom esto es siempre 0/0 (no hay layout), por eso esta prueba vive
// acá, con un navegador real, y no en vitest.
async function preciosCortados(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".card-price")]
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => (el.textContent ?? "").trim()),
  );
}

for (const ancho of ANCHOS) {
  test(`ningún precio cortado a ${ancho}px (grilla y lista)`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await page.goto("/");
    await page.waitForSelector(".card-price");
    for (const vista of ["grilla", "lista"] as const) {
      const cortados = await preciosCortados(page);
      expect(cortados, `precio cortado en vista ${vista} a ${ancho}px`).toEqual([]);
      const sinScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(sinScroll, `scroll horizontal en vista ${vista} a ${ancho}px`).toBe(true);
      if (vista === "grilla") await page.locator('[data-view="list"]').click();
    }
  });
}
