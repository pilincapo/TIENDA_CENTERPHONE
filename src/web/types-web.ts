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
}
