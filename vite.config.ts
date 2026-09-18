import { defineConfig } from "vite";

// Empaqueta la SPA pública y el panel admin a /public.
// El worker (wrangler) sirve esa carpeta como assets estáticos.
export default defineConfig({
  appType: "mpa",
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "index.html",
        product: "product.html",
        admin: "admin/index.html",
      },
    },
  },
});
