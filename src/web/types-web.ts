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
  /** Pago online activado en el panel (requiere además el secret del worker). */
  paymentsEnabled: boolean;
  /** Nota de envío/retiro para el carrito y el pedido. */
  checkoutNote: string;
  /** Recargo % del pago online por MercadoPago (0 = sin recargo). El total con recargo lo confirma el worker. */
  mpSurchargePercent: number;
  /** Descuento % por pagar con transferencia (0 = sin descuento); se congela en los pedidos por transferencia. */
  transferDiscountPercent: number;
  /** CBU/alias para el cierre por transferencia (opcional). */
  transferCbu: string;
}
