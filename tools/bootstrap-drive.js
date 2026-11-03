"use strict";
import { mkdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
const dir = "PROYECTOS/TIENDA_CENTER";
try {
  mkdirSync(dir, { recursive: true });
  console.log("ok:" + resolvePath(dir));
} catch (e) {
  console.error("err:", e.code);
  process.exit(1);
}
