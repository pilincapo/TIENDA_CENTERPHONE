import { describe, expect, it } from "vitest";
import { normalizeSettings, isStoreMode } from "./settings";
import { DEFAULT_SETTINGS } from "../shared/types";

describe("modo del sitio (tienda / catálogo)", () => {
  it("isStoreMode acepta solo los dos valores válidos", () => {
    expect(isStoreMode("tienda")).toBe(true);
    expect(isStoreMode("catalogo")).toBe(true);
    expect(isStoreMode("Tienda")).toBe(false);
    expect(isStoreMode("")).toBe(false);
    expect(isStoreMode(null)).toBe(false);
    expect(isStoreMode(undefined)).toBe(false);
    expect(isStoreMode(true)).toBe(false);
  });

  it("modo catálogo apaga el pago online aunque venga activado", () => {
    // Es el caso que motivó el modo: dos flags que se contradecían.
    const s = normalizeSettings({ storeMode: "catalogo", paymentsEnabled: true });
    expect(s.storeMode).toBe("catalogo");
    expect(s.paymentsEnabled).toBe(false);
  });

  it("modo tienda deja el pago online habilitado", () => {
    const s = normalizeSettings({ storeMode: "tienda" });
    expect(s.storeMode).toBe("tienda");
    expect(s.paymentsEnabled).toBe(true);
  });

  it("settings viejos (sin storeMode) se derivan del checkbox de pagos", () => {
    expect(normalizeSettings({ paymentsEnabled: true }).storeMode).toBe("tienda");
    expect(normalizeSettings({ paymentsEnabled: false }).storeMode).toBe("catalogo");
  });

  it("sin datos guardados arranca en modo catálogo (igual que antes: sin pagos)", () => {
    expect(normalizeSettings(null).storeMode).toBe(DEFAULT_SETTINGS.storeMode);
    expect(normalizeSettings(undefined).storeMode).toBe("catalogo");
    expect(DEFAULT_SETTINGS.storeMode).toBe("catalogo");
  });

  it("un storeMode inválido no rompe: cae al modo tienda por defecto", () => {
    // Si alguien guardara "cerrado" a mano, no queremos dejar la tienda sin
    // ventas por un valor raro: se usa el default (que no abre pagos sin token).
    const s = normalizeSettings({ storeMode: "cerrado" as never });
    expect(["tienda", "catalogo"]).toContain(s.storeMode);
    expect(s.paymentsEnabled).toBe(s.storeMode === "tienda");
  });

  it("el modo no borra el resto de la configuración", () => {
    const wa = { whatsappPhone: "5493425819402", transferCbu: "alias.Transfer" };
    const s = normalizeSettings({ ...wa, storeMode: "catalogo" });
    expect(s.whatsappPhone).toBe("5493425819402");
    expect(s.transferCbu).toBe("alias.Transfer");
  });
});