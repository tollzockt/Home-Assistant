// Tests der Editor-Operationen
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampOffset,
  furnitureAt,
  insertVertex,
  nearestEdge,
  newOpening,
  openingGeometry,
  rectRoom,
  removeRoom,
  removeVertex,
  snapPoint,
} from "../../custom_components/haus3d/frontend/edit-ops.js";
import { computeWalls } from "../../custom_components/haus3d/frontend/walls.js";

const floorWith = (rooms, openings = []) => ({ id: "f", rooms, openings, furniture: [], placements: [], outdoor: [], walls: [] });

test("Einrasten: Eckpunkt in der Nähe gewinnt, sonst Raster", () => {
  assert.deepEqual(snapPoint([1.02, 2.97], { grid: 0.05, vertices: [[1, 3]] }), [1, 3]);
  assert.deepEqual(snapPoint([1.27, 2.61], { grid: 0.05 }), [1.25, 2.6]);
  assert.deepEqual(snapPoint([1.27, 2.61], { grid: 0.5 }), [1.5, 2.5]);
});

test("Rechteck-Raum aus zwei beliebigen Ecken", () => {
  const r = rectRoom([4, 3], [0, 0], "r");
  assert.deepEqual(r.points, [[0, 0], [4, 0], [4, 3], [0, 3]]);
});

test("Öffnung auf nächster Kante, Offset wird begrenzt", () => {
  const f = floorWith([rectRoom([0, 0], [4, 3], "a")]);
  const hit = nearestEdge(f, [0.1, 0.05]);
  assert.equal(hit.room.id, "a");
  assert.equal(hit.edge, 0);
  const o = newOpening("door", hit, "o1");
  assert.equal(o.offset, 0.45); // halbe Breite, nicht über die Ecke
  assert.equal(clampOffset(3.9, 1.2, 4), 3.4);
  const g = openingGeometry(f, o);
  assert.deepEqual(g.p0, [0, 0]);
});

test("Punkt einfügen: Öffnungen bleiben auf derselben Wand", () => {
  const room = rectRoom([0, 0], [6, 3], "a");
  const f = floorWith([room], [
    { id: "links", room_id: "a", edge: 0, offset: 1, width: 1, type: "window", sill: 1, height: 1 },
    { id: "rechts", room_id: "a", edge: 0, offset: 5, width: 1, type: "window", sill: 1, height: 1 },
    { id: "hinten", room_id: "a", edge: 2, offset: 3, width: 1, type: "door", sill: 0, height: 2 },
  ]);
  const before = computeWalls(f).openings.map((p) => [p.opening.id, p.segment]);
  const g = insertVertex(f, "a", 0, [3, 0]);
  assert.equal(g.rooms[0].points.length, 5);
  const o = Object.fromEntries(g.openings.map((x) => [x.id, x]));
  assert.deepEqual([o.links.edge, o.links.offset], [0, 1]);
  assert.deepEqual([o.rechts.edge, o.rechts.offset], [1, 2]);
  assert.equal(o.hinten.edge, 3);
  // jede Öffnung liegt weiterhin an derselben Stelle im Plan
  for (const id of ["links", "rechts", "hinten"]) {
    const a = openingGeometry(f, f.openings.find((x) => x.id === id)).center;
    const b = openingGeometry(g, o[id]).center;
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, id);
  }
  assert.equal(computeWalls(g).openings.length, before.length);
});

test("Punkt löschen: betroffene Öffnungen weg, spätere rücken nach", () => {
  const f = floorWith([{ id: "a", points: [[0, 0], [3, 0], [6, 0], [6, 3], [0, 3]] }], [
    { id: "x", room_id: "a", edge: 1, offset: 1, width: 1, type: "window", sill: 1, height: 1 },
    { id: "y", room_id: "a", edge: 3, offset: 2, width: 1, type: "door", sill: 0, height: 2 },
  ]);
  const g = removeVertex(f, "a", 1);
  assert.equal(g.rooms[0].points.length, 4);
  assert.deepEqual(g.openings.map((o) => [o.id, o.edge]), [["y", 2]]);
  // Dreieck bleibt Dreieck
  const t = floorWith([{ id: "t", points: [[0, 0], [1, 0], [0, 1]] }]);
  assert.equal(removeVertex(t, "t", 0), t);
});

test("Raum löschen entfernt seine Öffnungen", () => {
  const f = floorWith([rectRoom([0, 0], [3, 3], "a"), rectRoom([3, 0], [6, 3], "b")], [
    { id: "o", room_id: "a", edge: 1, offset: 1, width: 1, type: "door", sill: 0, height: 2 },
  ]);
  const g = removeRoom(f, "a");
  assert.deepEqual(g.rooms.map((r) => r.id), ["b"]);
  assert.deepEqual(g.openings, []);
});

test("Möbel unter dem Mauszeiger, auch gedreht", () => {
  const f = floorWith([]);
  f.furniture = [{ id: "bett", type: "bed", x: 2, z: 2, rotation: 90, w: 2, d: 1, h: 0.5 }];
  assert.equal(furnitureAt(f, [2, 2.9])?.id, "bett"); // gedreht: lange Seite entlang z
  assert.equal(furnitureAt(f, [2.9, 2]), null);
});

test("Möbel-Drehung wie NeonPlan: bei 30° liegt die Breite entlang (cos, sin)", () => {
  const f = floorWith([]);
  f.furniture = [{ id: "s", type: "sofa", x: 0, z: 0, rotation: 30, w: 2, d: 0.2, h: 1 }];
  const a = (30 * Math.PI) / 180;
  assert.equal(furnitureAt(f, [0.9 * Math.cos(a), 0.9 * Math.sin(a)])?.id, "s");
  assert.equal(furnitureAt(f, [0.9 * Math.cos(a), -0.9 * Math.sin(a)]), null); // gespiegelt: daneben
});

test("Aufräumen: doppelte Punkte und Spitzen weg, Öffnungen bleiben an ihrer Stelle", async () => {
  const { cleanFloor, cleanPoints } = await import("../../custom_components/haus3d/frontend/edit-ops.js");
  assert.deepEqual(cleanPoints([[0, 0], [4, 0], [4, 0], [4, 3], [0, 3]]), [[0, 0], [4, 0], [4, 3], [0, 3]]);
  // Spitze: läuft von (4,3) nach (6,3) und wieder zurück
  assert.deepEqual(cleanPoints([[0, 0], [4, 0], [4, 3], [6, 3], [4, 3], [0, 3]]), [[0, 0], [4, 0], [4, 3], [0, 3]]);
  const f = floorWith([{ id: "a", points: [[0, 0], [2, 0], [2, 0], [4, 0], [4, 3], [0, 3]] }], [
    { id: "o", room_id: "a", edge: 4, offset: 1, width: 1, type: "window", sill: 1, height: 1 },
  ]);
  const before = openingGeometry(f, f.openings[0]).center;
  const { floor: g, fixed } = cleanFloor(f);
  assert.equal(fixed, 1);
  const after = openingGeometry(g, g.openings[0]).center;
  assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < 1e-9);
});

test("Möbel rastet an der Wand ein, in der Ecke auch seitlich", async () => {
  const { snapToWall, wallFaces } = await import("../../custom_components/haus3d/frontend/edit-ops.js");
  const f = floorWith([rectRoom([0, 0], [4, 3], "a")]);
  const faces = wallFaces(computeWalls(f, { wall_exterior: 0.24, wall_interior: 0.12 }).segments);
  // Schrank 0,6 tief, knapp vor der Wand bei z = 3 (Innenseite), Vorderseite soll nach -z zeigen
  const s = snapToWall({ type: "wardrobe", x: 2, z: 2.6, w: 2, d: 0.6, rotation: 0 }, faces);
  assert.deepEqual([s.x, s.z, s.rotation], [2, 2.7, 180]);
  // in der Ecke links unten: Rückseite an z = 0, linke Seite an x = 0
  const c = snapToWall({ type: "shelf", x: 0.55, z: 0.25, w: 1, d: 0.4, rotation: 0 }, faces);
  assert.deepEqual([c.x, c.z, c.rotation], [0.5, 0.2, 0]);
  // weit weg: nichts; Teppiche rasten nie ein
  assert.equal(snapToWall({ type: "wardrobe", x: 2, z: 1.5, w: 1, d: 0.6 }, faces), null);
  assert.equal(snapToWall({ type: "rug", x: 2, z: 2.75, w: 1, d: 0.5 }, faces), null);
});

test("Möbel aus der Wand rücken, Drehung bleibt", async () => {
  const { pushOutOfWalls, wallFaces } = await import("../../custom_components/haus3d/frontend/edit-ops.js");
  const f = floorWith([rectRoom([0, 0], [4, 3], "a"), rectRoom([4, 0], [8, 3], "b")]);
  const faces = wallFaces(computeWalls(f, { wall_exterior: 0.24, wall_interior: 0.12 }).segments);
  // Bett längs gedreht, ragt 10 cm in die Innenwand bei x = 4 (deren Fläche liegt bei 3,94)
  const q = pushOutOfWalls({ type: "bed", x: 3.54, z: 1.5, w: 2, d: 1, rotation: 90 }, faces);
  assert.deepEqual(q, { x: 3.44, z: 1.5 });
  assert.equal(pushOutOfWalls({ type: "bed", x: 2, z: 1.5, w: 2, d: 1, rotation: 90 }, faces), null);
});
