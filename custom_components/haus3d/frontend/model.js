// Import und Export im NeonPlan-Format.

export const EXPORT_FORMAT = "neonplan3d";
const BACKUP_FORMAT = "neonplan3d-backup";

// Entitäten der Energie-Anzeige: werden in den Einstellungen gewählt (bewusst keine Standard-IDs)
export const DEFAULT_ENERGY = {
  solar: null,
  einspeisung: null,
  akku_ladestand: null,
  akku_leistung: null,
  ertrag_heute: null,
};

/** Liest eine Datei: rohes Gebäude, NeonPlan-Export oder NeonPlan-Backup. Wirft bei Fehlern. */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON.");
  }
  const building = data && (data.format === EXPORT_FORMAT || data.format === BACKUP_FORMAT) ? data.building : data;
  if (!building || building.version !== 1 || !Array.isArray(building.floors)) {
    throw new Error("Die Datei enthält keinen Grundriss im NeonPlan-Format (version 1, floors).");
  }
  return normalize(building);
}

/** Ergänzt fehlende Listen, damit Darstellung und Speichern nicht stolpern. */
export function normalize(building) {
  const b = structuredClone(building);
  b.settings = { wall_exterior: 0.24, wall_interior: 0.12, grid: 0.05, ...(b.settings ?? {}) };
  b.settings.energy = { ...DEFAULT_ENERGY, ...(b.settings.energy ?? {}) };
  for (const f of b.floors) {
    for (const key of ["rooms", "openings", "furniture", "placements", "outdoor", "walls"]) f[key] = f[key] ?? [];
    f.background = f.background ?? null;
    f.cut_height = f.cut_height ?? 1.15;
  }
  return b;
}

/** Exportdatei im NeonPlan-Format (von NeonPlan 3D wieder einlesbar). */
export function exportFile(building) {
  return { format: EXPORT_FORMAT, version: 1, exported_at: new Date().toISOString(), building };
}

/** Bodenbeläge: Schlüssel, Name, Farbe. Die ersten sechs gibt es auch in NeonPlan. */
export const FLOOR_MATERIALS = [
  ["wood", "Holz", "#c89f6a"],
  ["oak", "Eiche", "#a8743f"],
  ["tiles", "Fliesen hell", "#d8d3ca"],
  ["carpet", "Teppich blau-grau", "#8f9cb0"],
  ["stone", "Stein", "#b3aea5"],
  ["concrete", "Beton", "#9e9e9e"],
  ["laminate_light", "Laminat hell", "#dcc8a6"],
  ["walnut", "Nussbaum", "#6e4a30"],
  ["parquet_grey", "Parkett grau", "#9a9086"],
  ["vinyl_grey", "Vinyl grau", "#a9a6a0"],
  ["tiles_dark", "Fliesen anthrazit", "#4b4e53"],
  ["tiles_white", "Fliesen weiß", "#efeeea"],
  ["marble", "Marmor", "#e8e4dc"],
  ["terracotta", "Terrakotta", "#b5653f"],
  ["slate", "Schiefer", "#5a5f66"],
  ["carpet_beige", "Teppich beige", "#c9b79a"],
  ["carpet_red", "Teppich rot", "#9c3b3b"],
  ["epoxy", "Epoxid", "#7d8b99"],
];

/** Farbvorschläge für Wände und Böden (eigene Farbe zusätzlich frei wählbar). */
export const COLOR_SWATCHES = [
  "#f3efe7", "#ffffff", "#e7e1d6", "#d9d4cc", "#b8b2a7", "#8c8a86", "#4f5257", "#2b2d31",
  "#f2e2c4", "#e9c99a", "#c98f5a", "#8a5a3c", "#f4d6d0", "#d98c7a", "#a8423a", "#6b2b2b",
  "#e3eed8", "#a9c99a", "#5f8f5a", "#2f5a3f", "#dbe8f2", "#9cc0dc", "#4f7fa8", "#25466b",
  "#ece3f2", "#b9a3d0", "#7c5fa3", "#fff3b0", "#f2c84b", "#e08a2e",
];

/** Farbe eines Bodens: eigene Farbe vor Bodenbelag. */
export function floorColor(room) {
  if (/^#[0-9a-f]{6}$/i.test(room?.floor_color ?? "")) return room.floor_color;
  return (FLOOR_MATERIALS.find((m) => m[0] === room?.floor_material) ?? FLOOR_MATERIALS[0])[2];
}

/**
 * Texturen (nur Bild, keine Struktur/Relief): Schlüssel, Name, Flächenarten (w = Wand, f = Boden,
 * r = Dach, g = Gelände). Die Farbe der Fläche tönt die Textur.
 */
export const TEXTURES = [
  ["plaster", "Putz", "wg"],
  ["brick", "Klinker", "wg"],
  ["timber", "Fachwerk", "w"],
  ["stone", "Naturstein", "wfg"],
  ["wood_v", "Holz senkrecht (Schalung)", "w"],
  ["wood_h", "Holz waagerecht", "w"],
  ["panel", "Fassadenpaneele", "wr"],
  ["concrete", "Beton", "wfg"],
  ["tiles", "Fliesen", "wf"],
  ["tiles_large", "Fliesen groß", "fg"],
  ["parquet", "Dielen / Parkett", "f"],
  ["carpet", "Teppich", "f"],
  ["roof_tiles", "Dachziegel", "r"],
  ["roof_slate", "Schiefer", "rw"],
  ["roof_metal", "Blech (Stehfalz)", "r"],
  ["roof_shingle", "Bitumenschindeln", "r"],
  ["grass", "Rasen", "g"],
  ["gravel", "Kies", "gr"],
  ["paving", "Pflaster", "g"],
  ["slabs", "Platten", "gf"],
  ["deck", "Holzdeck", "gf"],
  ["asphalt", "Asphalt", "g"],
  ["soil", "Erde", "g"],
];

/** Auswahl für eine Flächenart: [Schlüssel, Name]; "" = Standard, "none" = glatt. */
export function textureOptions(kind) {
  return [["", "Standard"], ["none", "glatt (keine)"], ...TEXTURES.filter((t) => t[2].includes(kind)).map(([k, n]) => [k, n])];
}

const FLOOR_TEXTURE = {
  wood: "parquet", oak: "parquet", laminate_light: "parquet", walnut: "parquet", parquet_grey: "parquet", vinyl_grey: "parquet",
  tiles: "tiles", tiles_dark: "tiles", tiles_white: "tiles", marble: "tiles_large", terracotta: "tiles", slate: "tiles_large",
  carpet: "carpet", carpet_beige: "carpet", carpet_red: "carpet", stone: "stone", concrete: "concrete", epoxy: "concrete",
};
const GROUND_TEXTURE = { lawn: "grass", terrace: "slabs", path: "paving", driveway: "asphalt", pool: "tiles", bed: "soil", hedge: "grass", fence: "wood_v", balcony: "slabs", gravel: "gravel", paving: "paving", rockery: "gravel" };

/**
 * Textur einer Fläche: eigene Wahl vor Standard. null = glatt.
 * @param {"wall"|"floor"|"roof"|"ground"} kind
 * @param {string|null|undefined} chosen eigene Wahl ("" = Standard, "none" = glatt)
 * @param {string} [base] Bodenbelag bzw. Art der Gartenfläche / Dachform für den Standard
 */
export function textureFor(kind, chosen, base) {
  if (chosen === "none") return null;
  if (chosen && TEXTURES.some((t) => t[0] === chosen)) return chosen;
  if (kind === "wall") return "plaster";
  if (kind === "floor") return FLOOR_TEXTURE[base] ?? "parquet";
  if (kind === "roof") return base === "flat" ? "gravel" : "roof_tiles";
  if (kind === "ground") return GROUND_TEXTURE[base] ?? null;
  return null;
}
