// repairpro-guard — copia versionada del worker desplegado en Cloudflare
// (el código de repairpro no vive en este repo; esta es su única copia en git).
//
// Qué hace: se pone DELANTE de repairpro (custom domain) mediante la ruta
// `repairpro.centerphone.com.ar/*` de la zona centerphone.com.ar. Responde 404
// a las rutas que solo piden los escáneres (.env, .git, .php, wp-*, wlwmanifest,
// xmlrpc, phpmyadmin) y pasa el resto al worker original con fetch(request) —
// el patrón de encadenado ruta → custom domain que documenta Cloudflare.
//
// Deploy/actualización: subir este archivo como módulo ES a
//   PUT /accounts/{account_id}/workers/scripts/repairpro-guard
// con metadata { main_module: "index.js", compatibility_date: "2026-08-15",
// bindings: [], observability: { enabled: true, head_sampling_rate: 1 } }.
// Reversión: borrar la ruta de la zona (el tráfico vuelve directo a repairpro).
// Verificación: `curl -o /dev/null -w '%{http_code}' https://repairpro.centerphone.com.ar/.env`
// debe dar 404 y `/` debe dar 200.

const FRAGMENTOS = ['wp-login', 'wp-admin', 'wp-includes', 'wp-content', 'wlwmanifest', 'xmlrpc', 'phpmyadmin'];
function esSospechosa(pathname) {
  const p = pathname.toLowerCase();
  if (p.includes('.env') || p.includes('.git') || p.includes('.php')) return true;
  return FRAGMENTOS.some((f) => p.includes(f));
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (esSospechosa(url.pathname)) {
      console.log('seguridad: escaneo bloqueado (404)', JSON.stringify({ path: url.pathname }));
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return fetch(request);
  },
};
