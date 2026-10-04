// Treppen (ohne THREE, mit node testbar): Stufen gerade bzw. viertelgewendelt mit Podest, Grundfläche,
// Deckenöffnung in der Etage darüber, Zuschneiden an Räumen.

export const STAIR_SHAPES = [
  ["straight", "gerade"],
  ["l_left", "viertelgewendelt links"],
  ["l_right", "viertelgewendelt rechts"],
];
export const RAILINGS_STAIR = [
  ["none", "keins"],
  ["left", "links"],
  ["right", "rechts"],
  ["both", "beidseitig"],
];
const DEFAULT = { w: 1.0, d: 3.0, h: 2.6 };

/**
 * Stufen im Möbel-System (w entlang x, d entlang z, Antritt vorne bei +z): je Stufe {x0, x1, z0, z1,
 * top}; Podest mit landing: true. Gerade: eine Flucht nach −z. Viertelgewendelt: erste Flucht nach −z
 * an der rechten (links abbiegend) bzw. linken Seite, Podest hinten, zweite Flucht quer.
 */
export function stairLayout({ shape = "straight", w = DEFAULT.w, d = DEFAULT.d, h = DEFAULT.h, rise = 0.18 } = {}) {
  const n = Math.max(3, Math.round(h / rise));
  const r = h / n;
  const treads = [];
  if (shape !== "l_left" && shape !== "l_right") {
    const t = d / n;
    for (let i = 0; i < n; i++) treads.push({ x0: -w / 2, x1: w / 2, z0: d / 2 - (i + 1) * t, z1: d / 2 - i * t, top: (i + 1) * r });
    return { treads, count: n, rise: r };
  }
  const sw = Math.min(1.0, w / 2, d / 2); // Laufbreite
  const L1 = d - sw;
  const L2 = w - sw;
  const n1 = Math.max(1, Math.round(((n - 1) * L1) / (L1 + L2)));
  const n2 = Math.max(1, n - 1 - n1);
  const nn = n1 + 1 + n2;
  const rr = h / nn;
  const left = shape === "l_left";
  // erste Flucht an der Seite gegenüber der Abbiegerichtung
  const cx0 = left ? w / 2 - sw : -w / 2;
  const t1 = L1 / n1;
  for (let i = 0; i < n1; i++) treads.push({ x0: cx0, x1: cx0 + sw, z0: d / 2 - (i + 1) * t1, z1: d / 2 - i * t1, top: (i + 1) * rr });
  treads.push({ x0: cx0, x1: cx0 + sw, z0: -d / 2, z1: -d / 2 + sw, top: (n1 + 1) * rr, landing: true });
  const t2 = L2 / n2;
  for (let i = 0; i < n2; i++) {
    const a = left ? w / 2 - sw - (i + 1) * t2 : -w / 2 + sw + i * t2;
    treads.push({ x0: a, x1: a + t2, z0: -d / 2, z1: -d / 2 + sw, top: (n1 + 2 + i) * rr });
  }
  return { treads, count: nn, rise: rr };
}

/** Grundfläche (4 Ecken im Grundriss) eines Möbelstücks mit w × d und Drehung wie in der Szene. */
export function stairFootprint(item) {
  const w = Number(item.w) || DEFAULT.w;
  const d = Number(item.d) || DEFAULT.d;
  const a = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [item.x + x * c - z * s, item.z + x * s + z * c]);
}

/** Oberkante einer Treppe über Null. */
export function stairTop(floor, item) {
  return (floor.elevation ?? 0) + (Number(item.mount_y) || 0) + (Number(item.h) || DEFAULT.h);
}

/**
 * Deckenöffnungen einer Etage: Treppen der Etagen darunter, die bis hierher reichen (cut nicht false),
 * und Treppenlöcher (stairwell) dieser Etage.
 * @returns {{poly: number[][], from: string}[]}
 */
export function slabOpenings(building, floorId) {
  const floors = building?.floors ?? [];
  const floor = floors.find((f) => f.id === floorId);
  if (!floor) return [];
  const elev = floor.elevation ?? 0;
  const out = [];
  for (const f of floors) {
    if ((f.elevation ?? 0) >= elev) continue;
    for (const m of f.furniture ?? []) {
      if (m?.type !== "stairs" || m.cut === false || !Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
      const top = stairTop(f, m);
      if (top >= elev - 0.3 && top <= elev + 0.5) out.push({ poly: stairFootprint(m), from: f.name ?? f.id });
    }
  }
  for (const m of floor.furniture ?? []) {
    if (m?.type === "stairwell" && Number.isFinite(m.x) && Number.isFinite(m.z)) out.push({ poly: stairFootprint(m), from: floor.name ?? floor.id });
  }
  return out;
}

const area = (p) => Math.abs(p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a[0] * b[1] - b[0] * a[1];
}, 0)) / 2;

/** Sutherland–Hodgman: subject (auch konkav) mit konvexem clip schneiden. */
export function clipPolygon(subject, clip) {
  let out = subject;
  // Umlaufsinn des Clip-Polygons
  const sign = clip.reduce((s, a, i) => {
    const b = clip[(i + 1) % clip.length];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-9;
    const cut = (p, q) => {
      const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
      const t = d1 / (d1 - d2);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cut(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cut(p, q));
    }
  }
  return out;
}

/** Loch für einen Raum: Öffnung ∩ Raum, 1 cm eingerückt; zu klein (< 0,1 m²) → null. */
export function roomHole(roomPoints, hole, inset = 0.01) {
  const p = clipPolygon(roomPoints, hole);
  if (p.length < 3 || area(p) < 0.1) return null;
  const c = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  return p.map((q) => {
    const dx = c[0] - q[0];
    const dz = c[1] - q[1];
    const l = Math.hypot(dx, dz) || 1;
    return [q[0] + (dx / l) * Math.min(inset * 1.5, l / 2), q[1] + (dz / l) * Math.min(inset * 1.5, l / 2)];
  });
}
