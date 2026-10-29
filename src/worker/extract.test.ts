import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFromUrl, MAX_DOWNLOAD_BYTES, readBodyCapped, urlExternaPermitida } from "./extract";

// Helper: Response con body de N bytes (stream real, como el de un fetch).
function responseWithBytes(n: number, headers: Record<string, string> = {}): Response {
  const data = new Uint8Array(n);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe("readBodyCapped", () => {
  it("descarga normal por debajo del límite devuelve el texto completo", async () => {
    const res = new Response("Hola mundo", { headers: { "Content-Type": "text/html" } });
    const text = await readBodyCapped(res);
    expect(text).toBe("Hola mundo");
  });

  it("respeta Content-Length: rechaza antes de descargar si supera el tope", async () => {
    const res = responseWithBytes(0, { "Content-Length": String(MAX_DOWNLOAD_BYTES + 1) });
    await expect(readBodyCapped(res)).rejects.toThrow(/pesa más de/);
  });

  it("corta el stream cuando el body acumulado supera el límite", async () => {
    // Un chunk de MAX+1 bytes: sin Content-Length, se detecta leyendo.
    const res = responseWithBytes(MAX_DOWNLOAD_BYTES + 1);
    await expect(readBodyCapped(res, 1024)).rejects.toThrow(/supera el límite/);
  });

  it("un body con varios chunks chicos se concatena bien", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hola "));
        controller.enqueue(new TextEncoder().encode("mundo"));
        controller.close();
      },
    });
    const text = await readBodyCapped(new Response(stream));
    expect(text).toBe("Hola mundo");
  });
});

// ---- Importador "categoría JSON-LD" ----
// Las URLs de las fichas salen del HTML de un tercero, así que no pueden llevar
// al worker a loopback/redes privadas ni hacerle gastar todos los subrequests
// del plan gratis.

const CATEGORIA = "https://tienda.example.com/categoria/celulares";

function respuestaHtml(html: string): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Respuesta con `url` final (lo que devuelve un fetch que siguió redirects). */
function respuestaRedirigida(html: string, urlFinal: string): Response {
  const res = respuestaHtml(html);
  Object.defineProperty(res, "url", { value: urlFinal });
  return res;
}

function categoriaHtml(urls: string[]): string {
  const lista = { "@context": "https://schema.org", "@type": "ItemList", itemListElement: urls.map((url) => ({ "@type": "ListItem", url })) };
  return `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify(lista)}</script>
</head><body>categoría</body></html>`;
}

function fichaHtml(titulo: string): string {
  const producto = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: titulo,
    offers: { "@type": "Offer", price: "125000", priceCurrency: "ARS", availability: "https://schema.org/InStock" },
  };
  return `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify(producto)}</script>
</head><body>${titulo}</body></html>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("urlExternaPermitida", () => {
  it("acepta http(s) a hosts públicos", () => {
    expect(urlExternaPermitida("https://tienda.example.com/producto/1")).toBe(true);
    expect(urlExternaPermitida("http://tienda.example.com/producto/1")).toBe(true);
    expect(urlExternaPermitida("  https://sub.tienda.com.ar/p/x  ")).toBe(true);
    expect(urlExternaPermitida("https://8.8.8.8/p")).toBe(true);
    // Dominios que empiezan con fc/fd no son IPv6 unique-local.
    expect(urlExternaPermitida("https://fcelulares.com/p/1")).toBe(true);
    expect(urlExternaPermitida("https://fdtech.com.ar/producto/7")).toBe(true);
  });

  it("rechaza loopback, redes privadas y link-local (IPv4)", () => {
    for (const u of [
      "http://127.0.0.1:8787/admin/",
      "http://127.1.2.3/",
      "http://0.0.0.0/",
      "http://10.0.0.5/x",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://2130706433/", // 127.0.0.1 en decimal
      "http://0x7f.0.0.1/", // 127.0.0.1 en hexadecimal
    ]) {
      expect(urlExternaPermitida(u), u).toBe(false);
    }
  });

  it("rechaza IPv6 interno y nombres de host locales", () => {
    for (const u of [
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://localhost:8787/",
      "http://localhost/",
      "http://panel.localhost/",
      "http://impresora.local/",
      "http://algo.internal/",
      "http://foo.home.arpa/",
    ]) {
      expect(urlExternaPermitida(u), u).toBe(false);
    }
  });

  it("rechaza esquemas que no son http(s) y URLs relativas o inválidas", () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/html,x", "/producto/1", "", "   ", "no es una url"]) {
      expect(urlExternaPermitida(u), u).toBe(false);
    }
  });
});

describe("extractFromUrl — importador de categoría JSON-LD", () => {
  it("filtra destinos internos y se queda con 20 fichas (1 subrequest cada una)", async () => {
    const privadas = [
      "http://127.0.0.1:8787/admin/",
      "http://localhost:8787/api/admin/settings",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.0.10/",
    ];
    const publicas = Array.from({ length: 30 }, (_, i) => `https://tienda.example.com/producto/${i + 1}`);
    const pedidas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        pedidas.push(url);
        if (url === CATEGORIA) return respuestaHtml(categoriaHtml([...privadas, ...publicas]));
        return respuestaHtml(fichaHtml(`Producto ${url.split("/").pop()}`));
      })
    );

    const r = await extractFromUrl(CATEGORIA);

    expect(r.source).toBe("ldjson-detail");
    expect(r.items).toHaveLength(20);
    // Cuentan la de la categoría y las 20 fichas: una petición por ficha.
    expect(pedidas).toHaveLength(21);
    for (const u of privadas) expect(pedidas, u).not.toContain(u);
    expect(pedidas.filter((u) => u.includes("127.0.0.1") || u.includes("localhost") || u.includes("169.254") || u.includes("192.168"))).toEqual([]);
  });

  it("descarta la ficha si el redirect aterriza en un host interno", async () => {
    const pedidas: string[] = [];
    const urlInterna = "http://127.0.0.1:8787/admin/";
    const urlPublica = "https://tienda.example.com/producto/1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        pedidas.push(url);
        if (url === CATEGORIA) return respuestaHtml(categoriaHtml([urlInterna, urlPublica]));
        // La ficha pública responde, pero su destino final es loopback.
        return respuestaRedirigida(fichaHtml("Producto secuestrado"), urlInterna);
      })
    );

    const r = await extractFromUrl(CATEGORIA);

    // La categoría y la ficha pública: nada más, y el contenido interno no se usa
    // (después viene el fallback de Shopify, que no trae items en este mock).
    expect(pedidas.slice(0, 2)).toEqual([CATEGORIA, urlPublica]);
    expect(pedidas).not.toContain(urlInterna);
    expect(r.items).toHaveLength(0);
    expect(r.source).toBe("json"); // sin items, cae al final del camino
  });

  it("una ficha caída no descarta las demás", async () => {
    const urls = ["https://tienda.example.com/producto/1", "https://tienda.example.com/producto/2", "https://tienda.example.com/producto/3"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === CATEGORIA) return respuestaHtml(categoriaHtml(urls));
        if (url.endsWith("/2")) return new Response("boom", { status: 500 });
        return respuestaHtml(fichaHtml(`Producto ${url.split("/").pop()}`));
      })
    );

    const r = await extractFromUrl(CATEGORIA);

    expect(r.source).toBe("ldjson-detail");
    expect(r.items).toHaveLength(2);
  });
});
