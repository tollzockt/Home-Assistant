// E15: Kantenmaße, Länge eintippen, Rechteck-Größe, PV-Hindernisse
import assert from "node:assert/strict";
import { test } from "node:test";

import { edgeDimensions, isAxisRect, setEdgeLength, setRectSize } from "../../custom_components/haus3d/frontend/edit-ops.js";
import { polygonsOverlap, pvLayout, roofItemFootprint, roofObstacles } from "../../custom_components/haus3d/frontend/exterior.js";

const sq = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

test("Kantenmaße: Länge, Mitte, Normale nach außen (beide Umlaufrichtungen)", () => {
  for (const pts of [sq(0, 0, 4, 3), [...sq(0, 0, 4, 3)].reverse()]) {
    const d = edgeDimensions(pts);
    assert.deepEqual(d.map((e) => e.len).sort(), [3, 3, 4, 4]);
    for (const e of d) {
      const q = [e.mid[0] + e.nOut[0], e.mid[1] + e.nOut[1]];
      assert.ok(q[0] < 0 || q[0] > 4 || q[1] < 0 || q[1] > 3, `Normale zeigt nach innen: ${JSON.stringify(e)}`);
    }
  }
});

test("Länge eintippen: Rechteck bleibt rechtwinklig, Nachbar folgt (außer einzeln)", () => {
  const floor = { rooms: [{ id: "a", points: sq(0, 0, 4, 3) }, { id: "b", points: sq(4, 0, 7, 3) }], openings: [], walls: [] };
  const f = setEdgeLength(floor, "a", 0, 5);
  const a = f.rooms.find((r) => r.id === "a").points;
  assert.deepEqual(a, sq(0, 0, 5, 3));
  assert.ok(isAxisRect(a));
  assert.ok(f.rooms.find((r) => r.id === "b").points.some((p) => p[0] === 5));
  const solo = setEdgeLength(floor, "a", 0, 5, { linked: false });
  assert.deepEqual(solo.rooms.find((r) => r.id === "b").points, sq(4, 0, 7, 3));
  // Kante 1 (rechts, z-Richtung) auf 2 m
  assert.deepEqual(setEdgeLength(floor, "a", 1, 2).rooms[0].points, sq(0, 0, 4, 2));
  // unsinnige Länge: nichts
  assert.equal(setEdgeLength(floor, "a", 0, 0), floor);
});

test("Rechteck-Größe: erste Ecke bleibt", () => {
  const floor = { rooms: [{ id: "a", points: sq(1, 1, 5, 4) }], openings: [], walls: [] };
  const f = setRectSize(floor, "a", { w: 6, d: 2 });
  assert.deepEqual(f.rooms[0].points, sq(1, 1, 7, 3));
  assert.equal(isAxisRect([[0, 0], [1, 1], [0, 2], [-1, 1]]), false);
});

test("PV-Hindernisse: Kamin verdeckt Module, ohne Hindernisse unverändert", () => {
  const model = { roof: { type: "gable" }, top: 3, eave: 3, tan: Math.tan((35 * Math.PI) / 180), parts: [{ center: [5, 4], length: 10, width: 8, u: [1, 0], v: [0, 1], kind: "gable" }] };
  const item = { type: "pv", x: 5, z: 6, cols: 4, rows: 1 };
  const free = pvLayout(model, item);
  const chimney = { type: "chimney", x: 5, z: 6, w: 0.5, d: 0.5 };
  const obs = roofObstacles(model, [chimney, item]);
  assert.equal(obs.length, 1);
  const lay = pvLayout(model, item, { obstacles: obs });
  assert.equal(free.blockedCount, 0);
  assert.ok(lay.blockedCount >= 1 && lay.count === free.count - lay.blockedCount);
  assert.equal(roofItemFootprint(model, item), null);
  assert.equal(polygonsOverlap(sq(0, 0, 1, 1), sq(2, 2, 3, 3)), false);
  assert.equal(polygonsOverlap(sq(0, 0, 2, 2), sq(1, 1, 3, 3)), true);
  // Kreuz ohne Ecke innen
  assert.equal(polygonsOverlap(sq(0, 1, 4, 2), sq(1.5, 0, 2.5, 3)), true);
});
