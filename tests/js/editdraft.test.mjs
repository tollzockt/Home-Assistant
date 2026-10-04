// Editor: Entwurfssicherung und Auswahl-Umriss
import assert from "node:assert/strict";
import { test } from "node:test";

import { draftState, selectionBounds } from "../../custom_components/haus3d/frontend/edit-ops.js";

const b = { version: 1, floors: [{ id: "eg", rooms: [] }], settings: {} };
const changed = { ...b, floors: [{ id: "eg", rooms: [{ id: "r", points: [[0, 0], [1, 0], [1, 1]] }] }] };

test("Entwurf: keiner, kaputt, gleich, fortsetzen, veraltet", () => {
  assert.equal(draftState(null, b, 3), "none");
  assert.equal(draftState("{kaputt", b, 3), "none");
  assert.equal(draftState({ v: 2, building: changed, base_revision: 3 }, b, 3), "none");
  assert.equal(draftState(JSON.stringify({ v: 1, building: b, base_revision: 3 }), b, 3), "none");
  assert.equal(draftState(JSON.stringify({ v: 1, building: changed, base_revision: 3 }), b, 3), "resume");
  assert.equal(draftState({ v: 1, building: changed, base_revision: 2 }, b, 3), "stale");
});

test("Auswahl-Umriss: Raum, Wand, Möbel, Öffnung, nichts", () => {
  const f = {
    rooms: [{ id: "r", points: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
    walls: [{ id: "w", a: [5, 0], b: [5, 2] }],
    furniture: [{ id: "m", x: 2, z: 1, w: 2, d: 0 }],
    openings: [{ id: "o", room_id: "r", edge: 0, offset: 2, width: 1 }],
  };
  assert.deepEqual(selectionBounds(f, { kind: "room", id: "r" }), [[0, 0], [4, 3]]);
  assert.deepEqual(selectionBounds(f, { kind: "wall", id: "w" }), [[5, 0], [5, 2]]);
  assert.deepEqual(selectionBounds(f, { kind: "opening", id: "o" }), [[1.5, 0], [2.5, 0]]);
  const m = selectionBounds(f, { kind: "furniture", id: "m" });
  assert.ok(Math.abs(m[0][0] + m[1][0] - 4) < 1e-9 && m[1][0] - m[0][0] >= 2);
  assert.equal(selectionBounds(f, { kind: "room", id: "x" }), null);
  assert.equal(selectionBounds(f, null), null);
});
