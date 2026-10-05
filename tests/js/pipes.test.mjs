import { test } from "node:test";
import assert from "node:assert/strict";
import { pathLength, pipeColor, pipeFlow, pipePath } from "../../custom_components/haus3d/frontend/pipes.js";

test("pipePath: Höhenwechsel geht senkrecht am Punkt hoch", () => {
  const path = pipePath({ points: [[0, 0], [2, 0], [2, 3]], heights: [0.03, 0.03, 1.1] });
  assert.deepEqual(path, [[0, 0.03, 0], [2, 0.03, 0], [2, 1.1, 0], [2, 1.1, 3]]);
  assert.ok(Math.abs(pathLength(path) - (2 + 1.07 + 3)) < 1e-9);
  // ohne heights: feste Höhe
  assert.deepEqual(pipePath({ points: [[0, 0], [1, 0]], height: 0.3 }), [[0, 0.3, 0], [1, 0.3, 0]]);
});

test("pipeFlow: Strom nach Sensor oder Raumleistung, Wasser nach Durchfluss/Ventil", () => {
  const hass = { states: {
    "sensor.leitung_w": { state: "-800", attributes: { unit_of_measurement: "W" } },
    "sensor.leitung_kw": { state: "1.5", attributes: { unit_of_measurement: "kW" } },
    "sensor.durchfluss": { state: "6", attributes: {} },
    "valve.garten": { state: "closed", attributes: {} },
    "switch.pumpe": { state: "on", attributes: {} },
  } };
  const s = pipeFlow({ type: "strom", entity: "sensor.leitung_w" }, hass);
  assert.equal(s.active, true);
  assert.equal(s.reverse, true);
  assert.ok(pipeFlow({ type: "strom", entity: "sensor.leitung_kw" }, hass).speed > s.speed);
  assert.equal(pipeFlow({ type: "strom", room: "kueche" }, hass, 120).active, true);
  assert.equal(pipeFlow({ type: "strom", room: "kueche" }, hass, 1).active, false);
  assert.equal(pipeFlow({ type: "strom" }, hass).active, false);
  assert.equal(pipeFlow({ type: "wasser_kalt", entity: "sensor.durchfluss" }, hass).active, true);
  assert.equal(pipeFlow({ type: "wasser_warm", entity: "valve.garten" }, hass).active, false);
  assert.equal(pipeFlow({ type: "wasser_warm", entity: "switch.pumpe" }, hass).active, true);
  assert.equal(pipeFlow({ type: "wasser_kalt" }, hass).active, false);
  assert.equal(pipeColor("wasser_kalt"), "#1e88e5");
  assert.equal(pipeColor("unbekannt"), "#fbc02d");
});
