// Tests für Raum-Szenen und Favoriten
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeDaily } from "../../custom_components/haus3d/frontend/panel-smart.js";
import { sceneEntity, sceneSlug, sceneState, topFavorites } from "../../custom_components/haus3d/frontend/panel-scenes.js";

test("Szenen: Kennung, gespeicherter Zustand, Entität finden", () => {
  assert.equal(sceneSlug("Wohnzimmer Kühl & Hell!"), "wohnzimmer_kuehl_hell");
  assert.deepEqual(sceneState({ entity_id: "light.a", state: "on", attributes: { brightness: 120, color_temp_kelvin: 2700, friendly_name: "A", supported_features: 4 } }), { state: "on", brightness: 120, color_temp_kelvin: 2700 });
  assert.deepEqual(sceneState({ entity_id: "light.a", state: "off", attributes: { brightness: null } }), { state: "off" });
  assert.deepEqual(sceneState({ entity_id: "cover.r", state: "open", attributes: { current_position: 40 } }), { state: "open", current_position: 40 });
  const hass = { states: { "scene.wz_kino": { attributes: { id: "haus3d_wz_kino_1" } }, "light.x": { attributes: { id: "haus3d_wz_kino_1" } } } };
  assert.equal(sceneEntity(hass, "haus3d_wz_kino_1"), "scene.wz_kino");
  assert.equal(sceneEntity(hass, "nope"), null);
});

test("Favoriten: meistgenutzt, mind. 3 Tipps, Alter zählt weniger, ausgeblendete nie", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const day = 86400000;
  const uses = { "light.a": { n: 10, t: now }, "light.b": { n: 2, t: now }, "light.c": { n: 12, t: now - 60 * day }, "switch.d": { n: 5, t: now - day }, "light.e": { n: -1, t: now } };
  assert.deepEqual(topFavorites(uses, now), ["light.a", "switch.d", "light.c"]);
  assert.equal(topFavorites(uses, now, 1).length, 1);
});

test("Alltag-Einstellungen: Standardwerte, ungültige Werte fallen weg", () => {
  const d = normalizeDaily({ appliances: [{ power: "sensor.wm", kind: "washer" }, { name: "kaputt" }], calendars: ["calendar.abfall", "kein id"], price: "32", vent_min: 500, window_heat: { auto: 1, minutes: 0 } });
  assert.equal(d.appliances.length, 1);
  assert.equal(d.appliances[0].name, "Waschmaschine");
  assert.deepEqual(d.calendars, ["calendar.abfall"]);
  assert.equal(d.price, 32);
  assert.equal(d.vent_min, 60);
  assert.equal(d.waste_hour, 16);
  assert.deepEqual(d.window_heat, { auto: true, minutes: 3 });
  assert.equal(normalizeDaily(null).mold, true);
});
