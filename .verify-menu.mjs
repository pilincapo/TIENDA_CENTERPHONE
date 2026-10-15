import { chromium } from "@playwright/test";
const base = "http://127.0.0.1:8787";
let fails = 0;
const ok = (c, l) => { if (c) console.log("  ✓ " + l); else { fails++; console.log("  ✗ " + l); } };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let pageErr = null;
page.on("pageerror", (e) => { pageErr = e.message; });
try {
  await page.goto(base + "/admin/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-password", { timeout: 60000 });
  await page.fill("#login-password", process.env.ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#tabs a[data-tab="products"]', { timeout: 60000 });

  // 1) 5 secciones con sus rótulos.
  const grupos = await page.evaluate(() =>
    [...document.querySelectorAll("#tabs .menu-group")].map((g) => ({
      label: g.querySelector(".menu-label")?.textContent?.trim(),
      tabs: [...g.querySelectorAll("a[data-tab]")].map((a) => a.dataset.tab),
    })));
  ok(grupos.length === 5, `5 secciones (${grupos.map((g) => g.label).join(" | ")})`);
  const total = grupos.reduce((n, g) => n + g.tabs.length, 0);
  ok(total === 11, `11 pestañas en total (${total})`);
  const esperadas = ["products","categories","import","auto","rules","orders","stats","dashboard","settings","changelog","seguridad"];
  const vistas = grupos.flatMap((g) => g.tabs);
  ok(esperadas.every((t) => vistas.includes(t)) && vistas.length === 11, "las 11 pestañas esperadas, sin duplicadas");
  ok(vistas.includes("rules") && grupos.find((g) => g.tabs.includes("rules"))?.label.includes("Ventas"),
    "«Precios» (rules) está en Ventas, no en Importación");

  // 2) Navegación: las 11 pestañas renderizan con 0 pageerror y la activa se resalta.
  for (const t of esperadas) {
    await page.click(`#tabs a[data-tab="${t}"]`);
    await page.waitForFunction((tab) => {
      const a = document.querySelector(`#tabs a[data-tab="${tab}"]`);
      return a && a.classList.contains("active") && document.querySelector("#view")?.children.length > 0;
    }, t, { timeout: 20000 });
    const activo = await page.evaluate(() => document.querySelector("#tabs a.active")?.dataset.tab);
    ok(activo === t, `pestaña "${t}" navega y se resalta`);
    if (pageErr) break;
  }
  ok(pageErr === null, `sin pageerror en toda la corrida${pageErr ? ` (${pageErr})` : ""}`);

  // 3) El badge de pedidos sigue enganchado (se crea por data-tab).
  const badgeOk = await page.evaluate(() => !!document.querySelector('#tabs a[data-tab="orders"]'));
  ok(badgeOk, "el nodo de Pedidos sigue siendo alcanzable por data-tab (badge)");

  // 4) Móvil 360px: el menú envuelve sin scroll horizontal de página.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  ok(!overflow, "sin scroll horizontal a 360px");
} finally { await browser.close(); }
console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
