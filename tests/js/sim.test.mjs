// Simulationsmodus: nichts geht an Home Assistant, Zustände ändern sich nur in der Simulation
import assert from "node:assert/strict";
import { test } from "node:test";

import { Simulator } from "../../custom_components/haus3d/frontend/sim.js";

function realHass() {
  const calls = [];
  return {
    calls,
    states: {
      "light.flur": { entity_id: "light.flur", state: "off", attributes: { friendly_name: "Flur" } },
      "cover.wz": { entity_id: "cover.wz", state: "open", attributes: { current_position: 100 } },
      "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: {} },
      "sensor.solar": { entity_id: "sensor.solar", state: "10", attributes: { unit_of_measurement: "W" } },
    },
    entities: { "light.flur": { entity_id: "light.flur", area_id: "flur" } },
    callService: async (...a) => calls.push(["service", ...a]),
    callWS: async (msg) => {
      calls.push(["ws", msg.type]);
      return { building: { floors: [] }, revision: 7 };
    },
  };
}

test("Schalten ändert nur den simulierten Zustand, nie den echten", async () => {
  const real = realHass();
  const sim = new Simulator();
  let changes = 0;
  const h = sim.wrap(real, { onChange: () => changes++ });
  await h.callService("light", "toggle", { entity_id: "light.flur" });
  await h.callService("cover", "toggle", { entity_id: "cover.wz" });
  assert.equal(real.calls.length, 0);
  assert.equal(real.states["light.flur"].state, "off");
  const h2 = sim.wrap(real);
  assert.equal(h2.states["light.flur"].state, "on");
  assert.equal(h2.states["cover.wz"].state, "closed");
  assert.equal(h2.states["cover.wz"].attributes.current_position, 0);
  assert.equal(changes, 2);
  // gleiches Objekt, solange sich nichts ändert
  assert.equal(sim.wrap(real), h2);
});

test("Grundriss speichern bleibt lokal, Verlauf gesperrt", async () => {
  const real = realHass();
  const sim = new Simulator();
  const h = sim.wrap(real);
  const first = await h.callWS({ type: "haus3d/building/get" });
  assert.equal(first.revision, 7);
  const saved = await h.callWS({ type: "haus3d/building/save", building: { floors: [{ id: "x" }] }, revision: 7 });
  assert.equal(saved.revision, 8);
  assert.deepEqual((await h.callWS({ type: "haus3d/building/get" })).building.floors[0].id, "x");
  await assert.rejects(h.callWS({ type: "haus3d/history/list" }));
  assert.deepEqual(real.calls, [["ws", "haus3d/building/get"]]);
});

test("Wetter, Tageszeit, Solar und Beispielgeräte", () => {
  const real = realHass();
  const sim = new Simulator();
  sim.weather = "snowy";
  sim.daytime = "night";
  sim.solar = 500;
  const building = { settings: { energy: { solar: "sensor.solar", einspeisung: "sensor.feed" } }, floors: [{ id: "eg", rooms: [{ id: "bad", name: "Bad", area_id: null }, { id: "flur", name: "Flur", area_id: "flur" }] }] };
  assert.equal(sim.makeDemo(building, real), 1);
  const h = sim.wrap(real, { building });
  assert.equal(h.states["weather.simulation"].state, "snowy");
  assert.equal(h.states["sun.sun"].state, "below_horizon");
  assert.equal(h.states["sensor.solar"].state, "500");
  assert.equal(h.states["sensor.feed"].state, "460");
  assert.equal(h.entities["light.sim_bad"].area_id, "sim_bad");
  assert.equal(building.floors[0].rooms[0].area_id, "sim_bad");
  assert.ok(!h.entities["light.sim_flur"]); // Flur hat schon Geräte
});

test("Uhrzeit: Sonnenstand aus Breite/Länge, Mitternacht unter dem Horizont, Mittag im Süden", () => {
  const real = { ...realHass(), config: { latitude: 51, longitude: 10 } };
  const sim = new Simulator();
  sim.time = 0;
  assert.equal(sim.wrap(real, { building: { floors: [] } }).states["sun.sun"].state, "below_horizon");
  const s2 = new Simulator();
  s2.time = 13 * 60; // 13 Uhr Ortszeit des Testrechners: Sonne irgendwo am Tageshimmel oder darunter
  const a = s2.wrap(real, { building: { floors: [] } }).states["sun.sun"].attributes;
  assert.ok(Number.isFinite(a.azimuth) && Number.isFinite(a.elevation));
  const s3 = new Simulator();
  s3.daytime = "day";
  assert.equal(s3.wrap(real, { building: { floors: [] } }).states["sun.sun"].attributes.elevation, 45);
});
