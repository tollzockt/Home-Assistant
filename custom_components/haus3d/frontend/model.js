// Import und Export im NeonPlan-Format.

export const EXPORT_FORMAT = "neonplan3d";
const BACKUP_FORMAT = "neonplan3d-backup";

export const DEFAULT_ENERGY = {
  solar: "sensor.pv_leistung",
  einspeisung: "sensor.pv_einspeisung",
  akku_ladestand: "sensor.akku_ladestand",
  akku_leistung: "sensor.akku_leistung",
  ertrag_heute: "sensor.pv_ertrag_heute",
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
