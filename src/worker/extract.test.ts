import { describe, expect, it } from "vitest";
import { MAX_DOWNLOAD_BYTES, readBodyCapped } from "./extract";

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
