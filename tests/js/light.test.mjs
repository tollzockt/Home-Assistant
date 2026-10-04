// Echtes Licht: Farbtemperatur, Lampenfarbe, Raum-Mischung ohne doppelte Gruppen
import assert from "node:assert/strict";
import { test } from "node:test";

import { colorKey, kelvinToRgb, lightLook, roomLight } from "../../custom_components/haus3d/frontend/light.js";

test("Farbtemperatur: warm rötlich, 6500 K fast weiß", () => {
  const [r, g, b] = kelvinToRgb(2700);
  assert.equal(r, 1);
  assert.ok(g < 0.75 && b < 0.5);
  const d = kelvinToRgb(6500);
  assert.ok(d.every((v) => v > 0.9));
});

test("Lampe: aus = null, RGB vor HS vor Kelvin, Helligkeit", () => {
  assert.equal(lightLook({ state: "off", attributes: {} }), null);
  assert.deepEqual(lightLook({ state: "on", attributes: { rgb_color: [0, 0, 255], brightness: 255, hs_color: [0, 100] } }), { color: [0, 0, 1], level: 1 });
  const red = lightLook({ state: "on", attributes: { hs_color: [0, 100], brightness: 128 } });
  assert.deepEqual(red.color.map((v) => Math.round(v * 100) / 100), [1, 0, 0]);
  assert.ok(Math.abs(red.level - 0.5) < 0.01);
  assert.deepEqual(lightLook({ state: "on", attributes: { color_temp_kelvin: 6500 } }).color, kelvinToRgb(6500));
  assert.deepEqual(lightLook({ state: "on", attributes: { color_temp: 370 } }).color, kelvinToRgb(1e6 / 370));
  assert.equal(lightLook({ state: "on", attributes: { brightness: null } }).level, 1);
});

test("Raum: gewichtete Mischung, höchste Helligkeit, Gruppe nicht doppelt", () => {
  const hass = { states: {
    "light.a": { state: "on", attributes: { rgb_color: [255, 0, 0], brightness: 255 } },
    "light.b": { state: "on", attributes: { rgb_color: [0, 0, 255], brightness: 85 } },
    "light.gruppe": { state: "on", attributes: { rgb_color: [0, 255, 0], entity_id: ["light.a", "light.b"] } },
    "light.aus": { state: "off", attributes: {} },
  } };
  const byArea = new Map([["wz", ["light.a", "light.b", "light.gruppe", "light.aus"]], ["leer", ["light.aus"]], ["nurgruppe", ["light.gruppe"]]]);
  const l = roomLight({ area_id: "wz" }, hass, byArea);
  assert.equal(l.level, 1);
  assert.ok(l.color[0] > 0.7 && l.color[2] > 0.2 && l.color[1] === 0);
  assert.equal(roomLight({ area_id: "leer" }, hass, byArea), null);
  assert.equal(roomLight({}, hass, byArea), null);
  assert.deepEqual(roomLight({ area_id: "nurgruppe" }, hass, byArea).color, [0, 1, 0]);
  assert.equal(colorKey([1, 0.5, 0]), "f80");
});
