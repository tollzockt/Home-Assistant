// Blickwinkel: feste Ansichten, Norden, Haus im Bild, gemerkte Ansichten
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_VIEWS, normalizeViews, poseInBox, presetPose } from "../../custom_components/haus3d/frontend/camera.js";

const box = { min: [0, 0, 0], max: [12, 6, 9] };
const dir = (p) => {
  const d = p.position.map((v, i) => v - p.target[i]);
  const l = Math.hypot(...d);
  return d.map((x) => x / l);
};

test("Oben: senkrecht über dem Haus; Norden oben im Bild", () => {
  const p = presetPose("oben", box);
  const d = dir(p);
  assert.ok(d[1] > 0.999);
  assert.deepEqual(p.target, [6, 3, 4.5]);
  assert.ok(d[2] > 0); // Kamera leicht südlich (+z) → Norden (−z) oben
  assert.ok(dir(presetPose("oben", box, { north: 180 }))[2] < 0);
});

test("Süd-Ansicht dreht mit Norden; Ost/West; 15° Höhe", () => {
  const s0 = dir(presetPose("sued", box, { north: 0 }));
  assert.ok(s0[2] > 0.9 && Math.abs(s0[0]) < 1e-9);
  const s180 = dir(presetPose("sued", box, { north: 180 }));
  assert.ok(s180[2] < -0.9);
  assert.ok(dir(presetPose("ost", box))[0] > 0.9);
  assert.ok(dir(presetPose("west", box))[0] < -0.9);
  assert.ok(dir(presetPose("nord", box, { north: 90 }))[0] > 0.9);
  assert.ok(Math.abs(Math.asin(s0[1]) * 180 / Math.PI - 15) < 1e-6);
});

test("Haus im Bild bei schmalem und breitem Fenster (Iso und Süd)", () => {
  for (const aspect of [0.6, 1.6]) {
    for (const name of ["iso", "sued", "oben"]) {
      const fov = 45;
      const p = presetPose(name, box, { fov, aspect });
      const f = dir(p).map((x) => -x); // Blickrichtung
      // Seitenmitten am Boden müssen im Kegel des kleineren Öffnungswinkels liegen
      const halfV = (fov / 2) * Math.PI / 180;
      const halfH = Math.atan(Math.tan(halfV) * aspect);
      const lim = Math.min(halfV, halfH);
      for (const q of [[0, 0, 4.5], [12, 0, 4.5], [6, 0, 0], [6, 0, 9], [6, 6, 4.5]]) {
        const v = q.map((x, i) => x - p.position[i]);
        const l = Math.hypot(...v);
        const ang = Math.acos((v[0] * f[0] + v[1] * f[1] + v[2] * f[2]) / l);
        assert.ok(ang <= lim + 0.02, `${name} ${aspect}: ${q} außerhalb (${ang.toFixed(3)} > ${lim.toFixed(3)})`);
      }
    }
  }
});

test("Gemerkte Ansicht: beim Haus gültig, weit weg oder kaputt nicht; höchstens 6", () => {
  const p = presetPose("iso", box);
  assert.equal(poseInBox(p, box), true);
  assert.equal(poseInBox({ target: [100, 0, 0], position: [110, 10, 0] }, box), false);
  assert.equal(poseInBox({ target: [6, 3, 4], position: [6, 3, 4] }, box), false);
  assert.equal(poseInBox({ target: [6, 3], position: [1, 2, 3] }, box), false);
  assert.equal(poseInBox(null, box), false);
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `A${i}`, target: [i, 0, 0], position: [i, 5, 5.123] }));
  const v = normalizeViews([...many, { name: "kaputt", target: [NaN, 0, 0], position: [0, 0, 0] }, "x"]);
  assert.equal(v.length, MAX_VIEWS);
  assert.equal(v.at(-1).name, "A8");
  assert.deepEqual(v[0].position, [3, 5, 5.12]);
  assert.deepEqual(normalizeViews(undefined), []);
});
