import { describe, expect, it } from "vitest";
import { isDueNow, nowArgentina } from "./autoimport";
import type { AutoImport } from "../shared/autoimport";

const job = (times: string[], active = true): AutoImport => ({
  id: "t1", url: "https://x", label: "", priceRuleId: null, times, active, lastRunAt: null, lastStatus: null,
});

describe("auto-importaciones", () => {
  it("nowArgentina devuelve HH:MM válido", () => {
    expect(nowArgentina()).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
  it("isDueNow matchea la hora entera al tick del cron horario (minute=0)", () => {
    // El cron corre a las XX:00 exactas; el horario "08:00" dispara en ese tick.
    expect(isDueNow(job(["08:00", "20:00"]), "08:00")).toBe(true);
    expect(isDueNow(job(["08:00", "20:00"]), "20:00")).toBe(true);
    expect(isDueNow(job(["08:00"]), "08:01")).toBe(false);
    expect(isDueNow(job(["08:00"]), "07:59")).toBe(false);
    expect(isDueNow(job(["08:00"]), "09:00")).toBe(false);
  });
  it("horarios con minutos (legado) corren en su hora entera", () => {
    // Compatibilidad: un "09:10" viejo se ejecuta en el tick de las 09:00.
    expect(isDueNow(job(["09:10"]), "09:00")).toBe(true);
    expect(isDueNow(job(["21:45"]), "21:00")).toBe(true);
    expect(isDueNow(job(["21:45"]), "22:00")).toBe(false);
  });
  it("job inactivo o sin horarios nunca corre", () => {
    expect(isDueNow(job(["08:00"], false), "08:00")).toBe(false);
    expect(isDueNow(job([]), "08:00")).toBe(false);
  });
});
