// Blickwinkel (ohne THREE, mit node testbar): feste Ansichten (Iso, Oben, Fassaden nach Himmelsrichtung),
// gemerkte Ansichten prüfen und begrenzen.

const RAD = Math.PI / 180;
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

export const VIEW_PRESETS = [
  ["iso", "Iso"],
  ["oben", "Oben"],
  ["sued", "Süd"],
  ["nord", "Nord"],
  ["ost", "Ost"],
  ["west", "West"],
];

export const MAX_VIEWS = 6;

/** Himmelsrichtungen im Grundriss [x, z] bei Norden um north Grad gedreht (wie compassOf). */
function compass(north) {
  const n = (Number(north) || 0) * RAD;
  const N = [Math.sin(n), -Math.cos(n)];
  const E = [Math.cos(n), Math.sin(n)];
  return { N, E, S: [-N[0], -N[1]], W: [-E[0], -E[1]] };
}

/**
 * Kamera für eine feste Ansicht.
 * @param {"iso"|"oben"|"sued"|"nord"|"ost"|"west"} name
 * @param {{min: number[], max: number[]}} box Haus (ohne Garten)
 * @param {{north?: number, fov?: number, aspect?: number}} o fov: senkrechter Öffnungswinkel in Grad
 * @returns {{target: number[], position: number[]}}
 */
export function presetPose(name, box, { north = 0, fov = 45, aspect = 1 } = {}) {
  const c = box.min.map((v, i) => (v + box.max[i]) / 2);
  const size = box.max.map((v, i) => v - box.min[i]);
  const half = Math.tan((fov * RAD) / 2);
  const narrow = Math.min(1, aspect);
  const radius = Math.max(size[0], size[2], 4) * 0.5;
  const at = (dir, dist) => {
    const d = norm(dir);
    return { target: c, position: c.map((v, i) => v + d[i] * dist) };
  };
  if (name === "oben") {
    // senkrecht von oben, Norden oben im Bild (Kamera minimal nach Süden versetzt)
    const { S } = compass(north);
    return at([S[0] * 0.01, 1, S[1] * 0.01], ((radius * 1.1) / half / narrow) + size[1] / 2);
  }
  const face = { sued: "S", nord: "N", ost: "E", west: "W" }[name];
  if (face) {
    // Fassade aus 15° Höhe: Abstand nach Breite und Höhe der Ansicht
    const h = compass(north)[face];
    const el = 15 * RAD;
    const across = Math.abs(h[0]) > Math.abs(h[1]) ? size[2] : size[0];
    const depth = Math.abs(h[0]) > Math.abs(h[1]) ? size[0] : size[2];
    const need = Math.max((Math.max(across, 4) * 0.55) / narrow, size[1] * 0.6);
    return at([h[0] * Math.cos(el), Math.sin(el), h[1] * Math.cos(el)], need / half + depth / 2);
  }
  // Iso: wie bisher (fitCamera)
  return at([0.35, 0.95, 0.75], (radius / half / narrow) * 1.05);
}

/** Liegt die gemerkte Ansicht noch beim Haus? (nach Umbauten im Grundriss sonst einpassen) */
export function poseInBox(pose, box, margin = 5) {
  if (!validPose(pose)) return false;
  const t = pose.target;
  if (!t.every((v, i) => v >= box.min[i] - margin && v <= box.max[i] + margin)) return false;
  const dist = Math.hypot(...pose.position.map((v, i) => v - t[i]));
  const size = Math.hypot(...box.max.map((v, i) => v - box.min[i]));
  return dist > 0.5 && dist < Math.max(60, size * 8);
}

function validPose(p) {
  const ok = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
  return !!p && ok(p.target) && ok(p.position);
}

/** Gemerkte Ansichten bereinigen: gültige Posen, Name, höchstens 6. */
export function normalizeViews(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v) => validPose(v))
    .map((v) => ({ name: String(v.name ?? "Ansicht").slice(0, 30) || "Ansicht", target: v.target.map(round), position: v.position.map(round), ...(typeof v.floor === "string" ? { floor: v.floor } : {}) }))
    .slice(-MAX_VIEWS);
}

/** Pose auf Zentimeter gerundet (zum Speichern). */
export function roundPose(p) {
  return { target: p.target.map(round), position: p.position.map(round) };
}

const round = (x) => Math.round(x * 100) / 100;
