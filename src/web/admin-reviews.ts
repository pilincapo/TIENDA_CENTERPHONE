// Pestaña RESEÑAS del panel: las opiniones de Google que se muestran en el sitio.
//
// Google no permite publicar reseñas desde otro sitio ni guardar las de su API
// (Places devuelve hasta 5 y prohíbe cachearlas), así que acá se copian a mano
// las que el local quiere destacar, con su autor y su fecha reales. El botón
// "Escribir una reseña" del sitio abre la ficha de Google.

import { esc } from "../shared/html";
import { MAX_REVIEW_BODY, MAX_REVIEW_REPLY, formatReviewRating, reviewDateLabel, type GoogleReview } from "../shared/reviews";

export interface ReviewsHost {
  root: HTMLElement;
  api: <T>(path: string, opts?: RequestInit) => Promise<T>;
  toast: (msg: string, ok?: boolean) => void;
}

interface ReviewsConfig {
  enabled: boolean;
  rating: number;
  count: number;
  reviewUrl: string;
  mapsUrl: string;
  storeAddress: string;
}

interface ReviewsData {
  reviews: GoogleReview[];
  config: ReviewsConfig;
  effectiveRating: number;
}

let formOpenFor: string | null = null; // id en edición; null = alta

/** Fecha para el input date (día argentino, no UTC). */
function dateInputValue(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function stars(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return `<span class="rv-stars" aria-hidden="true">${"★".repeat(full)}<span class="off">${"★".repeat(5 - full)}</span></span>`;
}

function formHtml(r: GoogleReview | null): string {
  return `
    <div class="panel" id="rv-form-panel">
      <div class="row" style="align-items:center;justify-content:space-between">
        <h2 style="margin:0">${r ? "Editar reseña" : "Agregar reseña"}</h2>
        <button type="button" class="btn" id="rv-form-cancel">Cancelar</button>
      </div>
      <p class="muted" style="margin-top:6px">Copiá el texto tal cual aparece en Google. No inventes reseñas: se muestran como opiniones reales del local.</p>
      <form id="rv-form">
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="field" style="flex:1;min-width:200px"><label>Nombre y apellido *</label><input name="author" maxlength="60" required value="${esc(r?.author ?? "")}"/></div>
          <div class="field" style="flex:1;min-width:180px"><label>Perfil en Google</label><input name="authorMeta" maxlength="60" placeholder="Local Guide · 24 reseñas" value="${esc(r?.authorMeta ?? "")}"/></div>
        </div>
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="field"><label>Puntaje *</label>
            <select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${(r?.rating ?? 5) === n ? " selected" : ""}>${"★".repeat(n)} (${n})</option>`).join("")}</select>
          </div>
          <div class="field"><label>Fecha de la reseña</label><input name="reviewedAt" type="date" value="${dateInputValue(r?.reviewedAt ?? null)}"/></div>
          <div class="field"><label>Orden</label><input name="sortOrder" type="number" min="-999" max="999" value="${r?.sortOrder ?? 0}" style="width:90px"/></div>
        </div>
        <div class="field"><label>Texto de la reseña</label><textarea name="body" rows="4" maxlength="${MAX_REVIEW_BODY}" placeholder="Lo que escribió el cliente…">${esc(r?.body ?? "")}</textarea></div>
        <div class="field"><label>Respuesta del local (opcional)</label><textarea name="localReply" rows="2" maxlength="${MAX_REVIEW_REPLY}" placeholder="Gracias por la visita…">${esc(r?.localReply ?? "")}</textarea></div>
        <div class="row" style="gap:18px;align-items:center;margin:8px 0 12px">
          <label class="field field--check" style="margin:0"><input type="checkbox" name="featured" ${r?.featured ? "checked" : ""}/> Destacada (va primero)</label>
          <label class="field field--check" style="margin:0"><input type="checkbox" name="active" ${r?.active === false ? "" : "checked"}/> Visible en el sitio</label>
        </div>
        <p class="error" id="rv-form-error" hidden></p>
        <div class="row"><button type="submit" class="btn btn-primary">${r ? "Guardar cambios" : "Agregar reseña"}</button></div>
      </form>
    </div>`;
}

export async function viewReviews(host: ReviewsHost): Promise<void> {
  const data = await host.api<ReviewsData>("/google-reviews");
  const c = data.config;
  const on = c.enabled;
  const shown = formatReviewRating(data.effectiveRating);

  const rows = data.reviews
    .map((r) => {
      const when = r.reviewedAt === null ? "—" : `${dateInputValue(r.reviewedAt)} (${reviewDateLabel(r.reviewedAt)})`;
      const text = r.body.length > 90 ? `${r.body.slice(0, 90)}…` : r.body;
      return `
      <tr class="${r.active ? "" : "rv-row-off"}">
        <td>${esc(r.author)}${r.authorMeta ? `<br><small class="muted">${esc(r.authorMeta)}</small>` : ""}</td>
        <td>${stars(r.rating)} <span class="muted">${r.rating}</span></td>
        <td style="max-width:380px">${esc(text) || '<span class="muted">(sólo estrellas)</span>'}${r.featured ? ' <span class="badge badge--featured">destacada</span>' : ""}</td>
        <td>${esc(when)}</td>
        <td><label class="field field--check" style="margin:0"><input type="checkbox" data-rv-flag="featured" data-rv-id="${esc(r.id)}" ${r.featured ? "checked" : ""} aria-label="Destacar reseña de ${esc(r.author)}"/></label></td>
        <td><label class="field field--check" style="margin:0"><input type="checkbox" data-rv-flag="active" data-rv-id="${esc(r.id)}" ${r.active ? "checked" : ""} aria-label="Mostrar reseña de ${esc(r.author)}"/></label></td>
        <td class="ord-actions">
          <button type="button" class="btn" data-rv-edit="${esc(r.id)}">Editar</button>
          <button type="button" class="btn btn-danger" data-rv-del="${esc(r.id)}">Borrar</button>
        </td>
      </tr>`;
    })
    .join("");

  host.root.innerHTML = `
    <div class="panel">
      <div class="row" style="align-items:center;gap:12px">
        <h2 style="margin:0">⭐ Reseñas de Google</h2>
        <a class="btn" href="/resenas" target="_blank" rel="noopener">Ver página pública</a>
      </div>
      <p class="muted" style="margin-top:8px">Se muestran en la franja de la home, debajo del título de cada ficha y en <code>/resenas</code>. Google entrega hasta 5 reseñas por consulta y no permite guardarlas, así que las mejores se copian acá a mano (autor y fecha reales).</p>

      <div class="club-switch ${on ? "on" : "off"}">
        <div class="club-switch-text">
          <strong>${on ? "Reseñas visibles en todo el sitio" : "Reseñas apagadas"}</strong>
          <p class="muted">${on
            ? `Se ve ${shown ? `${shown} ★` : "el promedio"} con ${c.count} reseñas. El botón «Escribir una reseña» abre Google.`
            : "La franja, la línea de la ficha y /resenas quedan ocultas (la página responde con noindex)."}</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="rv-enabled" ${on ? "checked" : ""} aria-label="Mostrar reseñas de Google en el sitio"/>
          <span class="switch-ui" aria-hidden="true"></span>
          <span class="switch-text">${on ? "Visibles" : "Apagadas"}</span>
        </label>
      </div>

      <form id="rv-config" class="row" style="gap:12px;flex-wrap:wrap;align-items:flex-end;margin:16px 0">
        <div class="field" style="margin:0"><label>Promedio en Google</label>
          <input name="rating" type="number" min="0" max="5" step="0.1" value="${c.rating}" style="width:110px"/>
          <p class="field-hint">0 = calcularlo con las reseñas cargadas.</p>
        </div>
        <div class="field" style="margin:0"><label>Total de reseñas en Google</label>
          <input name="count" type="number" min="0" step="1" value="${c.count}" style="width:130px"/>
          <p class="field-hint">El número que muestra Maps, aunque acá haya menos.</p>
        </div>
        <div class="field" style="flex:1;min-width:260px;margin:0"><label>Link para escribir una reseña</label>
          <input name="reviewUrl" maxlength="500" placeholder="https://g.page/r/…/review" value="${esc(c.reviewUrl)}"/>
          <p class="field-hint">En Google Maps: «Compartir» → «Compartir enlace» de la ficha. Vacío = no se muestra el botón.</p>
        </div>
        <button class="btn" type="submit">Guardar configuración</button>
      </form>

      <div class="row" style="gap:8px;align-items:center;margin:6px 0 12px">
        <button class="btn btn-primary" id="rv-new">+ Agregar reseña</button>
        <span class="muted">${data.reviews.length} cargada${data.reviews.length === 1 ? "" : "s"} · ${data.reviews.filter((r) => r.active).length} visible${data.reviews.filter((r) => r.active).length === 1 ? "" : "s"}</span>
      </div>

      <div id="rv-form-slot"></div>

      <div class="table-wrap"><table class="table">
        <thead><tr><th>Autor</th><th>Puntaje</th><th>Reseña</th><th>Fecha</th><th title="Va primero en la lista">Destacada</th><th>Visible</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="muted">Todavía no cargaste reseñas. Copiá las mejores de Google Maps con el botón «+ Agregar reseña».</td></tr>`}</tbody>
      </table></div>
    </div>`;

  const slot = host.root.querySelector<HTMLElement>("#rv-form-slot");
  const openForm = (r: GoogleReview | null): void => {
    formOpenFor = r?.id ?? null;
    if (!slot) return;
    slot.innerHTML = formHtml(r);
    slot.scrollIntoView({ block: "nearest", behavior: "smooth" });
    bindForm(r);
  };
  const closeForm = (): void => {
    formOpenFor = null;
    if (slot) slot.innerHTML = "";
  };

  function bindForm(r: GoogleReview | null): void {
    const form = slot?.querySelector<HTMLFormElement>("#rv-form");
    slot?.querySelector("#rv-form-cancel")?.addEventListener("click", closeForm);
    form?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const err = slot?.querySelector<HTMLElement>("#rv-form-error");
      if (err) err.hidden = true;
      const payload = {
        author: fd.get("author"),
        authorMeta: fd.get("authorMeta"),
        rating: Number(fd.get("rating")),
        reviewedAt: fd.get("reviewedAt"),
        body: fd.get("body"),
        localReply: fd.get("localReply"),
        featured: fd.get("featured") === "on",
        active: fd.get("active") === "on",
        sortOrder: Number(fd.get("sortOrder") ?? 0),
      };
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        if (r) {
          await host.api(`/google-reviews/${encodeURIComponent(r.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
          host.toast("Reseña actualizada");
        } else {
          await host.api("/google-reviews", { method: "POST", body: JSON.stringify(payload) });
          host.toast("Reseña agregada");
        }
        await viewReviews(host);
      } catch (e) {
        if (err) {
          err.textContent = e instanceof Error ? e.message : "No se pudo guardar";
          err.hidden = false;
        }
        if (btn) btn.disabled = false;
      }
    });
  }

  host.root.querySelector("#rv-new")?.addEventListener("click", () => openForm(null));

  host.root.querySelectorAll<HTMLButtonElement>("[data-rv-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = data.reviews.find((x) => x.id === b.dataset.rvEdit) ?? null;
      if (r) openForm(r);
    }),
  );

  host.root.querySelectorAll<HTMLButtonElement>("[data-rv-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const r = data.reviews.find((x) => x.id === b.dataset.rvDel);
      if (!r) return;
      if (!confirm(`¿Borrar la reseña de ${r.author}? El sitio deja de mostrarla al instante.`)) return;
      b.disabled = true;
      try {
        await host.api(`/google-reviews/${encodeURIComponent(r.id)}`, { method: "DELETE" });
        host.toast("Reseña borrada");
        await viewReviews(host);
      } catch (e) {
        b.disabled = false;
        host.toast(e instanceof Error ? e.message : "No se pudo borrar", false);
      }
    }),
  );

  // Destacar / ocultar sin abrir el formulario.
  host.root.querySelectorAll<HTMLInputElement>("[data-rv-flag]").forEach((input) =>
    input.addEventListener("change", async () => {
      const flag = input.dataset.rvFlag;
      const id = input.dataset.rvId ?? "";
      if (!flag || !id) return;
      input.disabled = true;
      try {
        await host.api(`/google-reviews/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ [flag]: input.checked }),
        });
        host.toast(flag === "featured" ? (input.checked ? "Reseña destacada" : "Ya no está destacada") : input.checked ? "Reseña visible" : "Reseña oculta");
        await viewReviews(host);
      } catch (e) {
        input.checked = !input.checked;
        input.disabled = false;
        host.toast(e instanceof Error ? e.message : "No se pudo cambiar", false);
      }
    }),
  );

  host.root.querySelector<HTMLInputElement>("#rv-enabled")?.addEventListener("change", async (ev) => {
    const input = ev.currentTarget as HTMLInputElement;
    input.disabled = true;
    try {
      const r = await host.api<{ config: { enabled: boolean } }>("/google-reviews/config", {
        method: "PATCH",
        body: JSON.stringify({ enabled: input.checked }),
      });
      host.toast(r.config.enabled ? "Reseñas visibles en el sitio" : "Reseñas apagadas");
      await viewReviews(host);
    } catch (e) {
      input.checked = !input.checked;
      input.disabled = false;
      host.toast(e instanceof Error ? e.message : "No se pudo cambiar", false);
    }
  });

  host.root.querySelector<HTMLFormElement>("#rv-config")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget as HTMLFormElement;
    const fd = new FormData(form);
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await host.api("/google-reviews/config", {
        method: "PATCH",
        body: JSON.stringify({
          rating: Number(fd.get("rating") ?? 0),
          count: Number(fd.get("count") ?? 0),
          reviewUrl: String(fd.get("reviewUrl") ?? ""),
        }),
      });
      host.toast("Configuración guardada");
      await viewReviews(host);
    } catch (e) {
      host.toast(e instanceof Error ? e.message : "No se pudo guardar", false);
      if (btn) btn.disabled = false;
    }
  });
}
