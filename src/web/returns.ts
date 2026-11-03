// Entrada de /devoluciones: formulario de arrepentimiento, cambio, devolución
// y garantía (ETAPA 2).
//
// El formulario no exige registro ni justificar el motivo. El worker valida
// todo de nuevo (el navegador solo evita un viaje en balde) y devuelve el
// código de seguimiento, que se muestra en pantalla para copiar.

import type { PublicSettings } from "./types-web";
import { fillStoreInfo } from "./store-modals";
import { mountSiteFooter } from "./site-footer";

interface CreateResponse {
  ok?: boolean;
  code?: string;
  token?: string;
  url?: string;
  message?: string;
  error?: string;
}

async function loadSettings(): Promise<PublicSettings | null> {
  try {
    const res = await fetch("/api/public/settings");
    return res.ok ? ((await res.json()) as PublicSettings) : null;
  } catch {
    return null;
  }
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showError(message: string): void {
  const box = el<HTMLParagraphElement>("rf-error");
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearError(): void {
  const box = el<HTMLParagraphElement>("rf-error");
  if (box) box.hidden = true;
}

function setupForm(): void {
  const form = el<HTMLFormElement>("return-form");
  if (!form) return;
  const submit = el<HTMLButtonElement>("rf-submit");

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitForm(form, submit);
  });
}

async function submitForm(form: HTMLFormElement, submit: HTMLButtonElement | null): Promise<void> {
  clearError();
  const data = new FormData(form);
  const payload = {
    kind: String(data.get("kind") ?? "arrepentimiento"),
    name: String(data.get("name") ?? ""),
    contact: String(data.get("contact") ?? ""),
    orderRef: String(data.get("orderRef") ?? ""),
    product: String(data.get("product") ?? ""),
    detail: String(data.get("detail") ?? ""),
    website: String(data.get("website") ?? ""),
  };

  // Chequeo mínimo en el navegador: el worker vuelve a validar todo.
  if (payload.name.trim().length < 2) return showError("Necesitamos tu nombre para identificar la solicitud.");
  if (payload.contact.trim() === "") return showError("Dejanos un WhatsApp o un email para responderte.");

  if (submit) {
    submit.disabled = true;
    submit.textContent = "Enviando…";
  }

  try {
    const res = await fetch("/api/returns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as CreateResponse;
    if (!res.ok || body.ok !== true || !body.code) {
      showError(body.error ?? "No pudimos registrar la solicitud. Probá de nuevo o escribinos por WhatsApp.");
      return;
    }
    showDone(body.code, body.url ?? "", body.message ?? "");
  } catch {
    showError("No pudimos conectar con el servidor. Revisá tu conexión o escribinos por WhatsApp.");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Enviar solicitud";
    }
  }
}

function showDone(code: string, url: string, message: string): void {
  const form = el<HTMLFormElement>("return-form");
  const done = el<HTMLElement>("return-done");
  const codeEl = el<HTMLElement>("rd-code");
  const link = el<HTMLAnchorElement>("rd-link");
  const note = el<HTMLElement>("rd-note");
  if (!done) return;

  if (codeEl) codeEl.textContent = code;
  if (link) link.href = url !== "" ? url : "/devoluciones";
  if (note) note.textContent = message;
  if (form) form.hidden = true;
  done.hidden = false;
  done.scrollIntoView({ block: "center" });

  const copy = el<HTMLButtonElement>("rd-copy");
  copy?.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copy) copy.textContent = "¡Copiado!";
      })
      .catch(() => {
        /* sin permisos de portapapeles: el código queda visible igual */
      });
  });
}

async function init(): Promise<void> {
  setupForm();
  const settings = await loadSettings();
  if (!settings) return;
  fillStoreInfo(settings);
  mountSiteFooter(settings);
}

void init();
