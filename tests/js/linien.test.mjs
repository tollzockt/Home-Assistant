// E17: Linien für Weg, Hecke, Zaun – Länge und Fläche aus der Mittellinie
import assert from "node:assert/strict";
import { test } from "node:test";

import { offsetPolyline, polylineLength } from "../../custom_components/haus3d/frontend/edit-ops.js";

const area = (p) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) / 2;

test("Länge", () => {
  assert.equal(polylineLength([[0, 0], [3, 0], [3, 4]]), 7);
  assert.equal(polylineLength([[1, 1]]), 0);
  assert.equal(polylineLength(undefined), 0);
});

test("Gerade: Rechteck mit Breite × Länge", () => {
  const p = offsetPolyline([[0, 0], [4, 0]], 1);
  assert.equal(p.length, 4);
  assert.ok(Math.abs(area(p) - 4) < 1e-9);
});

test("Rechter Winkel: Gehrung (6 Ecken), Fläche = Länge × Breite", () => {
  const p = offsetPolyline([[0, 0], [4, 0], [4, 3]], 1);
  assert.equal(p.length, 6);
  assert.ok(Math.abs(area(p) - 7) < 1e-9, `Fläche ${area(p)}`);
});

test("Spitzer Knick wird abgeschrägt; doppelte Punkte und zu wenig Punkte", () => {
  const sharp = offsetPolyline([[0, 0], [4, 0], [0, 0.3]], 0.5);
  assert.equal(sharp.length, 8);
  assert.deepEqual(offsetPolyline([[0, 0], [0, 0]], 1), []);
  assert.deepEqual(offsetPolyline([[0, 0], [2, 0]], 0), []);
  assert.equal(offsetPolyline([[0, 0], [0, 0], [2, 0]], 1).length, 4);
});
