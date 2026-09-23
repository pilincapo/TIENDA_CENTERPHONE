import { describe, expect, it } from "vitest";
import { computeSalud } from "./health";

const HORA = 60 * 60 * 1000;
const now = 1_800_000_000_000;

describe("computeSalud", () => {
  it("agrega corridas por fuente con tasa de éxito y duración media", () => {
    const s = computeSalud(
      [
        { status: "ok", detail: "https://a.com/x", error: null, started_at: now - 2 * HORA, finished_at: now - 2 * HORA + 5000 },
        { status: "ok", detail: "https://a.com/x", error: null, started_at: now - HORA, finished_at: now - HORA + 7000 },
        { status: "error", detail: "https://a.com/x", error: "502", started_at: now - 3 * HORA, finished_at: now - 3 * HORA + 1000 },
        { status: "ok", detail: "https://b.com/y", error: null, started_at: now - HORA, finished_at: now - HORA + 20000 },
      ],
      now
    );
    expect(s.totalCorridas).toBe(4);
    expect(s.totalOk).toBe(3);
    expect(s.totalErrores).toBe(1);
    expect(s.tasaExitoGlobal).toBe(75);
    const a = s.fuentes.find((f) => f.url === "https://a.com/x")!;
    expect(a.corridas).toBe(3);
    expect(a.ok).toBe(2);
    expect(a.errores).toBe(1);
    expect(a.tasaExito).toBe(67);
    expect(a.duracionMediaMs).toBe(4333); // (5000+7000+1000)/3
    expect(a.ultimoError).toBe("502");
    // Orden: más corridas primero.
    expect(s.fuentes[0].url).toBe("https://a.com/x");
  });

  it("excluye filas de más de 7 días y filas sin finished_at no rompen la duración", () => {
    const s = computeSalud(
      [
        { status: "ok", detail: "vieja", error: null, started_at: now - 8 * 24 * HORA, finished_at: now - 8 * 24 * HORA + 100 },
        { status: "ok", detail: "nueva", error: null, started_at: now - HORA, finished_at: null },
      ],
      now
    );
    expect(s.totalCorridas).toBe(1);
    expect(s.fuentes[0].duracionMediaMs).toBe(0);
  });

  it("ventana vacía devuelve todo en ceros sin dividir por cero", () => {
    const s = computeSalud([], now);
    expect(s.totalCorridas).toBe(0);
    expect(s.tasaExitoGlobal).toBe(0);
    expect(s.duracionMediaMs).toBe(0);
    expect(s.fuentes).toEqual([]);
  });
});
