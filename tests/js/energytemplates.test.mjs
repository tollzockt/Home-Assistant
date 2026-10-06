import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_TEMPLATES, applyTemplate, suggestEntities, templatesFor } from "../../custom_components/haus3d/frontend/energytemplates.js";
import { EXTRA } from "../../custom_components/haus3d/frontend/catalog-extra.js";

const s = (id, state, unit) => ({ entity_id: id, state, attributes: { unit_of_measurement: unit } });
const hass = {
  states: {
    "sensor.solarnet_power_photovoltaics": s("sensor.solarnet_power_photovoltaics", "3200", "W"),
    "sensor.solarnet_energy_day": s("sensor.solarnet_energy_day", "12.4", "kWh"),
    "sensor.solarnet_power_battery": s("sensor.solarnet_power_battery", "-800", "W"),
    "sensor.byd_state_of_charge": s("sensor.byd_state_of_charge", "64", "%"),
    "sensor.fremd_power_photovoltaics": s("sensor.fremd_power_photovoltaics", "1", "W"),
    "sensor.hms_ac_power": s("sensor.hms_ac_power", "540", "W"),
  },
  entities: {
    "sensor.solarnet_power_photovoltaics": { platform: "fronius" },
    "sensor.solarnet_energy_day": { platform: "fronius" },
    "sensor.solarnet_power_battery": { platform: "fronius" },
    "sensor.byd_state_of_charge": { platform: "fronius" },
    "sensor.fremd_power_photovoltaics": { platform: "andere" },
    "sensor.hms_ac_power": { platform: "hoymiles_wifi" },
  },
};

test("Vorlagen: jede hat Rollen für ihre Arten und ein vorhandenes 3D-Modell", () => {
  for (const t of DEVICE_TEMPLATES) {
    assert.ok(EXTRA[t.model], `${t.id}: ${t.model}`);
    for (const k of t.kinds) assert.ok(t.roles[k] || t.roles.pv, `${t.id}/${k}`);
  }
  assert.ok(templatesFor("bkw").some((t) => t.id === "hoymiles"));
  assert.ok(!templatesFor("bkw").some((t) => t.id === "fronius"));
});

test("Vorlagen: Entitäten der Integration vorschlagen, Vorzeichen und Kapazität setzen", () => {
  const fronius = DEVICE_TEMPLATES.find((t) => t.id === "fronius");
  const pv = suggestEntities(fronius, "pv", hass);
  assert.deepEqual(pv.values, { power: "sensor.solarnet_power_photovoltaics", energy: "sensor.solarnet_energy_day" });
  assert.equal(pv.platformSeen, true);
  const bat = applyTemplate({ id: "speicher_1", type: "speicher", name: "AC-Speicher", power: null, soc: null, capacity: null }, DEVICE_TEMPLATES.find((t) => t.id === "byd"), hass, "AC-Speicher");
  assert.equal(bat.source.power, "sensor.solarnet_power_battery");
  assert.equal(bat.source.soc, "sensor.byd_state_of_charge");
  assert.equal(bat.source.capacity, 10.2);
  assert.equal(bat.source.name, "BYD Battery-Box");
  assert.equal(bat.source.template, "byd");
  const fr = applyTemplate({ id: "speicher_2", type: "speicher", name: "Keller", capacity: 7 }, fronius, hass);
  assert.equal(fr.source.invert, true); // Fronius: + = entladen
  assert.equal(fr.source.name, "Keller");
  assert.equal(fr.source.capacity, 7);
  // fehlende Integration: nichts gefunden, nichts erfunden
  const none = applyTemplate({ id: "pv_1", type: "pv", name: "PV-Anlage" }, DEVICE_TEMPLATES.find((t) => t.id === "sma"), hass, "PV-Anlage");
  assert.equal(none.found, 0);
  assert.equal(none.platformSeen, false);
  assert.equal(none.source.power, undefined);
  const bkw = applyTemplate({ id: "bkw_1", type: "bkw", name: "Balkonkraftwerk" }, DEVICE_TEMPLATES.find((t) => t.id === "hoymiles"), hass, "Balkonkraftwerk");
  assert.equal(bkw.source.power, "sensor.hms_ac_power");
});

test("Vorlagen: SENEC und Solarbank finden ihre Sensoren", () => {
  const h = {
    states: Object.fromEntries([
      ["sensor.senec_solar_generated_power", "W"], ["sensor.senec_battery_charge_percent", "%"], ["sensor.senec_battery_state_power", "W"],
      ["sensor.sb_e1600_solar_power", "W"], ["sensor.sb_e1600_state_of_charge", "%"], ["sensor.sb_e1600_battery_power", "W"],
    ].map(([id, u]) => [id, s(id, "1", u)])),
    entities: {
      "sensor.senec_solar_generated_power": { platform: "senec" }, "sensor.senec_battery_charge_percent": { platform: "senec" }, "sensor.senec_battery_state_power": { platform: "senec" },
      "sensor.sb_e1600_solar_power": { platform: ["anker", "solix"].join("_") }, "sensor.sb_e1600_state_of_charge": { platform: ["anker", "solix"].join("_") }, "sensor.sb_e1600_battery_power": { platform: ["anker", "solix"].join("_") },
    },
  };
  const senec = applyTemplate({ id: "speicher_1", type: "speicher", name: "AC-Speicher" }, DEVICE_TEMPLATES.find((t) => t.id === "senec"), h, "AC-Speicher");
  assert.equal(senec.source.soc, "sensor.senec_battery_charge_percent");
  assert.equal(senec.source.power, "sensor.senec_battery_state_power");
  assert.equal(senec.source.capacity, 10);
  const sb = DEVICE_TEMPLATES.find((t) => t.id === "anker");
  assert.equal(applyTemplate({ id: "bkw_1", type: "bkw", name: "Balkonkraftwerk" }, sb, h, "Balkonkraftwerk").source.power, "sensor.sb_e1600_solar_power");
  const bat = applyTemplate({ id: "speicher_2", type: "speicher", name: "AC-Speicher" }, sb, h, "AC-Speicher").source;
  assert.equal(bat.soc, "sensor.sb_e1600_state_of_charge");
  assert.equal(bat.power, "sensor.sb_e1600_battery_power");
});
