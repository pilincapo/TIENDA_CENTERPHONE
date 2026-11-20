// Pestaña Categorías: árbol, alta y edición.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import type { Category, Order, OrderStatus, Product, StoreSettings, SyncLogEntry } from "../../shared/types";
import { esc } from "../../shared/html";
import { api, el, marcarSinPublicar, openModal, toast } from "./ui";
import { render } from "./router";


export async function viewCategories(): Promise<void> {
  const { categories, counts } = await api<{ categories: Category[]; counts: Record<string, { total: number; published: number }> }>("/categories");
  const roots = categories.filter((c) => c.parentId === null);
  const nameOf = (id: string | null): string =>
    id ? (categories.find((c) => c.id === id)?.name ?? id) : "—";
  // Conteo por categoría; las categorías padre suman también sus subcategorías.
  const countOf = (id: string): { total: number; published: number } => {
    const own = counts[id] ?? { total: 0, published: 0 };
    const children = categories.filter((c) => c.parentId === id);
    const sub = children.reduce(
      (acc, ch) => {
        const s = counts[ch.id] ?? { total: 0, published: 0 };
        return { total: acc.total + s.total, published: acc.published + s.published };
      },
      { total: 0, published: 0 }
    );
    return { total: own.total + sub.total, published: own.published + sub.published };
  };
  el.view.innerHTML = `
    <div class="panel">
      <div class="row">
        <h2 style="margin:0">Categorías (${categories.length})</h2>
        <button class="btn btn-primary" id="new-cat" style="margin-left:auto">+ Nueva categoría</button>
      </div>
      ${categories.length === 0 ? '<p class="muted">No hay categorías.</p>' : `
      <div class="table-scroll">
      <table class="table" style="margin-top:14px">
        <thead><tr><th>Nombre</th><th>Productos</th><th>Padre</th><th>Activa</th><th></th></tr></thead>
        <tbody>
          ${categories.map((c) => {
            const n = countOf(c.id);
            return `
            <tr>
              <td><strong>${esc(c.name)}</strong> <span class="muted">(${esc(c.id)})</span></td>
              <td><span class="badge">${n.total}</span>${n.published !== n.total ? ` <span class="muted" style="font-size:12px" title="Publicados de ${n.total}">${n.published} pub.</span>` : ""}</td>
              <td>${esc(nameOf(c.parentId))}</td>
              <td class="${c.active ? "ok" : "muted"}">${c.active ? "Sí" : "No"}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-cat-edit" data-id="${esc(c.id)}">Editar</button>
                <button class="btn btn-danger btn-cat-del" data-id="${esc(c.id)}">Borrar</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`}
      </div>
    </div>`;
  el.view.querySelector("#new-cat")?.addEventListener("click", () => void openCategoryForm(null, roots));
  el.view.querySelectorAll(".btn-cat-edit").forEach((b) => {
    b.addEventListener("click", () => {
      const c = categories.find((x) => x.id === (b as HTMLElement).dataset.id);
      if (c) void openCategoryForm(c, roots);
    });
  });
  el.view.querySelectorAll(".btn-cat-del").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.id;
      if (!id || !confirm("¿Borrar esta categoría? Los productos quedarán sin categoría.")) return;
      try {
        await api(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Categoría borrada (se publica al sincronizar)");
        marcarSinPublicar();
      } catch (e) {
        toast(e instanceof Error ? e.message : "Error", false);
      }
      void render();
    });
  });
}

async function openCategoryForm(c: Category | null, roots: Category[]): Promise<void> {
  const back = openModal(`
    <h2>${c ? "Editar categoría" : "Nueva categoría"}</h2>
    <form id="c-form">
      <div class="field"><label>Nombre</label><input name="name" required value="${esc(c?.name ?? "")}"/></div>
      <div class="field"><label>Padre</label>
        <select name="parentId"><option value="">— (raíz)</option>
          ${roots.filter((r) => r.id !== c?.id).map((r) => `<option value="${esc(r.id)}" ${c?.parentId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
        </select></div>
      <div class="field"><label class="checks"><input type="checkbox" name="active" ${c?.active !== false ? "checked" : ""}/> Activa (visible en filtros)</label></div>
      <p class="error" id="c-error" hidden></p>
      <div class="row">
        <button type="submit" class="btn btn-primary">Guardar</button>
        <button type="button" class="btn btn-cancel">Cancelar</button>
      </div>
    </form>`);
  const form = back.querySelector("#c-form") as HTMLFormElement;
  back.querySelector(".btn-cancel")?.addEventListener("click", () => back.remove());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = {
      name: String(fd.get("name") ?? ""),
      parentId: String(fd.get("parentId") ?? "") || null,
      active: fd.get("active") === "on",
    };
    try {
      if (c) await api(`/categories/${encodeURIComponent(c.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/categories", { method: "POST", body: JSON.stringify(body) });
      back.remove();
      toast("Categoría guardada (se publica al sincronizar)");
      marcarSinPublicar();
      void render();
    } catch (e) {
      const errEl = back.querySelector("#c-error") as HTMLElement;
      errEl.textContent = e instanceof Error ? e.message : "Error";
      errEl.hidden = false;
    }
  });
}

