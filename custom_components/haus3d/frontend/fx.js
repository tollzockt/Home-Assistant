// Optik und Auswertungen ohne DOM (mit node testbar): Jahreszeit im Garten, Sonnenbahn eines Tages,
// PV-Verschattung zusammenfassen, Energiefluss im Haus.

import { sunPosition } from "./sun.js";

export const SEASONS = [["auto", "Automatisch (Datum)"], ["spring", "Frühling"], ["summer", "Sommer"], ["autumn", "Herbst"], ["winter", "Winter"]];

/** Farben je Jahreszeit (Rasen, Laub; null = unverändert). */
export const SEASON_LOOK = {
  spring: { lawn: 0x78c257, leaf: 0x6fbf4a, blossom: 0xf6c1d6 },
  summer: { lawn: null, leaf: null, blossom: null },
  autumn: { lawn: 0x8f9a4c, leaf: 0xd07a2a, blossom: null },
  winter: { lawn: 0x8a9478, leaf: 0x8b7e6a, blossom: null },
};

/** Meteorologische Jahreszeit (Südhalbkugel um ein halbes Jahr versetzt). */
export function seasonOf(date = new Date(), lat = 50) {
  let m = (date instanceof Date ? date : new Date(date)).getMonth();
  if (lat < 0) m = (m + 6) % 12;
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

/** Einstellung → Jahreszeit („auto“ nach Datum und Breite). */
export function resolveSeason(setting, date = new Date(), lat = 50) {
  return SEASON_LOOK[setting] ? setting : seasonOf(date, lat);
}

/**
 * Sonnenstände eines Tages (lokale Mitternacht von day bis +24 h) alle step Minuten, nur über
 * minElev Grad.
 */
export function daySamples(day, lat, lon, { stepMin = 20, minElev = 3 } = {}) {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  const out = [];
  for (let m = 0; m < 24 * 60; m += stepMin) {
    const t = d.getTime() + m * 60000;
    const p = sunPosition(t, lat, lon);
    if (p.elevation >= minElev) out.push({ t, azimuth: p.azimuth, elevation: p.elevation });
  }
  return out;
}

/**
 * Verschattung zusammenfassen. rows: je Sonnenstand {t, elevation, shaded, total} (Module im Schatten
 * von allen). Gewichtet mit sin(Höhe) als grobes Maß für die Einstrahlung.
 * @returns {{loss: number, hours: {t: number, frac: number}[], worst: {t: number, frac: number}|null}}
 */
export function shadingSummary(rows) {
  let lost = 0;
  let all = 0;
  const hours = [];
  let worst = null;
  for (const r of rows) {
    if (!r.total) continue;
    const w = Math.sin((Math.max(0, r.elevation) * Math.PI) / 180);
    const frac = r.shaded / r.total;
    lost += w * frac;
    all += w;
    hours.push({ t: r.t, frac });
    if (!worst || frac > worst.frac) worst = { t: r.t, frac };
  }
  return { loss: all ? lost / all : 0, hours, worst: worst?.frac > 0 ? worst : null };
}

/**
 * Energiefluss im Haus: Räume mit Verbrauch (W) → Linien vom Hausanschluss; Netz (Bezug/Einspeisung).
 * Geschwindigkeit 0,1..0,9 Umläufe/s nach Leistung, Punkte 2..6.
 */
export function houseFlowItems(roomWatts, grid = null, { minW = 5 } = {}) {
  const items = [];
  const speed = (w) => Math.min(0.9, 0.1 + w / 1500);
  const dots = (w) => Math.max(2, Math.min(6, Math.round(2 + w / 400)));
  for (const [key, w] of roomWatts) if (Number.isFinite(w) && w >= minW) items.push({ key, kind: "room", w, speed: speed(w), dots: dots(w), reverse: false });
  if (grid?.dir === "import" || grid?.dir === "export") items.push({ key: "grid", kind: "grid", w: grid.w, speed: speed(grid.w), dots: dots(grid.w), reverse: grid.dir === "export", color: grid.dir === "import" ? "import" : "export" });
  return items;
}
