// Wandberechnung aus Raumpolygonen (ohne Three.js, damit sie mit node testbar ist).
//
// Räume sind Polygone in Metern [x, z], gezeichnet auf der Mitte der Innenwände.
// Vorgehen:
//  1. Alle Raumkanten werden nach der Geraden gruppiert, auf der sie liegen.
//  2. Auf jeder Geraden werden die Kanten an allen Endpunkten in Elementarintervalle zerlegt.
//     Für jedes Intervall wird gezählt, welche Räume es von links bzw. rechts abdecken.
//     Raum auf beiden Seiten -> eine Innenwand (mittig), nur auf einer Seite -> Außenwand
//     (wächst nach außen). Teilweise geteilte Kanten werden dadurch automatisch aufgeteilt,
//     und jede Stelle einer Geraden bekommt höchstens eine Wand.
//  3. Benachbarte Intervalle mit gleicher Belegung werden zu einem Segment zusammengefasst.
//  4. Öffnungen (room_id + edge + offset der Mitte) werden über die Quellkanten der Segmente
//     genau einem Segment zugeordnet.

const EPS = 0.005;
/** Toleranz zum Einrasten von Eckpunkten und für "liegt auf derselben Geraden" (Meter). */
const SNAP = 0.01;

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const mul = (p, k) => [p[0] * k, p[1] * k];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
const len = (p) => Math.hypot(p[0], p[1]);
const leftNormal = (u) => [-u[1], u[0]];

/** Vorzeichenbehaftete Fläche (Shoelace); > 0 heißt: Innenraum liegt links der Kantenrichtung. */
export function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(points) {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    const s = points.reduce((acc, p) => add(acc, p), [0, 0]);
    return mul(s, 1 / points.length);
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return len(sub(p, add(a, mul(d, t))));
}

/** Abstand eines Punkts zum Rand eines Polygons. */
export function distToEdges(p, points) {
  let m = Infinity;
  for (let i = 0; i < points.length; i++) m = Math.min(m, distToSegment(p, points[i], points[(i + 1) % points.length]));
  return m;
}

/**
 * Ein Punkt sicher im Inneren (für Beschriftungen): der Schwerpunkt, wenn er gut im Raum liegt,
 * sonst der Rasterpunkt mit dem größten Abstand zum Rand (auch bei L- oder U-förmigen Räumen).
 */
export function labelPoint(points) {
  const c = centroid(points);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const size = Math.min(x1 - x0, z1 - z0);
  if (pointInPolygon(c, points) && distToEdges(c, points) >= size * 0.25) return c;
  let best = pointInPolygon(c, points) ? c : null;
  let bestD = best ? distToEdges(c, points) : -1;
  const N = 24;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p = [x0 + ((x1 - x0) * i) / N, z0 + ((z1 - z0) * j) / N];
      if (!pointInPolygon(p, points)) continue;
      const d = distToEdges(p, points);
      if (d > bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  return best ?? c;
}

/** Kanonische Richtung einer Geraden (eindeutig bis auf das Vorzeichen). */
function canonical(u) {
  if (u[0] > 1e-9 || (Math.abs(u[0]) <= 1e-9 && u[1] > 0)) return u;
  return [-u[0], -u[1]];
}

/**
 * Berechnet die Wandsegmente einer Etage.
 * @param {object} floor Etage im NeonPlan-Format
 * @param {{wall_exterior?: number, wall_interior?: number}} settings
 * @returns {{segments: object[], openings: object[], warnings: string[]}}
 */
/** Toleranz, bis zu der fast gleiche Koordinaten als gleich gelten (Meter). */
export const ALIGN = 0.04;

/**
 * Fast gleiche x- und z-Werte aller Raumpunkte zusammenlegen. Je Gruppe gilt der häufigste Wert.
 * @returns {(p: number[]) => number[]} Abbildung eines Punkts auf den ausgerichteten Punkt
 */
export function alignAxes(rooms, tol = ALIGN) {
  const table = (vals) => {
    const sorted = [...vals].sort((x, y) => x - y);
    const map = new Map();
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const count = new Map();
      for (const v of group) count.set(v, (count.get(v) ?? 0) + 1);
      let best = group[0];
      for (const [v, c] of count) if (c > count.get(best)) best = v;
      for (const v of group) map.set(v, best);
      group = [];
    };
    for (const v of sorted) {
      if (group.length && v - group[0] > tol) flush();
      group.push(v);
    }
    flush();
    return map;
  };
  const pts = rooms.flatMap((r) => r.points ?? []);
  const xs = table(pts.map((p) => p[0]));
  const zs = table(pts.map((p) => p[1]));
  return (p) => [xs.get(p[0]) ?? p[0], zs.get(p[1]) ?? p[1]];
}

export function computeWalls(floor, settings = {}) {
  const ext = settings.wall_exterior ?? 0.24;
  const int = settings.wall_interior ?? 0.12;
  const warnings = [];

  // 0. Eckpunkte einrasten: fast gleiche x- bzw. z-Werte (bis ALIGN, z. B. 9,75 und 9,771) zusammenlegen,
  // sonst entstehen aus wenigen Zentimetern Versatz zwei Außenwände mit Spalt. Danach Punkte näher als SNAP
  // zu einem Punkt.
  const align = alignAxes(floor.rooms ?? []);
  const verts = [];
  const snap = (p0) => {
    const p = align(p0);
    for (const v of verts) if (Math.abs(v[0] - p[0]) <= SNAP && Math.abs(v[1] - p[1]) <= SNAP) return v;
    const v = [p[0], p[1]];
    verts.push(v);
    return v;
  };

  // 1. Kanten sammeln
  const edges = [];
  for (const room of floor.rooms ?? []) {
    const pts = (room.points ?? []).map(snap);
    if (pts.length < 3) continue;
    const area = signedArea(pts);
    if (Math.abs(area) < 1e-6) {
      warnings.push(`Raum ${room.id} hat keine Fläche`);
      continue;
    }
    const inside = area > 0 ? 1 : -1; // 1: Innenraum links der Kante
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const d = sub(q, p);
      const l = len(d);
      if (l < SNAP) continue;
      edges.push({ key: `${room.id}#${i}`, room: room.id, edge: i, p, q, dir: mul(d, 1 / l), length: l, inside });
    }
  }

  // 2. nach Geraden gruppieren: beide Endpunkte höchstens SNAP von der Geraden entfernt
  const lines = [];
  const onLine = (g, p) => Math.abs(dot(g.n, p) - g.c) <= SNAP;
  for (const e of edges) {
    let line = lines.find((g) => onLine(g, e.p) && onLine(g, e.q));
    if (!line) {
      const u = canonical(e.dir);
      const n = leftNormal(u);
      line = { u, n, c: dot(n, e.p), edges: [] };
      lines.push(line);
    }
    const sgn = dot(e.dir, line.u) > 0 ? 1 : -1;
    const tp = dot(line.u, e.p);
    const tq = dot(line.u, e.q);
    // Seite des Raums bezogen auf die Geradenrichtung: +1 links, -1 rechts
    line.edges.push({ ...e, sgn, tp, t0: Math.min(tp, tq), t1: Math.max(tp, tq), side: e.inside * sgn });
  }

  // Punkte, an denen eine nicht kollineare Kante beginnt oder endet (dort darf eine Wand nicht durchlaufen)
  const junctions = (line) => {
    const ts = [];
    for (const g of lines) {
      if (g === line) continue;
      for (const e of g.edges) for (const p of [e.p, e.q]) if (onLine(line, p)) ts.push(dot(line.u, p));
    }
    return ts;
  };

  // 3. Elementarintervalle und Segmente
  const segments = [];
  for (const line of lines) {
    const cuts = [];
    for (const e of line.edges) cuts.push(e.t0, e.t1);
    cuts.sort((a, b) => a - b);
    const ts = [];
    for (const t of cuts) if (!ts.length || t - ts[ts.length - 1] > SNAP) ts.push(t);
    const joints = junctions(line);

    let current = null;
    for (let k = 0; k + 1 < ts.length; k++) {
      const a = ts[k];
      const b = ts[k + 1];
      const cover = line.edges.filter((e) => e.t0 <= a + SNAP && e.t1 >= b - SNAP);
      if (!cover.length) {
        current = null;
        continue;
      }
      const left = cover.filter((e) => e.side > 0);
      const right = cover.filter((e) => e.side < 0);
      if (left.length > 1 || right.length > 1) {
        const names = [...left, ...right].map((e) => e.room).join(", ");
        warnings.push(`Räume überlappen auf derselben Seite einer Wand: ${names}`);
      }
      const interior = left.length > 0 && right.length > 0;
      const roomLeft = left[0]?.room ?? null;
      const roomRight = right[0]?.room ?? null;
      // gleiche Wand (Art und Räume) läuft weiter, wenn an der Stelle keine andere Wand einmündet
      if (
        current &&
        Math.abs(current.tEnd - a) <= SNAP &&
        current.interior === interior &&
        current.roomLeft === roomLeft &&
        current.roomRight === roomRight &&
        !joints.some((t) => Math.abs(t - a) <= SNAP)
      ) {
        current.tEnd = b;
        for (const e of cover) current.cover.add(e);
        continue;
      }
      current = { line, tStart: a, tEnd: b, interior, roomLeft, roomRight, cover: new Set(cover) };
      segments.push(current);
    }
  }

  const result = segments.map((s, i) => {
    const { line } = s;
    const base = mul(line.n, line.c);
    const a = add(base, mul(line.u, s.tStart));
    const b = add(base, mul(line.u, s.tEnd));
    let left;
    let right;
    if (s.interior) {
      left = int / 2;
      right = int / 2;
    } else if (s.roomLeft) {
      left = 0;
      right = ext;
    } else {
      left = ext;
      right = 0;
    }
    return {
      id: `w${i}`,
      kind: s.interior ? "interior" : "exterior",
      a,
      b,
      u: line.u,
      n: line.n,
      length: s.tEnd - s.tStart,
      left,
      right,
      roomLeft: s.roomLeft,
      roomRight: s.roomRight,
      // Quellkanten: abgedeckter Abschnitt [t0, t1] der Raumkante (Meter ab points[edge]) und Umrechnung auf s
      sources: [...s.cover].map((e) => {
        const lo = Math.max(s.tStart, e.t0);
        const hi = Math.min(s.tEnd, e.t1);
        const ea = e.sgn * (lo - e.tp);
        const eb = e.sgn * (hi - e.tp);
        return { room_id: e.room, edge: e.edge, t0: Math.min(ea, eb), t1: Math.max(ea, eb), tp: e.tp, sgn: e.sgn, tStart: s.tStart };
      }),
      // Ecken der Außenseite (für Gehrung), Verlängerung von Innenwänden an freien Enden
      outerA: null,
      outerB: null,
      extendA: 0,
      extendB: 0,
    };
  });

  // freistehende Wände (floor.walls im NeonPlan-Format)
  for (const w of floor.walls ?? []) {
    const d = sub(w.b, w.a);
    const l = len(d);
    if (l < 0.05) continue;
    const u = mul(d, 1 / l);
    const t = w.thickness ?? int;
    result.push({
      id: `free_${w.id}`,
      kind: "free",
      freeId: w.id,
      a: w.a,
      b: w.b,
      u,
      n: leftNormal(u),
      length: l,
      left: t / 2,
      right: t / 2,
      roomLeft: null,
      roomRight: null,
      height: w.height ?? null,
      sources: [],
      outerA: null,
      outerB: null,
      extendA: 0,
      extendB: 0,
    });
  }

  joinCorners(result, int, floor.rooms ?? []);
  const openings = placeOpenings(floor, result, warnings);
  return { segments: result, openings, warnings };
}

const near = (p, q) => Math.abs(p[0] - q[0]) <= SNAP && Math.abs(p[1] - q[1]) <= SNAP;

/** Gehrung der Außenwände und Verlängerung von Innenwänden an Ecken. */
function joinCorners(segments, interior, rooms) {
  // Außenseite einer Außenwand: Gerade durch a + nOut * dicke in Richtung u
  const outer = (s) => {
    const sign = s.left > 0 ? 1 : -1;
    const off = Math.max(s.left, s.right);
    return { p: add(s.a, mul(s.n, sign * off)), u: s.u };
  };
  const intersect = (l1, l2) => {
    const den = cross(l1.u, l2.u);
    if (Math.abs(den) < 1e-6) return null;
    const t = cross(sub(l2.p, l1.p), l2.u) / den;
    return add(l1.p, mul(l1.u, t));
  };
  for (const s of segments) {
    for (const end of ["a", "b"]) {
      const v = s[end];
      const others = segments.filter((o) => o !== s && (near(o.a, v) || near(o.b, v)));
      const collinear = others.some((o) => Math.abs(cross(o.u, s.u)) < 1e-4);
      if (s.kind === "exterior") {
        // Gehrung mit der Außenwand desselben Raums; nur ohne sie mit einer anderen
        const room = s.roomLeft ?? s.roomRight;
        const candidates = others.filter((o) => o.kind === "exterior" && Math.abs(cross(o.u, s.u)) >= 1e-4);
        const partner = candidates.find((o) => (o.roomLeft ?? o.roomRight) === room) ?? (candidates.length === 1 ? candidates[0] : null);
        if (partner && !collinear) {
          const c = intersect(outer(s), outer(partner));
          // nur sinnvolle Gehrungen: nicht weiter als 3 Wanddicken vom Eckpunkt und nicht in einem anderen Raum
          const intoRoom = rooms.some((r) => r.id !== room && pointInPolygon(c ?? v, r.points ?? []));
          if (c && !intoRoom && len(sub(c, v)) < 3 * Math.max(s.left, s.right) + 1e-6) s[end === "a" ? "outerA" : "outerB"] = c;
        }
      } else if (!collinear && others.length) {
        s[end === "a" ? "extendA" : "extendB"] = interior / 2;
      }
    }
  }
}

/** Ordnet jede Öffnung genau einem Segment zu. */
function placeOpenings(floor, segments, warnings) {
  const rooms = new Map((floor.rooms ?? []).map((r) => [r.id, r]));
  const placed = [];
  for (const o of floor.openings ?? []) {
    const half = o.width / 2;
    const candidates = [];
    if (o.wall) {
      const seg = segments.find((s) => s.freeId === o.wall);
      if (seg) candidates.push({ seg, s: o.offset });
    } else {
      if (!rooms.has(o.room_id)) {
        warnings.push(`Öffnung ${o.id}: Raum ${o.room_id} fehlt`);
        continue;
      }
      for (const seg of segments) {
        for (const src of seg.sources) {
          if (src.room_id !== o.room_id || src.edge !== o.edge) continue;
          if (o.offset < src.t0 - EPS || o.offset > src.t1 + EPS) continue;
          // Position der Öffnungsmitte entlang des Segments
          const t = src.tp + src.sgn * o.offset;
          candidates.push({ seg, s: t - src.tStart });
        }
      }
    }
    if (!candidates.length) {
      warnings.push(`Öffnung ${o.id} liegt auf keiner Wand`);
      continue;
    }
    // liegt die Mitte genau auf einer Segmentgrenze: das Segment, das mehr der Breite aufnimmt
    const overlap = (c) => Math.min(c.s + half, c.seg.length) - Math.max(c.s - half, 0);
    candidates.sort((x, y) => overlap(y) - overlap(x));
    const best = candidates[0];
    const s0 = best.s - half;
    const s1 = best.s + half;
    const fits = s0 >= -EPS && s1 <= best.seg.length + EPS;
    if (!fits) warnings.push(`Öffnung ${o.id} ragt über das Wandsegment hinaus`);
    // Seite des Raums, zu dem die Öffnung gehört (für Türaufschlag): +1 links, -1 rechts
    const roomSide = best.seg.roomLeft === o.room_id ? 1 : best.seg.roomRight === o.room_id ? -1 : 1;
    placed.push({
      opening: o,
      segment: best.seg.id,
      s: best.s,
      s0: Math.max(0, s0),
      s1: Math.min(best.seg.length, s1),
      fits,
      roomSide,
    });
  }
  return placed;
}

/**
 * Teilt ein Segment an seinen Öffnungen in Stücke:
 *  - "full": volle Höhe zwischen Öffnungen
 *  - "sill": Brüstung unter einer Öffnung (0 .. sill)
 *  - "lintel": Sturz über einer Öffnung (sill + height .. Wandhöhe)
 * @returns {{s0: number, s1: number, y0: number, y1: number, kind: string, opening?: string}[]}
 */
export function wallPieces(segment, openings, wallHeight) {
  const list = openings
    .filter((p) => p.segment === segment.id)
    .map((p) => ({ ...p, s0: p.s0, s1: p.s1 }))
    .sort((p, q) => p.s0 - q.s0);
  const pieces = [];
  let cursor = 0;
  for (const p of list) {
    const o = p.opening;
    const s0 = Math.max(p.s0, cursor);
    const s1 = Math.max(p.s1, s0);
    if (s0 - cursor > 1e-4) pieces.push({ s0: cursor, s1: s0, y0: 0, y1: wallHeight, kind: "full" });
    if (s1 - s0 > 1e-4) {
      const sill = Math.min(o.sill ?? 0, wallHeight);
      const top = Math.min(sill + o.height, wallHeight);
      if (sill > 1e-4) pieces.push({ s0, s1, y0: 0, y1: sill, kind: "sill", opening: o.id });
      if (wallHeight - top > 1e-4) pieces.push({ s0, s1, y0: top, y1: wallHeight, kind: "lintel", opening: o.id });
    }
    cursor = Math.max(cursor, s1);
  }
  if (segment.length - cursor > 1e-4) pieces.push({ s0: cursor, s1: segment.length, y0: 0, y1: wallHeight, kind: "full" });
  return pieces;
}

/**
 * Grundriss eines Wandstücks [s0, s1] als Viereck (gegen den Uhrzeigersinn nicht garantiert):
 * links-start, rechts-start, rechts-ende, links-ende. An den Segmentenden wird die Gehrung bzw.
 * Verlängerung berücksichtigt.
 */
export function pieceFootprint(seg, s0, s1) {
  const atStart = s0 <= 1e-6;
  const atEnd = s1 >= seg.length - 1e-6;
  const a0 = atStart ? s0 - seg.extendA : s0;
  const a1 = atEnd ? s1 + seg.extendB : s1;
  const p0 = add(seg.a, mul(seg.u, a0));
  const p1 = add(seg.a, mul(seg.u, a1));
  let l0 = add(p0, mul(seg.n, seg.left));
  let r0 = add(p0, mul(seg.n, -seg.right));
  let l1 = add(p1, mul(seg.n, seg.left));
  let r1 = add(p1, mul(seg.n, -seg.right));
  if (seg.kind === "exterior") {
    const outerLeft = seg.left > 0;
    if (atStart && seg.outerA) {
      if (outerLeft) l0 = seg.outerA;
      else r0 = seg.outerA;
    }
    if (atEnd && seg.outerB) {
      if (outerLeft) l1 = seg.outerB;
      else r1 = seg.outerB;
    }
  }
  return [l0, r0, r1, l1];
}

/** Punkt auf einem Segment im Abstand s vom Anfang. */
export function pointOnSegment(seg, s) {
  return add(seg.a, mul(seg.u, s));
}

/**
 * Lücken schließen: Räume, die mit einem Spalt nebeneinander gezeichnet sind (Innenmaße statt
 * Wandmitten), bekommen ihre gegenüberliegenden Kanten auf eine gemeinsame Mittellinie gelegt.
 * Kanten, die sich über Spalte gegenseitig gegenüberliegen, bilden Gruppen; jede Gruppe kommt auf
 * die mittlere Linie. Die Ecken der Räume werden danach neu geschnitten.
 * @param {object[]} rooms Räume im NeonPlan-Format
 * @param {number} maxGap größter Spalt in Metern, der geschlossen wird
 * @returns {{rooms: object[], gaps: number[]}} neue Räume (Kopien) und die geschlossenen Spalte
 */
export function closeGaps(rooms, maxGap = 0.45) {
  const MIN_OVERLAP = 0.2;
  const MAX_OVERLAP = 0.12;
  const edges = [];
  rooms.forEach((room, r) => {
    const pts = room.points ?? [];
    if (pts.length < 3) return;
    const inside = signedArea(pts) > 0 ? 1 : -1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const l = len(sub(q, p));
      if (l < 0.05) continue;
      const dir = mul(sub(q, p), 1 / l);
      const u = canonical(dir);
      const n = leftNormal(u);
      // Außenseite des Raums bezogen auf n: Innenraum liegt links von dir
      const outside = -inside * (dot(dir, u) > 0 ? 1 : -1);
      const tp = dot(u, p);
      const tq = dot(u, q);
      edges.push({ r, i, u, n, c: dot(n, p), outside, t0: Math.min(tp, tq), t1: Math.max(tp, tq) });
    }
  });
  // Paare: parallel, zeigen mit der Außenseite zueinander, Spalt 0..maxGap, ausreichend Überlappung
  const parent = edges.map((_, k) => k);
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const gaps = [];
  for (let a = 0; a < edges.length; a++) {
    for (let b = a + 1; b < edges.length; b++) {
      const e = edges[a];
      const f = edges[b];
      if (e.r === f.r || Math.abs(cross(e.u, f.u)) > 0.05) continue;
      const fc = dot(e.n, mul(f.n, f.c)); // Lage von f auf der Normalen von e
      const gap = (fc - e.c) * e.outside;
      // auch bereits anliegende (Spalt 0) und leicht überlappende Kanten gehören in die Gruppe,
      // damit sie mitwandern, wenn ein Nachbar auf derselben Linie verschoben wird
      if (gap < -MAX_OVERLAP || gap > maxGap || e.outside !== -f.outside * Math.sign(dot(e.n, f.n))) continue;
      const overlap = Math.min(e.t1, f.t1) - Math.max(e.t0, f.t0);
      if (overlap < MIN_OVERLAP) continue;
      parent[find(a)] = find(b);
      if (Math.abs(gap) > SNAP) gaps.push(gap);
    }
  }
  // Zielgerade je Gruppe: Mittel aus kleinster und größter Lage (bei zwei Kanten genau die Mitte)
  const groups = new Map();
  edges.forEach((e, k) => {
    const g = find(k);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  });
  const target = new Map(); // "r:i" -> neue Lage c auf e.n
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ref = members[0];
    const cs = members.map((e) => dot(ref.n, mul(e.n, e.c)));
    const mid = (Math.min(...cs) + Math.max(...cs)) / 2;
    for (const e of members) target.set(`${e.r}:${e.i}`, mid * Math.sign(dot(ref.n, e.n)));
  }
  const out = rooms.map((room, r) => {
    const pts = room.points ?? [];
    if (pts.length < 3) return { ...room };
    const lines = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const d = sub(q, p);
      const l = len(d) || 1;
      const dir = mul(d, 1 / l);
      const n = leftNormal(canonical(dir));
      const c = target.get(`${r}:${i}`);
      const shift = c === undefined ? 0 : c - dot(n, p);
      return { p: add(p, mul(n, shift)), dir };
    });
    const points = pts.map((orig, i) => {
      const a = lines[(i - 1 + pts.length) % pts.length];
      const b = lines[i];
      const den = cross(a.dir, b.dir);
      if (Math.abs(den) < 1e-6) return b.p; // kollinear: Punkt der eigenen Kante
      const t = cross(sub(b.p, a.p), b.dir) / den;
      return add(a.p, mul(a.dir, t));
    });
    return { ...room, points: points.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]) };
  });
  return { rooms: out, gaps };
}
