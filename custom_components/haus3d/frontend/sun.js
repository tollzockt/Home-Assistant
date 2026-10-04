// Sonnenstand (ohne THREE, mit node testbar): Azimut/Höhe nach NOAA, Richtung in Szenen-Achsen
// (Norden wie exterior.js:compassOf), Lichtfarbe und -stärke nach Sonnenhöhe.

const RAD = Math.PI / 180;

/**
 * Sonnenstand zu einem Zeitpunkt (NOAA-Näherung, genau auf etwa 0,1°; ohne Refraktion).
 * @param {Date|number} date
 * @returns {{azimuth: number, elevation: number}} Azimut in Grad im Uhrzeigersinn ab Norden
 */
export function sunPosition(date, lat, lon) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  const jd = ms / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot = (4 / RAD) * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minutes = (((ms % 86400000) + 86400000) % 86400000) / 60000;
  const tst = (((minutes + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.min(1, Math.max(-1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)));
  const elevation = 90 - Math.acos(cosZ) / RAD;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { azimuth: ((az % 360) + 360) % 360, elevation };
}

/**
 * Einheitsvektor zur Sonne in Szenen-Achsen [x, y, z] (y oben). north: Grad, um die „oben im Plan“
 * (-z) gedreht ist – gleiche Achsen wie compassOf.
 */
export function sunVector(azimuthDeg, elevationDeg, northDeg = 0) {
  const n = northDeg * RAD;
  const a = azimuthDeg * RAD;
  const el = elevationDeg * RAD;
  const N = [Math.sin(n), -Math.cos(n)];
  const E = [Math.cos(n), Math.sin(n)];
  const h = Math.cos(el);
  return [h * (Math.cos(a) * N[0] + Math.sin(a) * E[0]), Math.sin(el), h * (Math.cos(a) * N[1] + Math.sin(a) * E[1])];
}

const mix = (a, b, t) => a + (b - a) * t;
const hex = (r, g, b) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/**
 * Licht nach Sonnenhöhe: Stärke wächst mit sin(Höhe), unter etwa 12° warm (Abendrot), am Horizont
 * gedimmt; Himmelslicht nie ganz dunkel (Schattenseite bleibt lesbar).
 * @returns {{colorHex: number, intensityFactor: number, hemiFactor: number}|null} null = Sonne unter
 *   dem Horizont (Mondlicht wie bisher)
 */
export function sunLook(elevationDeg) {
  if (!Number.isFinite(elevationDeg) || elevationDeg <= -2) return null;
  const el = Math.max(0, elevationDeg);
  const s = Math.sin(el * RAD);
  const warm = Math.min(1, Math.max(0, (12 - el) / 12));
  const color = hex(255, mix(255, 176, warm), mix(255, 110, warm));
  return {
    colorHex: color,
    intensityFactor: Math.min(1.1, 0.25 + 1.1 * Math.sqrt(s)),
    hemiFactor: Math.min(1, 0.6 + 0.6 * s),
  };
}

/**
 * Sonnenstand aus Home Assistant: Attribute von sun.sun (azimuth/elevation), sonst berechnet aus
 * hass.config (Breite/Länge). null, wenn nichts bekannt ist.
 */
export function sunFromHass(hass, now = Date.now()) {
  const a = hass?.states?.["sun.sun"]?.attributes;
  if (a && Number.isFinite(Number(a.azimuth)) && Number.isFinite(Number(a.elevation)) && a.azimuth !== null && a.elevation !== null) {
    return { azimuth: Number(a.azimuth), elevation: Number(a.elevation) };
  }
  const lat = Number(hass?.config?.latitude);
  const lon = Number(hass?.config?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || hass?.config?.latitude == null) return null;
  return sunPosition(now, lat, lon);
}

/** Winkel zwischen zwei Richtungen in Grad (für „nur bei Änderung über 0,3°“). */
export function angleBetween(a, b) {
  if (!a || !b) return Infinity;
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, d))) / RAD;
}
