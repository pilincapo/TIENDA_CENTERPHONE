// Pestaña Novedades: changelog.md renderizado.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import { api, el } from "./ui";

// ---- Changelog (pestaña "Cambios") ----

/** Markdown mínimo → HTML seguro: títulos ##, ítems -, **negrita**, `código`.
 *  El contenido viene del changelog.md propio (texto confiable), pero se escapa
 *  igual por si algún día se pega algo con caracteres especiales. */
function changelogMarkdownToHtml(md: string): string {
  const inline = (s: string): string => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) {
      out.push(`<h3 class="cl-title">${inline(line.replace(/^##\s+/, ""))}</h3>`);
    } else if (/^-\s+/.test(line)) {
      out.push(`<li>${inline(line.replace(/^-\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      // Cierre de lista: los <li> sueltos se agrupan al final por el navegador,
      // pero mejor cerrar manualmente cuando la línea anterior era un ítem.
      if (out.length > 0 && out[out.length - 1]!.startsWith("<li>")) out.push("</ul>");
    } else {
      if (out.length > 0 && out[out.length - 1]!.startsWith("<li>") && !out.includes("</ul>")) out.push("</ul>");
      out.push(`<p class="cl-p">${inline(line)}</p>`);
    }
  }
  // Convertir los <li> sueltos en listas: envolver cada tanda.
  const html: string[] = [];
  let inList = false;
  for (const piece of out) {
    if (piece.startsWith("<li>")) {
      if (!inList) { html.push("<ul class=\"cl-list\">"); inList = true; }
      html.push(piece);
    } else if (piece === "</ul>") {
      if (inList) { html.push("</ul>"); inList = false; }
    } else {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(piece);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("");
}

export async function viewChangelog(): Promise<void> {
  el.view.innerHTML = `<div class="panel"><h2>Cambios de la página</h2><p class="muted">Cargando…</p></div>`;
  try {
    const { markdown } = await api<{ markdown: string }>("/changelog");
    const entries = markdown
      .split(/^##\s+/m)
      .slice(1) // antes del primer ## solo suele haber nada
      .map((bloque) => {
        const nl = bloque.indexOf("\n");
        const titulo = bloque.slice(0, nl).trim();
        const cuerpo = bloque.slice(nl + 1);
        return { titulo, cuerpo };
      });
    el.view.innerHTML = `
      <div class="panel">
        <div class="row">
          <h2 style="margin:0">Cambios de la página</h2>
          <span class="muted" style="margin-left:auto">${entries.length} entradas — la más nueva arriba</span>
        </div>
        <div class="cl-entries">
          ${entries.map((e) => `
            <details class="cfg-group cl-entry" ${e === entries[0] ? "open" : ""}>
              <summary>${esc(e.titulo)}</summary>
              <div class="cfg-body">${changelogMarkdownToHtml(e.cuerpo)}</div>
            </details>`).join("")}
        </div>
      </div>`;
  } catch (e) {
    el.view.innerHTML = `<div class="panel"><p class="error">No se pudo cargar el changelog: ${esc(e instanceof Error ? e.message : "Error")}</p></div>`;
  }
}
