// Arranque del panel: sesión, login/logout, cierre por inactividad y
// navegación por hash.
//
// Parte de la SPA del panel (src/web/admin.ts): cada archivo es una pestaña o
// una pieza compartida; el estado vive donde se usa.

import { initFormLabels } from "../form-labels";
import { api, el, mostrarBannerPendiente, pendiente, publicarAhora } from "./ui";
import { render } from "./router";

export async function showLogin(): Promise<void> {
  el.login.hidden = false;
  el.app.hidden = true;
  idleLoggedOut = false; // nueva sesión, reinicio el contador de inactividad
  lastActivity = Date.now();
  await applyStoreName();
}

// Nombre de la tienda desde la config pública: título de la pestaña + login.
async function applyStoreName(): Promise<void> {
  try {
    const res = await fetch("/api/public/settings");
    if (!res.ok) return;
    const s = (await res.json()) as { storeName?: string };
    if (s.storeName) {
      document.title = `Admin — ${s.storeName}`;
      const span = document.getElementById("login-store");
      if (span) span.textContent = s.storeName;
    }
  } catch {
    /* sin nombre: quedan los textos genéricos */
  }
}

export async function checkSession(): Promise<boolean> {
  try {
    await api("/session");
    return true;
  } catch {
    return false;
  }
}
export async function boot(): Promise<void> {
  // Etiquetas de los formularios asociadas a sus campos (login incluido): una
  // sola vez acá y el observer del módulo cubre vistas y modales que se pintan
  // después.
  initFormLabels();
  // Banner de "cambios sin publicar": publicar a mano o descartar el aviso.
  pendiente.publish?.addEventListener("click", () => void publicarAhora());
  pendiente.dismiss?.addEventListener("click", () => mostrarBannerPendiente(false));
  await applyStoreName();
  if (await checkSession()) {
    el.login.hidden = true;
    el.app.hidden = false;
    void render();
  } else {
    await showLogin();
  }
}
// ---- Cierre de sesión por inactividad (1 hora) ----
// Con actividad (clic/tecla/scroll en el panel) el servidor renueva la sesión
// sola (sliding); el aviso aparece solo si de verdad pasaste 55 min sin tocar nada.
const IDLE_LIMIT_MS = 60 * 60 * 1000;      // logout a la hora de inactividad
const IDLE_WARN_MS = 55 * 60 * 1000;       // aviso 5 min antes
let lastActivity = Date.now();
let idleLoggedOut = false;

/** Engancha login, logout, inactividad y navegación, y arranca el panel. */
export function startPanel(): void {
  el.loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    el.loginError.hidden = true;
    try {
      await api("/login", {
        method: "POST",
        body: JSON.stringify({ password: el.loginPassword.value }),
      });
      el.loginPassword.value = "";
      el.login.hidden = true;
      el.app.hidden = false;
      void render();
    } catch {
      el.loginError.textContent = "Contraseña incorrecta";
      el.loginError.hidden = false;
    }
  });

  el.logout.addEventListener("click", async () => {
    await api("/logout", { method: "POST" }).catch(() => null);
    await showLogin();
  });


  for (const ev of ["click", "keydown", "mousemove", "scroll", "touchstart"] as const) {
    document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true });
  }
  setInterval(async () => {
    if (idleLoggedOut || el.app.hidden) return;
    const idle = Date.now() - lastActivity;
    if (idle >= IDLE_LIMIT_MS) {
      idleLoggedOut = true;
      await api("/logout", { method: "POST" }).catch(() => null);
      await showLogin();
      el.loginError.textContent = "Cerramos tu sesión por inactividad (1 hora). Volvé a ingresar.";
      el.loginError.hidden = false;
    } else if (idle >= IDLE_WARN_MS) {
      const mins = Math.max(1, Math.round((IDLE_LIMIT_MS - idle) / 60000));
      el.loginError.textContent = `Tu sesión se va a cerrar en ~${mins} min por inactividad. Mové el mouse o tocá algo para seguir.`;
      el.loginError.hidden = false;
    }
  }, 30_000);

  window.addEventListener("hashchange", () => {
    if (!el.app.hidden) void render();
  });
  void boot();
}

