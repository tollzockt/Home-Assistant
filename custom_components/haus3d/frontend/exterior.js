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
