// Vorlagen bekannter Wechselrichter, Speicher und Balkonkraftwerke (ohne DOM, mit node testbar).
// Je Vorlage: Integration(en) in Home Assistant (platform) und typische Endungen der Entitäten. Beim
// Auswählen sucht suggestEntities passende Sensoren dieser Integration – Namen variieren je Anlage,
// deshalb nur Vorschläge (Felder bleiben editierbar).
// invert: Integration meldet Speicherleistung mit + = entladen (Haus 3D erwartet + = laden).

const P = (...r) => r.map((x) => new RegExp(x));

/** {id, name, kinds: pv|bkw|speicher, platforms, model (3D-Typ), capacity?, invert?, roles: {power, energy, soc}} */
export const DEVICE_TEMPLATES = [
  // Hybrid- und String-Wechselrichter (PV und angeschlossener Speicher)
  { id: "fronius", name: "Fronius (Symo GEN24 u. a.)", kinds: ["pv", "speicher"], platforms: ["fronius"], model: "inv_fronius_gen24", invert: true,
    roles: { pv: { power: P("power_photovoltaics$"), energy: P("energy_day$") }, speicher: { power: P("power_battery$"), soc: P("state_of_charge$") } } },
  { id: "sma", name: "SMA (Sunny Tripower / Home Storage)", kinds: ["pv", "speicher"], platforms: ["sma"], model: "inv_sma_stp_se",
    roles: { pv: { power: P("(^|_)pv_power$"), energy: P("daily_yield$") }, speicher: { power: P("battery_power_charge_total$", "battery_power$"), soc: P("battery_soc_total$", "battery_soc$") } } },
  { id: "huawei", name: "Huawei SUN2000 / LUNA2000", kinds: ["pv", "speicher"], platforms: ["huawei_solar"], model: "inv_huawei_sun2000", capacity: 10,
    roles: { pv: { power: P("input_power$"), energy: P("daily_yield$") }, speicher: { power: P("charge_discharge_power$"), soc: P("state_of_capacity$") } } },
  { id: "solaredge", name: "SolarEdge (Home Hub)", kinds: ["pv", "speicher"], platforms: ["solaredge", "solaredge_modbus_multi"], model: "inv_solaredge_hub",
    roles: { pv: { power: P("current_power$", "_i1_ac_power$"), energy: P("energy_today$") }, speicher: { power: P("storage_power$", "_b1_dc_power$"), soc: P("_b1_state_of_energy$", "state_of_energy$") } } },
  { id: "kostal", name: "Kostal PLENTICORE", kinds: ["pv", "speicher"], platforms: ["kostal_plenticore"], model: "inv_kostal_plenticore",
    roles: { pv: { power: P("solar_power$", "dc_sum_power$", "pv_power$"), energy: P("yield_day$") }, speicher: { power: P("battery_power$"), soc: P("battery_soc$", "state_of_charge$") } } },
  { id: "victron", name: "Victron (MultiPlus / GX)", kinds: ["pv", "speicher"], platforms: ["victron", "victron_ble", "modbus"], model: "inv_victron_mp2",
    roles: { pv: { power: P("system_pv_power$", "dc_pv_power$", "pv_power$"), energy: P("yield_today$") }, speicher: { power: P("system_battery_power$", "battery_power$"), soc: P("system_battery_soc$", "battery_soc$") } } },
  { id: "growatt", name: "Growatt (MOD / MIN / NOAH)", kinds: ["pv", "speicher", "bkw"], platforms: ["growatt_server"], model: "inv_growatt_mod",
    roles: { pv: { power: P("solar_production$", "(^|_)ppv$", "output_power$"), energy: P("energy_today$") }, bkw: { power: P("solar_production$", "(^|_)ppv$"), energy: P("energy_today$") }, speicher: { power: P("battery_power$"), soc: P("statement_of_charge$", "(^|_)soc$") } } },
  { id: "sungrow", name: "Sungrow SH-RT", kinds: ["pv", "speicher"], platforms: ["sungrow", "modbus", "sungather"], model: "inv_sungrow_sh",
    roles: { pv: { power: P("total_dc_power$"), energy: P("daily_pv_generation$") }, speicher: { power: P("battery_power$", "battery_charging_power$"), soc: P("battery_level$") } } },
  { id: "goodwe", name: "GoodWe (ET / EH)", kinds: ["pv", "speicher"], platforms: ["goodwe"], model: "inv_goodwe_et", invert: true,
    roles: { pv: { power: P("(^|_)ppv$", "pv_power$"), energy: P("today_s_pv_generation$", "(^|_)e_day$") }, speicher: { power: P("battery_power$"), soc: P("battery_state_of_charge$") } } },
  { id: "deye", name: "Deye Hybrid (Solarman)", kinds: ["pv", "speicher"], platforms: ["solarman"], model: "inv_deye_hybrid", invert: true,
    roles: { pv: { power: P("pv_power$"), energy: P("today_production$", "daily_production$") }, speicher: { power: P("battery_power$"), soc: P("battery_soc$", "_battery$") } } },
  // Speicher
  { id: "tesla", name: "Tesla Powerwall", kinds: ["speicher", "pv"], platforms: ["powerwall", "tesla_fleet", "teslemetry"], model: "bat_tesla_pw3", capacity: 13.5, invert: true,
    roles: { pv: { power: P("solar_power$") }, speicher: { power: P("battery_power$"), soc: P("powerwall_charge$", "(^|_)charge$", "percentage_charged$") } } },
  { id: "sonnen", name: "sonnenBatterie", kinds: ["speicher"], platforms: ["sonnenbatterie", "sonnen"], model: "bat_sonnen10", capacity: 10, invert: true,
    roles: { speicher: { power: P("battery_inout$"), soc: P("battery_percentage_user$", "usoc$") } } },
  { id: "e3dc", name: "E3/DC Hauskraftwerk", kinds: ["speicher", "pv"], platforms: ["e3dc_rscp"], model: "bat_e3dc",
    roles: { pv: { power: P("solar_production$") }, speicher: { power: P("battery_netchange$", "battery_charge$"), soc: P("state_of_charge$") } } },
  { id: "byd", name: "BYD Battery-Box (über Wechselrichter)", kinds: ["speicher"], platforms: ["fronius", "sma", "kostal_plenticore", "solarman"], model: "bat_byd_hvs", capacity: 10.2,
    roles: { speicher: { power: P("power_battery$", "battery_power$"), soc: P("state_of_charge$", "battery_soc$") } } },
  { id: "zendure", name: "Zendure SolarFlow / Hyper", kinds: ["speicher", "bkw"], platforms: ["zendure_ha", "zendure"], model: "bat_zendure_sf800", capacity: 1.92,
    roles: { bkw: { power: P("solar_input_power$") }, speicher: { power: P("output_pack_power$"), soc: P("electric_level$") } } },
  { id: "ecoflow", name: "EcoFlow (PowerStream / STREAM / Delta)", kinds: ["speicher", "bkw"], platforms: ["ecoflow_cloud", "ecoflow"], model: "bat_ecoflow_stream", capacity: 1.92,
    roles: { bkw: { power: P("solar_1_watts$", "solar_in_power$", "pv_in_power$", "inverter_output_watts$") }, speicher: { power: P("battery_input_watts$", "battery_power$"), soc: P("main_battery_level$", "battery_level$", "battery_charge$") } } },
  { id: "marstek", name: "Marstek Venus (AC-Speicher)", kinds: ["speicher"], platforms: ["marstek_local_api", "marstek", "modbus"], model: "bat_marstek_venus", capacity: 5.12,
    roles: { speicher: { power: P("battery_power$"), soc: P("battery_soc$", "(^|_)soc$") } } },
  // Balkonkraftwerke (Mikrowechselrichter)
  { id: "hoymiles", name: "Hoymiles HMS (WLAN)", kinds: ["bkw"], platforms: ["hoymiles_wifi"], model: "micro_hoymiles",
    roles: { bkw: { power: P("ac_power$", "dc_power$"), energy: P("daily_energy$", "ac_daily_energy$") } } },
  { id: "opendtu", name: "OpenDTU / AhoyDTU (MQTT)", kinds: ["bkw"], platforms: ["mqtt"], model: "micro_hoymiles",
    roles: { bkw: { power: P("(^|_)power$"), energy: P("yieldday$", "yield_day$") } } },
  { id: "apsystems", name: "APsystems EZ1", kinds: ["bkw"], platforms: ["apsystems"], model: "micro_apsystems",
    roles: { bkw: { power: P("total_power$"), energy: P("today_production$", "daily_production$") } } },
  { id: "deye_micro", name: "Deye SUN-M (Solarman)", kinds: ["bkw"], platforms: ["solarman"], model: "micro_deye",
    roles: { bkw: { power: P("pv_power$", "output_power$"), energy: P("today_production$", "daily_production$") } } },
];

/** Vorlagen, die zu einer Quellenart passen. */
export const templatesFor = (kind) => DEVICE_TEMPLATES.filter((t) => t.kinds.includes(kind));

const unitOk = (st, role) => {
  const u = String(st?.attributes?.unit_of_measurement ?? "").toLowerCase();
  if (role === "power") return !u || u === "w" || u === "kw";
  if (role === "energy") return !u || u === "kwh" || u === "wh";
  if (role === "soc") return !u || u === "%";
  return true;
};

/**
 * Passende Entitäten einer Vorlage für eine Quellenart: {power, energy, soc} (je erste passende).
 * Entitäten der genannten Integration(en) zuerst; ohne Registry-Infos alle Sensoren.
 * @returns {{values: object, found: number, platformSeen: boolean}}
 */
export function suggestEntities(template, kind, hass) {
  const roles = template?.roles?.[kind] ?? template?.roles?.pv ?? {};
  const ids = Object.keys(hass?.states ?? {}).filter((id) => id.startsWith("sensor.")).sort();
  const reg = hass?.entities ?? {};
  const own = ids.filter((id) => template.platforms.includes(reg[id]?.platform));
  const pool = own.length ? own : Object.keys(reg).length ? [] : ids;
  const values = {};
  let found = 0;
  for (const [role, patterns] of Object.entries(roles)) {
    for (const re of patterns) {
      const hit = pool.find((id) => re.test(id) && unitOk(hass.states[id], role) && !Object.values(values).includes(id));
      if (hit) {
        values[role] = hit;
        found++;
        break;
      }
    }
  }
  return { values, found, platformSeen: own.length > 0 };
}

/** Quelle mit Vorlage füllen: gefundene Entitäten, Vorzeichen, Kapazität, Name (nur wenn noch Standard). */
export function applyTemplate(source, template, hass, defaultName = null) {
  const { values, found, platformSeen } = suggestEntities(template, source.type, hass);
  const next = { ...source, template: template.id };
  for (const [k, v] of Object.entries(values)) next[k] = v;
  if (source.type === "speicher") {
    next.invert = !!template.invert;
    if (template.capacity && !source.capacity) next.capacity = template.capacity;
  }
  if (!source.name || source.name === defaultName) next.name = template.name.replace(/\s*\(.*\)$/, "");
  return { source: next, found, platformSeen };
}
