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
};

export const KV_SNAPSHOT_KEY = "catalog:snapshot:v1";
export const KV_SETTINGS_KEY = "config:settings:v1";
export const KV_SYNC_STATE_KEY = "config:syncstate:v1";
