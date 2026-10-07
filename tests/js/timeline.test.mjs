// Tests für den Zeitstrahl: Verlauf → Zustand zum Zeitpunkt, Vorhersage, PV-Schätzung
import assert from "node:assert/strict";
import { test } from "node:test";

import { cloudOf, forecastAt, historyStates, normalizeHistory, pvEstimate, stateAt, timeLabel, timelineRange } from "../../custom_components/haus3d/frontend/timeline.js";

const T0 = Date.parse("2026-10-07T06:00:00Z");
const H = 3600000;

test("Verlauf: kompakt und voll, Zustand zum Zeitpunkt", () => {
  const h = normalizeHistory({
    "light.kueche": [{ s: "off", lu: T0 / 1000 }, { s: "on", lu: (T0 + H) / 1000 }, { s: "off", lu: (T0 + 2 * H) / 1000 }],
    "person.anna": [{ state: "home", attributes: { friendly_name: "Anna" }, last_changed: new Date(T0).toISOString() }, { state: "not_home", last_changed: new Date(T0 + 3 * H).toISOString() }],
    "sensor.leer": [],
  });
  assert.deepEqual(Object.keys(h), ["light.kueche", "person.anna"]);
  assert.equal(stateAt(h["light.kueche"], T0 + 1.5 * H).state, "on");
  assert.equal(stateAt(h["light.kueche"], T0 - 1), undefined);
  const real = { states: { "light.kueche": { entity_id: "light.kueche", state: "off", attributes: { friendly_name: "Küche" } }, "sun.sun": { state: "above_horizon", attributes: {} } } };
  const s = historyStates(real, h, T0 + 1.5 * H, { lat: 51, lon: 10 });
  assert.equal(s["light.kueche"].state, "on");
  assert.equal(s["light.kueche"].attributes.friendly_name, "Küche"); // Attribute bleiben
  assert.equal(s["person.anna"].state, "home");
  assert.equal(s["sun.sun"].state, "above_horizon"); // 7:30 Uhr MESZ, Oktober: Sonne ist auf
  assert.equal(historyStates(real, h, T0 + 4 * H)["person.anna"].state, "not_home");
});

test("Vorhersage: nächster Eintrag, Bewölkung, PV-Schätzung", () => {
  const fc = [{ datetime: new Date(T0).toISOString(), condition: "sunny", temperature: 12 }, { datetime: new Date(T0 + H).toISOString(), condition: "cloudy", cloud_coverage: 80, temperature: 13 }];
  assert.equal(forecastAt(fc, T0 + 0.6 * H).condition, "cloudy");
  assert.equal(forecastAt(fc, T0 + 10 * H), null);
  assert.equal(cloudOf(fc[0]), 5);
  assert.equal(cloudOf(fc[1]), 80);
  assert.equal(pvEstimate(10, 30, 0), 4250); // 10 kWp · sin 30° · 0,85
  assert.ok(pvEstimate(10, 30, 100) < 1200);
  assert.equal(pvEstimate(10, -5, 0), 0);
  assert.equal(pvEstimate(0, 40, 0), 0);
});

test("Bereich und Beschriftung", () => {
  const now = new Date(2026, 9, 7, 3, 0).getTime(); // 3 Uhr: mind. 6 h zurück
  const r = timelineRange(now);
  assert.equal(r.from, now - 6 * H);
  assert.equal(r.to, now + 24 * H);
  const noon = new Date(2026, 9, 7, 12, 0).getTime();
  assert.equal(timelineRange(noon).from, new Date(2026, 9, 7).getTime());
  assert.equal(timeLabel(noon, noon), "jetzt");
  assert.equal(timeLabel(noon + 2 * H, noon), "14:00");
  assert.equal(timeLabel(noon + 20 * H, noon), "Do 08:00");
});
