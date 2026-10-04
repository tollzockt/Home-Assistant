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

test("Hang automatisch: Ecken an der oberen Gartenebene bekommen deren Höhe", async () => {
  const { autoHeights, roomRoofGroups } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const b = {
    floors: [
      { id: "kg", elevation: -2.6, rooms: [], outdoor: [
        { id: "unten", type: "lawn", points: [[0, 0], [10, 0], [10, 5], [0, 5]] },
        { id: "hang", type: "lawn", points: [[0, 5], [10, 5], [10, 9], [5, 9.5], [0, 9]] },
      ] },
      { id: "eg", elevation: 0, rooms: [], outdoor: [{ id: "oben", type: "lawn", points: [[0, 9], [10, 9], [10, 15], [0, 15]] }] },
    ],
  };
  // (5, 9.5) liegt in der oberen Fläche; (0,5)/(10,5) an der unteren
  assert.deepEqual(autoHeights(b, "kg", "hang"), [0, 0, 2.6, 2.6, 2.6]);
  assert.equal(autoHeights(b, "kg", "unten"), null);
  const floor = { rooms: [{ id: "s", points: rect(0, 0, 3, 2).points, roof: { type: "gable", pitch: 20 } }, { id: "u", points: rect(3, 0, 5, 2).points, roof: { type: "gable" } }, { id: "x", points: rect(9, 9, 10, 10).points }] };
  const groups = roomRoofGroups(floor);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rooms.map((r) => r.id), ["s", "u"]);
  assert.equal(groups[0].roof.pitch, 20);
});

test("PV: Himmelsrichtung der Dachfläche und Modulplätze", async () => {
  const { compassOf, panelSlots } = await import("../../custom_components/haus3d/frontend/exterior.js");
  // Norden oben im Plan (-z)
  assert.equal(compassOf([0, -1]), "N");
  assert.equal(compassOf([0, 1]), "S");
  assert.equal(compassOf([1, 0]), "E");
  assert.equal(compassOf([-1, 0]), "W");
  // Norden 90° gedreht (rechts im Plan): +x ist Norden, +z Osten
  assert.equal(compassOf([1, 0], 90), "N");
  assert.equal(compassOf([0, 1], 90), "E");
  // Dachfläche 10 m lang, 4,5 m bis zum First, 35°: zwei Reihen, mittig
  const slots = panelSlots({ length: 10, width: 9 }, { tan: Math.tan((35 * Math.PI) / 180), count: 10 });
  assert.equal(slots.length, 10);
  const rows = [...new Set(slots.map((p) => p.x))];
  assert.equal(rows.length, 2);
  // 9 passen in eine Reihe (9,4 m nutzbar), Rest in Reihe 2
  assert.equal(slots.filter((p) => p.x === rows[0]).length, 9);
  assert.ok(Math.abs(slots.filter((p) => p.x === rows[0]).reduce((a, p) => a + p.s, 0)) < 1e-6);
  // Walm: obere Reihe schmaler
  const hip = panelSlots({ length: 10, width: 9 }, { tan: 0.7, count: 30, type: "hip", hipEnds: [true, true] });
  const r = [...new Set(hip.map((p) => p.x))];
  assert.ok(hip.filter((p) => p.x === r[1]).length < hip.filter((p) => p.x === r[0]).length);
});

test("PV: belegte Bereiche (Flügel) werden ausgespart", async () => {
  const { panelSlots } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const slots = panelSlots({ length: 10, width: 9 }, { tan: 0.7, count: 50, blocked: [[-5, 0]] });
  assert.ok(slots.length > 0 && slots.every((p) => p.s - 0.5 >= 0 - 1e-9));
});

test("PV-Felder: Spalten × Reihen, quer, von links, Kehle", async () => {
  const { panelArraySlots, blockedAt } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const part = { length: 15, width: 9 };
  const tan = Math.tan((35 * Math.PI) / 180);
  // 3 × 4 quer, ganz links: 12 Module, linke Kante bei s = -7.5 + 0.3 (Rand) ... hier left = 0.3
  const a = panelArraySlots(part, { tan, cols: 3, rows: 4, orient: "landscape", left: 0.3 });
  assert.equal(a.length, 12);
  assert.ok(Math.abs(Math.min(...a.map((p) => p.s - p.w / 2)) - -7.2) < 1e-6);
  // gespiegelt (flip -1): gleiches Feld am anderen Ende
  const b = panelArraySlots(part, { tan, cols: 3, rows: 4, orient: "landscape", left: 0.3, flip: -1 });
  assert.ok(Math.abs(Math.max(...b.map((p) => p.s + p.w / 2)) - 7.2) < 1e-6);
  // Kehle: unten breit gesperrt, weiter oben frei
  assert.deepEqual(blockedAt([{ c: 0, hw: 3 }], 1), [[-2, 2]]);
  assert.deepEqual(blockedAt([{ c: 0, hw: 3 }], 3.5), []);
  const v = panelArraySlots(part, { tan, cols: 1, rows: 4, orient: "landscape", left: 8.5, blocked: [{ c: 0, hw: 3.75 }] });
  assert.ok(v.length > 0 && v.length < 4); // unten gesperrt, oben frei
});

test("Dach-Ebene: Höhe und Richtung der Dachfläche an einem Punkt", async () => {
  const { roofModel, roofSurfaceAt } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const b = { settings: { wall_exterior: 0, roof: { type: "gable", pitch: 45, overhang: 0 } }, floors: [{ id: "eg", elevation: 0, height: 2.5, rooms: [rect(0, 0, 10, 6)] }] };
  const m = roofModel(b);
  assert.equal(m.parts.length, 1);
  // First entlang x bei z = 3; an der Traufe Höhe 2,5, am First 2,5 + 3
  const eave = roofSurfaceAt(m, [5, 0]);
  assert.ok(Math.abs(eave.y - 2.5) < 1e-9);
  assert.deepEqual(eave.out.map((v) => Math.round(v) + 0), [0, -1]);
  const ridge = roofSurfaceAt(m, [5, 3]);
  assert.ok(Math.abs(ridge.y - 5.5) < 1e-9);
  assert.deepEqual(roofSurfaceAt(m, [5, 5]).out.map((v) => Math.round(v) + 0), [0, 1]);
  assert.equal(roofSurfaceAt(m, [20, 3]), null);
  // Walm: an der Stirnseite zeigt die Fläche nach außen
  const hip = roofModel({ ...b, settings: { ...b.settings, roof: { type: "hip", pitch: 45, overhang: 0 } } });
  assert.deepEqual(roofSurfaceAt(hip, [0.5, 3]).out.map((v) => Math.round(v) + 0), [-1, 0]);
  assert.equal(roofModel({ settings: {}, floors: [] }), null);
});

test("Dach-Ebene: PV-Feld richtet sich nach der Fläche, Reihe 1 an der Traufe", async () => {
  const { roofModel, pvLayout, legacyPvItems } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const b = { settings: { wall_exterior: 0, roof: { type: "gable", pitch: 30, overhang: 0 } }, floors: [{ id: "eg", elevation: 0, height: 2.5, rooms: [rect(0, 0, 10, 6)] }] };
  const m = roofModel(b);
  // Südseite (z > 3): Reihen laufen in z, Spalten in x
  const lay = pvLayout(m, { x: 5, z: 4.5, cols: 3, rows: 2, orient: "portrait" });
  assert.equal(lay.panels.length, 6);
  const xs = [...new Set(lay.panels.map((p) => p[0].toFixed(3)))];
  const zs = [...new Set(lay.panels.map((p) => p[1].toFixed(3)))];
  assert.equal(xs.length, 3);
  assert.equal(zs.length, 2);
  // erste Reihe (Index 0) liegt weiter unten (größeres z = näher an der Südtraufe)
  assert.ok(lay.panels[0][1] > lay.panels[3][1]);
  // Abstand der Reihen im Grundriss: (1,7 + Fuge) · cos 30°
  assert.ok(Math.abs(lay.panels[0][1] - lay.panels[3][1] - 1.73 * Math.cos(Math.PI / 6)) < 1e-6);
  assert.equal(lay.count, 6);
  // Feld über dem First: obere Reihe liegt auf der Nordseite und fällt weg
  const over = pvLayout(m, { x: 5, z: 3.9, cols: 2, rows: 2 });
  assert.equal(over.count, 2);
  assert.deepEqual(over.fits, [true, true, false, false]);
  // bisherige Angabe „8 nach Süden“ wird zu verschiebbaren Feldern
  b.settings.roof.solar = { S: 8 };
  const items = legacyPvItems(roofModel(b), 0);
  assert.ok(items.length >= 1);
  assert.equal(items.reduce((a, it) => a + it.cols * it.rows, 0), 8);
  assert.ok(items.every((it) => it.z > 3));
});

test("Texturen: Standard je Fläche, eigene Wahl, glatt", async () => {
  const { textureFor, textureOptions } = await import("../../custom_components/haus3d/frontend/model.js");
  assert.equal(textureFor("wall"), "plaster");
  assert.equal(textureFor("wall", "brick"), "brick");
  assert.equal(textureFor("wall", "none"), null);
  assert.equal(textureFor("wall", "quatsch"), "plaster");
  assert.equal(textureFor("floor", "", "tiles_dark"), "tiles");
  assert.equal(textureFor("roof", null, "flat"), "gravel");
  assert.equal(textureFor("ground", undefined, "lawn"), "grass");
  assert.ok(textureOptions("r").some(([k]) => k === "roof_tiles"));
  assert.ok(!textureOptions("r").some(([k]) => k === "parquet"));
});

test("Dachteile von Hand anpassen: verlängern, verbreitern, verschieben", async () => {
  const { adjustRoofParts, roofModel } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const fr = { center: [5, 3], u: [1, 0], v: [0, 1], length: 10, width: 6 };
  const [a] = adjustRoofParts([fr], [{ hi: 1, b: 0.5 }]);
  assert.equal(a.length, 11);
  assert.equal(a.width, 6.5);
  assert.deepEqual(a.center, [5.5, 3.25]);
  // verschieben: lo −1, hi +1 → gleiche Länge, Mitte +1 entlang u
  const [m] = adjustRoofParts([fr], [{ lo: -1, hi: 1 }]);
  assert.deepEqual([m.length, m.center[0]], [10, 6]);
  assert.equal(adjustRoofParts([fr], [null])[0], fr);
  const b = { settings: { wall_exterior: 0, roof: { type: "gable", pitch: 30, overhang: 0, adjust: [{ a: 1 }] } }, floors: [{ id: "eg", elevation: 0, height: 2.5, rooms: [rect(0, 0, 10, 6)] }] };
  assert.equal(roofModel(b).parts[0].width, 7);
});

test("Pultdach andersherum: hohe Seite getauscht", async () => {
  const { adjustRoofParts, roofModel, roofSurfaceAt } = await import("../../custom_components/haus3d/frontend/exterior.js");
  const fr = { center: [0, 0], u: [1, 0], v: [0, 1], length: 4, width: 2 };
  assert.deepEqual(adjustRoofParts([fr], null, true)[0].v.map((x) => x + 0), [0, -1]);
  const b = (flip) => ({ settings: { wall_exterior: 0, roof: { type: "shed", pitch: 20, overhang: 0, flip } }, floors: [{ id: "eg", elevation: 0, height: 2.5, rooms: [rect(0, 0, 4, 2)] }] });
  const hi = (m) => (roofSurfaceAt(m, [2, 0.1]).y > roofSurfaceAt(m, [2, 1.9]).y ? "oben" : "unten");
  assert.notEqual(hi(roofModel(b(false))), hi(roofModel(b(true))));
});

test("Balkonkraftwerk-Raum: energy_role vor alter Erkennung", async () => {
  const { isPvShed, findPvShed } = await import("../../custom_components/haus3d/frontend/exterior.js");
  assert.ok(isPvShed({ energy_role: "balkonkraftwerk", name: "Hütte" }));
  assert.ok(isPvShed({ area_id: "balkonkraftwerk", name: "X" }));
  assert.ok(isPvShed({ name: "Schuppen" }));
  assert.ok(!isPvShed({ name: "Schuppen", energy_role: "none" }));
  const b = { floors: [{ id: "eg", rooms: [{ id: "s", name: "Schuppen" }, { id: "g", name: "Gartenhaus 2", energy_role: "balkonkraftwerk" }] }] };
  assert.equal(findPvShed(b).room.id, "g");
});
