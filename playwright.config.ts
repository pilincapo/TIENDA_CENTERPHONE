import { defineConfig, devices } from "@playwright/test";

// Pruebas visuales del catálogo: necesitan el sitio servido por wrangler
// (worker + assets), así que Playwright levanta el suyo en un puerto propio
// (8788) con el build recién hecho. No se reutiliza ninguno existente: tras
// un `npm run build`, un wrangler dev que ya esté corriendo se queda con el
// índice de assets viejo y sirve 404 (ver changelog).
export default defineConfig({
  testDir: "tests/visual",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8788",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run build && npx wrangler dev --port 8788",
    url: "http://127.0.0.1:8788",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
