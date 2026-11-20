// Ruteo por hash y render serializado de la vista activa.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { esc } from "../../shared/html";
import { viewReviews } from "../admin-reviews";
import { api, el, refrescarEstadoCatalogo, setTabHighlight, toast } from "./ui";
import { boot, checkSession, showLogin } from "./boot";
import { viewDashboard } from "./dashboard";
import { viewProducts } from "./products";
import { viewCategories } from "./categories";
import { viewImport } from "./import";
import { viewRules } from "./rules";
import { viewAutoImports } from "./autoimports";
import { viewOrders } from "./orders";
import { viewReturns } from "./returns";
import { viewClub } from "./club";
import { viewSettings } from "./settings";
import { viewChangelog } from "./changelog";
import { viewSeguridad } from "./security";
import { viewStats } from "./stats";

export function route(): string {
  return location.hash.replace("#", "") || "dashboard";
}

// Guardia de edición: true cuando hay cambios sin guardar en Configuración.
// Se arma al tocar un campo, se desarma al guardar bien o al volver a los valores originales.
let dirtyGuardArmed = false;

// Token de render: cada navegación incrementa el contador. Una vista async que
// haga `await` (fetcheos) compara su token con el vigente al retomar: si cambió,
// significa que el usuario ya navegó a otra vista y el DOM de `#view` ya no es
// Render serializado: solo puede correr UN render a la vez. Al cargar el panel
// con sesión abierta se disparan dos a la vez —`boot()` (porque checkSession()
// es true) y `hashchange` (porque el hash pasa de vacío a #settings)— y si
// corren en paralelo se pisan: el perdedor engancha listeners contra nodos que
// el ganador ya reemplazó, y eso era el "addEventListener of null" intermitente
// que rompía Configuración. Acá la segunda llamada espera a la primera y, si
// llegan varias, se ejecuta solo la última (la más reciente).
let renderEnCurso: Promise<void> | null = null;

export async function render(): Promise<void> {
  // Guardia de cambios sin guardar: se chequea ANTES de tocar el DOM, porque
  // `renderSerial` pisa #view con el spinner apenas arranca.
  if (dirtyGuardArmed && el.view.querySelector("#s-form")) {
    const seguir = confirm("Hay cambios sin guardar en Configuración. Si cambiás de pestaña ahora, se pierden.\n\n¿Querés salir igual?");
    if (!seguir) {
      // La URL quedó en la pestaña elegida pero la vista sigue en Configuración:
      // se re-alinea el hash para que queden coherentes.
      if (route() !== "settings") {
        history.replaceState(null, "", "#settings");
        setTabHighlight("settings");
      }
      return;
    }
    dirtyGuardArmed = false;
  }
  // Si ya hay un render corriendo, esperar a que termine (`.finally`) antes de
  // arrancar el nuestro: nunca dos renders en paralelo. Si llegan varias
  // llamadas en cascada, cada una espera a la anterior y recién entonces lee
  // `route()`, así la última pinta el estado final.
  const anterior = renderEnCurso;
  const mio = (anterior ? anterior.then(() => renderSerial()) : renderSerial());
  renderEnCurso = mio.catch(() => {});
  return mio;
}

async function renderSerial(): Promise<void> {
  const tab = route();
  setTabHighlight(tab);
  el.view.innerHTML = `<div class="state"><div class="spinner"></div></div>`;
  try {
    if (tab === "products") await viewProducts();
    // Compat: la pestaña "Sin stock" ahora vive como filtro dentro de Productos.
    else if (tab === "hidden") await viewProducts("hidden");
    else if (tab === "categories") await viewCategories();
    else if (tab === "import") await viewImport();
    else if (tab === "rules") await viewRules();
    else if (tab === "auto") await viewAutoImports();
    else if (tab === "stats") await viewStats();
    else if (tab === "orders") await viewOrders();
    else if (tab === "returns") await viewReturns();
    else if (tab === "club") await viewClub();
    else if (tab === "reviews") await viewReviews({ root: el.view, api, toast });
    else if (tab === "settings") await viewSettings();
    else if (tab === "changelog") await viewChangelog();
    else if (tab === "seguridad") await viewSeguridad();
    else await viewDashboard();
  } catch (e) {
    if (e instanceof Error && e.message === "unauthorized") return showLogin();
    el.view.innerHTML = `<div class="panel"><p class="error">${esc(e instanceof Error ? e.message : String(e))}</p></div>`;
  }
  // El banner de "sin publicar" es global: se refresca al cambiar de pestaña
  // (dos KV.get chicos) para no quedar desactualizado si se editó en otro lado.
  void refrescarEstadoCatalogo();
}

/** Arma o desarma la guardia de cambios sin guardar (Configuración). */
export function setDirtyGuardArmed(v: boolean): void {
  dirtyGuardArmed = v;
}

