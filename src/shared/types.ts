// Tipos y constantes compartidos entre worker y frontend.

export type ProductStatus = "published" | "hidden";
export type Availability = "in_stock" | "out_of_stock" | "preorder";
export type Tag = "new" | "featured" | "offer";
export type SyncTrigger = "cron" | "manual" | "import";

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  active: boolean;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  categoryId: string | null;
  subcategoryId: string | null;
  tags: Tag[];
  imageUrl: string;
  status: ProductStatus;
  availability: Availability;
  /** Publicado también en el catálogo de WhatsApp (el feed CSV que descarga Meta,
   *  ver src/worker/wa-feed.ts). Lo marca el panel desde Productos; los syncs de
   *  las fuentes y la edición manual no lo tocan. */
  waPublish?: boolean;
  sortOrder: number;
  /** Fecha de alta del producto (epoch ms). Con <48h el frontend le pone badge "Nuevo". */
  createdAt: number;
  /** URL de origen si fue importado (NULL = alta manual). Si la fuente deja de traerlo, se oculta. */
  sourceUrl: string | null;
  /** Id ANTERIOR del producto (hash numérico del proveedor, p. ej. "6160"): viaja
   *  desde el importador hasta renombrar la fila en D1 y registrar el 301 en
   *  product_redirects. Campo interno del flujo de importación: no se persiste en
   *  D1 ni entra al snapshot público del catálogo. */
  prevId?: string | null;
  /** Marca detectada al importar (o null si no se pudo determinar). Opcional para productos creados antes. */
  brand?: string | null;
  /** Solo en la ficha: el producto está oculto (sin stock en la fuente) y se accedió por link directo. */
  hiddenNoStock?: boolean;
}

export interface CatalogSnapshot {
  generatedAt: number;
  categories: Category[];
  products: Product[];
}

export interface SyncLogEntry {
  id: string;
  trigger: SyncTrigger;
  status: "ok" | "error";
  itemsTotal: number | null;
  itemsImported: number | null;
  itemsFailed: number | null;
  /** Productos de la fuente que ya no vinieron en el listado y fueron ocultados. */
  itemsDeactivated: number | null;
  error: string | null;
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
}

// ---- Pedidos con pago online (MercadoPago) ----

export type OrderStatus = "pending" | "paid" | "cancelled" | "rejected" | "archived";

export interface OrderItem {
  id: string;
  title: string;
  qty: number;
  priceCents: number;
}

export interface Order {
  id: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  buyerName: string;
  buyerPhone: string;
  payerEmail: string | null;
  items: OrderItem[];
  mpPreferenceId: string | null;
  mpPaymentId: string | null;
  paidAt: number | null;
  notifiedWa: boolean;
  /** Fecha del archivo (epoch ms). Solo con status = "archived". */
  archivedAt?: number | null;
  /** Quien archivo (IP del panel o "panel"). Solo con status = "archived". */
  archivedBy?: string | null;
  /** Motivo opcional del archivo, guardado en el historial. */
  archiveNote?: string | null;
  /** Estado que tenía el pedido antes de archivarlo; al restaurar vuelve a
   *  ese estado. Null en filas archivadas antes de la migración 010. */
  preArchiveStatus?: OrderStatus | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Modo del sitio:
 * - "tienda": venta online (carrito, MercadoPago, transferencia) + consulta por WhatsApp.
 * - "catalogo": solo precios de referencia y consulta por WhatsApp. Sin carrito,
 *   sin pagos y sin creación de pedidos.
 */
export type StoreMode = "tienda" | "catalogo";

/**
 * Movimiento de la cinta de anuncio (Configuración › Cinta de anuncio):
 * - "none": estático (el comportamiento original).
 * - "marquee": desplazamiento continuo tipo noticiero (entra por la derecha y cruza).
 * - "swing": ida y vuelta (oscila a los costados sin irse de la barra).
 * - "fade": fundido (la barra queda fija y el texto respira).
 * Son animaciones CSS puras y todas respetan `prefers-reduced-motion` del sistema.
 */
export type AnnouncementMotion = "none" | "marquee" | "swing" | "fade";

export const ANNOUNCEMENT_MOTIONS: AnnouncementMotion[] = ["none", "marquee", "swing", "fade"];

export const ANNOUNCEMENT_MOTION_LABELS: Record<AnnouncementMotion, string> = {
  none: "Estático (sin movimiento)",
  marquee: "Desplazamiento continuo (tipo noticiero)",
  swing: "Ida y vuelta (oscila a los costados)",
  fade: "Fundido (el texto aparece y desvanece)",
};

/** Lo que llega del panel (o de un cliente) debe estar en la lista; cualquier otra cosa = "none". */
export function isAnnouncementMotion(v: unknown): v is AnnouncementMotion {
  return typeof v === "string" && (ANNOUNCEMENT_MOTIONS as readonly string[]).includes(v);
}

/**
 * Velocidad de las animaciones de la cinta (marquee/swing/fade) y de la
 * rotación entre promos. "normal" = los tiempos de siempre; "slow"/"fast"
 * solo reescalan esos valores, así un default normal no cambia nada.
 */
export type AnnouncementSpeed = "slow" | "normal" | "fast";

export const ANNOUNCEMENT_SPEEDS: AnnouncementSpeed[] = ["slow", "normal", "fast"];

export const ANNOUNCEMENT_SPEED_LABELS: Record<AnnouncementSpeed, string> = {
  slow: "Lenta",
  normal: "Normal",
  fast: "Rápida",
};

/** Multiplicador sobre la duración base de cada animación (>1 = más lento). */
export const ANNOUNCEMENT_SPEED_FACTOR: Record<AnnouncementSpeed, number> = {
  slow: 1.8,
  normal: 1,
  fast: 0.55,
};

/** Lo que llega del panel (o de un cliente) debe estar en la lista; cualquier otra cosa = "normal". */
export function isAnnouncementSpeed(v: unknown): v is AnnouncementSpeed {
  return typeof v === "string" && (ANNOUNCEMENT_SPEEDS as readonly string[]).includes(v);
}

/** Cinta con varias promos: hasta N, una por línea (como los pasos de «Cómo comprar»). */
export const MAX_ANNOUNCEMENT_PROMOS = 5;

/** Caracteres máximos por promo de la cinta. */
export const MAX_ANNOUNCEMENT_PROMO_LEN = 120;

export interface StoreSettings {
  /** Modo del sitio. Única fuente de verdad: `paymentsEnabled` se deriva de acá. */
  storeMode: StoreMode;
  /** Pago online por MercadoPago: activa botones de compra y /api/checkout. Requiere el secret MERCADOPAGO_ACCESS_TOKEN.
   *  Derivado de storeMode (se mantiene el campo para no tocar todo el código de pagos). */
  paymentsEnabled: boolean;
  /** Nota de envío/retiro que se muestra en el carrito y en la página del pedido. */
  checkoutNote: string;
  /** Recargo % que se suma al total cuando el pago es online por MercadoPago (0-50; 0 = sin recargo). Se cobra server-side en la preferencia. */
  mpSurchargePercent: number;
  /** Descuento % por pagar con transferencia (0-50; 0 = sin descuento). Se congela en los pedidos creados por "Coordinar por transferencia". */
  transferDiscountPercent: number;
  /** CBU o alias para el cierre por transferencia (opcional; va pre-cargado en el mensaje de WhatsApp). */
  transferCbu: string;
  whatsappPhone: string;
  currencySymbol: string;
  syncUrl: string;
  syncIntervalMinutes: number;
  syncToken: string;
  /** Token de la URL del feed del catálogo de WhatsApp (ver src/worker/wa-feed.ts).
   *  No se edita desde el formulario de Configuración: lo genera y rota el panel en
   *  Ajustes → Catálogo de WhatsApp. Vacío = el feed no existe (404). */
  whatsappFeedToken: string;
  // Datos del comercio para popups/footer (configurables desde el panel).
  storeName: string;
  storeAddress: string;
  storeMapUrl: string;
  storeHours: string;
  instagramUrl: string;
  facebookUrl: string;
  // Link al sistema de seguimiento (botón "Seguimiento" del header).
  trackUrl: string;
  // Pasos del modal "Cómo comprar", un paso por línea. Línea vacía = usar el texto por defecto.
  howSteps: string;
  // Título del modal y nota de retiro. Vacíos = usar los valores por defecto de la página.
  howTitle: string;
  howPickupNote: string;
  // Ventana del badge "Nuevo" automático, en horas (0 = badge desactivado).
  freshHours: number;
  // Modo mantenimiento: cierra el catálogo público (503) mostrando WhatsApp y
  // redes; el panel, los pedidos y el webhook siguen funcionando.
  maintenanceMode: boolean;
  maintenanceMessage: string;
  /** Cinta de anuncio sobre el topbar (ej. "📦 Envío gratis en Santa Fe"). Vacía = no se muestra. */
  announcementBar: string;
  /** Movimiento de la cinta (ver AnnouncementMotion). "none" = estática. */
  announcementMotion: AnnouncementMotion;
  /** Velocidad de la animación y la rotación de la cinta (ver AnnouncementSpeed). */
  announcementSpeed: AnnouncementSpeed;
  // ---- Envíos con Andreani (cotización server-side) ----
  /** Cotizador de envíos activo: muestra el precio en carrito y ficha. Sin credenciales del worker queda inerte. */
  shippingAndreaniEnabled: boolean;
  /** N° de contrato con Andreani (lo da el agente comercial; ej. AND00EST). */
  shippingAndreaniContrato: string;
  /** N° de cliente Andreani (ej. CL0003750). */
  shippingAndreaniCliente: string;
  /** Código postal del local: origen de los envíos (ej. 3000 Santa Fe). */
  shippingPostalCode: string;
  /** Peso en kg de cada unidad de producto (un celular ≈ 0.5 kg con caja). */
  shippingPackageKilos: number;
  /** Volumen en cm³ de cada unidad (ej. caja de celular 18×10×6 ≈ 1080 cm³). */
  shippingPackageVolumen: number;
}

export const TAGS: Tag[] = ["new", "featured", "offer"];

export const TAG_LABELS: Record<Tag, string> = {
  new: "Nuevo",
  featured: "Destacado",
  offer: "Oferta",
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: "En stock",
  out_of_stock: "Sin stock",
  preorder: "Bajo pedido",
};

export const DEFAULT_SETTINGS: StoreSettings = {
  whatsappPhone: "5491100000000",
  currencySymbol: "$",
  syncUrl: "",
  syncIntervalMinutes: 60,
  syncToken: "",
  // Se genera solo la primera vez que el panel pide la URL del feed de WhatsApp.
  whatsappFeedToken: "",
  storeName: "CenterPhone Celulares",
  storeAddress: "Mendoza 2974 · Santa Fe",
  storeMapUrl: "https://maps.google.com/?q=Mendoza+2974+Santa+Fe",
  storeHours: "Lunes a viernes: 9:00 a 19:00 hs\nSábados: 10:00 a 13:00 hs",
  instagramUrl: "https://www.instagram.com/centerphonesantafe",
  facebookUrl: "https://www.facebook.com/centerphonesantafe",
  trackUrl: "https://repairpro.centerphone.com.ar/track-lite",
  howSteps: [
    "Explorá el catálogo. Buscá por nombre o filtrá por categoría y etiquetas (Nuevo, Destacado, Oferta).",
    "Tocá \"Consultar\". En cada producto tenés el botón para preguntarnos por WhatsApp sin entrar a la ficha.",
    "Confirmamos stock y precio. Te respondemos con la disponibilidad real, colores/memoria y el precio final.",
    "Coordinamos el pago. Efectivo, transferencia o tarjeta — lo que prefieras.",
    "Recibilo o pasá a buscarlo. Envío gratis en la ciudad de Santa Fe o retiro en el local.",
  ].join("\n"),
  howTitle: "Cómo comprar",
  howPickupNote: "",
  freshHours: 48,
  // Sin config guardada arrancamos en catálogo (sin pagos), igual que antes
  // que paymentsEnabled valía false.
  storeMode: "catalogo",
  paymentsEnabled: false,
  checkoutNote: "Coordinamos envío o retiro por WhatsApp después del pago. Envío gratis en la ciudad de Santa Fe.",
  mpSurchargePercent: 0,
  transferDiscountPercent: 0,
  transferCbu: "",
  maintenanceMode: false,
  maintenanceMessage: "",
  // Cinta de anuncio: vacía por defecto (no se muestra nada hasta configurarla).
  announcementBar: "",
  // Movimiento de la cinta: apagado por defecto (estático, como siempre).
  announcementMotion: "none",
  announcementSpeed: "normal",
  // Envíos: apagado por defecto; sin secrets ANDREANI_* el worker rechaza igual.
  shippingAndreaniEnabled: false,
  shippingAndreaniContrato: "",
  shippingAndreaniCliente: "",
  shippingPostalCode: "",
  shippingPackageKilos: 0.5,
  shippingPackageVolumen: 1080,
};

export const KV_SNAPSHOT_KEY = "catalog:snapshot:v1";
// Marca de "el catalogo publico quedo viejo": la ponen las escrituras del panel
// (alta, edicion, baja, categorias) y la borra cada regenerateSnapshot.
export const KV_CATALOG_PENDING_KEY = "catalog:pending:v1";
// Timestamp de la ultima generacion del snapshot (invalida el cache de /api/catalog).
export const KV_CATALOG_VERSION_KEY = "catalog:v";
export const KV_SETTINGS_KEY = "config:settings:v1";
export const KV_SYNC_STATE_KEY = "config:syncstate:v1";
// Pedidos: solo se marca "notificado por WhatsApp" del lado del panel.
export const ORDER_STATUSES: OrderStatus[] = ["pending", "paid", "cancelled", "rejected", "archived"];
