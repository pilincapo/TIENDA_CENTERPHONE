import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:8787";
const TIMEOUT = 60000;
let fails = 0;
const ok = (cond, label) => { if (cond) console.log("  ✓ " + label); else { fails++; console.log("  ✗ " + label); } };

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let pageErr = null;
  page.on("pageerror", (e) => { pageErr = e.message; });
  try {
    await page.goto(base + "/admin/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#login-password", { timeout: TIMEOUT });
    await page.fill("#login-password", process.env.ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-tab="settings"]', { timeout: TIMEOUT });
    await page.click('[data-tab="settings"]');
    await page.waitForSelector("#cfg-tabs .cfg-tab", { timeout: TIMEOUT });

    // 1) La barra tiene sus 4 secciones.
    const secs = await page.evaluate(() => [...document.querySelectorAll("#cfg-tabs .cfg-tab")].map((b) => b.dataset.sec));
    ok(secs.length === 4 && secs.includes("tienda") && secs.includes("pagos") && secs.includes("cinta") && secs.includes("avanzado"),
      `la barra tiene 4 secciones (${secs.join(", ")})`);

    // 2) Cada sección filtra de verdad: solo se ven sus grupos.
    for (const sec of ["tienda", "pagos", "cinta", "avanzado"]) {
      await page.click(`.cfg-tab[data-sec="${sec}"]`);
      await page.waitForTimeout(400);
      const vis = await page.evaluate(() =>
        [...document.querySelectorAll("#s-form .cfg-group[data-sec]")].filter((g) => !g.hidden).map((g) => g.dataset.sec));
      ok(vis.length > 0 && vis.every((s) => s === sec),
        `sección "${sec}": solo sus grupos visibles (${vis.length} grupo${vis.length === 1 ? "" : "s"})`);
      const activo = await page.evaluate(() => document.querySelector(".cfg-tab.active")?.dataset.sec);
      ok(activo === sec, `sección "${sec}": el botón queda activo`);
    }

    // 3) Clave: el form ÚNICO expone TODOS los campos aunque la sección los oculte.
    await page.click('.cfg-tab[data-sec="tienda"]');
    const nombres = await page.evaluate(() => [...document.querySelectorAll("#s-form [name]")].map((e) => e.name));
    const esperados = ["storeName", "storeAddress", "whatsappPhone", "announcementBar", "announcementMotion",
      "announcementSpeed", "mpSurchargePercent", "transferCbu", "shippingAndreaniEnabled", "maintenanceMode"];
    const faltan = esperados.filter((n) => !nombres.includes(n));
    ok(faltan.length === 0, `el form expone todos los campos aunque estén ocultos (faltan: ${faltan.join(",") || "ninguno"})`);

    // 4) Guardar desde una sección NO borra las demás (el PUT reemplaza el objeto entero).
    const marca = `PRUEBA-REORG-${Date.now()}`;
    await page.click('.cfg-tab[data-sec="cinta"]');
    await page.evaluate((m) => {
      const t = document.querySelector('[name="announcementBar"]');
      t.value = m;
      t.dispatchEvent(new Event("input", { bubbles: true }));
    }, marca);
    await page.click('.cfg-tab[data-sec="tienda"]');
    await page.click('#s-form button[type="submit"]');
    await page.waitForTimeout(1500);

    const s = await page.evaluate(async (base) => (await fetch(base + "/api/public/settings")).json(), base);
    ok(s.announcementBar === marca, `la cinta guardada desde otra sección persistió`);
    ok(!!s.whatsappPhone && s.whatsappPhone.length >= 10, `el WhatsApp NO se borró (${s.whatsappPhone})`);
    ok(typeof s.storeMode === "string" && s.storeMode.length > 0, `el modo del sitio NO se borró (${s.storeMode})`);
    ok(typeof s.currencySymbol === "string" && s.currencySymbol.length > 0, `la moneda NO se borró (${s.currencySymbol})`);

    // 5) Sin errores de JS en ningún momento.
    ok(pageErr === null, `sin pageerror en toda la corrida${pageErr ? ` (${pageErr})` : ""}`);

    console.log(fails === 0 ? "\nTODO OK" : `\n${fails} FALLOS`);
  } finally {
    await browser.close();
  }
  process.exit(fails === 0 ? 0 : 1);
}
main();
