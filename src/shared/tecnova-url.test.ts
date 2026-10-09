// Detección de la fuente exclusiva de Tecnova: su web es una SPA sin productos en
// el HTML, así que estas URLs se ejecutan contra la API oficial en vez del
// importador genérico por URL (que siempre terminaba en "no devolvió productos").

import { describe, expect, it } from "vitest";
import { isTecnovaSourceUrl, TECNOVA_PUBLIC_URL, TECNOVA_SOURCE_URL } from "./tecnova-url";

describe("isTecnovaSourceUrl", () => {
  it("acepta la URL de la tienda y sus variantes", () => {
    expect(isTecnovaSourceUrl("https://www.tecnova.com.ar/")).toBe(true);
    expect(isTecnovaSourceUrl(TECNOVA_PUBLIC_URL)).toBe(true);
    expect(isTecnovaSourceUrl("https://tecnova.com.ar/")).toBe(true);
    expect(isTecnovaSourceUrl("http://tecnova.com.ar/celulares")).toBe(true);
    expect(isTecnovaSourceUrl("www.tecnova.com.ar")).toBe(true);
    expect(isTecnovaSourceUrl("https://sub.tecnova.com.ar/x")).toBe(true);
  });

  it("rechaza dominios parecidos, otras URLs y basura", () => {
    expect(isTecnovaSourceUrl("https://www.tecnova.com.ar.evil.com/")).toBe(false);
    expect(isTecnovaSourceUrl("https://mitecnova.com.ar/")).toBe(false);
    expect(isTecnovaSourceUrl("https://ejemplo.com/")).toBe(false);
    expect(isTecnovaSourceUrl("")).toBe(false);
    expect(isTecnovaSourceUrl(null)).toBe(false);
    expect(isTecnovaSourceUrl(undefined)).toBe(false);
    expect(isTecnovaSourceUrl("no es una url")).toBe(false);
  });

  it("la etiqueta de source_url es el dominio sin www (coincide con el import manual)", () => {
    expect(TECNOVA_SOURCE_URL).toBe("https://tecnova.com.ar/");
    expect(isTecnovaSourceUrl(TECNOVA_SOURCE_URL)).toBe(true);
  });
});
