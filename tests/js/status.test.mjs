// Hausstatus: offen/gekippt, Lichter, Schlösser, je Etage; Anwesenheit
import assert from "node:assert/strict";
import { test } from "node:test";

import { agoText, persons, roomPresence } from "../../custom_components/haus3d/frontend/devices.js";
import { entityPlaces, houseStatus, openState, statusChips } from "../../custom_components/haus3d/frontend/status.js";

const s = (entity_id, state, attributes = {}, ago = 0) => [entity_id, { entity_id, state, attributes, last_changed: new Date(Date.UTC(2026, 9, 4, 12, 0) - ago * 60000).toISOString() }];
const NOW = Date.UTC(2026, 9, 4, 12, 0);

test("Fensterzustand: offen, gekippt (Großschreibung, deutsch, Kippsensor), zu, nicht erreichbar", () => {
  const c = (state, attributes = {}) => ({ entity_id: "binary_sensor.f", state, attributes });
  assert.equal(openState(c("on")), "open");
  assert.equal(openState(c("on", { window_state: "TILTED" })), "tilted");
  assert.equal(openState({ entity_id: "sensor.fenster", state: "gekippt", attributes: {} }), "tilted");
  assert.equal(openState(c("off"), { state: "on" }), "tilted");
  assert.equal(openState(c("off")), "closed");
  assert.equal(openState(c("unavailable")), null);
});

test("Hausstatus: Bereich auf zwei Etagen einmal gezählt, Links, Garage, versteckt, Lichtgruppen", () => {
  const building = {
    floors: [
      { id: "eg", rooms: [{ id: "wz", area_id: "wz", points: [] }, { id: "flur", area_id: "flur", points: [] }], openings: [{ id: "f1", room_id: "wz" }] },
      { id: "kg", rooms: [{ id: "wz2", area_id: "wz", points: [] }, { id: "garage", area_id: "garage", points: [] }], openings: [] },
    ],
  };
  const hass = {
    states: Object.fromEntries([
      s("light.wz", "on"), s("light.gruppe", "on", { entity_id: ["light.wz"] }), s("light.versteckt", "on"),
      s("binary_sensor.wz_fenster", "on", { device_class: "window" }), s("binary_sensor.kippen", "on", { device_class: "window", window_state: "tilted" }),
      s("cover.garage", "open", { device_class: "garage" }), s("lock.tuer", "unlocked"), s("alarm_control_panel.haus", "armed_away"),
    ]),
    entities: { "light.versteckt": { hidden: true } },
  };
  const byArea = new Map([["wz", ["light.wz", "light.gruppe", "light.versteckt", "binary_sensor.kippen"]], ["flur", ["lock.tuer", "alarm_control_panel.haus"]], ["garage", ["cover.garage"]]]);
  const links = new Map([["eg", new Map([["f1", { contact: "binary_sensor.wz_fenster", cover: null }]])]]);
  const places = entityPlaces(building, hass, byArea, links);
  assert.deepEqual(places.get("light.wz"), { floorId: "eg", roomId: "wz" });
  assert.deepEqual(places.get("binary_sensor.wz_fenster"), { floorId: "eg", roomId: "wz", openingId: "f1" });
  const st = houseStatus(building, hass, byArea, links, places);
  assert.deepEqual(st.lights.map((x) => x.entity_id), ["light.wz"]);
  assert.deepEqual(st.open.map((x) => [x.entity_id, x.kind, x.state]).sort(), [["binary_sensor.kippen", "window", "tilted"], ["binary_sensor.wz_fenster", "window", "open"], ["cover.garage", "garage", "open"]]);
  assert.equal(st.unlocked.length, 1);
  assert.equal(st.alarm.state, "armed_away");
  assert.deepEqual(st.perFloor.get("eg"), { lights: 1, open: 2 });
  assert.deepEqual(st.perFloor.get("kg"), { lights: 0, open: 1 });
  const chips = statusChips(st);
  assert.deepEqual(chips.map((c) => c.text), ["1 Licht an", "1 offen · 1 gekippt", "Garage offen", "1 Schloss offen", "Alarm scharf"]);
  assert.deepEqual(statusChips({ lights: [], open: [], unlocked: [], alarm: null }).map((c) => c.key), ["ok"]);
});

test("Anwesenheit: jetzt, kürzlich, vorbei; jüngster gewinnt; eigene Melder; Personen", () => {
  const hass = { states: Object.fromEntries([
    s("binary_sensor.k_bew", "off", { device_class: "motion" }, 3), s("binary_sensor.k_bew2", "off", { device_class: "occupancy" }, 1),
    s("binary_sensor.alt", "off", { device_class: "motion" }, 20), s("binary_sensor.an", "on", { device_class: "presence" }, 30),
    s("person.anna", "home", { friendly_name: "Anna Muster", entity_picture: "/api/x.jpg" }), s("person.ben", "Arbeit", { friendly_name: "Ben" }),
  ]) };
  const byArea = new Map([["k", ["binary_sensor.k_bew", "binary_sensor.k_bew2"]], ["a", ["binary_sensor.alt"]], ["b", ["binary_sensor.an"]]]);
  const k = roomPresence({ area_id: "k" }, hass, byArea, NOW);
  assert.equal(k.level, "recent");
  assert.equal(agoText(NOW - k.since), "vor 1 min");
  assert.equal(roomPresence({ area_id: "a" }, hass, byArea, NOW).level, null);
  assert.equal(roomPresence({ area_id: "b" }, hass, byArea, NOW).level, "occupied");
  assert.equal(roomPresence({ area_id: "a", presence: ["binary_sensor.an"] }, hass, byArea, NOW).level, "occupied");
  assert.equal(agoText(30000), "gerade eben");
  assert.equal(agoText(2.5 * 3600000), "vor 2 h");
  const p = persons(hass);
  assert.deepEqual(p.map((x) => [x.name, x.home, x.zone]), [["Anna", true, "zu Hause"], ["Ben", false, "Arbeit"]]);
});
