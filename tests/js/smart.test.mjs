// Tests für Alltag: Geräte-Zyklus, Termine/Müll, Strompreis, Schimmel, Lüften
import assert from "node:assert/strict";
import { test } from "node:test";

import { applianceStep, cheapestWindow, costPerHour, currentPrice, fmtCost, fmtMinutes, guessAppliances, moldRisk, priceOf, priceSeries, remainingMinutes, upcomingEvents, ventTimers, wasteReminders, watts } from "../../custom_components/haus3d/frontend/smart.js";

const MIN = 60000;
const st = (state, attributes = {}) => ({ state: String(state), attributes });

test("Geräte: Vorschläge aus Leistungssensoren nach Namen", () => {
  const hass = { states: {
    "sensor.waschmaschine_leistung": st(0, { device_class: "power", unit_of_measurement: "W", friendly_name: "Waschmaschine Leistung" }),
    "sensor.dryer_power": st(0, { unit_of_measurement: "W" }),
    "sensor.spuelmaschine_energie": st(3, { device_class: "energy", unit_of_measurement: "kWh" }),
    "sensor.tv_power": st(80, { device_class: "power", unit_of_measurement: "W" }),
  } };
  const g = guessAppliances(hass);
  assert.deepEqual(g.map((x) => [x.power, x.kind]), [["sensor.waschmaschine_leistung", "washer"], ["sensor.dryer_power", "dryer"]]);
  assert.equal(guessAppliances(hass, ["sensor.dryer_power"]).length, 1);
  assert.equal(watts(st(1.2, { unit_of_measurement: "kW" })), 1200);
  assert.equal(watts(st("unavailable")), null);
});

test("Geräte: Lauf erkennen, Pausen überstehen, fertig nach Ruhe, kurze Spitzen ignorieren", () => {
  let s = applianceStep(null, 2, 0);
  assert.equal(s.phase, "idle");
  s = applianceStep(s, 1800, 1 * MIN);
  assert.equal(s.phase, "running");
  // Einweichpause 2 min unter 4 W: läuft weiter
  s = applianceStep(s, 1, 30 * MIN);
  s = applianceStep(s, 1, 32 * MIN);
  assert.equal(s.phase, "running");
  s = applianceStep(s, 300, 33 * MIN);
  assert.equal(s.lowSince, null);
  s = applianceStep(s, 1, 60 * MIN);
  s = applianceStep(s, 1, 63 * MIN);
  assert.equal(s.phase, "done");
  assert.equal(s.doneAt, 63 * MIN);
  // bleibt „fertig“, nach 3 h wieder ruhig
  assert.equal(applianceStep(s, 1, 120 * MIN).phase, "done");
  assert.equal(applianceStep(s, 1, 63 * MIN + 3 * 3600000 + 1).phase, "idle");
  // neuer Lauf direkt aus „fertig“
  assert.equal(applianceStep(s, 900, 70 * MIN).phase, "running");
  // nur 1 min an: keine Meldung
  let k = applianceStep(null, 50, 0);
  k = applianceStep(k, 1, 1 * MIN);
  k = applianceStep(k, 1, 4 * MIN);
  assert.equal(k.phase, "idle");
  // Spülmaschine: Trocknen ohne Strom dauert – erst nach 15 min fertig
  let d = applianceStep(null, 2000, 0, "dishwasher");
  d = applianceStep(d, 1, 60 * MIN, "dishwasher");
  assert.equal(applianceStep(d, 1, 70 * MIN, "dishwasher").phase, "running");
  assert.equal(applianceStep(d, 1, 76 * MIN, "dishwasher").phase, "done");
  // ohne Wert: unverändert
  assert.deepEqual(applianceStep(d, null, 99 * MIN, "dishwasher"), d);
});

test("Restzeit: Minuten, hh:mm:ss, Zeitpunkt", () => {
  const now = Date.parse("2026-10-07T10:00:00Z");
  assert.equal(remainingMinutes(st(42, { unit_of_measurement: "min" })), 42);
  assert.equal(remainingMinutes(st("1:05:00")), 65);
  assert.equal(remainingMinutes(st("2026-10-07T10:30:00Z", { device_class: "timestamp" }), now), 30);
  assert.equal(remainingMinutes(st(1.5, { unit_of_measurement: "h" })), 90);
  assert.equal(remainingMinutes(st("unknown")), null);
  assert.equal(fmtMinutes(65), "1:05 h");
  assert.equal(fmtMinutes(25), "25 min");
});

test("Termine: Kalender und Abfall-Sensoren, Müll-Erinnerung abends für morgen", () => {
  const now = new Date(2026, 9, 7, 18, 0).getTime(); // Mi 18 Uhr
  const hass = { states: {
    "calendar.familie": st("off", { message: "Zahnarzt", start_time: "2026-10-09 09:30:00", all_day: false }),
    "calendar.abfall": st("off", { message: "Gelbe Tonne", start_time: "2026-10-08 00:00:00", all_day: true }),
    "sensor.restmuell": st("in 3 Tagen", { daysTo: 3, friendly_name: "Restmüll" }),
    "sensor.papier": st("2026-10-20", { friendly_name: "Papier" }), // zu weit weg
    "calendar.alt": st("off", { message: "Gestern", start_time: "2026-10-06 10:00:00" }),
  } };
  const ev = upcomingEvents(hass, Object.keys(hass.states), now);
  assert.deepEqual(ev.map((e) => [e.title, e.days, e.waste]), [["Gelbe Tonne", 1, true], ["Zahnarzt", 2, false], ["Restmüll", 3, true]]);
  const r = wasteReminders(ev, now);
  assert.equal(r.length, 1);
  assert.equal(r[0].when, "morgen");
  assert.ok(r[0].key.startsWith("waste:calendar.abfall:"));
  // mittags noch keine Erinnerung; morgens früh für heute
  assert.equal(wasteReminders(ev, new Date(2026, 9, 7, 12).getTime()).length, 0);
  const morning = new Date(2026, 9, 8, 7).getTime();
  assert.equal(wasteReminders(upcomingEvents(hass, ["calendar.abfall"], morning), morning)[0].when, "heute");
});

test("Strompreis: Einheiten, Reihen, günstigstes Fenster, Kosten", () => {
  assert.equal(priceOf(32.5, "ct/kWh"), 0.325);
  assert.equal(priceOf(120, "EUR/MWh"), 0.12);
  assert.equal(priceOf(0.3, "€/kWh"), 0.3);
  const base = Date.parse("2026-10-07T00:00:00Z");
  const h = (i) => new Date(base + i * 3600000).toISOString();
  const prices = [30, 28, 25, 10, 9, 12, 30, 31].map((v, i) => ({ start: h(i), end: h(i + 1), value: v }));
  const series = priceSeries(st(30, { unit_of_measurement: "ct/kWh", raw_today: prices }));
  assert.equal(series.length, 8);
  assert.equal(series[3].price, 0.1);
  const w = cheapestWindow(series, 3, base);
  assert.equal(w.start, base + 3 * 3600000);
  assert.ok(Math.abs(w.avg - 0.103333) < 1e-5);
  // nur Zukunft
  assert.equal(cheapestWindow(series, 3, base + 6.5 * 3600000), null);
  // EPEX-Format
  assert.equal(priceSeries(st(1, { data: [{ start_time: h(0), end_time: h(1), price_eur_per_mwh: 85 }] }))[0].price, 0.085);
  // fester Preis in ct oder €
  assert.equal(currentPrice({ price: 32 }, {}), 0.32);
  assert.equal(currentPrice({ price: 0.32 }, {}), 0.32);
  assert.equal(currentPrice({ price_entity: "sensor.preis" }, { states: { "sensor.preis": st(25, { unit_of_measurement: "ct/kWh" }) } }), 0.25);
  assert.equal(costPerHour(2000, 0.3), 0.6);
  assert.equal(fmtCost(0.6), "60 ct/h");
  assert.equal(fmtCost(1.2), "1,20 €/h");
});

test("Schimmel: Feuchte an der Wand, Lüften-Timer", () => {
  assert.equal(moldRisk(21, 45).level, "ok");
  assert.equal(moldRisk(20, 70, 0).level, "hoch"); // kalte Außenwand
  assert.equal(moldRisk(21, 60).level, "mittel");
  assert.equal(moldRisk(null, 60), null);
  const t = ventTimers({ "eg:bad": 1000, "eg:wz": 5 * MIN }, 2 * MIN);
  assert.deepEqual(t.due.map((x) => x.key), ["eg:bad"]);
  assert.equal(t.running[0].left, 3);
});
