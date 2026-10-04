// Hinweise: jede Regel an ihrer Grenze, aus, Innentür nie bei Regen, Schlüssel, Ausblenden, pending
import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateAlerts, normalizeAlerts, visibleAlerts } from "../../custom_components/haus3d/frontend/alerts.js";
import { entityPlaces } from "../../custom_components/haus3d/frontend/status.js";

const NOW = Date.UTC(2026, 9, 4, 18, 0);
const st = (entity_id, state, attributes = {}, ago = 60) => [entity_id, { entity_id, state, attributes, last_changed: new Date(NOW - ago * 60000).toISOString() }];
const sq = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

function setup(states, extra = {}) {
  const building = {
    settings: { wall_exterior: 0.24, wall_interior: 0.12 },
    floors: [{
      id: "eg", name: "EG",
      rooms: [{ id: "wz", name: "Wohnzimmer", area_id: "wz", points: sq(0, 0, 5, 4) }, { id: "flur", name: "Flur", area_id: "flur", points: sq(5, 0, 8, 4) }, { id: "garage", name: "Garage", area_id: "garage", points: sq(8, 0, 12, 4) }],
      openings: [
        { id: "fenster", type: "window", room_id: "wz", edge: 0, offset: 2.5, width: 1.2 },
        { id: "innentuer", type: "door", room_id: "wz", edge: 1, offset: 2, width: 0.9 },
        { id: "haustuer", type: "door", room_id: "flur", edge: 0, offset: 1.5, width: 1 },
      ],
    }],
  };
  const hass = { states: Object.fromEntries(states), entities: {} };
  const byArea = new Map([["wz", ["climate.wz", "sensor.wz_feuchte"]], ["flur", ["binary_sensor.wasser"]], ["garage", ["cover.garage"]]]);
  const links = new Map([["eg", new Map([["fenster", { contact: "binary_sensor.fenster" }], ["innentuer", { contact: "binary_sensor.innentuer" }], ["haustuer", { contact: "binary_sensor.haustuer" }]])]]);
  const places = entityPlaces(building, hass, byArea, links);
  const exterior = new Set(["eg:fenster", "eg:haustuer"]);
  return { building, hass, byArea, links, places, exterior, now: NOW, ...extra };
}

test("Regen: nur Außenfenster, gekippt nach Einstellung", () => {
  const states = [st("binary_sensor.fenster", "on", { device_class: "window" }), st("binary_sensor.innentuer", "on", { device_class: "door" })];
  const r = evaluateAlerts({ ...setup(states), weather: "rain" });
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].text, "Regen – Fenster offen: Wohnzimmer");
  assert.equal(r.alerts[0].roomId, "wz");
  assert.ok(!r.alerts[0].entities.includes("binary_sensor.innentuer"));
  assert.equal(evaluateAlerts({ ...setup(states), weather: null }).alerts.length, 0);
  const tilted = [st("binary_sensor.fenster", "off", { device_class: "window", window_state: "tilted" })];
  assert.equal(evaluateAlerts({ ...setup(tilted), weather: "rain" }).alerts.length, 1);
  assert.equal(evaluateAlerts({ ...setup(tilted), weather: "rain", cfg: { rain_tilted: false } }).alerts.length, 0);
  assert.equal(evaluateAlerts({ ...setup(states), weather: "rain", cfg: { rain_open: false } }).alerts.length, 0);
});

test("Haustür und Garage: erst nach der Wartezeit, vorher pending", () => {
  const early = evaluateAlerts(setup([st("binary_sensor.haustuer", "on", { device_class: "door", friendly_name: "Haustür" }, 9), st("cover.garage", "open", { device_class: "garage", friendly_name: "Garage" }, 14)]));
  assert.equal(early.alerts.length, 0);
  assert.equal(early.pending, true);
  const late = evaluateAlerts(setup([st("binary_sensor.haustuer", "on", { device_class: "door", friendly_name: "Haustür" }, 10), st("cover.garage", "open", { device_class: "garage", friendly_name: "Garage" }, 16)]));
  assert.deepEqual(late.alerts.map((a) => a.text).sort(), ["Garage seit 16 min offen", "Haustür seit 10 min offen"]);
  assert.equal(evaluateAlerts({ ...setup([st("cover.garage", "open", { device_class: "garage" }, 60)]), cfg: { garage_open_min: 0 } }).alerts.length, 0);
});

test("Wassermelder kritisch zuerst, Heizung bei offenem Fenster, Feuchte, Akku", () => {
  const r = evaluateAlerts({
    ...setup([
      st("binary_sensor.wasser", "on", { device_class: "moisture" }), st("climate.wz", "heat", { hvac_action: "heating" }),
      st("binary_sensor.fenster", "on", { device_class: "window" }, 11), st("sensor.wz_feuchte", "71", { device_class: "humidity" }),
    ]),
    energy: { akku_ladestand: 8 },
  });
  assert.equal(r.alerts[0].level, "critical");
  assert.equal(r.alerts[0].text, "Wassermelder Flur!");
  const texts = r.alerts.map((a) => a.text);
  assert.ok(texts.includes("Fenster offen, Heizung läuft: Wohnzimmer"));
  assert.ok(texts.includes("Luftfeuchte 71 % – Wohnzimmer lüften"));
  assert.ok(texts.includes("Akku 8 %"));
});

test("Schlüssel ändert sich mit neuem Ereignis; Ausblenden; Einstellungen bereinigt", () => {
  const a = evaluateAlerts({ ...setup([st("binary_sensor.fenster", "on", { device_class: "window" }, 5)]), weather: "rain" }).alerts[0];
  const b = evaluateAlerts({ ...setup([st("binary_sensor.fenster", "on", { device_class: "window" }, 5)]), weather: "rain" }).alerts[0];
  const c = evaluateAlerts({ ...setup([st("binary_sensor.fenster", "on", { device_class: "window" }, 1)]), weather: "rain" }).alerts[0];
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.deepEqual(visibleAlerts([a, c], { [a.key]: 1 }), [c]);
  assert.deepEqual(normalizeAlerts({ door_open_min: "x", akku_min: -5, safety: "ja" }), { ...normalizeAlerts({}), akku_min: 0 });
});
