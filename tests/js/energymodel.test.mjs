// Energie-Modell: Basis + Quellen, Summen, altes Format, Netz mit einem oder zwei Sensoren
import assert from "node:assert/strict";
import { test } from "node:test";

import { energyEntities, energyTotals, legacyValues, newSource, normalizeEnergy } from "../../custom_components/haus3d/frontend/energymodel.js";

const S = (state, unit = "W") => ({ state: String(state), attributes: { unit_of_measurement: unit } });

test("Altes Format wird zu Quellen", () => {
  const e = normalizeEnergy({ solar: "sensor.bkw", ertrag_heute: "sensor.bkw_heute", haus_pv: "sensor.pv", akku_ladestand: "sensor.soc", akku_leistung: "sensor.akku", akku_invert: true, akku_kapazitaet: 5, verbrauch: "sensor.haus", netz: "sensor.netz", netz_invert: true });
  assert.deepEqual(e.sources.map((s) => [s.type, s.power]), [["bkw", "sensor.bkw"], ["pv", "sensor.pv"], ["speicher", "sensor.akku"]]);
  assert.equal(e.sources[2].invert, true);
  assert.equal(e.sources[2].capacity, 5);
  assert.equal(e.haus, "sensor.haus");
  assert.equal(e.netz_invert, true);
  assert.deepEqual(energyEntities({ solar: "sensor.bkw", netz: "sensor.netz" }).sort(), ["sensor.bkw", "sensor.netz"]);
});

test("Summen: alle Erzeuger zusammen, Netz getrennt, Verbrauch berechnet", () => {
  const cfg = {
    netz_bezug: "sensor.bezug",
    netz_einspeisung: "sensor.einsp",
    sources: [
      { id: "pv_1", type: "pv", name: "Dach", power: "sensor.pv", energy: "sensor.pv_heute" },
      { id: "bkw_1", type: "bkw", name: "Balkon", power: "sensor.bkw", energy: "sensor.bkw_heute" },
      { id: "sp_1", type: "speicher", name: "Speicher", power: "sensor.sp", soc: "sensor.soc", capacity: 10 },
      { id: "sp_2", type: "speicher", name: "Speicher 2", power: "sensor.sp2", soc: "sensor.soc2", capacity: 5, invert: true },
    ],
  };
  const hass = { states: { "sensor.bezug": S(0), "sensor.einsp": S(300), "sensor.pv": S(2.5, "kW"), "sensor.bkw": S(600), "sensor.pv_heute": S(8.2, "kWh"), "sensor.bkw_heute": S(1500, "Wh"), "sensor.sp": S(400), "sensor.sp2": S(100), "sensor.soc": S(80, "%"), "sensor.soc2": S(50, "%") } };
  const t = energyTotals(cfg, hass);
  assert.equal(t.erzeugung, 3100);
  assert.equal(Math.round(t.ertrag * 100) / 100, 9.7);
  assert.equal(t.netz, -300);
  assert.equal(t.einspeisung, 300);
  assert.equal(t.bezug, 0);
  assert.equal(t.speicher.power, 300); // 400 laden, 100 entladen (umgekehrt)
  assert.equal(t.speicher.soc, 70); // nach Kapazität gewichtet
  // Haus = 3100 Erzeugung − 300 Einspeisung − 300 Laden
  assert.equal(t.verbrauch, 2500);
  assert.equal(t.verbrauchCalc, true);
  const v = legacyValues(t);
  assert.equal(v.solar, 3100);
  assert.equal(v.netz, -300);
  assert.equal(v.akku_ladestand, 70);
});

test("Ein Netz-Sensor mit Vorzeichen, Hausverbrauch als Sensor", () => {
  const hass = { states: { "sensor.netz": S(-450), "sensor.haus": S(820) } };
  const t = energyTotals({ netz: "sensor.netz", netz_invert: true, haus: "sensor.haus", sources: [] }, hass);
  assert.equal(t.netz, 450);
  assert.equal(t.bezug, 450);
  assert.equal(t.verbrauch, 820);
  assert.equal(t.verbrauchCalc, false);
  assert.equal(newSource("pv", [{ id: "pv_1", type: "pv" }]).id, "pv_2");
});
