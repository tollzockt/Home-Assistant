// Treppen (ohne THREE, mit node testbar): gerade, L mit Podest, L gewendelt (Wendelstufen im Eck),
// U mit Podest und Wendeltreppe; Grundfläche, Deckenöffnung in der Etage darüber, Zuschneiden an Räumen.

export const STAIR_SHAPES = [
  ["straight", "gerade"],
  ["l_left", "L mit Podest, Kehre links"],
  ["l_right", "L mit Podest, Kehre rechts"],
  ["lw_left", "L gewendelt, Kehre links"],
  ["lw_right", "L gewendelt, Kehre rechts"],
  ["u_left", "U mit Podest, Kehre links"],
  ["u_right", "U mit Podest, Kehre rechts"],
  ["spiral", "Wendeltreppe"],
];
export const RAILINGS_STAIR = [
  ["none", "keins"],
  ["left", "links"],
  ["right", "rechts"],
  ["both", "beidseitig"],
];
const DEFAULT = { w: 1.0, d: 3.0, h: 2.6 };

const shapeKind = (s) => (s === "l_left" || s === "l_right" ? "l" : s === "lw_left" || s === "lw_right" ? "lw" : s === "u_left" || s === "u_right" ? "u" : s === "spiral" ? "spiral" : "straight");
const turnsLeft = (s) => /_left$/.test(s ?? "");

/** Laufbreite: angegeben oder passend zur Grundfläche (höchstens 1 m). */
export function runWidth({ shape, w = DEFAULT.w, d = DEFAULT.d, run = null } = {}) {
  const k = shapeKind(shape);
  if (k === "straight") return w;
  if (k === "spiral") return Math.min(w, d) / 2;
  const max = k === "u" ? w / 2 : Math.min(w, d) / 2;
  return Math.max(0.5, Math.min(max, Number(run) > 0 ? Number(run) : Math.min(1.0, max)));
}

/**
 * Stufen im Möbel-System (w entlang x, d entlang z, Antritt vorne bei +z). Je Stufe {x0, x1, z0, z1, top}
 * oder bei Wendel-/Fächerstufen ein Vieleck {poly, top}; Podest mit landing: true.
 * @returns {{treads: object[], count: number, rise: number, run: number, path: number[][]}} path: Lauflinie
 */
export function stairLayout({ shape = "straight", w = DEFAULT.w, d = DEFAULT.d, h = DEFAULT.h, rise = 0.18, run = null } = {}) {
  const k = shapeKind(shape);
  const n = Math.max(3, Math.round(h / rise));
  const treads = [];
  const sw = runWidth({ shape, w, d, run });
  if (k === "straight") {
    const r = h / n;
    const t = d / n;
    for (let i = 0; i < n; i++) treads.push({ x0: -w / 2, x1: w / 2, z0: d / 2 - (i + 1) * t, z1: d / 2 - i * t, top: (i + 1) * r });
    return { treads, count: n, rise: r, run: w, path: [[0, d / 2], [0, -d / 2]] };
  }
  if (k === "spiral") return spiralLayout(w, d, h, n);
  const left = turnsLeft(shape);
  const flip = (x) => (left ? x : -x);
  if (k === "u") {
    // erste Flucht rechts (Kehre links) nach −z, Podest hinten über die ganze Breite, zweite Flucht zurück
    const L = d - sw;
    const n1 = Math.max(1, Math.floor((n - 1) / 2));
    const n2 = Math.max(1, n - 1 - n1);
    const nn = n1 + 1 + n2;
    const r = h / nn;
    const t1 = L / n1;
    const t2 = L / n2;
    const c1 = [w / 2 - sw, w / 2]; // rechte Spalte (bei Kehre links)
    const c2 = [-w / 2, -w / 2 + sw];
    const col = ([a, b]) => (left ? [a, b] : [-b, -a]);
    for (let i = 0; i < n1; i++) {
      const [x0, x1] = col(c1);
      treads.push({ x0, x1, z0: d / 2 - (i + 1) * t1, z1: d / 2 - i * t1, top: (i + 1) * r });
    }
    treads.push({ x0: -w / 2, x1: w / 2, z0: -d / 2, z1: -d / 2 + sw, top: (n1 + 1) * r, landing: true });
    for (let i = 0; i < n2; i++) {
      const [x0, x1] = col(c2);
      treads.push({ x0, x1, z0: -d / 2 + sw + i * t2, z1: -d / 2 + sw + (i + 1) * t2, top: (n1 + 2 + i) * r });
    }
    const mx1 = flip(w / 2 - sw / 2);
    const mx2 = flip(-w / 2 + sw / 2);
    return { treads, count: nn, rise: r, run: sw, path: [[mx1, d / 2], [mx1, -d / 2 + sw / 2], [mx2, -d / 2 + sw / 2], [mx2, d / 2]] };
  }
  // L: erste Flucht an der Seite gegenüber der Kehre nach −z, im hinteren Eck Podest bzw. 3 Wendelstufen,
  // zweite Flucht quer zur Kehrseite
  const winders = k === "lw" ? 3 : 1;
  const L1 = d - sw;
  const L2 = w - sw;
  const n1 = Math.max(1, Math.round(((n - winders) * L1) / (L1 + L2)));
  const n2 = Math.max(1, n - winders - n1);
  const nn = n1 + winders + n2;
  const r = h / nn;
  const t1 = L1 / n1;
  const t2 = L2 / n2;
  const cx0 = left ? w / 2 - sw : -w / 2; // Spalte der ersten Flucht
  for (let i = 0; i < n1; i++) treads.push({ x0: cx0, x1: cx0 + sw, z0: d / 2 - (i + 1) * t1, z1: d / 2 - i * t1, top: (i + 1) * r });
  if (k === "l") treads.push({ x0: cx0, x1: cx0 + sw, z0: -d / 2, z1: -d / 2 + sw, top: (n1 + 1) * r, landing: true });
  else {
    // Wendelstufen: Fächer um die innere Ecke des Eckquadrats, je 30°
    const pivot = [left ? cx0 : cx0 + sw, -d / 2 + sw];
    const sq = { x0: cx0, x1: cx0 + sw, z0: -d / 2, z1: -d / 2 + sw };
    const dirAt = (deg) => {
      const a = (deg * Math.PI) / 180;
      // 0° = entlang der Eintrittskante (weg von der inneren Ecke), 90° = nach hinten (−z)
      return [left ? Math.cos(a) : -Math.cos(a), -Math.sin(a)];
    };
    const hit = (dir) => {
      const ts = [];
      if (dir[0] > 1e-9) ts.push((sq.x1 - pivot[0]) / dir[0]);
      if (dir[0] < -1e-9) ts.push((sq.x0 - pivot[0]) / dir[0]);
      if (dir[1] < -1e-9) ts.push((sq.z0 - pivot[1]) / dir[1]);
      const t = Math.min(...ts.filter((x) => x > 1e-9));
      return [pivot[0] + dir[0] * t, pivot[1] + dir[1] * t];
    };
    const corner = [left ? sq.x1 : sq.x0, sq.z0];
    for (let j = 0; j < 3; j++) {
      const a0 = j * 30;
      const a1 = (j + 1) * 30;
      const poly = [pivot, hit(dirAt(a0))];
      if (a0 < 45 && a1 > 45) poly.push(corner);
      poly.push(hit(dirAt(a1)));
      // die Kanten liegen auf dem Quadratrand: Ecke einfügen, wenn der Fächer sie überspannt
      treads.push({ poly, top: (n1 + 1 + j) * r, winder: true });
    }
  }
  for (let i = 0; i < n2; i++) {
    const a = left ? w / 2 - sw - (i + 1) * t2 : -w / 2 + sw + i * t2;
    treads.push({ x0: a, x1: a + t2, z0: -d / 2, z1: -d / 2 + sw, top: (n1 + winders + 1 + i) * r });
  }
  const mx = cx0 + sw / 2;
  const mz = -d / 2 + sw / 2;
  return { treads, count: nn, rise: r, run: sw, path: [[mx, d / 2], [mx, mz], [left ? -w / 2 : w / 2, mz]] };
}

function spiralLayout(w, d, h, n) {
  const R = Math.min(w, d) / 2;
  const r0 = Math.min(0.12, R * 0.15); // Spindel
  const turn = Math.min(360, n * 22.5); // höchstens eine volle Umdrehung
  const step = turn / n;
  const treads = [];
  const P = (rad, deg) => [rad * Math.sin((deg * Math.PI) / 180), rad * Math.cos((deg * Math.PI) / 180)];
  for (let i = 0; i < n; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    treads.push({ poly: [P(r0, a0), P(R, a0), P(R, (a0 + a1) / 2), P(R, a1), P(r0, a1)], top: ((i + 1) * h) / n, spiral: true });
  }
  const path = [];
  for (let a = 0; a <= turn; a += step) path.push(P((R + r0) / 2, a));
  return { treads, count: n, rise: h / n, run: R - r0, path, spindle: r0, radius: R };
}

/** Punkt im Möbel-System → Grundriss (gedreht wie in der Szene). */
export function toPlan(item, [x, z]) {
  const a = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [item.x + x * c - z * s, item.z + x * s + z * c];
}

/** Grundfläche (4 Ecken im Grundriss) eines Möbelstücks mit w × d und Drehung wie in der Szene. */
export function stairFootprint(item) {
  const w = Number(item.w) || DEFAULT.w;
  const d = Number(item.d) || DEFAULT.d;
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map((p) => toPlan(item, p));
}

/**
 * Deckenöffnung einer Treppe (konvex, im Grundriss): gerade und U über die ganze Grundfläche, L über
 * Eck und zweite Flucht (dort geht man unter der Decke hindurch), Wendeltreppe als Kreis.
 */
export function stairHole(item) {
  const w = Number(item.w) || DEFAULT.w;
  const d = Number(item.d) || DEFAULT.d;
  const k = shapeKind(item.stair_shape);
  if (k === "spiral") {
    const R = Math.min(w, d) / 2;
    return Array.from({ length: 16 }, (_, i) => toPlan(item, [R * Math.cos((i * Math.PI) / 8), R * Math.sin((i * Math.PI) / 8)]));
  }
  if (k === "l" || k === "lw") {
    const sw = runWidth({ shape: item.stair_shape, w, d, run: item.run_width });
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + sw], [-w / 2, -d / 2 + sw]].map((p) => toPlan(item, p));
  }
  return stairFootprint(item);
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
      if (top >= elev - 0.3 && top <= elev + 0.5) out.push({ poly: stairHole(m), from: f.name ?? f.id });
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
