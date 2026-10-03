// Tests für Dach, Balkon, Wetter und Streupunkte
import assert from "node:assert/strict";
import { test } from "node:test";

import { freeEdges, mainDirection, roofFloor, roofRooms, roofFrame, roofSettings, scatter, weatherEntity, weatherKind } from "../../custom_components/haus3d/frontend/exterior.js";
import { pointInPolygon } from "../../custom_components/haus3d/frontend/walls.js";

const rect = (x0, z0, x1, z1) => ({ points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });

test("Dachrahmen: First entlang der langen Seite, um Wand und Überstand vergrößert", () => {
  const f = roofFrame([rect(0, 0, 10, 6)], { wall: 0.24, overhang: 0.4 });
  assert.deepEqual(f.center, [5, 3]);
  assert.equal(f.length, 11.28);
  assert.equal(f.width, 7.28);
  assert.ok(Math.abs(Math.abs(f.u[0]) - 1) < 1e-9); // First entlang x
  const g = roofFrame([rect(0, 0, 6, 10)], { wall: 0, overhang: 0 });
  assert.ok(Math.abs(Math.abs(g.u[1]) - 1) < 1e-9); // First entlang z
  const h = roofFrame([rect(0, 0, 10, 6)], { wall: 0, overhang: 0, direction: "z" });
  assert.equal(h.length, 6);
});

test("Hauptrichtung eines gedrehten Hauses", () => {
  const a = Math.PI / 6;
  const rot = ([x, z]) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
  const room = { points: rect(0, 0, 8, 5).points.map(rot) };
  assert.ok(Math.abs(mainDirection([room]) - a) < 1e-6);
  const f = roofFrame([room], { wall: 0, overhang: 0 });
  assert.ok(Math.abs(f.length - 8) < 1e-3 && Math.abs(f.width - 5) < 1e-3);
});

test("Dach-Einstellungen werden begrenzt, oberste Etage gewählt", () => {
  const r = roofSettings({ roof: { type: "quatsch", pitch: 90, overhang: -1 } });
  assert.deepEqual([r.type, r.pitch, r.overhang], ["none", 60, 0]);
  const b = { floors: [{ id: "kg", elevation: -2.6, height: 2.4, rooms: [rect(0, 0, 1, 1)] }, { id: "eg", elevation: 0, height: 2.6, rooms: [rect(0, 0, 1, 1)] }, { id: "garten", elevation: 3, height: 0.5, rooms: [] }] };
  assert.equal(roofFloor(b, r).id, "eg");
  assert.equal(roofFloor(b, { floor: "kg" }).id, "kg");
});

test("Balkon: Geländer nur an den Kanten, die nicht am Haus liegen", () => {
  const house = rect(0, 0, 8, 6);
  const balcony = [[2, 6], [5, 6], [5, 7.5], [2, 7.5]];
  const free = freeEdges(balcony, [house]);
  assert.equal(free.length, 3);
  assert.ok(!free.some(([a, b]) => a[1] === 6 && b[1] === 6));
  // freistehende Fläche: alle Kanten
  assert.equal(freeEdges([[20, 20], [22, 20], [22, 22]], [house]).length, 3);
});

test("Wetter aus dem Zustand", () => {
  assert.equal(weatherKind({ state: "pouring" }).kind, "rain");
  assert.equal(weatherKind({ state: "snowy" }).kind, "snow");
  assert.equal(weatherKind({ state: "sunny" }).kind, null);
  assert.equal(weatherKind(undefined).kind, null);
  const hass = { states: { "weather.zuhause": { state: "rainy" }, "weather.alt": { state: "sunny" } } };
  assert.equal(weatherEntity(hass, {}), "weather.alt");
  assert.equal(weatherEntity(hass, { weather: "weather.zuhause" }), "weather.zuhause");
  assert.equal(weatherEntity(hass, { weather: "none" }), null);
});

test("Streupunkte liegen im Polygon und sind reproduzierbar", () => {
  const bed = [[0, 0], [4, 0], [4, 1], [0, 1]];
  const a = scatter(bed, { seed: "beet", perM2: 5 });
  assert.equal(a.length, 20);
  assert.ok(a.every((p) => pointInPolygon(p, bed)));
  assert.deepEqual(scatter(bed, { seed: "beet", perM2: 5 }), a);
});

test("Dach nur über dem Haus: abseits stehender Schuppen bleibt außen vor", () => {
  const floor = { rooms: [{ id: "a", ...rect(0, 0, 5, 6) }, { id: "b", ...rect(5, 0, 9, 6) }, { id: "schuppen", ...rect(20, 0, 23, 3) }] };
  assert.deepEqual(roofRooms(floor, {}).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(roofRooms(floor, { rooms: ["schuppen"] }).map((r) => r.id), ["schuppen"]);
});

test("L-Haus: Hauptdach plus Flügel bis zum First", async () => {
  const { roofParts } = await import("../../custom_components/haus3d/frontend/exterior.js");
  // Hauptteil 14 × 8 (z 5..13), Flügel 6 × 5 davor (z 0..5)
  const rooms = [
    { points: [[0, 5], [14, 5], [14, 13], [0, 13]] },
    { points: [[0, 0], [6, 0], [6, 5], [0, 5]] },
    // kleiner Schacht ohne Raum mitten im Hauptteil wird gefüllt
    { points: [[8, 5], [14, 5], [14, 8], [8, 8]] },
  ];
  const parts = roofParts([rooms[1], { points: [[0, 5], [8, 5], [8, 8], [8.4, 8], [8.4, 8.6], [8, 8.6], [8, 13], [0, 13]] }, rooms[2], { points: [[8.4, 8], [14, 8], [14, 13], [8.4, 13], [8.4, 8.6], [8.4, 8]] }], { wall: 0, overhang: 0 });
  assert.equal(parts.length, 2);
  const [main, wing] = parts;
  assert.deepEqual([main.length, main.width], [14, 8]);
  // Flügel: von z = 0 bis zum First des Hauptdachs bei z = 9
  assert.deepEqual([wing.length, wing.width], [9, 6]);
  assert.ok(Math.abs(Math.abs(wing.u[1]) - 1) < 1e-9);
  assert.equal(wing.open.filter(Boolean).length, 1);
  // Rechteck: nur ein Teil
  assert.equal(roofParts([rooms[0]]).length, 1);
});
