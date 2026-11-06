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
        // Páginas legales: HTML estático con el mismo styles.css. El worker las
        // sirve en la ruta limpia (ver src/worker/index.ts).
        devoluciones: "politica-de-cambios-y-devoluciones.html",
        privacidad: "politica-de-privacidad.html",
        // Formulario de solicitudes (ETAPA 2), también en su ruta limpia.
        solicitud: "devoluciones.html",
        // Club de socios: página pública con alta gratuita (/club).
        club: "club.html",
        // Reseñas de Google curadas desde el panel (/resenas).
        resenas: "resenas.html",
      },
    },
  },
});
