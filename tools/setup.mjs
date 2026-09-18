#!/usr/bin/env node
// Setup inicial de Cloudflare: crea D1, KV, aplica schema y seed, y configura secretos.
// Uso: npm run setup   (requiere `npx wrangler login` hecho antes)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function run(cmd, quiet = false) {
  return execSync(cmd, { encoding: "utf8", stdio: quiet ? ["pipe", "pipe", "pipe"] : "inherit" }).trim();
}

console.log("▶ Verificando sesión de wrangler…");
try {
  execSync("npx wrangler whoami", { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
} catch {
  console.error("✖ No hay sesión. Corré `npx wrangler login` primero.");
  process.exit(1);
}
console.log("✔ Sesión de wrangler activa");

const configPath = "wrangler.jsonc";
let config = readFileSync(configPath, "utf8");

// 1. Base de datos D1
if (config.includes("REPLACE_ME_RUN_NPM_RUN_SETUP")) {
  console.log("▶ Creando base de datos D1 celu-store-db…");
  let db;
  try {
    // d1 create no soporta --json: se extrae el id del output legible.
    const out = execSync("npx wrangler d1 create celu-store-db 2>nul", { encoding: "utf8", shell: true });
    db = { database_id: /"database_id":\s*"([a-f0-9-]+)"/.exec(out)?.[1] };
  } catch {
    db = { database_id: undefined };
  }
  if (!db.database_id) {
    // Quizá ya existía: buscar en d1 list.
    const list = execSync("npx wrangler d1 list --json 2>nul", { encoding: "utf8", shell: true }).trim();
    const start = list.indexOf("[");
    if (start >= 0) {
      const dbs = JSON.parse(list.slice(start));
      db.database_id = dbs.find((d) => d.name === "celu-store-db")?.uuid;
    }
  }
  if (!db.database_id) {
    console.error("✖ No se pudo crear/obtener la D1. Creala a mano y pegá el id en wrangler.jsonc.");
    process.exit(1);
  }
  config = config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${db.database_id}"`);
  console.log(`✔ D1 lista (${db.database_id})`);

  console.log("▶ Creando namespace KV CELU_KV…");
  let kvId;
  try {
    const out = execSync("npx wrangler kv namespace create CELU_KV 2>nul", { encoding: "utf8", shell: true });
    kvId = /"id":\s*"([a-f0-9]+)"/.exec(out)?.[1];
  } catch {
    kvId = undefined;
  }
  if (!kvId) {
    console.error("✖ No se pudo crear/obtener el KV. Crealo a mano y pegá el id en wrangler.jsonc.");
    process.exit(1);
  }
  config = config.replace(/"id":\s*"[^"]*"/, `"id": "${kvId}"`);
  console.log(`✔ KV listo (${kvId})`);
  writeFileSync(configPath, config);
} else {
  console.log("✔ wrangler.jsonc ya está configurado");
}

// 2. Schema + seed (remoto)
console.log("▶ Aplicando esquema en D1 remota…");
run("npx wrangler d1 execute celu-store-db --remote --file=db/schema.sql -y");
console.log("✔ Esquema aplicado");
console.log("▶ Cargando datos de ejemplo (11 celulares)…");
run("npx wrangler d1 execute celu-store-db --remote --file=db/seed.sql -y");
console.log("✔ Seed cargado (podés borrarlo desde el panel o con db/seed-clear.sql)");

// 3. Secretos
console.log("▶ Configurando secretos del worker…");
run(`echo admin| npx wrangler secret put ADMIN_PASSWORD`, true);
console.log("  ⚠ ADMIN_PASSWORD quedó como 'admin'. Cambiala YA con:");
console.log('     npx wrangler secret put ADMIN_PASSWORD');
run(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put ADMIN_SESSION_SECRET`, true);
console.log("✔ ADMIN_SESSION_SECRET generado al azar");

console.log(`
✔ Setup completo. Para desplegar:
    npm run deploy
  Después:
    - Entrá a https://celu-store.<tu-subdominio>.workers.dev/admin/
    - Cambiá la contraseña (comando de arriba), el número de WhatsApp y la URL de sync en Configuración.
`);
