// Gute-Nacht-Check: Abschnitte, Vorauswahl, Sammel-Aufrufe, Ablauf-Skript
import assert from "node:assert/strict";
import { test } from "node:test";

import { allSecure, checklist, checklistCalls, routineCall } from "../../custom_components/haus3d/frontend/security.js";

const building = { floors: [{ id: "eg", name: "EG", rooms: [{ id: "wz", name: "Wohnzimmer", points: [] }, { id: "hobby", name: "Hobbyraum", points: [] }], openings: [] }] };
const st = (state, attributes = {}) => ({ state, attributes });
const hass = {
  states: {
    "light.wz": st("on", { friendly_name: "Decke" }),
    "light.hobby": st("on", { friendly_name: "Werkbank" }),
    "lock.tuer": st("unlocked"),
    "cover.garage": st("open", { device_class: "garage" }),
    "cover.wz_rollo": st("open", { device_class: "shutter" }),
    "binary_sensor.wz_fenster": st("on", { device_class: "window" }),
    "script.nacht": st("off"),
  },
  entities: {},
};
const at = (entity_id, roomId, extra = {}) => ({ entity_id, floorId: "eg", roomId, ...extra });
const status = {
  open: [at("binary_sensor.wz_fenster", "wz", { kind: "window", state: "tilted" }), at("cover.garage", null, { kind: "garage", state: "open" })],
  unlocked: [at("lock.tuer", null)],
  lights: [at("light.wz", "wz"), at("light.hobby", "hobby")],
};
const places = new Map([["cover.wz_rollo", { floorId: "eg", roomId: "wz" }], ["light.wz", { floorId: "eg", roomId: "wz" }]]);

test("Gute Nacht: Abschnitte, Bezeichnungen, anbleibende Lampe nicht vorausgewählt", () => {
  const secs = checklist(status, hass, building, places, { mode: "goodnight", keepOn: ["light.hobby"] });
  assert.deepEqual(secs.map((s) => s.key), ["open", "garage", "locks", "lights", "covers"]);
  assert.equal(secs[0].info, true);
  assert.match(secs[0].items[0].label, /^EG · Wohnzimmer · binary_sensor\.wz_fenster – Fenster gekippt$/);
  assert.equal(secs[1].confirm, true);
  const lights = secs.find((s) => s.key === "lights");
  assert.deepEqual(lights.items.map((i) => i.checked), [true, false]);
  assert.equal(lights.items[0].label, "EG · Wohnzimmer · Decke");
});

test("Haus verlassen: ohne Rollläden", () => {
  const secs = checklist(status, hass, building, places, { mode: "leave" });
  assert.ok(!secs.some((s) => s.key === "covers"));
});

test("Sammel-Aufrufe: ein Aufruf je Dienst, nur angehakte, Fenster nie", () => {
  const secs = checklist(status, hass, building, places, { mode: "goodnight", keepOn: ["light.hobby"] });
  assert.deepEqual(checklistCalls(secs, ["lights"]), [{ domain: "light", service: "turn_off", data: { entity_id: ["light.wz"] } }]);
  const all = checklistCalls(secs);
  assert.deepEqual(all.map((c) => `${c.domain}.${c.service}`), ["cover.close_cover", "lock.lock", "light.turn_off"]);
  assert.deepEqual(all[0].data.entity_id, ["cover.garage", "cover.wz_rollo"]);
  assert.equal(allSecure(secs), false);
  assert.equal(allSecure([{ items: [] }]), true);
});

test("Ablauf: Skript, Automation, Taste, fehlend, ungültig", () => {
  assert.deepEqual(routineCall({ goodnight: "script.nacht" }, "goodnight", hass), { domain: "script", service: "turn_on", data: { entity_id: "script.nacht" }, exists: true });
  assert.equal(routineCall({ leave: "automation.weg" }, "leave", hass).service, "trigger");
  assert.equal(routineCall({ leave: "input_button.weg" }, "leave", hass).service, "press");
  assert.equal(routineCall({ leave: "scene.weg" }, "leave", hass).exists, false);
  assert.equal(routineCall({ goodnight: "kaputt" }, "goodnight", hass), null);
  assert.equal(routineCall(undefined, "goodnight", hass), null);
});
