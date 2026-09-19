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
  sortOrder: number;
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
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface StoreSettings {
  whatsappPhone: string;
  currencySymbol: string;
  syncUrl: string;
  syncIntervalMinutes: number;
  syncToken: string;
  // Datos del comercio para popups/footer (configurables desde el panel).
  storeName: string;
  storeAddress: string;
  storeMapUrl: string;
  storeHours: string;
  instagramUrl: string;
  facebookUrl: string;
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
  storeName: "CenterPhone Celulares",
  storeAddress: "Mendoza 2974 · Santa Fe",
  storeMapUrl: "https://maps.google.com/?q=Mendoza+2974+Santa+Fe",
  storeHours: "Lunes a viernes: 9:00 a 19:00 hs\nSábados: 10:00 a 13:00 hs",
  instagramUrl: "https://www.instagram.com/centerphonesantafe",
  facebookUrl: "https://www.facebook.com/centerphonesantafe",
};

export const KV_SNAPSHOT_KEY = "catalog:snapshot:v1";
export const KV_SETTINGS_KEY = "config:settings:v1";
export const KV_SYNC_STATE_KEY = "config:syncstate:v1";
