// Estado chico que comparten dos pestañas y no pertenece a ninguna.
//
// Va en un objeto porque un `let` importado no se puede asignar desde otro
// módulo: las pestañas que lo necesitan leen y escriben estos campos.

export const uiState = {
  /** "Programar actualización" en Importar salta a Auto-importaciones con esto. */
  pendingAutoFuente: null as "url" | "tecnova" | null,
  /** Volver a enfocar el buscador después de un re-render (editar, borrar, paginar). */
  refocusSearch: false,
};
