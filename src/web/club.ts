// Entrada de la página pública /club: alta gratuita y consulta de código.
//
// El worker es la fuente de verdad (valida el WhatsApp, genera el código y
// recalcula el descuento). Acá solo se valida lo mínimo para dar un mensaje
// inmediato y se guarda el código en el navegador para el carrito.

import type { PublicSettings } from "./types-web";
import { fillStoreInfo } from "./store-modals";
import { mountSiteFooter } from "./site-footer";
import { normalizeMemberCode } from "../shared/loyalty";
import { saveMember, storedMemberCode, storedMemberPercent } from "./member-storage";

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(id: string, text: string): void {
  const el = byId(id);
  if (el) el.textContent = text;
}

function setError(text: string): void {
  const el = byId("club-error");
  if (!el) return;
  el.textContent = text;
  el.hidden = text === "";
}

function setStatus(text: string, ok: boolean): void {
  const el = byId("club-status");
  if (!el) return;
  el.textContent = text;
  el.hidden = text === "";
  el.classList.toggle("ok", ok);
  el.classList.toggle("bad", !ok && text !== "");
}

function showDone(code: string, percent: number, recovered: boolean): void {
  const join = byId("club-join-block");
  const done = byId("club-done");
  if (join) join.hidden = true;
  if (done) done.hidden = false;
  setText("club-code", code);
  setText(
    "club-done-note",
    recovered
      ? `Recuperamos tu código. Tenés ${percent}% de descuento en cada compra: lo aplicás en el carrito.`
      : `Tenés ${percent}% de descuento en cada compra: lo aplicás en el carrito.`,
  );
  done?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function join(form: HTMLFormElement): Promise<void> {
  const fd = new FormData(form);
  const name = String(fd.get("name") ?? "").trim();
  const phone = String(fd.get("phone") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  const birthday = String(fd.get("birthday") ?? "").trim();
  const website = String(fd.get("website") ?? "").trim();

  if (name.length < 2) return setError("Ingresá tu nombre.");
  if (phone.replace(/\D/g, "").length < 8) return setError("Ingresá un WhatsApp válido, con código de área.");
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setError("Revisá el email.");
  setError("");

  const btn = byId<HTMLButtonElement>("club-submit");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Sumándote…";
  }
  try {
    const res = await fetch("/api/loyalty/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email, birthday, website }),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; code?: string; recovered?: boolean; discountPercent?: number; error?: string }
      | null;
    if (!res.ok || !data?.ok || !data.code) {
      setError(data?.error ?? "No pudimos completar el alta. Probá de nuevo.");
      return;
    }
    const percent = Math.max(0, Math.round(Number(data.discountPercent ?? 0)));
    saveMember(data.code, percent);
    showDone(data.code, percent, data.recovered === true);
  } catch {
    setError("Error de red. Revisá tu conexión y probá de nuevo.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Sumarme gratis";
    }
  }
}

async function check(codeRaw: string): Promise<boolean> {
  const code = normalizeMemberCode(codeRaw);
  if (code === "") {
    setStatus("Pegá tu código de socio.", false);
    return false;
  }
  try {
    const res = await fetch(`/api/loyalty/validate?code=${encodeURIComponent(code)}`);
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; valid?: boolean; discountPercent?: number; name?: string; error?: string }
      | null;
    if (!res.ok || !data?.ok) {
      setStatus(data?.error ?? "No pudimos consultar el código. Probá de nuevo.", false);
      return false;
    }
    if (!data.valid) {
      setStatus("Ese código no está activo. Si perdiste el tuyo, volvé a completar el alta con el mismo WhatsApp.", false);
      return false;
    }
    const percent = Math.max(0, Math.round(Number(data.discountPercent ?? 0)));
    saveMember(code, percent);
    setStatus(
      `${data.name ? `¡Hola, ${data.name}! ` : ""}Tu código está activo: ${percent}% de descuento en el carrito.`,
      true,
    );
    return true;
  } catch {
    setStatus("Error de red. Revisá tu conexión y probá de nuevo.", false);
    return false;
  }
}

async function init(): Promise<void> {
  let settings: PublicSettings | null = null;
  try {
    const res = await fetch("/api/public/settings");
    settings = res.ok ? ((await res.json()) as PublicSettings) : null;
  } catch {
    settings = null;
  }

  if (!settings) {
    setError("No pudimos cargar la página. Recargá o escribinos por WhatsApp.");
    return;
  }

  fillStoreInfo(settings);
  mountSiteFooter(settings);
  setText("club-title", settings.loyaltyName || "Club CenterPhone");
  // El nivel se anuncia fijo ("hasta un 15%"): el % real de cada socio lo
  // devuelve el worker al validar el código y puede ser 5, 10 o 15.
  document.title = `${settings.loyaltyName || "Club CenterPhone"} — socios con hasta 15% de descuento`;

  if (settings.loyaltyWelcomeText && settings.loyaltyWelcomeText.trim() !== "") {
    const welcome = byId("club-welcome");
    if (welcome) {
      welcome.textContent = settings.loyaltyWelcomeText.trim();
      welcome.hidden = false;
    }
  }

  // Club apagado desde el panel: la página queda solo como aviso. Se ocultan
  // los beneficios, el alta, la consulta y el texto de «descuento permanente»
  // para no prometer algo que el carrito y el checkout ya no aplican.
  if (!settings.loyaltyEnabled) {
    document.title = `${settings.loyaltyName || "Club CenterPhone"} — en pausa`;
    for (const id of ["club-nav-link", "club-lead", "club-benefits", "club-join-block", "club-existing", "club-done"]) {
      byId(id)?.setAttribute("hidden", "");
    }
    const disabled = byId("club-disabled");
    if (disabled) disabled.hidden = false;
    return;
  }

  const form = byId<HTMLFormElement>("club-form");
  form?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void join(form);
  });

  const checkForm = byId<HTMLFormElement>("club-check-form");
  const checkInput = byId<HTMLInputElement>("club-check-code");
  checkForm?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void check(checkInput?.value ?? "");
  });

  byId("club-copy")?.addEventListener("click", () => {
    const code = byId("club-code")?.textContent ?? "";
    const btn = byId<HTMLButtonElement>("club-copy");
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (btn) btn.textContent = "✓ Copiado";
        setTimeout(() => { if (btn) btn.textContent = "Copiar código"; }, 2200);
      })
      .catch(() => {
        if (btn) btn.textContent = "Seleccionalo y copialo";
      });
  });

  // Código ya guardado en este navegador: se precarga y se valida solo.
  const saved = storedMemberCode();
  if (saved !== "") {
    if (checkInput) checkInput.value = saved;
    const percent = storedMemberPercent();
    if (percent > 0) setStatus(`Tenés guardado el código ${saved}: ${percent}% de descuento en el carrito.`, true);
    void check(saved).then((ok) => {
      if (!ok && storedMemberPercent() > 0) {
        // El worker es la verdad: si dejó de estar activo, no prometemos nada.
        setStatus("Tu código guardado ya no está activo. Escribinos por WhatsApp para revisarlo.", false);
      }
    });
  }
}

void init();
