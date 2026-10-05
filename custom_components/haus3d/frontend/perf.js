// Leistung und Qualität (ohne DOM, mit node testbar): Qualitätsstufen, wann gezeichnet wird,
// Auflösung nach Bildzeit anpassen, Möbel innen ausblenden, Ruhezeiten.

/** Qualitätsstufen. ambientFps: Bilder/s für Hintergrund-Animationen (Energiefluss, Wetter). */
export const QUALITY = {
  akku: { label: "Akku", maxDpr: 1, glow: false, weatherScale: 0.35, ambientFps: 12, cullInterior: true, shadows: false, shadowSize: 1024 },
  ausgewogen: { label: "Ausgewogen", maxDpr: 1.5, glow: true, weatherScale: 0.7, ambientFps: 24, cullInterior: true, shadows: true, shadowSize: 1024 },
  schoen: { label: "Schön", maxDpr: 2, glow: true, weatherScale: 1, ambientFps: 30, cullInterior: false, shadows: true, shadowSize: 2048 },
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

/** „HH:MM“ → Minuten seit Mitternacht, sonst null. */
export function parseClock(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

/**
 * Ruhemodus und Dimmen (settings.kiosk, dieses Gerät). Im Wandtablet-Modus ohne Angabe 5 min.
 * @returns {{idleMs: number, dimFrom: number|null, dimTo: number|null, dimLevel: number}}
 */
export function normalizeIdle(cfg, { kiosk = false } = {}) {
  const raw = cfg?.idleMin;
  const min = raw === undefined || raw === null || raw === "" ? (kiosk ? 5 : 0) : Math.max(0, Math.min(240, Number(raw) || 0));
  const dimFrom = parseClock(cfg?.dimFrom);
  const dimTo = parseClock(cfg?.dimTo);
  const lvl = Number(cfg?.dimLevel);
  return { idleMs: min * 60000, dimFrom: dimFrom !== null && dimTo !== null ? dimFrom : null, dimTo: dimFrom !== null && dimTo !== null ? dimTo : null, dimLevel: Number.isFinite(lvl) && lvl > 0 ? Math.min(0.95, Math.max(0.2, lvl)) : 0.75 };
}

/** Liegt die Uhrzeit (Minuten) im Zeitraum von–bis? Auch über Mitternacht (22:00–06:00). */
export function inTimeRange(nowMin, from, to) {
  if (from === null || to === null || from === undefined || to === undefined || from === to) return false;
  return from < to ? nowMin >= from && nowMin < to : nowMin >= from || nowMin < to;
}

/** Ruhe nach idleMs ohne Eingabe (0 = nie). */
export function idleState(lastInput, now, idleMs) {
  return idleMs > 0 && now - lastInput >= idleMs ? "idle" : "active";
}
