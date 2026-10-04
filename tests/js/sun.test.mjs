// Sonnenstand: NOAA-Werte für Berlin, Achsen wie compassOf, Licht nach Höhe, Werte aus HA
import assert from "node:assert/strict";
import { test } from "node:test";

import { compassOf } from "../../custom_components/haus3d/frontend/exterior.js";
import { angleBetween, sunFromHass, sunLook, sunPosition, sunVector } from "../../custom_components/haus3d/frontend/sun.js";

const BERLIN = [52.52, 13.405];
const noon = (y, m, d) => {
  // höchster Stand des Tages (Minutenraster)
  let best = { elevation: -99 };
  for (let min = 0; min < 1440; min++) {
    const p = sunPosition(Date.UTC(y, m - 1, d, 0, min), ...BERLIN);
    if (p.elevation > best.elevation) best = p;
  }
  return best;
};

test("Berlin: Mittagshöhe 21. Juni ≈ 60,9°, 21. Dezember ≈ 14,0°, Süden; Mitternacht unter dem Horizont", () => {
  const jun = noon(2026, 6, 21);
  assert.ok(Math.abs(jun.elevation - 60.9) < 0.3, `Juni ${jun.elevation}`);
  assert.ok(Math.abs(jun.azimuth - 180) < 1.5, `Azimut ${jun.azimuth}`);
  const dec = noon(2026, 12, 21);
  assert.ok(Math.abs(dec.elevation - 14.0) < 0.3, `Dezember ${dec.elevation}`);
  assert.ok(sunPosition(Date.UTC(2026, 5, 21, 23, 0), ...BERLIN).elevation < 0);
  // morgens im Osten, abends im Westen
  assert.ok(Math.abs(sunPosition(Date.UTC(2026, 2, 20, 6, 0), ...BERLIN).azimuth - 95) < 15);
  assert.ok(Math.abs(sunPosition(Date.UTC(2026, 2, 20, 16, 0), ...BERLIN).azimuth - 255) < 15);
});

test("Richtung in Szenen-Achsen stimmt mit compassOf überein (Norden 0/90/233)", () => {
  for (const north of [0, 90, 233]) {
    for (const [az, dir] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]]) {
      const v = sunVector(az, 0, north);
      assert.equal(compassOf([v[0], v[2]], north), dir, `Norden ${north}, Azimut ${az}`);
      assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
    }
  }
  assert.deepEqual(sunVector(0, 90, 0).map((x) => Math.round(x * 1e6) / 1e6 + 0), [0, 1, 0]);
  // Osten bei Norden oben: +x
  assert.ok(sunVector(90, 20, 0)[0] > 0.9);
  assert.ok(angleBetween(sunVector(180, 30), sunVector(180.2, 30)) < 0.3);
  assert.ok(angleBetween(sunVector(180, 30), sunVector(181, 30)) > 0.3);
});

test("Licht nach Höhe: Mittag hell und weiß, Abend warm, Nacht null", () => {
  const mid = sunLook(60);
  const eve = sunLook(3);
  assert.equal(mid.colorHex, 0xffffff);
  assert.ok(eve.intensityFactor < mid.intensityFactor);
  assert.ok((eve.colorHex & 0xff) < 0xc0, "abends weniger Blau");
  assert.ok(eve.hemiFactor >= 0.6);
  assert.equal(sunLook(-5), null);
  assert.equal(sunLook(NaN), null);
});

test("Sonnenstand aus HA: Attribute von sun.sun, sonst aus Breite/Länge, sonst null", () => {
  assert.deepEqual(sunFromHass({ states: { "sun.sun": { state: "above_horizon", attributes: { azimuth: 120.5, elevation: 22 } } } }), { azimuth: 120.5, elevation: 22 });
  const p = sunFromHass({ states: {}, config: { latitude: 52.52, longitude: 13.405 } }, Date.UTC(2026, 5, 21, 11, 8));
  assert.ok(p.elevation > 60);
  assert.equal(sunFromHass({ states: {}, config: {} }), null);
  assert.equal(sunFromHass(null), null);
});
