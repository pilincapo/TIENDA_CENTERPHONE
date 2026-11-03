// Entrada de las páginas legales (política de cambios/devoluciones y privacidad).
// Las páginas son HTML estático: acá solo se completa lo que depende de la
// configuración del panel (marca del header y footer compartido), para no
// duplicar esos datos en el HTML.
//
// El CTA de arrepentimiento es un enlace interno a /devoluciones (el formulario
// de la ETAPA 2), así que no necesita datos del panel.

import type { PublicSettings } from "./types-web";
import { fillStoreInfo } from "./store-modals";
import { mountSiteFooter } from "./site-footer";

async function loadSettings(): Promise<PublicSettings | null> {
  try {
    const res = await fetch("/api/public/settings");
    return res.ok ? ((await res.json()) as PublicSettings) : null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  if (!settings) return;
  fillStoreInfo(settings);
  mountSiteFooter(settings);
}

void init();
