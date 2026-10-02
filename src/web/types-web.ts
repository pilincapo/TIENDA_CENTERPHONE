// Settings públicas que el worker expone al frontend (sin tokens ni URLs de sync).
export interface PublicSettings {
  whatsappPhone: string;
  currencySymbol: string;
  whatsappOk: boolean;
  storeName: string;
  storeAddress: string;
  storeMapUrl: string;
  storeHours: string;
  instagramUrl: string;
  facebookUrl: string;
  trackUrl: string;
  howSteps: string;
  howTitle: string;
  howPickupNote: string;
  freshHours: number;
  /**
   * Modo del sitio. En "catalogo" el sitio muestra precios y el botón de WhatsApp,
   * y nada de carrito ni pagos (el worker además rechaza crear pedidos).
   */
  storeMode: "tienda" | "catalogo";
  /** Pago online activado (derivado: storeMode === "tienda"; requiere el secret del worker). */
  paymentsEnabled: boolean;
  /** Nota de envío/retiro para el carrito y el pedido. */
  checkoutNote: string;
  /** Recargo % del pago online por MercadoPago (0 = sin recargo). El total con recargo lo confirma el worker. */
  mpSurchargePercent: number;
  /** Descuento % por pagar con transferencia (0 = sin descuento); se congela en los pedidos por transferencia. */
  transferDiscountPercent: number;
  /** CBU/alias para el cierre por transferencia (opcional). */
  transferCbu: string;
  /** Modo mantenimiento activo: el catálogo muestra la página de contacto. */
  maintenanceMode: boolean;
}

/**
 * El sitio vende en línea solo en modo "tienda". Centraliza la decisión para que
 * el catálogo y la ficha no puedan mostrarse distintos entre sí.
 */
export function sellsOnline(settings: Pick<PublicSettings, "storeMode" | "paymentsEnabled"> | null): boolean {
  return settings?.storeMode === "tienda" && settings.paymentsEnabled === true;
}
