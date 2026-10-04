// Tests der Gerätezuordnung und des Imports: node --test tests/js/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildingIcons,
  buildingLinks,
  coverClosedFraction,
  energyKWh,
  isOpen,
  layout,
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
    assert.equal(parsed.settings.energy.einspeisung, null); // keine Standard-IDs (Datenschutz)
  }
  assert.throws(() => parseImport("{kein json"), /JSON/);
  assert.throws(() => parseImport(JSON.stringify({ version: 2, floors: [] })), /NeonPlan/);
  const out = exportFile(b);
  assert.equal(out.format, "neonplan3d");
  assert.equal(out.building, b);
});

// Regressionstests aus der Prüfung vor 0.1.0
test("Garagentor-Cover (garage/gate) gehört zur Garage, nicht als Rollladen vor ein Fenster", () => {
  const h = makeHass([
    [st("cover.tor", "closed", { device_class: "gate" }), { area_id: "garage" }],
    [st("cover.rollo", "closed", { device_class: "shutter" }), { area_id: "garage" }],
  ]);
  const f = {
    id: "kg",
    rooms: [{ id: "g", area_id: "garage", points: [[0, 0], [6, 0], [6, 5], [0, 5]] }],
    openings: [
      { id: "a_fenster", room_id: "g", edge: 1, type: "window", contact: null, cover: null },
      { id: "b_tor", room_id: "g", edge: 0, type: "garage", contact: null, cover: null },
    ],
  };
  const links = buildingLinks({ floors: [f] }, h, entitiesByArea(h)).get("kg");
  assert.equal(links.get("b_tor").cover, "cover.tor");
  assert.equal(links.get("a_fenster").cover, "cover.rollo");
});

test("ein Bereich auf zwei Etagen: Kontakt und Symbole nur einmal; Platzierung auf anderer Etage gewinnt", () => {
  const h = makeHass([
    [st("binary_sensor.th_fenster", "on", { device_class: "window" }), { area_id: "treppe" }],
    [st("light.th", "on"), { area_id: "treppe" }],
  ]);
  const r = (id) => ({ id, area_id: "treppe", points: [[0, 0], [3, 0], [3, 3], [0, 3]] });
  const op = { id: "f", room_id: "th", edge: 0, type: "window", contact: null, cover: null };
  const b = { floors: [{ id: "eg", rooms: [r("th")], openings: [op], placements: [] }, { id: "og", rooms: [r("th")], openings: [op], placements: [{ entity_id: "light.th", x: 1, z: 1, y: null }] }] };
  const links = buildingLinks(b, h, entitiesByArea(h));
  const contacts = [links.get("eg").get("f").contact, links.get("og").get("f").contact].filter(Boolean);
  assert.deepEqual(contacts, ["binary_sensor.th_fenster"]);
  const icons = buildingIcons(b, h);
  const all = [...icons.values()].flat().map((i) => `${i.entity_id}${i.manual ? "(m)" : ""}`).sort();
  assert.deepEqual(all, ["binary_sensor.th_fenster", "light.th(m)"]);
  assert.ok(icons.get("og").some((i) => i.entity_id === "light.th" && i.manual));
});

test("Lampen aus furniture[] (NeonPlan) werden als feste Position übernommen", () => {
  const h = makeHass([[st("light.stehlampe", "on"), { area_id: "wohnzimmer" }]]);
  const f = { id: "eg", rooms: [room], openings: [], placements: [], furniture: [{ id: "m1", type: "lamp_floor", x: 5, z: 3, mount_y: null, entity: "light.stehlampe" }] };
  const icons = buildingIcons({ floors: [f] }, h).get("eg");
  assert.deepEqual(icons.map((i) => [i.entity_id, i.x, i.z, i.manual]), [["light.stehlampe", 5, 3, true]]);
});

test("Einheiten: mW ist nicht MW, kJ wird umgerechnet", () => {
  assert.equal(powerW(st("sensor.p", "500", { unit_of_measurement: "mW" })), 0.5);
  assert.equal(powerW(st("sensor.p", "2", { unit_of_measurement: "MW" })), 2e6);
  assert.equal(energyKWh(st("sensor.e", "3600", { unit_of_measurement: "kJ" })), 1);
  assert.equal(energyKWh(st("sensor.e", "1000", { unit_of_measurement: "mWh" })), 0.001);
});

test("Fenstergriffe: offen/gekippt zählen als offen", () => {
  assert.ok(isOpen(st("sensor.griff", "tilted")));
  assert.ok(isOpen(st("sensor.griff", "geöffnet")));
  assert.ok(isOpen(st("sensor.griff", "x", { window_state: "open" })));
  assert.ok(!isOpen(st("sensor.griff", "closed")));
  assert.ok(!isOpen(st("binary_sensor.k", "off")));
});

test("Auto-Layout in L-förmigem Raum: alle Punkte im Raum und verschieden", () => {
  const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
  const spots = layout(L, 7);
  assert.equal(spots.length, 7);
  for (const p of spots) assert.ok(pointInPolygonLocal(p, L), `${p} außerhalb`);
  assert.equal(new Set(spots.map((p) => p.join())).size, 7);
});

function pointInPolygonLocal(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

test("Geräte anpassen: ausgeblendet (auch fest platziert) und hinzugefügt", () => {
  const h = makeHass([
    [st("light.decke", "on"), { area_id: "wohnzimmer" }],
    [st("light.stehlampe", "off"), { area_id: "wohnzimmer" }],
    [st("media_player.tv", "playing"), { area_id: "sonstwo" }],
  ]);
  const r = { id: "wz", name: "Wohnzimmer", area_id: "wohnzimmer", points: [[0, 0], [6, 0], [6, 4], [0, 4]], hidden_entities: ["light.decke", "light.stehlampe"], panel: ["media_player.tv"] };
  const f = { id: "eg", rooms: [r], openings: [], placements: [{ entity_id: "light.stehlampe", x: 1, z: 1, y: null }], furniture: [] };
  const icons = buildingIcons({ floors: [f] }, h).get("eg");
  assert.deepEqual(icons.map((i) => [i.entity_id, i.kind]), [["media_player.tv", "other"]]);
});

test("Watch-Liste: Energie-Zusatzzeilen, Karten, Kurzwahl, eigene Funktionen, Links", async () => {
  const { watchedEntities } = await import("../../custom_components/haus3d/frontend/devices.js");
  const building = {
    floors: [],
    settings: {
      energy: { solar: "sensor.pv", kurz: "akku", extra: ["sensor.a", { entity: "sensor.b", name: "B" }] },
      cards: [{ entities: [{ entity: "sensor.c" }, "sensor.d"] }],
      quick: [{ entity: "script.e" }],
      functions: [{ key: "flow" }, { entity: "switch.f" }],
    },
  };
  const links = new Map([["eg", new Map([["o1", { contact: "binary_sensor.g", cover: null }]])]]);
  const ids = watchedEntities(building, { states: {} }, new Map(), { links, extra: ["light.h"] });
  assert.deepEqual(ids, ["binary_sensor.g", "light.h", "script.e", "sensor.a", "sensor.b", "sensor.c", "sensor.d", "sensor.pv", "switch.f"]);
});

test("Raumfenster: Gruppen und Schnellaktionen", async () => {
  const { groupRoomEntities, roomActions, stepTarget } = await import("../../custom_components/haus3d/frontend/devices.js");
  const s = (entity_id, state, attributes = {}) => [entity_id, { entity_id, state, attributes }];
  const hass = { states: Object.fromEntries([
    s("light.a", "on"), s("light.b", "off"), s("light.gruppe", "on", { entity_id: ["light.a", "light.b"] }),
    s("cover.rollo", "open", { device_class: "shutter" }), s("cover.garage", "open", { device_class: "garage" }),
    s("binary_sensor.fenster", "off", { device_class: "window" }), s("sensor.temp", "21", { device_class: "temperature" }),
    s("climate.hk", "heat", { temperature: 21, current_temperature: 20.5, target_temp_step: 0.5, min_temp: 7, max_temp: 22, hvac_action: "heating" }),
    s("scene.kino", "scening"), s("sensor.strom", "5", { device_class: "power" }),
  ]) };
  const ids = Object.keys(hass.states);
  const groups = groupRoomEntities(ids, hass);
  assert.deepEqual(groups.map((g) => g.key), ["light", "cover", "opening", "climate", "scene", "sensor"]);
  assert.deepEqual(groups.find((g) => g.key === "opening").ids, ["cover.garage", "binary_sensor.fenster"]);
  const a = roomActions(ids, hass);
  assert.deepEqual(a.lights, { all: ["light.a", "light.b"], on: ["light.a"] });
  assert.deepEqual(a.covers, ["cover.rollo"]);
  assert.equal(a.climate.entity, "climate.hk");
  assert.equal(a.climate.action, "heating");
  assert.deepEqual(a.scenes, ["scene.kino"]);
  assert.equal(stepTarget(a.climate, null, 1), 21.5);
  assert.equal(stepTarget(a.climate, 21.8, 2), 22); // Grenze
  assert.equal(stepTarget(a.climate, 8, -4), 7);
});

test("Raumklima: Taupunkt, absolute Feuchte, Lüften-Rat, Thermostat, Bodenfarbe, Raumleistung", async () => {
  const d = await import("../../custom_components/haus3d/frontend/devices.js");
  assert.ok(Math.abs(d.dewPoint(20, 50) - 9.26) < 0.05);
  assert.ok(Math.abs(d.absHumidity(20, 50) - 8.64) < 0.05);
  assert.equal(d.ventAdvice({ temperature: 20, humidity: 60 }, { temperature: 5, humidity: 80 }).level, "good");
  assert.equal(d.ventAdvice({ temperature: 18, humidity: 50 }, { temperature: 25, humidity: 80 }).level, "bad");
  assert.equal(d.ventAdvice({ temperature: 18, humidity: 70 }, null).level, "mold");
  assert.equal(d.ventAdvice({ temperature: 18, humidity: 50 }, null), null);
  const s = (entity_id, state, attributes = {}) => [entity_id, { entity_id, state, attributes }];
  const hass = { states: Object.fromEntries([
    s("climate.hk", "heat", { temperature: 21, current_temperature: 19.5, current_humidity: 55, hvac_action: "heating" }),
    s("sensor.plug", "320", { device_class: "power", unit_of_measurement: "W" }), s("sensor.tv", "0.1", { device_class: "power", unit_of_measurement: "kW" }),
    s("sensor.pv", "800", { device_class: "power", unit_of_measurement: "W" }),
  ]) };
  const byArea = new Map([["r", ["climate.hk", "sensor.plug", "sensor.tv", "sensor.pv"]]]);
  const h = d.roomHeating({ area_id: "r" }, hass, byArea);
  assert.deepEqual([h.entity, h.target, h.current, h.action, h.readOnly], ["climate.hk", 21, 19.5, "heating", false]);
  assert.equal(d.roomHeating({ area_id: "r", climate: { thermostat: "none" } }, hass, byArea), null);
  // ohne Sensoren: Ist-Werte des Thermostats
  assert.deepEqual(d.roomClimate({ area_id: "r" }, hass, byArea), { temperature: 19.5, humidity: 55 });
  assert.equal(d.roomPower({ area_id: "r" }, hass, byArea, new Set(["sensor.pv"])), 420);
  assert.equal(d.roomPower({ area_id: "r", power: "none" }, hass, byArea), null);
  assert.equal(d.roomPower({ area_id: "r", power: "sensor.plug" }, hass, byArea), 320);
  assert.deepEqual(d.viewColor("temp", 18), d.temperatureColor(18));
  assert.equal(d.viewColor("humidity", null), null);
  assert.notDeepEqual(d.viewColor("humidity", 70), d.viewColor("humidity", 50));
  assert.ok(d.viewColor("power", 2000)[0] > d.viewColor("power", 10)[0]); // rot bei viel Leistung
});
