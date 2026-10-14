import { test, expect } from "@playwright/test";

// La preferencia de vista y de orden viven en localStorage (celu_view_v1 /
// celu_sort_v1) y tienen que sobrevivir la recarga: esa es la promesa del// alternador. Cada contexto de Playwright arranca con storage limpio, así
// que "persiste" se prueba recargando de verdad.
test("la vista elegida sobrevive la recarga (lista y vuelta a grilla)", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".card-price");
  await expect(page.locator(".grid")).not.toHaveClass(/grid--list/);

  await page.locator('[data-view="list"]').click();
  await expect(page.locator(".grid")).toHaveClass(/grid--list/);
  await page.reload();
  await page.waitForSelector(".card-price");
  await expect(page.locator(".grid")).toHaveClass(/grid--list/);

  await page.locator('[data-view="grid"]').click();
  await expect(page.locator(".grid")).not.toHaveClass(/grid--list/);
  await page.reload();
  await page.waitForSelector(".card-price");
  await expect(page.locator(".grid")).not.toHaveClass(/grid--list/);
});

test("el orden elegido sobrevive la recarga y ordena de verdad", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".card-price");
  await page.selectOption("#sort-sel", "price-asc");
  await expect(page.locator("#sort-sel")).toHaveValue("price-asc");

  await page.reload();
  await page.waitForSelector(".card-price");
  await expect(page.locator("#sort-sel")).toHaveValue("price-asc");

  // Que además esté aplicado: los precios renderizados, en orden creciente.
  const textos = await page.locator(".card-price").allTextContents();
  const numeros = textos.map((t) => Number(t.replace(/[^\d]/g, "")));
  expect(numeros.length).toBeGreaterThan(0);
  expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
});
