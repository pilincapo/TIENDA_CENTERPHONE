#!/usr/bin/env node
// Smoke test del sitio: comprueba, contra una URL real, que la versión que está
// sirviendo responde bien. No reemplaza a los tests (esos prueban la lógica): esto
// ataja el caso "subió mal" — bundles viejos, 404 que devuelven 200, redirect de
// www roto, feed de WhatsApp abierto sin token.
//
// Uso:
//   npm run smoke                 → https://centerphone.com.ar
//   npm run smoke -- --local      → http://127.0.0.1:8787
//   npm run smoke -- --url=http://otro-host:8787
//
// Sale con código 1 si algún control falla, para poder usarlo en un paso manual
// después del deploy (o en un hook, si algún día se quiere).

const args = process.argv.slice(2);
const BASE = (
  args.find((a) => a.startsWith("--url="))?.slice("--url=".length) ??
  (args.includes("--local") ? "http://127.0.0.1:8787" : "https://centerphone.com.ar")
).replace(/\/+$/, "");
const HOST = new URL(BASE).host;
const TIMEOUT = 15_000;

const resultados = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function pedir(path, init = {}) {
  return fetch(`${BASE}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { "user-agent": "centerphone-smoke/1" },
    ...init,
  });
}

async function check(nombre, fn) {
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true, detalle: detalle ?? "" });
  } catch (e) {
    resultados.push({ nombre, ok: false, detalle: e instanceof Error ? e.message : String(e) });
  }
}

// ---- Controles ----

let catalogo = null;

await check("home 200 y HTML con el contenedor del catálogo", async () => {
  const res = await pedir("/");
  assert(res.status === 200, `status ${res.status}`);
  assert(/text\/html/.test(res.headers.get("content-type") ?? ""), `content-type ${res.headers.get("content-type")}`);
  assert(res.headers.get("content-security-policy") !== null, "sin CSP");
  const html = await res.text();
  assert(html.includes('id="content"'), "el HTML no trae #content (build incompleto)");
  assert(html.includes("/assets/"), "el HTML no referencia ningún bundle");
});

await check("/api/catalog 200 con productos y categorías", async () => {
  const res = await pedir("/api/catalog");
  assert(res.status === 200, `status ${res.status}`);
  catalogo = await res.json();
  assert(Array.isArray(catalogo.products), "sin array products");
  assert(catalogo.products.length > 0, "catálogo vacío");
  // El snapshot trae productos y categorías; los ajustes van por /api/public/settings
  // (el control de abajo). Si falta generatedAt, el snapshot quedó viejo o incompleto.
  assert(Array.isArray(catalogo.categories), "sin array categories");
  assert(Number(catalogo.generatedAt) > 0, "snapshot sin generatedAt");
  return `${catalogo.products.length} productos, ${catalogo.categories.length} categorías`;
});

await check("/api/public/settings 200", async () => {
  const res = await pedir("/api/public/settings");
  assert(res.status === 200, `status ${res.status}`);
  const j = await res.json();
  assert(typeof j.storeName === "string", "sin storeName");
});

await check("ficha de un producto real (HTML con Open Graph del producto)", async () => {
  const p = catalogo?.products?.[0];
  assert(p, "no hay producto para probar");
  const res = await pedir(`/producto/${encodeURIComponent(p.id)}`);
  assert(res.status === 200, `status ${res.status}`);
  const html = await res.text();
  assert(html.includes('property="og:title"'), "sin og:title inyectado");
  assert(!html.includes('content=""'), "og con contenido vacío");
  return p.id;
});

await check("/api/products/:id devuelve ese producto", async () => {
  const p = catalogo?.products?.[0];
  assert(p, "no hay producto para probar");
  const res = await pedir(`/api/products/${encodeURIComponent(p.id)}`);
  assert(res.status === 200, `status ${res.status}`);
  const j = await res.json();
  assert(j?.product?.id === p.id, `devolvió ${j?.product?.id ?? "nada"}`);
});

await check("CSS y JS del HTML responden 200 (bundles al día)", async () => {
  const html = await (await pedir("/")).text();
  const css = html.match(/\/assets\/[^"']+\.css/)?.[0];
  const js = html.match(/\/assets\/[^"']+\.js/)?.[0];
  assert(css, "el HTML no referencia CSS");
  assert(js, "el HTML no referencia JS");
  const [rCss, rJs] = await Promise.all([pedir(css), pedir(js)]);
  assert(rCss.status === 200, `${css} → ${rCss.status}`);
  assert(rJs.status === 200, `${js} → ${rJs.status}`);
  assert(/text\/css/.test(rCss.headers.get("content-type") ?? ""), `CSS con content-type ${rCss.headers.get("content-type")}`);
  assert(/javascript/.test(rJs.headers.get("content-type") ?? ""), `JS con content-type ${rJs.headers.get("content-type")}`);
  return [css, js].map((u) => u.split("/").pop()).join(" + ");
});

await check("sitemap.xml 200 con URLs", async () => {
  const res = await pedir("/sitemap.xml");
  assert(res.status === 200, `status ${res.status}`);
  const xml = await res.text();
  assert(xml.includes("<urlset"), "sin <urlset>");
  const urls = xml.match(/<loc>/g)?.length ?? 0;
  assert(urls > 0, "sitemap sin URLs");
  return `${urls} URLs`;
});

await check("robots.txt 200", async () => {
  const res = await pedir("/robots.txt");
  assert(res.status === 200, `status ${res.status}`);
  const txt = await res.text();
  assert(/user-agent:/i.test(txt), "robots.txt sin user-agent");
});

await check("una URL inexistente responde 404 de verdad (no 200)", async () => {
  const res = await pedir(`/no-existe-smoke-${Date.now()}`);
  assert(res.status === 404, `status ${res.status} (soft 404)`);
  const html = await res.text();
  assert(/text\/html/.test(res.headers.get("content-type") ?? ""), `content-type ${res.headers.get("content-type")}`);
  assert(html.length > 200, "cuerpo vacío");
});

await check("/404.html responde 404", async () => {
  const res = await pedir("/404.html");
  assert(res.status === 404, `status ${res.status}`);
});

await check("/changelog.md queda bloqueado", async () => {
  const res = await pedir("/changelog.md");
  assert(res.status === 401, `status ${res.status} (documentación interna expuesta)`);
});

await check("feed de WhatsApp sin token responde 404", async () => {
  const res = await pedir("/api/whatsapp/feed.csv");
  assert(res.status === 404, `status ${res.status}`);
});

await check("admin sin sesión no sirve el panel", async () => {
  const res = await pedir("/api/admin/stats");
  assert(res.status === 401 || res.status === 403, `status ${res.status}`);
});

if (HOST === "centerphone.com.ar") {
  await check("www redirige al dominio sin www (301)", async () => {
    const res = await fetch("https://www.centerphone.com.ar/", {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    assert(res.status === 301, `status ${res.status}`);
    const loc = res.headers.get("location") ?? "";
    assert(loc.startsWith("https://centerphone.com.ar"), `location ${loc}`);
  });
}

// ---- Resumen ----

const ancho = Math.max(...resultados.map((r) => r.nombre.length));
console.log(`\nSmoke test contra ${BASE}\n`);
for (const r of resultados) {
  const marca = r.ok ? "OK  " : "FALLA";
  console.log(`${marca}  ${r.nombre.padEnd(ancho)}  ${r.detalle}`);
}
const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} controles OK`);
if (fallas.length > 0) {
  console.error(`\nFallaron ${fallas.length}: ${fallas.map((f) => f.nombre).join(" · ")}`);
  process.exit(1);
}
