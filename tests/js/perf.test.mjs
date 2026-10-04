// Leistung: Qualitätsstufen, Zeichentakt, Auflösung nach Bildzeit, Möbel innen ausblenden
import assert from "node:assert/strict";
import { test } from "node:test";

import { QUALITY, adaptDpr, ambientInterval, lodState, quantile, resolveQuality, shouldRender } from "../../custom_components/haus3d/frontend/perf.js";

test("Stufen vollständig, auto: Tablet ausgewogen, PC schön", () => {
  for (const q of Object.values(QUALITY)) for (const k of ["maxDpr", "glow", "weatherScale", "ambientFps", "cullInterior"]) assert.ok(k in q, k);
  assert.equal(resolveQuality("akku").maxDpr, 1);
  assert.equal(resolveQuality("auto", { coarse: true }).name, "ausgewogen");
  assert.equal(resolveQuality("auto").name, "schoen");
  assert.ok(resolveQuality("quatsch").auto);
});

test("Zeichnen: Änderungen sofort, Hintergrund gedrosselt", () => {
  const i = ambientInterval(24);
  assert.ok(Math.abs(i - 41.67) < 0.01);
  assert.equal(shouldRender({ dirty: true }), true);
  assert.equal(shouldRender({ ambient: true, now: 1000, lastRender: 980, interval: i }), false);
  assert.equal(shouldRender({ ambient: true, now: 1000, lastRender: 950, interval: i }), true);
  assert.equal(shouldRender({ ambient: false, now: 5000, lastRender: 0 }), false);
});

test("Auflösung: runter bei Ruckeln, rauf bei Reserve, sonst gleich, Grenzen", () => {
  const slow = Array(30).fill(45);
  const fast = Array(30).fill(10);
  const ok = Array(30).fill(20);
  assert.equal(adaptDpr(2, slow), 1.75);
  assert.equal(adaptDpr(1, slow), 1);
  assert.equal(adaptDpr(1.5, fast, { max: 1.5 }), 1.5);
  assert.equal(adaptDpr(1.25, fast), 1.5);
  assert.equal(adaptDpr(1.5, ok), 1.5);
  assert.equal(adaptDpr(1.5, slow.slice(0, 5)), 1.5); // zu wenig Messungen
  assert.equal(quantile([1, 2, 3, 4], 0.75), 3);
});

test("Möbel innen nur bei Draufsicht mit Dach und passender Stufe ausblenden", () => {
  assert.equal(lodState(0.6, true, QUALITY.akku).hideInterior, true);
  assert.equal(lodState(1.4, true, QUALITY.akku).hideInterior, false);
  assert.equal(lodState(0.6, false, QUALITY.akku).hideInterior, false);
  assert.equal(lodState(0.6, true, QUALITY.schoen).hideInterior, false);
});
