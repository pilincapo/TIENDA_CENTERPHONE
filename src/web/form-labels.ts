// Accesibilidad de los formularios del panel (WCAG 1.3.1 / 4.1.2).
//
// Las plantillas del panel escriben la etiqueta suelta, sin `for` ni `id`:
//   <div class="field"><label>Título</label><input name="title"/></div>
// Un `label` así no está asociado a nada: el lector de pantalla anuncia el campo
// como "cuadro de texto" sin nombre y el clic (o el toque) en el texto no enfoca
// el input. En vez de tocar las ~50 plantillas —y olvidarse de las que se agreguen
// después— la asociación se hace sobre el DOM ya pintado, con un observer que
// cubre también modales, vistas y filas creadas en el momento.

// Campos que necesitan nombre accesible: se excluyen los ocultos y los botones,
// que ya se anuncian con su propio texto.
const CAMPOS =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea';

let secuencia = 0;

/** ¿El campo ya tiene nombre accesible? (el `<label>` que lo envuelve, aria-label/labelledby o title). */
function tieneNombre(el: Element): boolean {
  return (
    el.closest("label") !== null ||
    el.hasAttribute("aria-label") ||
    el.hasAttribute("aria-labelledby") ||
    el.hasAttribute("title")
  );
}

/** Id del campo, único en el documento (el `for` del label apunta a un solo elemento). */
function idUnico(el: HTMLElement): string {
  const base = (el.getAttribute("name") ?? "").replace(/[^\w-]/g, "") || `c${++secuencia}`;
  let id = `fl-${base}`;
  let n = 1;
  while (document.getElementById(id) !== null) id = `fl-${base}-${++n}`;
  return id;
}

/**
 * Asocia etiquetas y campos dentro de `scope`, y le da un nombre accesible a los
 * campos que no tienen ninguno. Idempotente: se puede correr varias veces.
 */
export function linkFormLabels(scope: ParentNode = document): void {
  // 1) Etiqueta suelta → el campo del mismo contenedor. Se mira primero el
  //    contenedor directo y recién después el `.field` completo: en la fila
  //    peso/volumen los dos labels viven en el mismo `.field` y cada uno tiene
  //    que apuntar a su propio input, no los dos al primero.
  for (const label of scope.querySelectorAll<HTMLLabelElement>("label:not([for])")) {
    if (label.querySelector(CAMPOS) !== null) continue; // ya asocia por envoltura
    const campo =
      label.parentElement?.querySelector<HTMLElement>(CAMPOS) ??
      label.closest(".field")?.querySelector<HTMLElement>(CAMPOS) ??
      null;
    if (campo === null || tieneNombre(campo)) continue;
    campo.id = campo.id !== "" ? campo.id : idUnico(campo);
    label.htmlFor = campo.id;
  }

  // 2) Campos sin etiqueta visible (buscadores, filtros, filas de la escala de
  //    precios): se les da como nombre el texto que el usuario ya ve ahí.
  for (const campo of scope.querySelectorAll<HTMLElement>(CAMPOS)) {
    if (tieneNombre(campo)) continue;
    const texto = (campo.getAttribute("placeholder") ?? "").trim();
    if (texto !== "") campo.setAttribute("aria-label", texto);
  }
}

/**
 * Corre la asociación sobre lo que ya está en el DOM y la mantiene al día en
 * todo lo que se pinte después. Una sola llamada al arrancar el panel.
 */
export function initFormLabels(): void {
  linkFormLabels(document);
  new MutationObserver((records) => {
    const contenedores = new Set<Element>();
    for (const r of records) {
      if (r.target instanceof Element) contenedores.add(r.target);
    }
    for (const cont of contenedores) linkFormLabels(cont);
  }).observe(document.body, { childList: true, subtree: true });
}
