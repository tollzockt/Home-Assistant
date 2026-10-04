// Reine Bearbeitungs-Operationen für den Editor (ohne DOM, mit node testbar).
// Alle Koordinaten in Metern, Plan [x, z].

import { alignAxes, computeWalls, pointInPolygon, signedArea } from "./walls.js";

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
  let a;
  let b;
  let room = null;
  let wall = null;
  if (o.wall) {
    // Öffnung in einer freistehenden Wand: offset ab Wandanfang a
    wall = (floor.walls ?? []).find((w) => w.id === o.wall);
    if (!wall) return null;
    [a, b] = [wall.a, wall.b];
  } else {
    room = (floor.rooms ?? []).find((r) => r.id === o.room_id);
    if (!room) return null;
    a = room.points[o.edge];
    b = room.points[(o.edge + 1) % room.points.length];
  }
  if (!a || !b) return null;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const c = [a[0] + u[0] * o.offset, a[1] + u[1] * o.offset];
  const h = o.width / 2;
  return { center: c, u, len, a, b, p0: [c[0] - u[0] * h, c[1] - u[1] * h], p1: [c[0] + u[0] * h, c[1] + u[1] * h], room, wall };
}

/** Nächste freistehende Wand zu einem Punkt: {wall, offset, len, dist} oder null. */
export function nearestWall(floor, p, maxDist = 0.6) {
  let best = null;
  for (const w of floor.walls ?? []) {
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.dist > maxDist || pr.len < 0.3) continue;
    if (!best || pr.dist < best.dist) best = { wall: w, offset: pr.t, len: pr.len, dist: pr.dist };
  }
  return best;
}

/**
 * Endpunkt einer neuen Wand: Richtung auf 0/45/90° (± tolDeg) einrasten, dann Länge aufs Raster.
 * Liegt ein Eckpunkt (vertices) nah, gewinnt der.
 */
export function snapWallEnd(a, p, { grid = 0.05, vertices = [], tol = 0.15, tolDeg = 8, free = false } = {}) {
  for (const v of vertices) if (Math.hypot(v[0] - p[0], v[1] - p[1]) <= tol) return [v[0], v[1]];
  if (free) return snapPoint(p, { grid });
  const dx = p[0] - a[0];
  const dz = p[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [a[0], a[1]];
  const ang = Math.atan2(dz, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(ang - snapped) > (tolDeg * Math.PI) / 180) return snapPoint(p, { grid });
  // Länge = Anteil in der eingerasteten Richtung, aufs Raster gerundet
  const l = Math.round((dx * Math.cos(snapped) + dz * Math.sin(snapped)) / grid) * grid;
  return [r3(a[0] + Math.cos(snapped) * l), r3(a[1] + Math.sin(snapped) * l)];
}

/** Freistehende Wand löschen samt ihrer Öffnungen. */
export function removeWall(floor, wallId) {
  return { ...floor, walls: (floor.walls ?? []).filter((w) => w.id !== wallId), openings: (floor.openings ?? []).filter((o) => o.wall !== wallId) };
}

/**
 * Raum-Polygon aufräumen: doppelte Punkte und „Spitzen“ (Kante läuft auf sich selbst zurück) entfernen.
 * Öffnungen bleiben an ihrer Stelle (Kante und Offset werden neu bestimmt).
 * @returns {{floor: object, fixed: number}} neue Etage und Anzahl entfernter Punkte
 */
export function cleanFloor(floor) {
  let fixed = 0;
  let out = floor;
  // fast gleiche Koordinaten (wenige Zentimeter Versatz) angleichen, wie die Wandberechnung es tut
  const align = alignAxes(floor.rooms ?? []);
  let aligned = 0;
  out = {
    ...out,
    rooms: (out.rooms ?? []).map((r) => ({
      ...r,
      points: r.points.map((p) => {
        const q = align(p);
        if (q[0] !== p[0] || q[1] !== p[1]) aligned++;
        return q;
      }),
    })),
  };
  fixed += aligned;
  for (const room of out.rooms ?? []) {
    const pts = cleanPoints(room.points);
    if (pts.length === room.points.length || pts.length < 3) continue;
    fixed += room.points.length - pts.length;
    const centers = new Map();
    for (const o of out.openings ?? []) {
      if (o.room_id !== room.id || o.wall) continue;
      const g = openingGeometry(out, o);
      if (g) centers.set(o.id, g.center);
    }
    const openings = (out.openings ?? []).map((o) => {
      const c = centers.get(o.id);
      if (!c) return o;
      let best = null;
      for (let i = 0; i < pts.length; i++) {
        const pr = projectOnSegment(c, pts[i], pts[(i + 1) % pts.length]);
        if (!best || pr.dist < best.dist) best = { edge: i, offset: r3(pr.t), dist: pr.dist };
      }
      return { ...o, edge: best.edge, offset: best.offset };
    });
    out = { ...out, rooms: out.rooms.map((r) => (r.id === room.id ? { ...r, points: pts } : r)), openings };
  }
  return { floor: out, fixed };
}

/** Doppelte Punkte und Rückläufer entfernen, bis nichts mehr zu tun ist. */
export function cleanPoints(points, eps = 0.005) {
  let pts = points.map((p) => [p[0], p[1]]);
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length];
      const q = pts[i];
      const n = pts[(i + 1) % pts.length];
      const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const l2 = Math.hypot(n[0] - q[0], n[1] - q[1]);
      // doppelt, oder Spitze: q liegt auf der Linie und die Richtung kehrt um
      const back = l1 > eps && l2 > eps && ((q[0] - p[0]) * (n[0] - q[0]) + (q[1] - p[1]) * (n[1] - q[1])) / (l1 * l2) < -0.995;
      if (l1 <= eps || back) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/**
 * Wandflächen einer Etage zum Einrasten: je Wandsegment die Seiten, an denen ein Raum liegt.
 * @param {object[]} segments aus computeWalls
 * @returns {{p: number[], u: number[], n: number[], t0: number, t1: number}[]} n zeigt von der Wand weg in den Raum
 */
export function wallFaces(segments) {
  const faces = [];
  for (const s of segments) {
    for (const side of [1, -1]) {
      const off = side > 0 ? s.left : -s.right;
      // nur Seiten zum Raum hin (bei Außenwänden die Innenseite), freie Wände beidseitig
      const roomSide = side > 0 ? s.roomLeft : s.roomRight;
      if (!roomSide && s.kind !== "free") continue;
      const n = [s.n[0] * side, s.n[1] * side];
      faces.push({ p: [s.a[0] + s.n[0] * off, s.a[1] + s.n[1] * off], u: s.u, n, t0: 0, t1: s.length });
    }
  }
  return faces;
}

/** Möbeltypen, die nicht an Wänden einrasten (liegen frei im Raum oder hängen an der Decke). */
const FREE_TYPES = new Set(["beam", "column", "rug", "parking", "stairwell", "robot_vacuum", "table", "table_round", "coffee_table", "island", "lamp_ceiling", "lamp_downlight", "lamp_panel", "lamp_pendant", "chair", "stool", "bar_stool", "custom_box", "custom_cylinder"]);

/**
 * Möbel an der nächsten Wand ausrichten (Rückseite bündig, Vorderseite zum Raum) und, wenn nah,
 * seitlich an eine zweite Wand (Ecke). Gibt {x, z, rotation} zurück oder null, wenn keine Wand nah ist.
 */
export function snapToWall(item, faces, { tol = 0.3 } = {}) {
  if (FREE_TYPES.has(item.type)) return null;
  const w = item.w || 0.6;
  const d = item.d || 0.6;
  const p = [item.x, item.z];
  let best = null;
  for (const f of faces) {
    const rel = [p[0] - f.p[0], p[1] - f.p[1]];
    const along = rel[0] * f.u[0] + rel[1] * f.u[1];
    const dist = rel[0] * f.n[0] + rel[1] * f.n[1];
    // Möbel muss vor der Wand liegen (nicht dahinter) und entlang der Wand überlappen
    if (dist < -0.05 || along < f.t0 - w / 2 + 0.1 || along > f.t1 + w / 2 - 0.1) continue;
    // Abstand der nächsten Möbelseite zur Wand: bei beliebiger Drehung die passende halbe Tiefe
    const gap = Math.abs(dist - d / 2);
    if (gap > tol || (best && gap >= best.gap)) continue;
    best = { f, gap, along };
  }
  if (!best) return null;
  const { f } = best;
  // Vorderseite (lokal +z, Richtung (-sin r, cos r)) zeigt in den Raum: n
  const deg = (((Math.atan2(-f.n[0], f.n[1]) * 180) / Math.PI) % 360 + 360) % 360;
  const rotation = Math.round(deg * 10) / 10;
  let along = best.along;
  // Ecke: seitlich an eine quer stehende Wand, wenn nah
  for (const g of faces) {
    if (g === f || Math.abs(g.n[0] * f.u[0] + g.n[1] * f.u[1]) < 0.95) continue;
    const s = g.n[0] * f.u[0] + g.n[1] * f.u[1] > 0 ? 1 : -1; // g zeigt in +u oder -u
    // Lage der Wandfläche g entlang f
    const gAlong = (g.p[0] - f.p[0]) * f.u[0] + (g.p[1] - f.p[1]) * f.u[1];
    const want = gAlong + s * (w / 2);
    if (Math.abs(want - along) <= tol && s * (along - gAlong) > 0) {
      // die Querwand muss die Möbelzone erreichen (im Abstand d vor f)
      const gDist0 = (f.p[0] + f.u[0] * gAlong - g.p[0]) * g.u[0] + (f.p[1] + f.u[1] * gAlong - g.p[1]) * g.u[1];
      const reach = [gDist0, gDist0 + (f.n[0] * g.u[0] + f.n[1] * g.u[1]) * d];
      const lo = Math.min(...reach);
      const hi = Math.max(...reach);
      if (hi < g.t0 - 0.05 || lo > g.t1 + 0.05) continue;
      along = want;
      break;
    }
  }
  const base = [f.p[0] + f.u[0] * along, f.p[1] + f.u[1] * along];
  return { x: r3(base[0] + f.n[0] * (d / 2)), z: r3(base[1] + f.n[1] * (d / 2)), rotation: rotation >= 360 ? 0 : rotation };
}

/**
 * Möbel, das in eine Wand ragt, so weit herausschieben, dass es bündig steht (Drehung bleibt).
 * @returns {{x: number, z: number}|null} neue Lage oder null, wenn nichts zu tun ist
 */
export function pushOutOfWalls(item, faces) {
  if (["rug", "parking", "stairwell", "led_strip"].includes(item.type) || item.type.startsWith("lamp_")) return null;
  const a = ((item.rotation || 0) * Math.PI) / 180;
  const ux = [Math.cos(a), Math.sin(a)]; // lokale Breite
  const uz = [-Math.sin(a), Math.cos(a)]; // lokale Tiefe
  const w = (item.w || 0.6) / 2;
  const d = (item.d || 0.6) / 2;
  let p = [item.x, item.z];
  let moved = false;
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const f of faces) {
      const ext = Math.abs(w * (ux[0] * f.n[0] + ux[1] * f.n[1])) + Math.abs(d * (uz[0] * f.n[0] + uz[1] * f.n[1]));
      const along = Math.abs(w * (ux[0] * f.u[0] + ux[1] * f.u[1])) + Math.abs(d * (uz[0] * f.u[0] + uz[1] * f.u[1]));
      const rel = [p[0] - f.p[0], p[1] - f.p[1]];
      const dist = rel[0] * f.n[0] + rel[1] * f.n[1];
      const t = rel[0] * f.u[0] + rel[1] * f.u[1];
      // nur Wände, vor denen das Möbel steht (Mitte im Raum) und die es entlang überlappt
      if (dist <= 0 || dist >= ext - 0.005 || t < f.t0 - along + 0.02 || t > f.t1 + along - 0.02) continue;
      // Ecken der Wand nicht als Hindernis werten, wenn das Möbel nur knapp darüber hinausragt
      if (ext - dist > 0.5) continue;
      p = [p[0] + f.n[0] * (ext - dist), p[1] + f.n[1] * (ext - dist)];
      changed = moved = true;
    }
    if (!changed) break;
  }
  return moved ? { x: r3(p[0]), z: r3(p[1]) } : null;
}

/** Eckpunkte anderer Räume derselben Etage, die auf einem Punkt liegen: [{roomId, i}]. */
export function linkedVertices(floor, p, exceptRoomId = null, tol = 0.02) {
  const out = [];
  for (const r of floor.rooms ?? []) {
    if (r.id === exceptRoomId) continue;
    r.points.forEach((q, i) => {
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol) out.push({ roomId: r.id, i });
    });
  }
  return out;
}

/**
 * Wand (Raumkante i) senkrecht um d Meter verschieben. Mit linked gehen angrenzende Räume mit:
 * - Kanten anderer Räume, die auf der Wand liegen, wandern mit;
 * - reicht eine Nachbarkante über die Wand hinaus, bekommt sie dort einen Versatz (zwei neue Ecken);
 * - Ecken, an denen die Wand nur stumpf anstößt, wandern mit; Wände, die in Verlängerung weiterlaufen, bleiben.
 * Öffnungen behalten ihre Lage (Kante und Offset werden beim Einfügen von Ecken angepasst).
 */
export function moveEdge(floor, roomId, i, d, { linked = true, tol = 0.02 } = {}) {
  const room = floor.rooms.find((r) => r.id === roomId);
  const n0 = room.points.length;
  const a = room.points[i];
  const b = room.points[(i + 1) % n0];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const nrm = [-u[1], u[0]];
  const along = (p) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
  const off = (p) => Math.abs((p[0] - a[0]) * nrm[0] + (p[1] - a[1]) * nrm[1]);
  const onLine = (p) => off(p) <= tol;
  const inside = (p, q) => {
    if (!onLine(p) || !onLine(q)) return false;
    const m = (along(p) + along(q)) / 2;
    return m > tol && m < len - tol && Math.abs(along(p) - along(q)) > tol;
  };
  let f = floor;
  const moving = new Set([`${roomId}#${i}`, `${roomId}#${(i + 1) % n0}`]);
  if (linked) {
    for (const r0 of floor.rooms) {
      if (r0.id === roomId) continue;
      // 1. Versatz: Wandenden a/b, die mitten in einer Nachbarkante auf derselben Linie liegen
      for (let guard = 0; guard < 4; guard++) {
        const r = f.rooms.find((x) => x.id === r0.id);
        const m = r.points.length;
        let done = true;
        for (let k = 0; k < m; k++) {
          const p = r.points[k];
          const q = r.points[(k + 1) % m];
          if (!onLine(p) || !onLine(q)) continue;
          const lo = Math.min(along(p), along(q));
          const hi = Math.max(along(p), along(q));
          const cut = [0, len].find((t) => t > lo + tol && t < hi - tol);
          if (cut === undefined) continue;
          const e = [r3(a[0] + u[0] * cut), r3(a[1] + u[1] * cut)];
          f = insertVertex(f, r.id, k, e);
          f = insertVertex(f, r.id, k + 1, e);
          done = false;
          break;
        }
        if (done) break;
      }
      // 2. welche Ecken des Nachbarn wandern
      const r = f.rooms.find((x) => x.id === r0.id);
      const m = r.points.length;
      r.points.forEach((p, k) => {
        const prev = r.points[(k - 1 + m) % m];
        const next = r.points[(k + 1) % m];
        const prevSame = Math.hypot(prev[0] - p[0], prev[1] - p[1]) <= tol;
        const nextSame = Math.hypot(next[0] - p[0], next[1] - p[1]) <= tol;
        // Kanten zur Nachbarecke; doppelte Ecken (Versatz) zählen nur zur Seite, an der sie hängen
        const inPrev = !prevSame && inside(prev, p);
        const inNext = !nextSame && inside(p, next);
        if (inPrev || inNext) {
          moving.add(`${r.id}#${k}`);
          return;
        }
        const atEnd = Math.hypot(p[0] - a[0], p[1] - a[1]) <= tol || Math.hypot(p[0] - b[0], p[1] - b[1]) <= tol;
        if (!atEnd || prevSame || nextSame) return;
        // stumpfer Anschluss (keine Kante auf der Linie) wandert mit, Verlängerungen bleiben
        const collinear = (!prevSame && onLine(prev)) || (!nextSame && onLine(next));
        if (!collinear) moving.add(`${r.id}#${k}`);
      });
    }
  }
  return {
    ...f,
    rooms: f.rooms.map((r) => ({
      ...r,
      points: r.points.map((q, k) => (moving.has(`${r.id}#${k}`) ? [r3(q[0] + nrm[0] * d), r3(q[1] + nrm[1] * d)] : q)),
    })),
  };
}

/** Eckpunkt setzen; mit linked wandern gleich liegende Ecken anderer Räume mit. */
export function moveVertex(floor, roomId, i, p, { linked = true } = {}) {
  const old = floor.rooms.find((r) => r.id === roomId).points[i];
  const moves = new Set([`${roomId}#${i}`]);
  if (linked) for (const m of linkedVertices(floor, old, roomId)) moves.add(`${m.roomId}#${m.i}`);
  return {
    ...floor,
    rooms: floor.rooms.map((r) => ({ ...r, points: r.points.map((q, k) => (moves.has(`${r.id}#${k}`) ? [r3(p[0]), r3(p[1])] : q)) })),
  };
}

/**
 * Außenwände einer Etage bündig auf die Etage darunter (ref) setzen: achsparallele Außenwände, die
 * höchstens tol neben einer gleich ausgerichteten Außenwand von ref liegen, bekommen deren Lage. Alle
 * Punkte der Etage mit dieser x- bzw. z-Koordinate wandern mit (angeschlossene Innenwände auch).
 * Fenster und Türen bleiben an ihrer Stelle.
 * @returns {{floor: object, moved: string[]}} neue Etage und Beschreibung der verschobenen Wände
 */
export function alignToFloor(floor, ref, settings = {}, tol = 0.15) {
  const lines = (f) =>
    computeWalls(f, settings).segments
      .filter((s) => s.kind === "exterior")
      .map((s) => {
        const ax = Math.abs(s.u[0]) > 0.999 ? "z" : Math.abs(s.u[1]) > 0.999 ? "x" : null;
        if (!ax) return null;
        const c = ax === "z" ? s.a[1] : s.a[0];
        const lo = Math.min(ax === "z" ? s.a[0] : s.a[1], ax === "z" ? s.b[0] : s.b[1]);
        const hi = Math.max(ax === "z" ? s.a[0] : s.a[1], ax === "z" ? s.b[0] : s.b[1]);
        // Außenseite: Richtung der Normalen zur Seite ohne Raum
        const out = s.roomLeft ? -1 : 1;
        const side = (ax === "z" ? s.n[1] : s.n[0]) * out > 0 ? 1 : -1;
        return { ax, c, lo, hi, side };
      })
      .filter(Boolean);
  const mine = lines(floor);
  const theirs = lines(ref);
  const map = { x: new Map(), z: new Map() };
  for (const l of mine) {
    let best = null;
    for (const t of theirs) {
      if (t.ax !== l.ax || t.side !== l.side) continue;
      const d = Math.abs(t.c - l.c);
      const overlap = Math.min(l.hi, t.hi) - Math.max(l.lo, t.lo);
      if (d < 1e-6 || d > tol || overlap < 0.5) continue;
      if (!best || d < Math.abs(best - l.c)) best = t.c;
    }
    if (best !== null) map[l.ax].set(l.c, best);
  }
  if (!map.x.size && !map.z.size) return { floor, moved: [] };
  const move = (p) => {
    let [x, z] = p;
    for (const [from, to] of map.x) if (Math.abs(x - from) < 0.002) x = to;
    for (const [from, to] of map.z) if (Math.abs(z - from) < 0.002) z = to;
    return [r3(x), r3(z)];
  };
  // Öffnungen: Mittelpunkt merken und auf der (gleichen) Kante wieder einhängen
  const centers = new Map();
  for (const o of floor.openings ?? []) {
    const g = openingGeometry(floor, o);
    if (g) centers.set(o.id, g.center);
  }
  const next = { ...floor, rooms: floor.rooms.map((r) => ({ ...r, points: r.points.map(move) })) };
  next.openings = (floor.openings ?? []).map((o) => {
    const c = centers.get(o.id);
    const room = next.rooms.find((r) => r.id === o.room_id);
    if (!c || !room) return o;
    const a = room.points[o.edge];
    const b = room.points[(o.edge + 1) % room.points.length];
    const pr = projectOnSegment(move(c), a, b);
    return { ...o, offset: clampOffset(pr.t, o.width, pr.len) };
  });
  const moved = [...[...map.x].map(([f, t]) => `x ${r3(f)} → ${r3(t)}`), ...[...map.z].map(([f, t]) => `z ${r3(f)} → ${r3(t)}`)];
  return { floor: next, moved };
}
