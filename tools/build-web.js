#!/usr/bin/env node
// Post-build: 404.html para el routing client-side y copia de los archivos de marca.
// (vite build usa emptyOutDir y limpia public/ entera, por eso hay que recopiarlos.)
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dist = "public";
const index = readFileSync(join(dist, "index.html"), "utf8");

const notFound = index.replace(
  /<title>.*?<\/title>/,
  "<title>404 — No encontrado</title>"
);

writeFileSync(join(dist, "404.html"), notFound);
console.log("✔ public/404.html generado");

// Archivos de marca (favicon + logo) que se sirven desde la raíz.
mkdirSync(dist, { recursive: true });
for (const f of ["favicon.png", "logo.jpg"]) {
  copyFileSync(join("brand", f), join(dist, f));
}
console.log("✔ favicon.png y logo.jpg copiados a public/");
