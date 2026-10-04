// PV je Dachfeld: Modul-Achsen, Azimut, Kenndaten, Einfall, Aufteilung der Leistung
import assert from "node:assert/strict";
import { test } from "node:test";

import { azimuthOf, compass16, compassOf, fieldInfo, panelBasis, pvLayout } from "../../custom_components/haus3d/frontend/exterior.js";
import { fieldPower, poaFactor } from "../../custom_components/haus3d/frontend/energy.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("Modul-Achsen: rechtwinklig, Normale nach oben, flach = senkrecht", () => {
  for (const [out, tan, along] of [[[0, 1], 0.7, null], [[0.6, -0.8], 0.3, null], [null, 0, [1, 0]], [null, 0, [0.6, 0.8]]]) {
    const { U, N, Z } = panelBasis(out, tan, along);
    for (const v of [U, N, Z]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    assert.ok(Math.abs(dot(U, N)) < 1e-9 && Math.abs(dot(U, Z)) < 1e-9 && Math.abs(dot(N, Z)) < 1e-9);
    assert.ok(N[1] > 0);
    if (!out) assert.ok(Math.abs(N[1] - 1) < 1e-9);
  }
});

test("Azimut passt zu compassOf; 16 Richtungen", () => {
  for (const north of [0, 90, 233]) {
    for (const dir of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.3, 0.9]]) assert.equal(compassOf(dir, north), ["N", "E", "S", "W"][Math.round(azimuthOf(dir, north) / 90) % 4]);
  }
  assert.equal(azimuthOf([0, 1], 0), 180);
  assert.equal(compass16(205), "SSW");
  assert.equal(compass16(359), "N");
  assert.equal(compass16(90), "O");
});

test("Kenndaten eines Feldes auf einem Satteldach", () => {
  // Satteldach 10 × 8 m, First entlang x: Südseite (+z) fällt nach +z
  const model = { roof: { type: "gable" }, top: 3, eave: 3, tan: Math.tan((35 * Math.PI) / 180), parts: [{ center: [5, 4], length: 10, width: 8, u: [1, 0], v: [0, 1], kind: "gable" }] };
  const item = { type: "pv", x: 5, z: 6, cols: 3, rows: 1, wp: 420 };
  const lay = pvLayout(model, item);
  const info = fieldInfo(model, item, 0);
  assert.equal(info.azimuth, 180);
  assert.equal(info.count, 3);
  assert.equal(info.count, lay.count);
  assert.ok(Math.abs(info.tilt - 35) < 0.01);
  assert.ok(Math.abs(info.kwp - (lay.count * 420) / 1000) < 1e-9);
});

test("Einfall: Sonne hinter der Fläche = 0, flach = sin(Höhe)", () => {
  assert.equal(poaFactor({ azimuth: 0, elevation: 30 }, 180, 40), 0);
  assert.ok(Math.abs(poaFactor({ azimuth: 180, elevation: 30 }, null, 0) - 0.5) < 1e-9);
  assert.ok(poaFactor({ azimuth: 180, elevation: 50 }, 180, 40) > 0.99);
  assert.equal(poaFactor({ azimuth: 180, elevation: -5 }, 180, 40), 0);
  assert.equal(poaFactor(null, 180, 40), 0);
});

test("Aufteilung: eigener Sensor gilt, Rest nach kWp × Einfall, ohne Sonne nach kWp", () => {
  const fields = [
    { id: "sued", kwp: 4, azimuth: 180, tilt: 35 },
    { id: "nord", kwp: 4, azimuth: 0, tilt: 35 },
    { id: "ost", kwp: 2, azimuth: 90, tilt: 35, w: 500 },
  ];
  const noon = fieldPower(fields, 3500, { azimuth: 180, elevation: 50 });
  assert.deepEqual(noon.get("ost"), { w: 500, estimated: false });
  assert.ok(noon.get("sued").w > noon.get("nord").w);
  assert.ok(Math.abs(noon.get("sued").w + noon.get("nord").w - 3000) < 1e-6);
  const plain = fieldPower(fields, 3500);
  assert.equal(plain.get("sued").w, 1500);
  assert.equal(fieldPower(fields, NaN).get("sued").w, null);
  // Sonne hinter allen Feldern: trotzdem nach kWp verteilen
  assert.equal(fieldPower(fields.slice(0, 1), 100, { azimuth: 0, elevation: 10 }).get("sued").w, 100);
});
