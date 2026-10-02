// Tests der Gerätezuordnung und des Imports: node --test tests/js/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coverClosedFraction,
  energyValues,
  entitiesByArea,
  floorIcons,
  openingLinks,
  powerW,
  roomClimate,
  roomLit,
  temperatureColor,
} from "../../custom_components/haus3d/frontend/devices.js";
import { exportFile, parseImport } from "../../custom_components/haus3d/frontend/model.js";

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

function makeHass(list) {
  const hass = { states: {}, entities: {}, devices: { dev1: { area_id: "wohnzimmer" } } };
  for (const [s, entry] of list) {
    hass.states[s.entity_id] = s;
    hass.entities[s.entity_id] = { entity_id: s.entity_id, ...entry };
  }
  return hass;
}

const hass = makeHass([
  [st("light.decke", "on"), { area_id: "wohnzimmer" }],
  [st("light.ueber_geraet", "off"), { device_id: "dev1" }],
  [st("light.versteckt", "on"), { area_id: "wohnzimmer", hidden: true }],
  [st("switch.diagnose", "on"), { area_id: "wohnzimmer", entity_category: "diagnostic" }],
  [st("binary_sensor.fenster", "on", { device_class: "window" }), { area_id: "wohnzimmer" }],
  [st("binary_sensor.bewegung", "on", { device_class: "motion" }), { area_id: "wohnzimmer" }],
  [st("cover.rollo", "open", { current_position: 30 }), { area_id: "wohnzimmer" }],
  [st("sensor.t1", "21", { device_class: "temperature" }), { area_id: "wohnzimmer" }],
  [st("sensor.t2", "23", { device_class: "temperature" }), { area_id: "wohnzimmer" }],
  [st("sensor.t3", "unavailable", { device_class: "temperature" }), { area_id: "wohnzimmer" }],
  [st("sensor.h1", "50", { device_class: "humidity" }), { area_id: "wohnzimmer" }],
  [st("fan.platziert", "off"), { area_id: "wohnzimmer" }],
]);
const room = { id: "wz", name: "Wohnzimmer", area_id: "wohnzimmer", points: [[0, 0], [6, 0], [6, 4], [0, 4]] };
const floor = {
  id: "eg",
  rooms: [room],
  openings: [
    { id: "a_fenster", room_id: "wz", edge: 0, type: "window", contact: null, cover: null },
    { id: "b_fenster", room_id: "wz", edge: 1, type: "window", contact: "none", cover: null },
    { id: "c_tuer", room_id: "wz", edge: 2, type: "door", contact: null, cover: null },
  ],
  placements: [{ entity_id: "fan.platziert", x: 1, z: 1, y: 2 }],
};

test("Bereich über Gerät, versteckte und Diagnose-Entitäten fehlen", () => {
  const ids = entitiesByArea(hass).get("wohnzimmer");
  assert.ok(ids.includes("light.ueber_geraet"));
  assert.ok(!ids.includes("light.versteckt"));
  assert.ok(!ids.includes("switch.diagnose"));
});

test("Symbole: passende Domains, Kontakte nur mit Fenster/Tür-Klasse, Platzierung hat Vorrang", () => {
  const icons = floorIcons(floor, hass);
  const ids = icons.map((i) => i.entity_id).sort();
  assert.deepEqual(ids, ["binary_sensor.fenster", "cover.rollo", "fan.platziert", "light.decke", "light.ueber_geraet"]);
  const fan = icons.find((i) => i.entity_id === "fan.platziert");
  assert.deepEqual([fan.x, fan.z, fan.y, fan.manual], [1, 1, 2, true]);
  for (const i of icons.filter((x) => !x.manual)) assert.ok(i.x > 0 && i.x < 6 && i.z > 0 && i.z < 4, `${i.entity_id} im Raum`);
});

test("Klima: Mittelwert, ungültige Werte ignoriert; feste Sensoren und 'none'", () => {
  const byArea = entitiesByArea(hass);
  assert.deepEqual(roomClimate(room, hass, byArea), { temperature: 22, humidity: 50 });
  assert.equal(roomClimate({ ...room, climate: { temperature: "sensor.t1" } }, hass, byArea).temperature, 21);
  assert.equal(roomClimate({ ...room, climate: { humidity: "none" } }, hass, byArea).humidity, null);
  assert.equal(roomLit(room, hass, byArea), true);
});

test("Öffnungen: Kontakte und Rollläden automatisch nach Typ, 'none' bleibt leer", () => {
  const links = openingLinks(floor, hass, entitiesByArea(hass));
  assert.equal(links.get("a_fenster").contact, "binary_sensor.fenster");
  assert.equal(links.get("a_fenster").cover, "cover.rollo");
  assert.equal(links.get("b_fenster").contact, null);
  assert.equal(links.get("c_tuer").contact, null); // Fenstersensor passt nicht zur Tür
  const explicit = { ...floor, openings: [{ ...floor.openings[2], contact: "binary_sensor.fenster" }] };
  assert.equal(openingLinks(explicit, hass, entitiesByArea(hass)).get("c_tuer").contact, "binary_sensor.fenster");
});

test("Rollladen-Behang und Einheiten", () => {
  assert.equal(coverClosedFraction(st("cover.x", "open", { current_position: 30 })), 0.7);
  assert.equal(coverClosedFraction(st("cover.x", "closed")), 1);
  assert.equal(coverClosedFraction(st("cover.x", "unavailable")), null);
  assert.equal(powerW(st("sensor.p", "0.45", { unit_of_measurement: "kW" })), 450);
  assert.equal(powerW(st("sensor.p", "unknown")), null);
  const e = energyValues({ energy: { einspeisung: "sensor.e", ertrag_heute: "sensor.y" } }, { states: { "sensor.e": st("sensor.e", "380", { unit_of_measurement: "W" }), "sensor.y": st("sensor.y", "1500", { unit_of_measurement: "Wh" }) } });
  assert.equal(e.einspeisung, 380);
  assert.equal(e.ertrag_heute, 1.5);
  assert.equal(e.solar, null);
});

test("Temperaturfarben: 18 °C blau, 26 °C rot, außerhalb begrenzt", () => {
  const [r1, , b1] = temperatureColor(18);
  const [r2, , b2] = temperatureColor(26);
  assert.ok(b1 > r1 && r2 > b2);
  assert.deepEqual(temperatureColor(10), temperatureColor(18));
  assert.deepEqual(temperatureColor(30), temperatureColor(26));
});

test("Import: rohes Gebäude, NeonPlan-Export und -Backup; Export im NeonPlan-Format", () => {
  const b = { version: 1, floors: [{ id: "eg", name: "EG", elevation: 0, height: 2.5, rooms: [] }], settings: {} };
  for (const text of [b, { format: "neonplan3d", version: 1, building: b }, { format: "neonplan3d-backup", version: 1, building: b, packs: [] }].map((x) => JSON.stringify(x))) {
    const parsed = parseImport(text);
    assert.equal(parsed.floors[0].id, "eg");
    assert.deepEqual(parsed.floors[0].openings, []);
    assert.equal(parsed.settings.energy.einspeisung, "sensor.aktuell_pv_einspeisung");
  }
  assert.throws(() => parseImport("{kein json"), /JSON/);
  assert.throws(() => parseImport(JSON.stringify({ version: 2, floors: [] })), /NeonPlan/);
  const out = exportFile(b);
  assert.equal(out.format, "neonplan3d");
  assert.equal(out.building, b);
});
