// Außenbereich ohne Three.js (mit node testbar): Dachrahmen, Balkonkanten, Wetter, Streupunkte.
// Koordinaten in Metern, Plan [x, z].

import { pointInPolygon } from "./walls.js";

export const ROOF_TYPES = [
  ["none", "Kein Dach"],
  ["flat", "Flachdach"],
  ["gable", "Satteldach"],
  ["hip", "Walmdach"],
  ["shed", "Pultdach"],
];

export const DEFAULT_ROOF = { type: "none", pitch: 35, overhang: 0.4, direction: "auto", floor: null, color: null };

/** Dacheinstellungen mit Standardwerten. */
export function roofSettings(settings) {
  const r = { ...DEFAULT_ROOF, ...(settings?.roof ?? {}) };
  if (!ROOF_TYPES.some(([k]) => k === r.type)) r.type = "none";
  r.pitch = Math.min(60, Math.max(5, Number(r.pitch) || DEFAULT_ROOF.pitch));
  r.overhang = Math.min(1.5, Math.max(0, Number(r.overhang ?? DEFAULT_ROOF.overhang)));
  return r;
}

/** Hauptrichtung der Kanten (Winkel in rad, 0 bis PI/2), gewichtet nach Länge. */
export function mainDirection(rooms) {
  // Winkel modulo 90° als Vektor auf dem Vierfach-Kreis mitteln
  let sx = 0;
  let sz = 0;
  for (const r of rooms) {
    const pts = r.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const t = 4 * Math.atan2(dz, dx);
      sx += len * Math.cos(t);
      sz += len * Math.sin(t);
    }
  }
  let ang = Math.atan2(sz, sx) / 4;
  if (ang < 0) ang += Math.PI / 2;
  return Math.abs(ang - Math.PI / 2) < 1e-9 ? 0 : ang;
}

/**
 * Rechteck, auf dem das Dach sitzt: an der Hauptrichtung des Hauses ausgerichtet, um Außenwand und
 * Überstand vergrößert. First entlang der langen Seite (oder direction "x"/"z").
 * @returns {{center:[number,number], u:[number,number], v:[number,number], length:number, width:number}|null}
 *   u = Richtung des Firsts, length entlang u, width quer dazu.
 */
export function roofFrame(rooms, { wall = 0.24, overhang = 0.4, direction = "auto" } = {}) {
  const pts = rooms.flatMap((r) => r.points ?? []);
  if (pts.length < 3) return null;
  const ang = mainDirection(rooms);
  const a = [Math.cos(ang), Math.sin(ang)];
  const b = [-a[1], a[0]];
  let [minA, maxA, minB, maxB] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, z] of pts) {
    const pa = x * a[0] + z * a[1];
    const pb = x * b[0] + z * b[1];
    minA = Math.min(minA, pa);
    maxA = Math.max(maxA, pa);
    minB = Math.min(minB, pb);
    maxB = Math.max(maxB, pb);
  }
  const grow = wall + overhang;
  const lenA = maxA - minA + 2 * grow;
  const lenB = maxB - minB + 2 * grow;
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  const center = [r3(ca * a[0] + cb * b[0]), r3(ca * a[1] + cb * b[1])];
  // "x"/"z": First möglichst parallel zur Plan-Achse
  let alongA = lenA >= lenB;
  if (direction === "x") alongA = Math.abs(a[0]) >= Math.abs(b[0]);
  else if (direction === "z") alongA = Math.abs(a[1]) >= Math.abs(b[1]);
  return alongA
    ? { center, u: a, v: b, length: r3(lenA), width: r3(lenB) }
    : { center, u: b, v: [-a[0], -a[1]], length: r3(lenB), width: r3(lenA) };
}

/**
 * Dachteile für beliebige rechtwinklige Grundrisse (L, T, U): Grundriss am Haus ausgerichtet in
 * Rechtecke zerlegen. Der größte Teil ist das Hauptdach; Flügel laufen bis zum First des Teils,
 * an dem sie hängen (so entsteht ein L- oder T-Satteldach).
 * @returns {{center:number[], u:number[], v:number[], length:number, width:number, open:[boolean, boolean]}[]}
 *   open[0]/open[1]: Ende bei -length/2 bzw. +length/2 steckt im Nachbardach (kein Giebel nötig).
 */
export function roofParts(rooms, { wall = 0.24, overhang = 0.4, direction = "auto", maxParts = 4 } = {}) {
  const all = rooms.flatMap((r) => r.points ?? []);
  if (all.length < 3) return [];
  const ang = mainDirection(rooms);
  const A = [Math.cos(ang), Math.sin(ang)];
  const B = [-A[1], A[0]];
  const loc = (p) => [p[0] * A[0] + p[1] * A[1], p[0] * B[0] + p[1] * B[1]];
  const polys = rooms.map((r) => r.points.map(loc));
  // Kanten sammeln, nahe Werte (< 0,4 m) zusammenfassen: kleine Nischen und Versätze verschwinden
  const merge = (vals) => {
    const out = [];
    for (const v of vals.sort((x, y) => x - y)) if (!out.length || v - out[out.length - 1] > 0.4) out.push(v);
    return out;
  };
  const xs = merge(polys.flat().map((p) => p[0]));
  const ys = merge(polys.flat().map((p) => p[1]));
  const n = xs.length - 1;
  const m = ys.length - 1;
  if (n < 1 || m < 1) return [];
  const inside = [];
  for (let i = 0; i < n; i++) {
    inside.push([]);
    for (let j = 0; j < m; j++) {
      const c = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
      inside[i].push(polys.some((p) => pointInPolygon(c, p)));
    }
  }
  // schmale Streifen zwischen zwei Räumen (Spalt, Schacht) gehören zum Haus
  const thin = inside.map((row, i) =>
    row.map((v, j) =>
      v ||
      (xs[i + 1] - xs[i] < 0.6 && i > 0 && i < n - 1 && inside[i - 1][j] && inside[i + 1][j]) ||
      (ys[j + 1] - ys[j] < 0.6 && j > 0 && j < m - 1 && inside[i][j - 1] && inside[i][j + 1]),
    ),
  );
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) inside[i][j] = thin[i][j];
  // Löcher (z. B. Schacht zwischen zwei Räumen) füllen: alles, was nicht von außen erreichbar ist
  const outside = inside.map((row) => row.map(() => false));
  const stack = [];
  for (let i = 0; i < n; i++) for (const j of [0, m - 1]) stack.push([i, j]);
  for (let j = 0; j < m; j++) for (const i of [0, n - 1]) stack.push([i, j]);
  while (stack.length) {
    const [i, j] = stack.pop();
    if (i < 0 || j < 0 || i >= n || j >= m || outside[i][j] || inside[i][j]) continue;
    outside[i][j] = true;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  const cell = inside.map((row, i) => row.map((v, j) => v || !outside[i][j]));
  const area = (i0, i1, j0, j1) => (xs[i1] - xs[i0]) * (ys[j1] - ys[j0]);
  const full = (i0, i1, j0, j1, test) => {
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (!test(i, j)) return false;
    return true;
  };
  // größtes Rechteck aus Zellen, die test erfüllen
  const largest = (test) => {
    let best = null;
    for (let i0 = 0; i0 < n; i0++)
      for (let i1 = i0 + 1; i1 <= n; i1++)
        for (let j0 = 0; j0 < m; j0++)
          for (let j1 = j0 + 1; j1 <= m; j1++) {
            if (!full(i0, i1, j0, j1, test)) break;
            const a = area(i0, i1, j0, j1);
            if (!best || a > best.a + 1e-9) best = { i0, i1, j0, j1, a };
          }
    return best;
  };
  const covered = cell.map((row) => row.map(() => false));
  const cover = (r) => {
    for (let i = r.i0; i < r.i1; i++) for (let j = r.j0; j < r.j1; j++) covered[i][j] = true;
  };
  const total = cell.flat().reduce((s, v, k) => s + (v ? area(Math.floor(k / m), Math.floor(k / m) + 1, k % m, (k % m) + 1) : 0), 0);
  const main = largest((i, j) => cell[i][j]);
  if (!main) return [];
  cover(main);
  // Rechteck in lokalen Koordinaten [a0, a1] × [b0, b1], ridge: "a" oder "b"
  const lenA = xs[main.i1] - xs[main.i0];
  const lenB = ys[main.j1] - ys[main.j0];
  let mainRidge = lenA >= lenB ? "a" : "b";
  if (direction === "x") mainRidge = Math.abs(A[0]) >= Math.abs(B[0]) ? "a" : "b";
  else if (direction === "z") mainRidge = Math.abs(A[1]) >= Math.abs(B[1]) ? "a" : "b";
  const parts = [{ a0: xs[main.i0], a1: xs[main.i1], b0: ys[main.j0], b1: ys[main.j1], ridge: mainRidge, open: [false, false], ext: {} }];
  while (parts.length < maxParts) {
    const rest = cell.flat().reduce((s, v, k) => s + (v && !covered[Math.floor(k / m)][k % m] ? area(Math.floor(k / m), Math.floor(k / m) + 1, k % m, (k % m) + 1) : 0), 0);
    if (rest < Math.max(4, total * 0.05)) break;
    const stub = largest((i, j) => cell[i][j] && !covered[i][j]);
    if (!stub || stub.a < 3) break;
    cover(stub);
    const part = { a0: xs[stub.i0], a1: xs[stub.i1], b0: ys[stub.j0], b1: ys[stub.j1], open: [false, false], ext: {} };
    // Anschluss an ein vorhandenes Teil suchen, dessen First quer zur Anschlussrichtung läuft
    const eps = 0.01;
    for (const q of parts) {
      const overlapA = Math.min(part.a1, q.a1) - Math.max(part.a0, q.a0) > 0.3;
      const overlapB = Math.min(part.b1, q.b1) - Math.max(part.b0, q.b0) > 0.3;
      if (overlapA && q.ridge === "a" && Math.abs(part.b1 - q.b0) < eps) {
        part.b1 = (q.b0 + q.b1) / 2; part.ridge = "b"; part.open = [false, true]; part.ext.b1 = true; break;
      }
      if (overlapA && q.ridge === "a" && Math.abs(part.b0 - q.b1) < eps) {
        part.b0 = (q.b0 + q.b1) / 2; part.ridge = "b"; part.open = [true, false]; part.ext.b0 = true; break;
      }
      if (overlapB && q.ridge === "b" && Math.abs(part.a1 - q.a0) < eps) {
        part.a1 = (q.a0 + q.a1) / 2; part.ridge = "a"; part.open = [false, true]; part.ext.a1 = true; break;
      }
      if (overlapB && q.ridge === "b" && Math.abs(part.a0 - q.a1) < eps) {
        part.a0 = (q.a0 + q.a1) / 2; part.ridge = "a"; part.open = [true, false]; part.ext.a0 = true; break;
      }
    }
    part.ridge ??= part.a1 - part.a0 >= part.b1 - part.b0 ? "a" : "b";
    parts.push(part);
  }
  const grow = wall + overhang;
  return parts.map((q) => {
    const a0 = q.a0 - (q.ext.a0 ? 0 : grow);
    const a1 = q.a1 + (q.ext.a1 ? 0 : grow);
    const b0 = q.b0 - (q.ext.b0 ? 0 : grow);
    const b1 = q.b1 + (q.ext.b1 ? 0 : grow);
    const ca = (a0 + a1) / 2;
    const cb = (b0 + b1) / 2;
    const center = [r3(ca * A[0] + cb * B[0]), r3(ca * A[1] + cb * B[1])];
    return q.ridge === "a"
      ? { center, u: A, v: B, length: r3(a1 - a0), width: r3(b1 - b0), open: q.open }
      : { center, u: B, v: [-A[0], -A[1]], length: r3(b1 - b0), width: r3(a1 - a0), open: q.open };
  });
}

/** Oberste Etage mit Räumen (oder die in roof.floor genannte). */
export function roofFloor(building, roof) {
  const floors = (building.floors ?? []).filter((f) => (f.rooms ?? []).length);
  if (roof?.floor) {
    const f = floors.find((x) => x.id === roof.floor);
    if (f) return f;
  }
  return floors.reduce((top, f) => (!top || (f.elevation ?? 0) + (f.height ?? 2.5) > (top.elevation ?? 0) + (top.height ?? 2.5) ? f : top), null);
}

/**
 * Räume unter dem Dach: roof.rooms (IDs) oder die größte Gruppe zusammenhängender Räume der Etage
 * (Schuppen, Garage mit Abstand und der Raum des Balkonkraftwerks bleiben ohne dieses Dach).
 */
export function roofRooms(floor, roof) {
  const rooms = (floor?.rooms ?? []).filter((r) => (r.points ?? []).length >= 3);
  if (Array.isArray(roof?.rooms) && roof.rooms.length) return rooms.filter((r) => roof.rooms.includes(r.id));
  const cand = rooms.filter((r) => r.area_id !== "balkonkraftwerk");
  const box = (r) => {
    const xs = r.points.map((p) => p[0]);
    const zs = r.points.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  };
  const boxes = cand.map(box);
  const parent = cand.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const gap = Math.max(a[0] - b[1], b[0] - a[1], a[2] - b[3], b[2] - a[3]);
      if (gap < 0.5) parent[find(i)] = find(j);
    }
  }
  const area = (r) => {
    let s = 0;
    for (let i = 0; i < r.points.length; i++) {
      const a = r.points[i];
      const b = r.points[(i + 1) % r.points.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  };
  const sum = new Map();
  cand.forEach((r, i) => sum.set(find(i), (sum.get(find(i)) ?? 0) + area(r)));
  const best = [...sum.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return cand.filter((_, i) => find(i) === best);
}

/** Liegt die Strecke a-b auf einer Raumkante (kollinear, überlappend)? */
function onRoomEdge(a, b, rooms, tol = 0.15) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return true;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const r of rooms) {
    const pts = r.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const el = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (el < 1e-6) continue;
      const u = [(q[0] - p[0]) / el, (q[1] - p[1]) / el];
      // parallel?
      const cross = Math.abs(((b[0] - a[0]) * u[1] - (b[1] - a[1]) * u[0]) / len);
      if (cross > 0.05) continue;
      // Abstand der Mitte zur Kantengeraden und Lage auf der Kante
      const t = (mid[0] - p[0]) * u[0] + (mid[1] - p[1]) * u[1];
      const dist = Math.abs((mid[0] - p[0]) * u[1] - (mid[1] - p[1]) * u[0]);
      if (dist <= tol && t >= -tol && t <= el + tol) return true;
    }
  }
  return false;
}

/** Kanten eines Balkons, die nicht am Haus liegen (dort kommt das Geländer hin): Liste von [a, b]. */
export function freeEdges(points, rooms) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!onRoomEdge(a, b, rooms)) out.push([a, b]);
  }
  return out;
}

/** Wetter aus einer weather-Entität: {kind: "rain"|"snow"|"hail"|null, amount: 0..1}. */
export function weatherKind(stateObj) {
  const s = stateObj?.state;
  switch (s) {
    case "rainy":
      return { kind: "rain", amount: 0.5 };
    case "pouring":
      return { kind: "rain", amount: 1 };
    case "lightning-rainy":
      return { kind: "rain", amount: 0.8, lightning: true };
    case "lightning":
      return { kind: null, amount: 0, lightning: true };
    case "snowy":
      return { kind: "snow", amount: 0.6 };
    case "snowy-rainy":
      return { kind: "snow", amount: 0.5, rain: true };
    case "hail":
      return { kind: "hail", amount: 0.7 };
    default:
      return { kind: null, amount: 0 };
  }
}

/** Erste weather-Entität, falls keine eingestellt ist. */
export function weatherEntity(hass, settings) {
  const id = settings?.weather;
  if (id === "none") return null;
  if (id && hass?.states?.[id]) return id;
  return Object.keys(hass?.states ?? {}).sort().find((e) => e.startsWith("weather.")) ?? null;
}

/** Deterministischer Zufall (gleiches Beet = gleiche Blumen bei jedem Aufbau). */
export function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bis zu n Punkte gleichmäßig zufällig im Polygon (Dichte: höchstens perM2 je m²). */
export function scatter(points, { n = 40, perM2 = 6, seed = "x", margin = 0.1 } = {}) {
  const rnd = seeded(seed);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const want = Math.min(n, Math.round((Math.abs(area) / 2) * perM2));
  const out = [];
  for (let tries = 0; out.length < want && tries < want * 30; tries++) {
    const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
    if (!pointInPolygon(p, points)) continue;
    // Abstand zum Rand
    if (margin > 0 && [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([dx, dz]) => !pointInPolygon([p[0] + dx, p[1] + dz], points))) continue;
    out.push(p);
  }
  return out;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Eigene Dächer einzelner Räume (room.roof, z. B. Schuppen, Carport): berührende Räume mit Dach
 * bilden eine Gruppe; die Einstellungen kommen vom ersten Raum der Gruppe.
 * @returns {{rooms: object[], roof: object}[]}
 */
export function roomRoofGroups(floor) {
  const rooms = (floor?.rooms ?? []).filter((r) => r.roof && r.roof.type && r.roof.type !== "none" && (r.points ?? []).length >= 3);
  const box = (r) => {
    const xs = r.points.map((p) => p[0]);
    const zs = r.points.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  };
  const boxes = rooms.map(box);
  const parent = rooms.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (Math.max(a[0] - b[1], b[0] - a[1], a[2] - b[3], b[2] - a[3]) < 0.05) parent[find(i)] = find(j);
    }
  const groups = new Map();
  rooms.forEach((r, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return [...groups.values()].map((list) => ({ rooms: list, roof: roofSettings({ roof: list[0].roof }) }));
}

/** Abstand eines Punkts zum Rand eines Polygons (0, wenn innen). */
function distToPolygon(p, poly) {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
  }
  return best;
}

/**
 * Hang automatisch: Höhe je Eckpunkt einer Gartenfläche (relativ zu ihrer Etage). Ecken, die an
 * Gartenflächen einer anderen Etage stoßen, bekommen deren Höhenunterschied, Ecken an Flächen der
 * eigenen Etage 0, die übrigen werden entlang des Umrisses zwischen den bekannten interpoliert.
 * @returns {number[]|null} heights, oder null, wenn die Fläche eben bleibt
 */
export function autoHeights(building, floorId, areaId, tol = 0.5) {
  const floor = building.floors.find((f) => f.id === floorId);
  const area = floor?.outdoor?.find((o) => o.id === areaId);
  if (!area) return null;
  const elev = floor.elevation ?? 0;
  const pts = area.points;
  const known = pts.map((p) => {
    let other = null;
    for (const f of building.floors) {
      if (f.id === floorId) continue;
      const dh = (f.elevation ?? 0) - elev;
      if (Math.abs(dh) < 0.05) continue;
      if ((f.outdoor ?? []).some((o) => o.type !== "balcony" && distToPolygon(p, o.points) <= tol)) {
        // mehrere Etagen: die mit dem kleinsten Höhenunterschied (nächste Geländestufe)
        if (other === null || Math.abs(dh) < Math.abs(other)) other = dh;
      }
    }
    if (other !== null) return Math.round(other * 1000) / 1000;
    if ((floor.outdoor ?? []).some((o) => o.id !== areaId && distToPolygon(p, o.points) <= tol)) return 0;
    return null;
  });
  if (!known.some((h) => h !== null && h !== 0)) return null;
  // Lücken entlang des Umrisses linear füllen
  const n = pts.length;
  const seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % n][0] - p[0], pts[(i + 1) % n][1] - p[1]));
  return known.map((h, i) => {
    if (h !== null) return h;
    let back = 0;
    let fwd = 0;
    let hb = null;
    let hf = null;
    for (let k = 1; k < n && hb === null; k++) {
      back += seg[(i - k + n) % n];
      hb = known[(i - k + n) % n];
    }
    for (let k = 1; k < n && hf === null; k++) {
      fwd += seg[(i + k - 1) % n];
      hf = known[(i + k) % n];
    }
    if (hb === null || hf === null) return hb ?? hf ?? 0;
    return Math.round((hb + ((hf - hb) * back) / (back + fwd || 1)) * 1000) / 1000;
  });
}
