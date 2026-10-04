// Energie-Karte 2.0: HA-Energie-Vorschläge, Akku, Netz, Überschuss, Formatierung
import assert from "node:assert/strict";
import { test } from "node:test";

import { batteryState, batteryText, ema, etaClock, formatPower, gridState, gridText, siblingOnDevice, suggestEnergy, surplus } from "../../custom_components/haus3d/frontend/energy.js";

const st = (id, state, attributes = {}) => [id, { entity_id: id, state, attributes }];
const hass = {
  states: Object.fromEntries([
    st("sensor.netz_bezug", "1234", { device_class: "energy" }), st("sensor.netz_einspeisung", "99", { device_class: "energy" }),
    st("sensor.netz_leistung", "450", { device_class: "power", unit_of_measurement: "W" }),
    st("sensor.pv_ertrag", "500", { device_class: "energy" }), st("sensor.pv_leistung", "1200", { device_class: "power" }),
    st("sensor.akku_rein", "1", { device_class: "energy" }), st("sensor.akku_raus", "1", { device_class: "energy" }),
    st("sensor.akku_leistung", "-32", { device_class: "power" }), st("sensor.akku_ladestand", "76", { device_class: "battery" }),
  ]),
  entities: {
    "sensor.netz_bezug": { entity_id: "sensor.netz_bezug", device_id: "zaehler" },
    "sensor.netz_leistung": { entity_id: "sensor.netz_leistung", device_id: "zaehler" },
    "sensor.akku_rein": { entity_id: "sensor.akku_rein", device_id: "akku" },
    "sensor.akku_leistung": { entity_id: "sensor.akku_leistung", device_id: "akku" },
    "sensor.akku_ladestand": { entity_id: "sensor.akku_ladestand", device_id: "akku" },
  },
};

test("Vorschläge: alte Form (flow_from/flow_to), Geschwister auf dem Gerät, nur vorhandene IDs", () => {
  const prefs = { energy_sources: [
    { type: "grid", flow_from: [{ stat_energy_from: "sensor.netz_bezug" }], flow_to: [{ stat_energy_to: "sensor.netz_einspeisung" }] },
    { type: "solar", stat_energy_from: "sensor.pv_ertrag", stat_rate: "sensor.pv_leistung" },
    { type: "battery", stat_energy_from: "sensor.akku_raus", stat_energy_to: "sensor.akku_rein" },
    { type: "gas", stat_energy_from: "sensor.gibts_nicht" },
  ] };
  const s = suggestEnergy(prefs, hass);
  assert.deepEqual(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.entity])), {
    netz: "sensor.netz_leistung", bezug_zaehler: "sensor.netz_bezug", einspeise_zaehler: "sensor.netz_einspeisung",
    haus_pv: "sensor.pv_leistung", pv_zaehler: "sensor.pv_ertrag",
    akku_leistung: "sensor.akku_leistung", akku_ladestand: "sensor.akku_ladestand",
  });
});

test("Vorschläge: neue Form mit stat_rate am Netz; kaputte Eingaben → {}", () => {
  const s = suggestEnergy({ energy_sources: [{ type: "grid", stat_energy_from: "sensor.netz_bezug", power_config: { stat_rate: "sensor.netz_leistung" } }] }, hass);
  assert.equal(s.netz.entity, "sensor.netz_leistung");
  assert.equal(s.netz.label, "Netz – Leistung");
  for (const bad of [null, undefined, {}, { energy_sources: "x" }, { energy_sources: [null, 3, { type: "grid", flow_from: "x" }] }]) assert.deepEqual(suggestEnergy(bad, hass), {});
  assert.equal(siblingOnDevice("sensor.unbekannt", hass, "power"), null);
});

test("Akku: Richtung mit Ruhe-Schwelle, Umkehr, Restzeit, Symbol", () => {
  assert.equal(batteryState(76, -32).dir, "discharge");
  assert.equal(batteryState(76, 5).dir, "idle");
  assert.equal(batteryState(76, -5).dir, "idle");
  assert.equal(batteryState(76, -32, { invert: true }).dir, "charge");
  assert.equal(batteryState(76, -200).etaMin, null); // ohne Kapazität keine Restzeit
  // 1,6 kWh, 76 % → bis 10 % Reserve: 66 % = 1056 Wh bei 880 W = 72 min
  assert.equal(batteryState(76, -880, { capacityKWh: 1.6, reservePct: 10 }).etaMin, 72);
  assert.equal(batteryState(100, 300, { capacityKWh: 1.6 }).etaMin, 0);
  assert.equal(batteryState(76, -32).icon, "mdi:battery-arrow-down-outline");
  assert.equal(batteryState(76, 0).icon, "mdi:battery-80");
  assert.equal(batteryState(12, 0).level, "low");
  assert.deepEqual(batteryState(null, null), { dir: null, w: null, etaMin: null, level: null, icon: "mdi:battery" });
});

test("Akku-Text: Uhrzeit auf 10 min gerundet", () => {
  const now = new Date(2026, 9, 4, 12, 0).getTime();
  assert.equal(etaClock(72, now), "13:10");
  assert.equal(batteryText({ dir: "charge", w: 320, etaMin: 100 }, now), "lädt 320 W · voll ca. 13:40");
  assert.equal(batteryText({ dir: "discharge", w: 80, etaMin: 0 }, now), "entlädt 80 W · Reserve erreicht");
  assert.equal(batteryText({ dir: "idle", w: 2 }, now), "ruht");
});

test("Netz: Bezug positiv, Umkehr, ruht", () => {
  assert.deepEqual(gridState(450), { dir: "import", w: 450 });
  assert.deepEqual(gridState(450, true), { dir: "export", w: 450 });
  assert.equal(gridState(3).dir, "idle");
  assert.equal(gridState(NaN).dir, null);
  assert.equal(gridText(gridState(-1200)), "Einspeisung 1,2 kW");
  assert.equal(gridText(gridState(450)), "Bezug 450 W");
});

test("Überschuss: Schwellen 600/150 mit Hysterese, Netz vor Einspeisung", () => {
  assert.equal(surplus({ einspeisung: 640 }).level, "hoch");
  assert.equal(surplus({ einspeisung: 640 }).proxy, true);
  assert.equal(surplus({ einspeisung: 580 }).level, "mittel");
  assert.equal(surplus({ einspeisung: 580 }, {}, "hoch").level, "hoch");
  assert.equal(surplus({ einspeisung: 540 }, {}, "hoch").level, "mittel");
  assert.equal(surplus({ einspeisung: 120 }, {}, "mittel").level, "mittel");
  assert.equal(surplus({ einspeisung: 90 }, {}, "mittel").level, "niedrig");
  assert.equal(surplus({ netz: 450, einspeisung: 800 }).level, "niedrig");
  assert.deepEqual(surplus({ netz: -700 }), { level: "hoch", w: 700, proxy: false });
  assert.equal(surplus({ einspeisung: 300 }, { hoch: 250, mittel: 100 }).level, "hoch");
  assert.equal(surplus({}).level, null);
});

test("Leistung: W unter 1000, darüber kW mit Komma", () => {
  assert.equal(formatPower(412), "412 W");
  assert.equal(formatPower(1234), "1,2 kW");
  assert.equal(formatPower(-1500), "-1,5 kW");
  assert.equal(formatPower(null), "–");
  assert.equal(ema(null, 100), 100);
  assert.equal(ema(100, 200, 0.5), 150);
  assert.equal(ema(100, NaN), 100);
});
