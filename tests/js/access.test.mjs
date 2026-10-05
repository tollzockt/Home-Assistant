// PIN-Feld, Freigabe mit Ablauf, Token an Befehlen, Energie-Karte (Reihenfolge, Ausblenden, Namen)
import assert from "node:assert/strict";
import { test } from "node:test";

import { accessScope, canAdmin, canEdit, clearAccess, newPinError, pinKey, setAccess, withToken } from "../../custom_components/haus3d/frontend/access.js";
import { energyRowList, energyRows } from "../../custom_components/haus3d/frontend/panel-util.js";

test("PIN-Feld: ab 4 Ziffern prüfen, höchstens 8, löschen", () => {
  let p = "";
  for (const k of ["1", "2", "3"]) {
    const r = pinKey(p, k);
    p = r.pin;
    assert.equal(r.check, false);
  }
  assert.deepEqual(pinKey(p, "4"), { pin: "1234", check: true });
  assert.deepEqual(pinKey("12345678", "9"), { pin: "12345678", check: false });
  assert.deepEqual(pinKey("123", "back"), { pin: "12", check: false });
  assert.deepEqual(pinKey("123", "clear"), { pin: "", check: false });
  assert.deepEqual(pinKey("12", "x"), { pin: "12", check: false });
  assert.equal(newPinError("12", "12"), "4 bis 8 Ziffern");
  assert.equal(newPinError("1234", "1235"), "Die beiden Eingaben stimmen nicht überein");
  assert.equal(newPinError("4711", "4711"), null);
});

test("Freigabe: Bereiche, Ablauf nach 10 min, Token am Befehl", () => {
  clearAccess();
  assert.deepEqual(withToken({ type: "x" }), { type: "x" });
  setAccess("t1", "edit", 1000);
  assert.ok(canEdit(1000) && !canAdmin(1000));
  setAccess("t2", "admin", 1000);
  assert.ok(canEdit(2000) && canAdmin(2000));
  assert.equal(accessScope(1000 + 10 * 60000 + 1), null);
  setAccess("t3", "edit");
  assert.equal(withToken({ type: "x" }).token, "t3");
  clearAccess();
});

test("Energie-Karte: Reihenfolge, Ausblenden, eigene Namen, Zusatzwerte", () => {
  const hass = { states: { "sensor.pv": { attributes: {} }, "sensor.bkw": { attributes: {} }, "sensor.netz": { attributes: {} }, "sensor.akku": { attributes: {} }, "sensor.wp": { attributes: { friendly_name: "Wärmepumpe", device_class: "power" } } } };
  const energy = { netz: "sensor.netz", sources: [{ id: "pv_1", type: "pv", name: "Dach", power: "sensor.pv" }, { id: "bkw_1", type: "bkw", name: "Balkon", power: "sensor.bkw" }, { id: "s", type: "speicher", soc: "sensor.akku" }], extra: [{ entity: "sensor.wp" }] };
  assert.deepEqual(energyRows(energy, hass).map((r) => r.id), ["verbrauch", "bezug", "einspeisung", "erzeugung", "akku_ladestand", "src:pv_1", "src:bkw_1", "x:sensor.wp"]);
  const card = { rows: [{ key: "akku_ladestand", name: "Batterie" }, { key: "x:sensor.wp" }, { key: "bezug", hidden: true }] };
  const list = energyRowList(energy, hass, card);
  assert.deepEqual(list.slice(0, 3).map((r) => [r.id, r.hidden]), [["akku_ladestand", false], ["x:sensor.wp", false], ["bezug", true]]);
  const rows = energyRows(energy, hass, card);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.name), ["Batterie", "Wärmepumpe", "Hausverbrauch"]);
  assert.equal(rows[0].key, "akku_ladestand"); // Balken hängt am Schlüssel
  assert.equal(rows[1].key, null);
});
