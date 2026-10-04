// Tagesverlauf: Formate aus HA, Ausdünnen, kWh, Tagesbeginn über die Zeitumstellung
import assert from "node:assert/strict";
import { test } from "node:test";

import { dayStart, downsample, integrateKWh, normalizeHistory, normalizeStats, sparkPath, valueAt } from "../../custom_components/haus3d/frontend/history.js";

test("Statistik: Start in ms oder ISO, leere Werte fallen weg", () => {
  const resp = { "sensor.pv": [{ start: 1759572000000, mean: 100 }, { start: "2025-10-04T10:05:00+00:00", mean: 200 }, { start: 1759572600000, mean: null }] };
  assert.deepEqual(normalizeStats(resp, "sensor.pv"), [{ t: 1759572000000, v: 100 }, { t: Date.parse("2025-10-04T10:05:00Z"), v: 200 }]);
  assert.deepEqual(normalizeStats(resp, "sensor.x"), []);
  assert.deepEqual(normalizeStats(null, "sensor.x"), []);
});

test("Verlauf: kompakte Form (Sekunden), ausführliche Form, keine Zahlen fallen weg", () => {
  const resp = { "sensor.a": [{ s: "12.5", lu: 1759572000.5 }, { s: "unavailable", lu: 1759572060 }, { s: "13", lu: 1759572120 }], "sensor.b": [{ state: "7", last_updated: "2025-10-04T10:00:00Z" }] };
  assert.deepEqual(normalizeHistory(resp, "sensor.a"), [{ t: 1759572000500, v: 12.5 }, { t: 1759572120000, v: 13 }]);
  assert.deepEqual(normalizeHistory(resp, "sensor.b"), [{ t: Date.parse("2025-10-04T10:00:00Z"), v: 7 }]);
});

test("Ausdünnen behält Spitzen; Kurve; Wert zur Zeit", () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i * 1000, v: i === 500 ? 9999 : i === 700 ? -50 : Math.sin(i / 50) }));
  const d = downsample(pts, 100);
  assert.ok(d.length <= 100);
  assert.ok(d.some((p) => p.v === 9999) && d.some((p) => p.v === -50));
  assert.ok(d.every((p, i) => !i || d[i - 1].t <= p.t));
  assert.equal(sparkPath([{ t: 0, v: 0 }, { t: 10, v: 10 }], 100, 20), "M0 20 L100 0");
  assert.equal(sparkPath([], 10, 10), "");
  assert.equal(valueAt([{ t: 0, v: 1 }, { t: 10, v: 2 }], 5), 1);
  assert.equal(valueAt([{ t: 10, v: 2 }], 5), null);
});

test("1000 W eine Stunde lang = 1 kWh; große Lücken zählen nicht", () => {
  const h = 3600000;
  assert.ok(Math.abs(integrateKWh([{ t: 0, v: 1000 }, { t: h / 2, v: 1000 }, { t: h, v: 1000 }]) - 1) < 1e-9);
  assert.equal(integrateKWh([{ t: 0, v: 1000 }, { t: 10 * h, v: 1000 }]), 0);
});

test("Tagesbeginn in Europe/Berlin, auch an den Tagen der Zeitumstellung", () => {
  const tz = "Europe/Berlin";
  assert.equal(dayStart(Date.UTC(2026, 6, 15, 12), tz), Date.UTC(2026, 6, 14, 22));
  assert.equal(dayStart(Date.UTC(2026, 0, 15, 12), tz), Date.UTC(2026, 0, 14, 23));
  // 29. März 2026: Sommerzeit beginnt (Mitternacht noch Winterzeit)
  assert.equal(dayStart(Date.UTC(2026, 2, 29, 20), tz), Date.UTC(2026, 2, 28, 23));
  // 25. Oktober 2026: Winterzeit beginnt (Mitternacht noch Sommerzeit)
  assert.equal(dayStart(Date.UTC(2026, 9, 25, 20), tz), Date.UTC(2026, 9, 24, 22));
  // gestern
  assert.equal(dayStart(Date.UTC(2026, 6, 15, 12), tz, -1), Date.UTC(2026, 6, 13, 22));
  // kurz nach Mitternacht Ortszeit gehört zum neuen Tag
  assert.equal(dayStart(Date.UTC(2026, 6, 14, 22, 30), tz), Date.UTC(2026, 6, 14, 22));
});
