import { test } from "node:test";
import assert from "node:assert/strict";
import { alignGuides, clipSummary, copyRefs, defaultBackground, fitSize, moveRefs, pasteClip, pointAt, refsInRect, removeRefs, scaleBackground, segmentInfo, toggleRef } from "../../custom_components/haus3d/frontend/plan-tools.js";

const floor = () => ({
  id: "eg",
  rooms: [
    { id: "kueche", name: "Küche", area_id: "kueche", points: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { id: "flur", name: "Flur", points: [[4, 0], [6, 0], [6, 3], [4, 3]] },
  ],
  openings: [
    { id: "f1", type: "window", room_id: "kueche", edge: 0, offset: 2, width: 1.2, entity: "binary_sensor.kueche_fenster" },
    { id: "t1", type: "door", room_id: "flur", edge: 1, offset: 1, width: 0.9 },
    { id: "w1", type: "window", room_id: "mauer_1", wall: "mauer_1", edge: 0, offset: 1, width: 1 },
  ],
  furniture: [{ id: "tisch", type: "table", x: 2, z: 1.5, entity: "light.tisch" }],
  outdoor: [],
  walls: [{ id: "mauer_1", a: [0, 5], b: [4, 5] }],
});

test("Fluchtlinien übernehmen x/z naher Punkte", () => {
  const r = alignGuides([3.97, 7.04], [[4, 0], [0, 7]], 0.1);
  assert.deepEqual(r.point, [4, 7]);
  assert.deepEqual(r.guides.map((g) => g.axis).sort(), ["x", "z"]);
  assert.deepEqual(alignGuides([2, 2], [[4, 0]], 0.1), { point: [2, 2], guides: [] });
});

test("Länge und Winkel", () => {
  assert.deepEqual(pointAt([1, 1], 2, 0), [3, 1]);
  assert.deepEqual(pointAt([1, 1], 2, 90), [1, -1]);
  assert.deepEqual(segmentInfo([0, 0], [0, -3]), { len: 3, deg: 90 });
  assert.deepEqual(segmentInfo([0, 0], [-2, 0]), { len: 2, deg: 180 });
});

test("Rahmen wählt ganz enthaltene Teile, Umschalten", () => {
  const refs = refsInRect(floor(), [-1, -1], [4.5, 3.5]);
  assert.deepEqual(refs, [{ kind: "room", id: "kueche" }, { kind: "furniture", id: "tisch" }]);
  assert.equal(toggleRef(refs, { kind: "room", id: "kueche" }).length, 1);
  assert.equal(toggleRef(refs, { kind: "wall", id: "mauer_1" }).length, 3);
});

test("Verschieben und Löschen mehrerer Teile", () => {
  const refs = [{ kind: "room", id: "kueche" }, { kind: "furniture", id: "tisch" }, { kind: "wall", id: "mauer_1" }];
  const m = moveRefs(floor(), refs, 1, -0.5);
  assert.deepEqual(m.rooms[0].points[0], [1, -0.5]);
  assert.deepEqual(m.rooms[1].points[0], [4, 0]);
  assert.deepEqual([m.furniture[0].x, m.furniture[0].z], [3, 1]);
  assert.deepEqual(m.walls[0].a, [1, 4.5]);
  const d = removeRefs(floor(), refs);
  assert.deepEqual(d.rooms.map((r) => r.id), ["flur"]);
  assert.deepEqual(d.openings.map((o) => o.id), ["t1"]);
  assert.equal(d.furniture.length, 0);
});

test("Kopieren und Einfügen mit neuen IDs und Bezügen", () => {
  const f = floor();
  const clip = copyRefs(f, [{ kind: "room", id: "kueche" }, { kind: "furniture", id: "tisch" }, { kind: "wall", id: "mauer_1" }]);
  assert.deepEqual(clip.size, [4, 5]);
  assert.deepEqual(clip.rooms[0].points[0], [-2, -2.5]);
  assert.equal(clip.openings.length, 2);
  assert.equal(clipSummary(clip), "1 Raum, 1 Möbel, 1 Wand, 2 Fenster/Türen");
  const { floor: out, added } = pasteClip(f, clip, [10, 10], new Set(["kueche", "flur", "tisch", "mauer_1", "f1", "t1", "w1"]));
  assert.equal(added.length, 3);
  const room = out.rooms.find((r) => r.id === added[0].id);
  assert.deepEqual(room.points[0], [8, 7.5]);
  assert.equal(room.area_id, null);
  const win = out.openings.filter((o) => o.room_id === room.id);
  assert.equal(win.length, 1);
  assert.equal(win[0].entity, undefined);
  const wall = out.walls.at(-1);
  const wwin = out.openings.find((o) => o.wall === wall.id);
  assert.equal(wwin.room_id, wall.id);
  assert.equal(out.furniture.at(-1).entity, null);
  assert.equal(new Set([...out.rooms, ...out.openings, ...out.furniture, ...out.walls].map((x) => x.id)).size, out.rooms.length + out.openings.length + out.furniture.length + out.walls.length);
  // Original unverändert
  assert.equal(f.rooms.length, 2);
  assert.equal(f.openings[0].entity, "binary_sensor.kueche_fenster");
});

test("Bauplan-Foto: Lage, Maßstab aus zwei Punkten, Verkleinern", () => {
  const bg = defaultBackground({ x0: 0, x1: 10, z0: 0, z1: 8 }, 0.5);
  assert.deepEqual([bg.x, bg.width, bg.opacity, bg.visible], [-1, 12, 0.5, true]);
  const s = scaleBackground({ x: 0, z: 0, width: 10 }, [2, 2], [4, 2], 5);
  assert.deepEqual(s, { x: -3, z: -3, width: 25 });
  assert.deepEqual(fitSize(4000, 3000), [1600, 1200]);
  assert.deepEqual(fitSize(800, 600), [800, 600]);
});
