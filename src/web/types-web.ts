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
}
