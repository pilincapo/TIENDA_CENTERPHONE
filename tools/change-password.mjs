// Cambia la contraseña del admin y de una vez actualiza .dev.vars local si existe.
// Uso: node tools/change-password.mjs "NuevaClaveSegura"          (producción + .dev.vars)
//      node tools/change-password.mjs "NuevaClaveSegura" --local  (solo .dev.vars)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const pass = process.argv[2];
const localOnly = process.argv.includes("--local");
if (!pass || pass.length < 8) {
  console.error("Usá una contraseña de al menos 8 caracteres: node tools/change-password.mjs \"ClaveSegura123\"");
  process.exit(1);
}

// 1) .dev.vars local (si existe): reemplaza o agrega ADMIN_PASSWORD.
const varsPath = ".dev.vars";
if (existsSync(varsPath)) {
  let content = readFileSync(varsPath, "utf8");
  const re = /^ADMIN_PASSWORD=.*$/m;
  if (re.test(content)) content = content.replace(re, `ADMIN_PASSWORD=${pass}`);
  else content += `\nADMIN_PASSWORD=${pass}\n`;
  writeFileSync(varsPath, content);
  console.log("✔ .dev.vars actualizado (local).");
} else {
  console.log("· No hay .dev.vars local, se omite.");
}

// 2) Producción (a menos que --local).
if (!localOnly) {
  const { execSync } = await import("node:child_process");
  execSync(`npx wrangler secret put ADMIN_PASSWORD`, { input: pass + "\n", stdio: "inherit" });
  console.log("✔ Secret de producción actualizado. El cambio es inmediato en Cloudflare.");
}
