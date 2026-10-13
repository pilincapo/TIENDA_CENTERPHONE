import { describe, expect, it } from "vitest";
import type { Product } from "./types";
import {
  avisoCatalogoVacio,
  buildWaFeed,
  feedResultante,
  waAvailability,
  waBrand,
  waDescription,
  waPrice,
  WA_FEED_COLUMNS,
  WA_MAX_ID,
} from "./wa-feed";

function prod(over: Partial<Product> = {}): Product {
  return {
    id: "5469",
    title: "Celular de prueba",
    description: "",
    priceCents: 1_250_000,
    categoryId: "celulares",
    subcategoryId: null,
    tags: [],
    imageUrl: "https://cdn.ejemplo.com/foto.jpg",
    status: "published",
    availability: "in_stock",
    waPublish: true,
    sortOrder: 0,
    createdAt: 0,
    sourceUrl: null,
    brand: null,
    ...over,
  };
}

const OPTS = {
  origin: "https://centerphone.com.ar",
  storeName: "CenterPhone Celulares",
  categoryNames: new Map([["celulares", "Celulares"]]),
};

/**
 * Parser CSV RFC 4180 mínimo: se usa para verificar que el archivo generado es
 * parseable de verdad (comillas, comas y saltos de línea dentro de las celdas) y
 * no solo "parecido a un CSV" mirado con un split.
 */
function parseCsv(text: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (entreComillas) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          celda += '"';
          i += 2;
          continue;
        }
        entreComillas = false;
        i += 1;
        continue;
      }
      celda += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      entreComillas = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      fila.push(celda);
      celda = "";
      i += 1;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
      i += 2;
      continue;
    }
    celda += ch;
    i += 1;
  }
  if (celda !== "" || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/** Fila `n` del CSV generado, con el parseo ya verificado (el repo usa `!` para esto). */
function fila(csv: string, n: number): string[] {
  const filas = parseCsv(csv);
  expect(filas.length).toBeGreaterThan(n);
  return filas[n]!;
}

describe("waPrice", () => {
  it("arma el precio con punto decimal y moneda ISO, sin símbolo", () => {
    expect(waPrice(1_250_000)).toBe("12500.00 ARS");
    expect(waPrice(99_990)).toBe("999.90 ARS");
    expect(waPrice(0)).toBe("0.00 ARS");
  });

  it("nunca emite precios negativos ni símbolos de moneda", () => {
    expect(waPrice(-500)).toBe("0.00 ARS");
    expect(waPrice(1_250_000)).not.toContain("$");
  });
});

describe("waAvailability", () => {
  it("mapea los estados del sitio a los valores en inglés de Meta", () => {
    expect(waAvailability("in_stock")).toBe("in stock");
    expect(waAvailability("out_of_stock")).toBe("out of stock");
    expect(waAvailability("preorder")).toBe("preorder");
  });
});

describe("waDescription", () => {
  it("usa la descripción propia cuando existe y colapsa los espacios", () => {
    const p = prod({ description: "  Celular   nuevo\ncon caja  " });
    expect(waDescription(p, "CenterPhone Celulares", "Celulares")).toBe("Celular nuevo con caja");
  });

  it("genera una descripción de respaldo cuando el producto no trae una", () => {
    const texto = waDescription(prod(), "CenterPhone Celulares", "Celulares");
    expect(texto).toContain("Celular de prueba.");
    expect(texto).toContain("Categoría: Celulares.");
    expect(texto).toContain("disponible en CenterPhone Celulares");
    expect(texto.length).toBeGreaterThan(20);
  });

  it("no deja la descripción vacía (Meta la exige)", () => {
    const sinNada = prod({ description: "", title: "", brand: null });
    expect(waDescription(sinNada, "", "").length).toBeGreaterThan(0);
  });
});

describe("waBrand", () => {
  it("usa la marca del producto y cae al nombre de la tienda", () => {
    expect(waBrand(prod({ brand: "Samsung" }), "CenterPhone Celulares")).toBe("Samsung");
    expect(waBrand(prod({ brand: null }), "CenterPhone Celulares")).toBe("CenterPhone Celulares");
    expect(waBrand(prod({ brand: null }), "")).toBe("Genérico");
  });
});

describe("buildWaFeed", () => {
  it("arma encabezado + una fila por producto marcado, con el formato de Meta", () => {
    const { csv, included, skipped } = buildWaFeed([prod()], OPTS);
    expect(included).toBe(1);
    expect(skipped).toEqual([]);
    const filas = parseCsv(csv);
    expect(filas[0]).toEqual([...WA_FEED_COLUMNS]);
    expect(filas[1]).toEqual([
      "5469",
      "Celular de prueba",
      "Celular de prueba. Categoría: Celulares. Nuevo, disponible en CenterPhone Celulares. Consultanos por WhatsApp por stock, colores, memoria y formas de pago.",
      "in stock",
      "new",
      "12500.00 ARS",
      "https://centerphone.com.ar/producto/5469",
      "https://cdn.ejemplo.com/foto.jpg",
      "CenterPhone Celulares",
    ]);
    // Todas las filas tienen la misma cantidad de columnas que el encabezado.
    expect(filas.every((f) => f.length === WA_FEED_COLUMNS.length)).toBe(true);
  });

  it("solo incluye los productos marcados para WhatsApp", () => {
    const { csv, included } = buildWaFeed(
      [prod({ id: "1" }), prod({ id: "2", waPublish: false }), prod({ id: "3" })],
      OPTS
    );
    expect(included).toBe(2);
    expect(csv).toContain("/producto/1");
    expect(csv).not.toContain("/producto/2");
    expect(csv).toContain("/producto/3");
  });

  it("saltea (y reporta) los productos que harían fallar la validación del feed", () => {
    const largo = "x".repeat(WA_MAX_ID + 1);
    const { included, skipped } = buildWaFeed(
      [
        prod({ id: "ok" }),
        prod({ id: "sin-foto", imageUrl: "" }),
        prod({ id: "foto-relativa", imageUrl: "/assets/foto.jpg" }),
        prod({ id: "sin-titulo", title: "   " }),
        prod({ id: largo }),
      ],
      OPTS
    );
    expect(included).toBe(1);
    expect(skipped.map((s) => s.id)).toEqual(["sin-foto", "foto-relativa", "sin-titulo", largo]);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("escapa comas y comillas y aplana los saltos de línea", () => {
    const p = prod({
      title: 'Celular "Pro", 128 GB',
      description: "Primera línea\r\nSegunda, con coma y \"comillas\"",
    });
    const { csv } = buildWaFeed([p], OPTS);
    // Una fila por producto: ningún campo puede meter un salto real en el CSV.
    expect(parseCsv(csv)).toHaveLength(2);
    const primera = fila(csv, 1);
    expect(primera[1]).toBe('Celular "Pro", 128 GB');
    expect(primera[2]).toBe('Primera línea Segunda, con coma y "comillas"');
  });

  it("codifica el id en el link y recorta títulos largos", () => {
    const { csv } = buildWaFeed([prod({ id: "power bank 12000", title: "T".repeat(500) })], OPTS);
    const primera = fila(csv, 1);
    expect(primera[0]).toBe("power bank 12000");
    expect(primera[6]).toBe("https://centerphone.com.ar/producto/power%20bank%2012000");
    expect((primera[1] ?? "").length).toBeLessThanOrEqual(200);
  });

  it("con cero productos marcados devuelve solo el encabezado", () => {
    const { csv, included } = buildWaFeed([prod({ waPublish: false })], OPTS);
    expect(included).toBe(0);
    expect(parseCsv(csv)).toEqual([[...WA_FEED_COLUMNS]]);
  });

  it("no duplica la barra del origen en el link", () => {
    const { csv } = buildWaFeed([prod()], { ...OPTS, origin: "https://centerphone.com.ar/" });
    expect(csv).toContain("https://centerphone.com.ar/producto/5469");
    expect(csv).not.toContain("com.ar//producto");
  });
});

// Aviso del panel antes de una acción masiva sobre el catálogo de WhatsApp. La aritmética
// se testea acá (y no en el navegador) porque es lo que decide si se pide una segunda
// confirmación antes de desarmar el catálogo.
describe("aviso de catálogo casi vacío", () => {
  it("marcar suma solo los que todavía no estaban en el feed", () => {
    expect(feedResultante(true, 100, 0, 10)).toBe(110);
    expect(feedResultante(true, 100, 4, 10)).toBe(106);
    // Ya estaban todos: marcar no cambia el tamaño del feed.
    expect(feedResultante(true, 100, 10, 10)).toBe(100);
  });

  it("quitar resta los que estaban en el feed (nunca da negativo de más)", () => {
    expect(feedResultante(false, 100, 40, 45)).toBe(60);
    expect(feedResultante(false, 100, 100, 100)).toBe(0);
  });

  it("avisa fuerte cuando la acción deja el feed vacío, y explica la consecuencia", () => {
    const aviso = avisoCatalogoVacio(0, 100);
    expect(aviso).toContain("VACÍO");
    // El feed responde error a propósito y Meta conserva el catálogo viejo: no es "nada".
    expect(aviso).toContain("error a propósito");
  });

  it("avisa cuando queda menos de un cuarto del catálogo, y no cuando queda más", () => {
    expect(avisoCatalogoVacio(25, 100)).toContain("con 25 productos, de los 100 que hay hoy");
    expect(avisoCatalogoVacio(26, 100)).toBe("");
    // Singular bien dicho cuando queda uno solo.
    expect(avisoCatalogoVacio(1, 100)).toContain("con 1 producto,");
  });

  it("con el feed ya vacío no avisa nada (no hay nada que proteger)", () => {
    expect(avisoCatalogoVacio(0, 0)).toBe("");
  });

  it("una acción que no achica el feed no dice nada", () => {
    expect(avisoCatalogoVacio(100, 100)).toBe("");
    expect(avisoCatalogoVacio(110, 100)).toBe("");
    expect(avisoCatalogoVacio(feedResultante(true, 100, 0, 10), 100)).toBe("");
  });
});
