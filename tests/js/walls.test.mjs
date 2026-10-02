// Tests der Wandberechnung: node --test tests/js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { computeWalls, pieceFootprint, wallPieces } from "../../custom_components/haus3d/frontend/walls.js";

const DATA = new URL("../../custom_components/haus3d/haus-daten.json", import.meta.url);
const building = JSON.parse(readFileSync(DATA, "utf8"));
const settings = building.settings;

const rect = (id, x0, z0, x1, z1) => ({ id, name: id, area_id: null, floor_material: "wood", points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
const floorOf = (rooms, openings = []) => ({ id: "f", rooms, openings, walls: [] });

/** Prüft, dass sich keine zwei Segmente auf derselben Geraden überlappen. */
function assertNoOverlaps(segments, label) {
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i];
      const o = segments[j];
      if (s.kind === "free" || o.kind === "free") continue;
      const parallel = Math.abs(s.u[0] * o.u[1] - s.u[1] * o.u[0]) < 1e-4;
      if (!parallel) continue;
      // Abstand von o.a zur Geraden von s
      const d = (o.a[0] - s.a[0]) * s.n[0] + (o.a[1] - s.a[1]) * s.n[1];
      if (Math.abs(d) > 0.01) continue;
      const proj = (p) => (p[0] - s.a[0]) * s.u[0] + (p[1] - s.a[1]) * s.u[1];
      const [a0, a1] = [0, s.length];
      const [b0, b1] = [proj(o.a), proj(o.b)].sort((x, y) => x - y);
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      assert.ok(overlap < 0.01, `${label}: Segmente ${s.id} (${s.kind}) und ${o.id} (${o.kind}) überlappen um ${overlap.toFixed(3)} m`);
    }
  }
}

for (const floor of building.floors) {
  test(`haus-daten.json, Etage ${floor.name}: keine doppelten Wände`, () => {
    const { segments, warnings } = computeWalls(floor, settings);
    assert.ok(segments.length > 0);
    assertNoOverlaps(segments, floor.name);
    assert.deepEqual(warnings.filter((w) => w.includes("überlappen")), []);
  });

  test(`haus-daten.json, Etage ${floor.name}: jede Innenwand gehört zu genau zwei Räumen`, () => {
    const { segments } = computeWalls(floor, settings);
    for (const s of segments.filter((x) => x.kind === "interior")) {
      assert.ok(s.roomLeft && s.roomRight && s.roomLeft !== s.roomRight, `${s.id}`);
      assert.equal(s.left + s.right, settings.wall_interior);
    }
    for (const s of segments.filter((x) => x.kind === "exterior")) {
      assert.ok(!!s.roomLeft !== !!s.roomRight, `${s.id} hat genau einen Raum`);
      assert.equal(s.left + s.right, settings.wall_exterior);
    }
  });

  test(`haus-daten.json, Etage ${floor.name}: jede Öffnung liegt auf genau einem Wandsegment`, () => {
    const { segments, openings, warnings } = computeWalls(floor, settings);
    assert.equal(openings.length, floor.openings.length, warnings.join("; "));
    const seen = new Set();
    for (const p of openings) {
      assert.ok(!seen.has(p.opening.id), `${p.opening.id} doppelt`);
      seen.add(p.opening.id);
      const hosts = segments.filter((s) => s.id === p.segment);
      assert.equal(hosts.length, 1, `${p.opening.id}`);
      assert.ok(p.fits, `${p.opening.id} passt nicht ins Segment ${p.segment}`);
      // die Öffnung liegt nur in einem Segment: ihre Mitte ist in keinem anderen Segment derselben Raumkante
      const others = segments.filter(
        (s) =>
          s.id !== p.segment &&
          s.sources.some((src) => src.room_id === p.opening.room_id && src.edge === p.opening.edge && p.opening.offset > src.t0 + 0.01 && p.opening.offset < src.t1 - 0.01),
      );
      assert.deepEqual(others.map((s) => s.id), [], `${p.opening.id} auch in anderen Segmenten`);
    }
  });

  test(`haus-daten.json, Etage ${floor.name}: Wandstücke lassen die Öffnungen frei`, () => {
    const { segments, openings } = computeWalls(floor, settings);
    for (const seg of segments) {
      const pieces = wallPieces(seg, openings, floor.height);
      for (const p of openings.filter((x) => x.segment === seg.id)) {
        const o = p.opening;
        const mid = (p.s0 + p.s1) / 2;
        const y = (o.sill ?? 0) + o.height / 2;
        const blocking = pieces.filter((pc) => pc.s0 < mid && pc.s1 > mid && pc.y0 < y && pc.y1 > y);
        assert.deepEqual(blocking, [], `${o.id} wird verdeckt`);
      }
      for (const pc of pieces) {
        const fp = pieceFootprint(seg, pc.s0, pc.s1);
        assert.equal(fp.length, 4);
        for (const pt of fp) assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
      }
    }
  });
}

test("geteilte Kante: genau eine Innenwand", () => {
  const { segments } = computeWalls(floorOf([rect("a", 0, 0, 4, 3), rect("b", 4, 0, 8, 3)]));
  const interior = segments.filter((s) => s.kind === "interior");
  assert.equal(interior.length, 1);
  assert.equal(interior[0].length, 3);
  assert.equal(segments.filter((s) => s.kind === "exterior").length, 6);
});

test("teilweise geteilte Kante wird in Segmente aufgeteilt", () => {
  // a: x 0..4, z 0..5; b: x 4..8, z 2..4 -> Innenwand nur auf z 2..4
  const { segments } = computeWalls(floorOf([rect("a", 0, 0, 4, 5), rect("b", 4, 2, 8, 4)]));
  const onLine = segments.filter((s) => Math.abs(s.a[0] - 4) < 1e-6 && Math.abs(s.b[0] - 4) < 1e-6);
  const kinds = onLine.map((s) => [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1]), s.kind]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(kinds, [
    [0, 2, "exterior"],
    [2, 4, "interior"],
    [4, 5, "exterior"],
  ]);
  assertNoOverlaps(segments, "teilweise");
});

test("Öffnung auf teilweise geteilter Kante landet im richtigen Segment", () => {
  const rooms = [rect("a", 0, 0, 4, 5), rect("b", 4, 2, 8, 4)];
  // Kante 1 von a läuft von (4,0) nach (4,5): offset 3 = Innenwand, offset 1 = Außenwand
  const openings = [
    { id: "tuer", room_id: "a", edge: 1, offset: 3, width: 0.9, type: "door", sill: 0, height: 2 },
    { id: "fenster", room_id: "a", edge: 1, offset: 1, width: 1, type: "window", sill: 1, height: 1 },
    // dieselbe Innenwand, aber über Raum b angegeben (Kante 3 läuft von (4,4) nach (4,2))
    { id: "tuer_b", room_id: "b", edge: 3, offset: 0.5, width: 0.6, type: "door", sill: 0, height: 2 },
  ];
  const { segments, openings: placed } = computeWalls(floorOf(rooms, openings));
  const kind = (id) => segments.find((s) => s.id === placed.find((p) => p.opening.id === id).segment).kind;
  assert.equal(kind("tuer"), "interior");
  assert.equal(kind("fenster"), "exterior");
  assert.equal(kind("tuer_b"), "interior");
  // tuer_b: Mitte 0.5 m ab (4,4) Richtung (4,2) -> z = 3.5
  const p = placed.find((x) => x.opening.id === "tuer_b");
  const seg = segments.find((s) => s.id === p.segment);
  const z = seg.a[1] + seg.u[1] * p.s;
  assert.ok(Math.abs(z - 3.5) < 1e-6, `z = ${z}`);
});

test("Raumrichtung (im/gegen Uhrzeigersinn) ändert nichts", () => {
  const cw = rect("a", 0, 0, 4, 3);
  const ccw = { ...cw, points: [...cw.points].reverse() };
  const s1 = computeWalls(floorOf([cw, rect("b", 4, 0, 8, 3)])).segments;
  const s2 = computeWalls(floorOf([ccw, rect("b", 4, 0, 8, 3)])).segments;
  assert.equal(s1.filter((s) => s.kind === "interior").length, 1);
  assert.equal(s2.filter((s) => s.kind === "interior").length, 1);
  assert.equal(s1.length, s2.length);
});

test("Außenwände wachsen nach außen und bekommen Gehrung an Ecken", () => {
  const { segments } = computeWalls(floorOf([rect("a", 0, 0, 4, 3)]), { wall_exterior: 0.24 });
  for (const s of segments) {
    assert.equal(s.kind, "exterior");
    assert.ok(s.outerA && s.outerB, `${s.id} ohne Gehrung`);
    for (const c of [s.outerA, s.outerB]) {
      // Ecken liegen 0.24 außerhalb des Rechtecks
      assert.ok(Math.abs(Math.abs(c[0] - 2) - 2.24) < 1e-6 && Math.abs(Math.abs(c[1] - 1.5) - 1.74) < 1e-6, `${c}`);
    }
  }
});

test("Brüstung und Sturz sind eigene Stücke", () => {
  const rooms = [rect("a", 0, 0, 4, 3)];
  const openings = [{ id: "f", room_id: "a", edge: 0, offset: 2, width: 1, type: "window", sill: 0.9, height: 1.2 }];
  const { segments, openings: placed } = computeWalls(floorOf(rooms, openings));
  const seg = segments.find((s) => s.id === placed[0].segment);
  const pieces = wallPieces(seg, placed, 2.5);
  assert.deepEqual(
    pieces.map((p) => [p.kind, +p.s0.toFixed(3), +p.s1.toFixed(3), +p.y0.toFixed(3), +p.y1.toFixed(3)]),
    [
      ["full", 0, 1.5, 0, 2.5],
      ["sill", 1.5, 2.5, 0, 0.9],
      ["lintel", 1.5, 2.5, 2.1, 2.5],
      ["full", 2.5, 4, 0, 2.5],
    ],
  );
});

test("Öffnung auf nicht vorhandener Kante wird gemeldet statt platziert", () => {
  const { openings, warnings } = computeWalls(floorOf([rect("a", 0, 0, 4, 3)], [{ id: "x", room_id: "a", edge: 0, offset: 9, width: 1, type: "window", sill: 1, height: 1 }]));
  assert.equal(openings.length, 0);
  assert.ok(warnings.some((w) => w.includes("x")));
});
