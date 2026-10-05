// Treppenformen: L mit Podest/gewendelt, U, Wendeltreppe; Lauflinie; Deckenöffnung je Form
import assert from "node:assert/strict";
import { test } from "node:test";

import { STAIR_SHAPES, slabOpenings, stairHole, stairLayout } from "../../custom_components/haus3d/frontend/stairs.js";

const pts = (t) => t.poly ?? [[t.x0, t.z0], [t.x1, t.z0], [t.x1, t.z1], [t.x0, t.z1]];
const inside = (t, w, d) => pts(t).every(([x, z]) => x >= -w / 2 - 1e-9 && x <= w / 2 + 1e-9 && z >= -d / 2 - 1e-9 && z <= d / 2 + 1e-9);
const area = (p) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) / 2;

test("Alle Formen: oberste Stufe = Höhe, steigend, in der Grundfläche", () => {
  for (const [shape] of STAIR_SHAPES) {
    const s = stairLayout({ shape, w: 2.2, d: 3.2, h: 2.8 });
    assert.ok(Math.abs(s.treads.at(-1).top - 2.8) < 1e-9, shape);
    const tops = s.treads.map((t) => t.top);
    assert.deepEqual(tops, [...tops].sort((a, b) => a - b), shape);
    assert.ok(s.treads.every((t) => inside(t, 2.2, 3.2)), shape);
    assert.equal(s.count, s.treads.length, shape);
    assert.ok(s.path.length >= 2, shape);
  }
});

test("L gewendelt: 3 Wendelstufen füllen das Eckquadrat, kein Podest", () => {
  for (const shape of ["lw_left", "lw_right"]) {
    const s = stairLayout({ shape, w: 2, d: 3, h: 2.6, run: 0.9 });
    const w = s.treads.filter((t) => t.winder);
    assert.equal(w.length, 3);
    assert.equal(s.treads.filter((t) => t.landing).length, 0);
    assert.ok(Math.abs(w.reduce((a, t) => a + area(t.poly), 0) - 0.81) < 1e-9, shape);
    assert.equal(s.run, 0.9);
  }
  // Kehre links: zweite Flucht läuft nach −x
  const l = stairLayout({ shape: "lw_left", w: 2, d: 3 });
  assert.ok(l.treads.at(-1).x0 < -0.5);
  assert.ok(stairLayout({ shape: "lw_right", w: 2, d: 3 }).treads.at(-1).x1 > 0.5);
});

test("U: zwei Fluchten nebeneinander, Podest über die ganze Breite", () => {
  const s = stairLayout({ shape: "u_left", w: 2.2, d: 3, h: 2.6 });
  const land = s.treads.filter((t) => t.landing);
  assert.equal(land.length, 1);
  assert.ok(Math.abs(land[0].x1 - land[0].x0 - 2.2) < 1e-9);
  const before = s.treads.slice(0, s.treads.indexOf(land[0]));
  const after = s.treads.slice(s.treads.indexOf(land[0]) + 1);
  assert.ok(before.every((t) => t.x0 > 0) && after.every((t) => t.x1 < 0));
});

test("Wendeltreppe: Fächer um die Spindel, höchstens eine Umdrehung", () => {
  const s = stairLayout({ shape: "spiral", w: 1.6, d: 1.6, h: 2.7 });
  assert.ok(s.treads.every((t) => t.spiral && t.poly.length === 5));
  assert.ok(s.spindle > 0 && s.radius === 0.8);
});

test("Deckenöffnung je Form: L nur Eck + zweite Flucht, Wendel rund, gerade ganz", () => {
  const base = { x: 5, z: 5, w: 2, d: 3, rotation: 0 };
  assert.ok(Math.abs(area(stairHole({ ...base, stair_shape: "straight" })) - 6) < 1e-9);
  assert.ok(Math.abs(area(stairHole({ ...base, stair_shape: "lw_left", run_width: 1 })) - 2) < 1e-9);
  assert.equal(stairHole({ ...base, stair_shape: "spiral" }).length, 16);
  const b = { floors: [{ id: "kg", name: "KG", elevation: -2.6, furniture: [{ ...base, type: "stairs", h: 2.6, stair_shape: "l_right" }] }, { id: "eg", elevation: 0, furniture: [] }] };
  assert.equal(slabOpenings(b, "eg").length, 1);
});
