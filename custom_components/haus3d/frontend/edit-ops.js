// Reine Bearbeitungs-Operationen für den Editor (ohne DOM, mit node testbar).
// Alle Koordinaten in Metern, Plan [x, z].

import { pointInPolygon, signedArea } from "./walls.js";

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Eindeutige ID mit Präfix (zufällig, für neue Räume, Öffnungen, Möbel). */
export function newId(prefix, taken = new Set()) {
  let id;
  do id = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  while (taken.has(id));
  return id;
}

/** Alle IDs eines Gebäudes (für eindeutige neue IDs). */
export function allIds(building) {
  const ids = new Set();
  for (const f of building.floors ?? []) {
    ids.add(f.id);
    for (const key of ["rooms", "openings", "furniture", "outdoor", "walls"]) for (const x of f[key] ?? []) ids.add(x.id);
  }
  return ids;
}

/**
 * Einrasten: zuerst auf Eckpunkte in der Nähe (tol), sonst aufs Raster.
 * @returns {[number, number]}
 */
export function snapPoint(p, { grid = 0.05, vertices = [], tol = 0.15 } = {}) {
  let best = null;
  let bestD = tol;
  for (const v of vertices) {
    const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
    if (d <= bestD) {
      best = v;
      bestD = d;
    }
  }
  if (best) return [best[0], best[1]];
  const g = grid > 0 ? grid : 0.05;
  return [r3(Math.round(p[0] / g) * g), r3(Math.round(p[1] / g) * g)];
}

/** Eckpunkte aller Räume einer Etage (zum Einrasten), optional ohne einen Raum. */
export function floorVertices(floor, exceptRoomId = null) {
  return (floor.rooms ?? []).filter((r) => r.id !== exceptRoomId).flatMap((r) => r.points);
}

/** Rechteckiger Raum aus zwei Ecken (gegen den Uhrzeigersinn wie NeonPlan). */
export function rectRoom(a, b, id, name = "Raum") {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [z0, z1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return { id, name, area_id: null, floor_material: "wood", points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [r3(x), r3(z)]) };
}

/** Ist ein Polygon brauchbar (mindestens 3 Punkte, Fläche > 0,1 m²)? */
export function validPolygon(points) {
  return points.length >= 3 && Math.abs(signedArea(points)) > 0.1;
}

/** Verschiebt einen Raum samt seinen Öffnungen (die hängen an Kanten und wandern mit). */
export function moveRoom(room, dx, dz) {
  return { ...room, points: room.points.map(([x, z]) => [r3(x + dx), r3(z + dz)]) };
}

/** Abstand Punkt-Strecke und Parameter t (Meter ab a). */
export function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1e-9;
  const t = Math.max(0, Math.min(len, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len));
  const q = [a[0] + (dx / len) * t, a[1] + (dz / len) * t];
  return { t, len, dist: Math.hypot(p[0] - q[0], p[1] - q[1]), point: q };
}

/** Nächste Raumkante zu einem Punkt: {room, edge, offset, len, dist}. */
export function nearestEdge(floor, p, maxDist = 0.6) {
  let best = null;
  for (const room of floor.rooms ?? []) {
    const pts = room.points;
    for (let i = 0; i < pts.length; i++) {
      const pr = projectOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
      if (pr.dist > maxDist || pr.len < 0.3) continue;
      // bei gleicher Kante in zwei Räumen: den Raum, in dem der Punkt liegt
      const inside = pointInPolygon(p, pts) ? 0 : 0.001;
      const score = pr.dist + inside;
      if (!best || score < best.score) best = { room, edge: i, offset: pr.t, len: pr.len, dist: pr.dist, score };
    }
  }
  return best;
}

/** Offset (Mitte) so begrenzen, dass die Öffnung ganz auf der Kante liegt. */
export function clampOffset(offset, width, len) {
  const half = width / 2;
  if (len <= width) return r3(len / 2);
  return r3(Math.min(len - half, Math.max(half, offset)));
}

/** Neue Öffnung an einer Kante. */
export function newOpening(type, hit, id) {
  const defaults = {
    window: { width: 1.2, height: 1.3, sill: 0.9 },
    door: { width: 0.9, height: 2.05, sill: 0 },
    garage: { width: 2.5, height: 2.1, sill: 0 },
  }[type];
  return {
    id,
    room_id: hit.room.id,
    edge: hit.edge,
    offset: clampOffset(hit.offset, defaults.width, hit.len),
    width: defaults.width,
    type,
    sill: defaults.sill,
    height: defaults.height,
    hinge: "left",
    leaves: 1,
    swing: "in",
    style: null,
    contact2: null,
    cover: null,
    contact: null,
    tilt: null,
  };
}

/**
 * Punkt in eine Raumkante einfügen (Index i: zwischen points[i] und points[i+1]).
 * Öffnungen auf späteren Kanten rücken eine Kante weiter; Öffnungen auf der geteilten Kante
 * landen je nach Lage auf der ersten oder zweiten Hälfte.
 */
export function insertVertex(floor, roomId, i, p) {
  const room = floor.rooms.find((r) => r.id === roomId);
  const n = room.points.length;
  const a = room.points[i];
  const cut = Math.hypot(p[0] - a[0], p[1] - a[1]);
  const points = [...room.points.slice(0, i + 1), [r3(p[0]), r3(p[1])], ...room.points.slice(i + 1)];
  const openings = floor.openings.map((o) => {
    if (o.room_id !== roomId || o.wall) return o;
    if (o.edge > i) return { ...o, edge: (o.edge + 1) % (n + 1) };
    if (o.edge === i && o.offset > cut) return { ...o, edge: i + 1, offset: r3(o.offset - cut) };
    return o;
  });
  return { ...floor, rooms: floor.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)), openings };
}

/** Punkt löschen (mindestens 3 bleiben). Öffnungen der beiden betroffenen Kanten werden entfernt. */
export function removeVertex(floor, roomId, i) {
  const room = floor.rooms.find((r) => r.id === roomId);
  const n = room.points.length;
  if (n <= 3) return floor;
  const prev = (i - 1 + n) % n;
  const points = room.points.filter((_, k) => k !== i);
  const openings = floor.openings
    .filter((o) => o.room_id !== roomId || o.wall || (o.edge !== i && o.edge !== prev))
    .map((o) => (o.room_id === roomId && !o.wall && o.edge > i ? { ...o, edge: o.edge - 1 } : o));
  return { ...floor, rooms: floor.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)), openings };
}

/** Raum löschen samt seiner Öffnungen. */
export function removeRoom(floor, roomId) {
  return { ...floor, rooms: floor.rooms.filter((r) => r.id !== roomId), openings: floor.openings.filter((o) => o.room_id !== roomId || o.wall) };
}

/** Raum, in dem ein Punkt liegt (oberster zuerst). */
export function roomAt(floor, p) {
  return [...(floor.rooms ?? [])].reverse().find((r) => pointInPolygon(p, r.points)) ?? null;
}

/** Gartenfläche, in der ein Punkt liegt. */
export function outdoorAt(floor, p) {
  return [...(floor.outdoor ?? [])].reverse().find((o) => pointInPolygon(p, o.points)) ?? null;
}

/** Möbelstück unter einem Punkt (gedrehtes Rechteck). */
export function furnitureAt(floor, p) {
  return (
    [...(floor.furniture ?? [])].reverse().find((m) => {
      // lokale Achsen bei Drehung r: x -> (cos r, sin r), z -> (-sin r, cos r) (wie NeonPlan)
      const a = ((m.rotation || 0) * Math.PI) / 180;
      const dx = p[0] - m.x;
      const dz = p[1] - m.z;
      const lx = dx * Math.cos(a) + dz * Math.sin(a);
      const lz = -dx * Math.sin(a) + dz * Math.cos(a);
      return Math.abs(lx) <= (m.w || 0.6) / 2 + 0.05 && Math.abs(lz) <= (m.d || 0.6) / 2 + 0.05;
    }) ?? null
  );
}

/** Lage einer Öffnung im Plan: Mittelpunkt, Richtung der Kante, Endpunkte. */
export function openingGeometry(floor, o) {
  const room = (floor.rooms ?? []).find((r) => r.id === o.room_id);
  if (!room || o.wall) return null;
  const a = room.points[o.edge];
  const b = room.points[(o.edge + 1) % room.points.length];
  if (!a || !b) return null;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const c = [a[0] + u[0] * o.offset, a[1] + u[1] * o.offset];
  const h = o.width / 2;
  return { center: c, u, len, p0: [c[0] - u[0] * h, c[1] - u[1] * h], p1: [c[0] + u[0] * h, c[1] + u[1] * h], room };
}
