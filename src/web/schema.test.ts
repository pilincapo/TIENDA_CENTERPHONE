import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd } from "./schema";

describe("breadcrumbJsonLd", () => {
  it("arma la lista con posiciones 1..n y URLs absolutas", () => {
    const ld = JSON.parse(
      breadcrumbJsonLd([
        { name: "Inicio", url: "https://centerphone.com.ar/" },
        { name: "Electrónica", url: "https://centerphone.com.ar/?cat=electronica" },
        { name: "Galaxy A15", url: "https://centerphone.com.ar/producto/galaxy-a15" },
      ])
    ) as { "@type": string; itemListElement: { position: number; name: string; item: string }[] };

    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toHaveLength(3);
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(ld.itemListElement[2]?.item).toBe("https://centerphone.com.ar/producto/galaxy-a15");
  });

  it("funciona sin escalón de categoría (producto sin categoría)", () => {
    const ld = JSON.parse(
      breadcrumbJsonLd([
        { name: "Inicio", url: "https://centerphone.com.ar/" },
        { name: "Cable USB-C", url: "https://centerphone.com.ar/producto/cable-usb-c" },
      ])
    ) as { itemListElement: unknown[] };

    expect(ld.itemListElement).toHaveLength(2);
  });
});
