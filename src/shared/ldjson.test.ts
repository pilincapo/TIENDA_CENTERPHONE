import { describe, expect, it } from "vitest";
import { extractLdJsonBlocks, itemsFromLdJson } from "./ldjson";

const htmlConProducto = `
<!doctype html>
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Samsung Galaxy S24",
 "description":"El nuevo S24","image":["https://x/s24.jpg"],"sku":"S24-512",
 "offers":{"@type":"Offer","price":"1299999","priceCurrency":"ARS"}}
</script>
</head><body>hola</body></html>`;

describe("extractLdJsonBlocks", () => {
  it("extrae bloques ld+json válidos", () => {
    const blocks = extractLdJsonBlocks(htmlConProducto);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Record<string, unknown>)["@type"]).toBe("Product");
  });

  it("ignora bloques malformados sin romper", () => {
    const html = `<script type="application/ld+json">{roto</script>
      <script type="application/ld+json">{"@type":"Product","name":"A","offers":{"price":1}}</script>`;
    expect(extractLdJsonBlocks(html)).toHaveLength(1);
  });

  it("devuelve vacío sin bloques", () => {
    expect(extractLdJsonBlocks("<p>sin nada</p>")).toEqual([]);
  });
});

describe("itemsFromLdJson", () => {
  it("mapea un Product completo", () => {
    const items = itemsFromLdJson(htmlConProducto);
    expect(items).toHaveLength(1);
    const item = items[0] as Record<string, unknown>;
    expect(item.title).toBe("Samsung Galaxy S24");
    expect(item.price).toBe(1299999);
    expect(item.image_url).toBe("https://x/s24.jpg");
    expect(item.sku).toBe("S24-512");
  });

  it("encuentra Product dentro de @graph", () => {
    const html = `<script type="application/ld+json">{"@graph":[
      {"@type":"WebSite","name":"x"},
      {"@type":"Product","name":"Moto G84","offers":{"price":329999}}]}</script>`;
    const items = itemsFromLdJson(html);
    expect(items).toHaveLength(1);
    expect((items[0] as Record<string, unknown>).title).toBe("Moto G84");
  });

  it("acepta lista de ofertas (lowPrice)", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"POCO X6",
      "offers":[{"@type":"AggregateOffer","lowPrice":549999}]}</script>`;
    expect((itemsFromLdJson(html)[0] as Record<string, unknown>).price).toBe(549999);
  });

  it("omite Product sin nombre o sin precio usable pero no rompe", () => {
    const html = `<script type="application/ld+json">[
      {"@type":"Product","offers":{"price":10}},
      {"@type":"Product","name":"Sin precio"},
      {"@type":"Product","name":"Con precio","offers":{"price":"99,99"}}]</script>`;
    const items = itemsFromLdJson(html);
    expect(items).toHaveLength(2);
  });

  it("ignora otros tipos schema.org", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Tienda"}</script>`;
    expect(itemsFromLdJson(html)).toEqual([]);
  });
});
