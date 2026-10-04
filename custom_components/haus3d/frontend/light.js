// Echtes Licht (ohne DOM, mit node testbar): Lampenfarbe und Helligkeit je Raum.

/** Farbtemperatur → [r, g, b] 0..1 (Näherung nach Tanner Helland). */
export function kelvinToRgb(kelvin) {
  const t = Math.min(40000, Math.max(1000, Number(kelvin) || 2700)) / 100;
  const clamp = (v) => Math.min(255, Math.max(0, v)) / 255;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r), clamp(g), clamp(b)];
}

/** HSV-Farbton/Sättigung (hs_color: [0..360, 0..100]) → [r, g, b] 0..1 bei voller Helligkeit. */
function hsToRgb(h, s) {
  const S = Math.min(1, Math.max(0, s / 100));
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 1 - S * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/**
 * Aussehen einer Lampe: null wenn aus, sonst Farbe (rgb_color → hs_color → color_temp_kelvin/mired →
 * 2700 K) und Helligkeit 0..1 (brightness/255, ohne Angabe 1).
 * @returns {{color: number[], level: number}|null}
 */
export function lightLook(st) {
  if (!st || st.state !== "on") return null;
  const a = st.attributes ?? {};
  let color;
  if (Array.isArray(a.rgb_color) && a.rgb_color.length >= 3) color = a.rgb_color.slice(0, 3).map((v) => Math.min(255, Math.max(0, Number(v) || 0)) / 255);
  else if (Array.isArray(a.hs_color) && a.hs_color.length >= 2) color = hsToRgb(Number(a.hs_color[0]) || 0, Number(a.hs_color[1]) || 0);
  else if (Number(a.color_temp_kelvin) > 0) color = kelvinToRgb(a.color_temp_kelvin);
  else if (Number(a.color_temp) > 0) color = kelvinToRgb(1e6 / Number(a.color_temp));
  else color = kelvinToRgb(2700);
  const b = Number(a.brightness);
  const level = Number.isFinite(b) && a.brightness !== null ? Math.min(1, Math.max(0.05, b / 255)) : 1;
  return { color, level };
}

/**
 * Licht eines Raums: nach Helligkeit gewichtete Mischfarbe und höchste Helligkeit; Lichtgruppen
 * (Attribut entity_id) zählen nicht doppelt. null = kein Licht an.
 */
export function roomLight(room, hass, byArea) {
  if (!room?.area_id) return null;
  let w = 0;
  let level = 0;
  const sum = [0, 0, 0];
  for (const id of byArea.get(room.area_id) ?? []) {
    if (!id.startsWith("light.")) continue;
    const st = hass.states[id];
    if (Array.isArray(st?.attributes?.entity_id)) continue;
    const look = lightLook(st);
    if (!look) continue;
    w += look.level;
    level = Math.max(level, look.level);
    for (let i = 0; i < 3; i++) sum[i] += look.color[i] * look.level;
  }
  if (!w) {
    // nur Gruppen an (Einzellampen unbekannt): Gruppe selbst nehmen
    for (const id of byArea.get(room.area_id) ?? []) {
      const look = id.startsWith("light.") ? lightLook(hass.states[id]) : null;
      if (look) return look;
    }
    return null;
  }
  return { color: sum.map((v) => v / w), level };
}

/** Farbe auf 4 Bit je Kanal (Schlüssel für Material-Zwischenspeicher). */
export function colorKey(color) {
  return color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 15).toString(16)).join("");
}
