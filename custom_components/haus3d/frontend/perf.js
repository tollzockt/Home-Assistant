// Leistung und Qualität (ohne DOM, mit node testbar): Qualitätsstufen, wann gezeichnet wird,
// Auflösung nach Bildzeit anpassen, Möbel innen ausblenden, Ruhezeiten.

/** Qualitätsstufen. ambientFps: Bilder/s für Hintergrund-Animationen (Energiefluss, Wetter). */
export const QUALITY = {
  akku: { label: "Akku", maxDpr: 1, glow: false, weatherScale: 0.35, ambientFps: 12, cullInterior: true },
  ausgewogen: { label: "Ausgewogen", maxDpr: 1.5, glow: true, weatherScale: 0.7, ambientFps: 24, cullInterior: true },
  schoen: { label: "Schön", maxDpr: 2, glow: true, weatherScale: 1, ambientFps: 30, cullInterior: false },
};

/** Auswahl in den Einstellungen. */
export const QUALITY_CHOICES = [["auto", "Automatisch"], ["akku", "Akku"], ["ausgewogen", "Ausgewogen"], ["schoen", "Schön"]];

/**
 * Stufe zur Einstellung. „auto“: Touch-Geräte (Tablet) ausgewogen, sonst schön; die Auflösung passt
 * sich danach an die gemessene Bildzeit an (adaptDpr).
 * @returns {{name: string, auto: boolean} & typeof QUALITY.schoen}
 */
export function resolveQuality(name, { coarse = false } = {}) {
  if (QUALITY[name]) return { name, auto: false, ...QUALITY[name] };
  const base = coarse ? "ausgewogen" : "schoen";
  return { name: base, auto: true, ...QUALITY[base] };
}

/** Abstand zwischen zwei Hintergrund-Bildern in ms. */
export function ambientInterval(fps) {
  return 1000 / Math.max(1, Math.min(60, Number(fps) || 30));
}

/**
 * Jetzt zeichnen? Änderungen, Kamerabewegung und Tür-/Rollladen-Animationen sofort; reine
 * Hintergrund-Animationen (Energiefluss, Wetter) höchstens alle interval ms.
 */
export function shouldRender({ dirty = false, moving = false, animating = false, ambient = false, now = 0, lastRender = -Infinity, interval = 33 }) {
  if (dirty || moving || animating) return true;
  return ambient && now - lastRender >= interval - 1;
}

/** p-Quantil (0..1) einer Zahlenliste. */
export function quantile(list, p) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/**
 * Auflösung (devicePixelRatio) nach Bildzeiten anpassen: langsamer als 30 Bilder/s → eine Stufe
 * runter, deutlich schneller als 60 → eine Stufe rauf. Mindestens 20 Messungen, sonst unverändert.
 */
export function adaptDpr(cur, samplesMs, { min = 1, max = 2, step = 0.25 } = {}) {
  if (!samplesMs || samplesMs.length < 20) return cur;
  const slow = quantile(samplesMs, 0.75);
  const fast = quantile(samplesMs, 0.9);
  let next = cur;
  if (slow > 33) next = cur - step;
  else if (fast < 14) next = cur + step;
  return Math.round(Math.min(max, Math.max(min, next)) * 100) / 100;
}

/**
 * Möbel innen ausblenden, solange das Dach drauf ist und man von oben schaut (sieht man ohnehin nicht,
 * kostet aber viele Zeichenaufrufe). Flacher Blick (durch Fenster) zeigt sie weiter.
 */
export function lodState(polar, roofShown, profile) {
  return { hideInterior: !!profile?.cullInterior && !!roofShown && polar < 1.15 };
}
