// Server estático temporal para mirar los mockups con el CSS real del sitio.
// No forma parte de la app: se usa sólo para sacar capturas.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const candidates = [path.join(root, p), path.join(root, "public", p)];
    const file = candidates.find((f) => !f.includes("..") && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 " + p);
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(fs.readFileSync(file));
  })
  .listen(8790, "127.0.0.1", () => console.log("mock server en http://127.0.0.1:8790"));
