// Treppen: Stufen, Podest, Grundfläche, Deckenöffnung, Zuschneiden
import assert from "node:assert/strict";
import { test } from "node:test";

import { clipPolygon, roomHole, slabOpenings, stairFootprint, stairLayout } from "../../custom_components/haus3d/frontend/stairs.js";

const inside = (t, w, d) => t.x0 >= -w / 2 - 1e-9 && t.x1 <= w / 2 + 1e-9 && t.z0 >= -d / 2 - 1e-9 && t.z1 <= d / 2 + 1e-9;

test("Gerade Treppe: Stufenzahl, oberste Stufe = Höhe, Antritt vorne", () => {
  const s = stairLayout({ w: 1, d: 3, h: 2.6 });
  assert.equal(s.count, 14);
  assert.ok(Math.abs(s.treads.at(-1).top - 2.6) < 1e-9);
  assert.ok(Math.abs(s.treads[0].z1 - 1.5) < 1e-9);
  assert.ok(s.treads.every((t) => inside(t, 1, 3)));
});

test("Viertelgewendelt: Podest, zwei Fluchten in der Grundfläche, Höhe stimmt", () => {
  for (const shape of ["l_left", "l_right"]) {
    const s = stairLayout({ shape, w: 2.2, d: 3, h: 2.8 });
    assert.equal(s.treads.filter((t) => t.landing).length, 1);
    assert.ok(Math.abs(s.treads.at(-1).top - 2.8) < 1e-9);
    assert.ok(s.treads.every((t) => inside(t, 2.2, 3)), shape);
    const tops = s.treads.map((t) => t.top);
    assert.deepEqual(tops, [...tops].sort((a, b) => a - b));
    // zweite Flucht läuft zur Abbiegeseite
    const last = s.treads.at(-1);
    assert.ok(shape === "l_left" ? last.x0 < -0.5 : last.x1 > 0.5);
  }
});

test("Grundfläche gedreht wie in der Szene", () => {
  const p = stairFootprint({ x: 5, z: 5, w: 1, d: 3, rotation: 90 });
  const xs = p.map((q) => q[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 3) < 1e-9);
});

test("Deckenöffnung: Treppe aus dem KG reicht bis EG; cut false; Treppenloch; zu kurz", () => {
  const stairs = (extra) => ({ id: "t", type: "stairs", x: 2, z: 2, w: 1, d: 3, h: 2.6, ...extra });
  const b = (m, own = []) => ({ floors: [{ id: "kg", name: "KG", elevation: -2.6, furniture: [m] }, { id: "eg", name: "EG", elevation: 0, furniture: own }, { id: "og", elevation: 2.8, furniture: [] }] });
  assert.equal(slabOpenings(b(stairs()), "eg").length, 1);
  assert.equal(slabOpenings(b(stairs()), "eg")[0].from, "KG");
  assert.equal(slabOpenings(b(stairs()), "og").length, 0);
  assert.equal(slabOpenings(b(stairs({ cut: false })), "eg").length, 0);
  assert.equal(slabOpenings(b(stairs({ h: 1.2 })), "eg").length, 0);
  assert.equal(slabOpenings(b(stairs(), [{ type: "stairwell", x: 6, z: 6, w: 1, d: 2 }]), "eg").length, 2);
  assert.deepEqual(slabOpenings({ floors: [] }, "x"), []);
});

test("Zuschneiden: konkaver Raum, Loch nur im Raum, eingerückt; zu klein → null", () => {
  // L-förmiger Raum
  const room = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  const hole = [[1, 1], [3, 1], [3, 3], [1, 3]];
  const c = clipPolygon(room, hole);
  const area = Math.abs(c.reduce((s, a, i) => s + a[0] * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * a[1], 0)) / 2;
  assert.ok(Math.abs(area - 3) < 1e-9, `Fläche ${area}`);
  const h = roomHole(room, hole);
  assert.ok(h.every(([x, z]) => x > 1 && z > 1));
  assert.equal(roomHole(room, [[10, 10], [11, 10], [11, 11], [10, 11]]), null);
});
