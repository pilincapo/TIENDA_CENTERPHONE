// Vocabulario de las solicitudes de cambio/devolución/arrepentimiento.
// Vive en shared para que el worker (validación y API) y el panel (filtros y
// etiquetas) usen exactamente los mismos valores: si se agrega un estado, el
// panel lo muestra sin tocar nada más.

export const RETURN_KINDS = ["arrepentimiento", "cambio", "devolucion", "garantia"] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];

/** Estados posibles. El comercio los cambia desde el panel. */
export const RETURN_STATUSES = ["recibida", "en_revision", "aprobada", "resuelta", "cerrada"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const KIND_LABEL: Record<ReturnKind, string> = {
  arrepentimiento: "Arrepentimiento (compra a distancia)",
  cambio: "Cambio",
  devolucion: "Devolución",
  garantia: "Garantía",
};

export const STATUS_LABEL: Record<ReturnStatus, string> = {
  recibida: "Solicitud recibida",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  resuelta: "Resuelta",
  cerrada: "Cerrada",
};

export const CONTACT_KIND_LABEL: Record<"wa" | "email", string> = {
  wa: "WhatsApp",
  email: "Email",
};

/** Fila completa tal como la ve el panel (incluye datos personales). */
export interface AdminReturn {
  id: string;
  code: string;
  kind: ReturnKind;
  name: string;
  contact: string;
  contactKind: "wa" | "email";
  orderRef: string | null;
  product: string | null;
  detail: string | null;
  status: ReturnStatus;
  response: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AdminReturnEvent {
  at: number;
  status: ReturnStatus;
  label: string;
  /** Nota interna: nunca se publica en el seguimiento del consumidor. */
  note: string | null;
}

export interface AdminReturnDetail extends AdminReturn {
  history: AdminReturnEvent[];
}
