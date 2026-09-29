import { describe, expect, it } from "vitest";
import {
  CSP_TEMPLATE, isAllowedTrackOrigin, newNonce, securityHeaders, trackRequestHost,
} from "./security";

describe("newNonce", () => {
  it("genera hex de 32 chars y valores distintos en cada llamada", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("securityHeaders", () => {
  it("incluye todas las cabeceras de seguridad con el nonce interpolado", () => {
    const h = securityHeaders("abc123");
    expect(h["Content-Security-Policy"]).toContain("script-src 'self' 'nonce-abc123'");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("la plantilla CSP no deja placeholder sin reemplazar", () => {
    expect(CSP_TEMPLATE).toContain("%NONCE%");
    expect(securityHeaders("x")["Content-Security-Policy"]).not.toContain("%NONCE%");
  });

  it("permite el beacon de Cloudflare Web Analytics (inyectado en producción)", () => {
    const csp = securityHeaders("x")["Content-Security-Policy"];
    expect(csp).toContain("https://static.cloudflareinsights.com");
  });
});

describe("trackRequestHost", () => {
  it("extrae el host de Origin", () => {
    expect(trackRequestHost("https://centerphone.com.ar", undefined)).toBe("centerphone.com.ar");
  });
  it("cae a Referer si no hay Origin", () => {
    expect(trackRequestHost(undefined, "https://centerphone.com.ar/producto/x")).toBe("centerphone.com.ar");
  });
  it("devuelve null sin cabeceras o con URL inválida", () => {
    expect(trackRequestHost(undefined, undefined)).toBe(null);
    expect(trackRequestHost("no-es-una-url", undefined)).toBe(null);
  });
});

describe("isAllowedTrackOrigin", () => {
  it("acepta dominios propios (apex y www)", () => {
    expect(isAllowedTrackOrigin("https://centerphone.com.ar", undefined, "centerphone.com.ar")).toBe(true);
    expect(isAllowedTrackOrigin(undefined, "https://www.centerphone.com.ar/", "www.centerphone.com.ar")).toBe(true);
  });
  it("rechaza orígenes externos (inflado de métricas)", () => {
    expect(isAllowedTrackOrigin("https://evil.example", undefined, "centerphone.com.ar")).toBe(false);
    expect(isAllowedTrackOrigin(undefined, "https://evil.example/x", "centerphone.com.ar")).toBe(false);
  });
  it("rechaza sin Origin/Referer fuera de localhost (curl, bots)", () => {
    expect(isAllowedTrackOrigin(undefined, undefined, "centerphone.com.ar")).toBe(false);
  });
  it("acepta sin Origin/Referer solo en local (dev)", () => {
    expect(isAllowedTrackOrigin(undefined, undefined, "127.0.0.1:8788")).toBe(true);
    expect(isAllowedTrackOrigin(undefined, undefined, "localhost:8788")).toBe(true);
  });
});
