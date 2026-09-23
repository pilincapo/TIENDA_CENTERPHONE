// Detección de marca de un producto a partir de su título (y del campo
// "brand"/"marca" si la fuente lo trae). Sirve para dos cosas:
//  1. Guardar la marca al importar (columna products.brand) → JSON-LD "brand".
//  2. Fallback en la ficha para productos importados antes de que existiera
//     la columna, sin necesidad de re-importar.

/** Alias → marca canónica. Se buscan como palabra completa, sin distinguir mayúsculas. */
const ALIASES: Record<string, string> = {
  iphone: "Apple",
  ipad: "Apple",
  macbook: "Apple",
  airpods: "Apple",
  apple: "Apple",
  galaxy: "Samsung",
  samsung: "Samsung",
  xiaomi: "Xiaomi",
  redmi: "Xiaomi",
  poco: "Xiaomi",
  mi: "Xiaomi",
  motorola: "Motorola",
  moto: "Motorola",
  huawei: "Huawei",
  honor: "Honor",
  tcl: "TCL",
  zte: "ZTE",
  nokia: "Nokia",
  oppo: "Oppo",
  realme: "Realme",
  vivo: "Vivo",
  lenovo: "Lenovo",
  lg: "LG",
  sony: "Sony",
  xperia: "Sony",
  asus: "Asus",
  rog: "Asus",
  alcatel: "Alcatel",
  hisense: "Hisense",
  noblex: "Noblex",
  bgh: "BGH",
  jbl: "JBL",
  philips: "Philips",
  google: "Google",
  pixel: "Google",
  oneplus: "OnePlus",
  kindle: "Amazon",
  alexa: "Amazon",
  amazon: "Amazon",
  spigen: "Spigen",
  baseus: "Baseus",
  anker: "Anker",
  romos: "Romos",
  joyroom: "Joyroom",
  // Marcas propias del catálogo (electro, audio, accesorios) detectadas
  // analizando los títulos sin marca del listado:
  time: "Time",
  ecopower: "Ecopower",
  qcy: "QCY",
  redragon: "Redragon",
  seisa: "Seisa",
  oryx: "Oryx",
  hytoshy: "Hytoshy",
  energizer: "Energizer",
  greatnice: "Greatnice",
  gts: "GTS",
  zeus: "Zeus",
};

// Precompiladas una sola vez: palabra completa, ignorando mayúsculas/acentos.
const MATCHERS = Object.entries(ALIASES).map(([alias, brand]) => ({
  brand,
  re: new RegExp(`\\b${alias}\\b`, "i"),
}));

/**
 * Devuelve la marca detectada en el texto, o null si no hay coincidencia.
 * Si dos marcas matchean (ej: "Fundas para iPhone y Samsung"), gana la que
 * aparece más temprano en el título.
 */
export function detectBrand(text: string): string | null {
  if (!text) return null;
  let best: { brand: string; at: number } | null = null;
  for (const { brand, re } of MATCHERS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) {
      best = { brand, at: m.index };
    }
  }
  return best ? best.brand : null;
}
