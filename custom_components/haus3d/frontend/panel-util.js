// Gemeinsame Helfer des Panels (Formatieren, Symbole, Ebenen, Einstellungen).

// Haus 3D – Panel für die Home-Assistant-Seitenleiste.

import * as THREE from "./vendor/three.module.min.js";
import {
  displayKind,
  roomEntities,
  coverClosedFraction,
  domainOf,
  energyValues,
  entitiesByArea,
  buildingIcons,
  buildingLinks,
  iconKind,
  isOpen,
  placesOf,
  roomClimate,
  roomLit,
  roomHeating,
  roomPower,
  VIEW_MODES,
  viewColor,
  dewPoint,
  ventAdvice,
  agoText,
  persons,
  roomPresence,
  groupRoomEntities,
  roomActions,
  stepTarget,
  temperatureColor,
  watchedEntities,
} from "./devices.js";
import { ROOF_TYPES, roofSettings, weatherEntity, weatherKind } from "./exterior.js";
import { exportFile, normalize, parseImport } from "./model.js";
import { SIM_WEATHER, Simulator } from "./sim.js";
import { FUNCTION_KEYS, LEGACY_FUNCTION_KEYS, MAX_CARDS, WHEEL_VISIBLE, labelPlace, nextStyle, migrateView, nextView, normalizeCards, normalizeFunctions, rotateWheel, wheelLayout, wheelPlusAngle } from "./hud.js";
import { entityAction } from "./actions.js";
import { entityPlaces, houseStatus, statusChips } from "./status.js";
import { ALERT_DEFAULTS, evaluateAlerts, exteriorOpenings, normalizeAlerts, visibleAlerts } from "./alerts.js";
import { QUALITY_CHOICES, adaptDpr, resolveQuality } from "./perf.js";
import { HouseScene } from "./scene.js";
import { closeGaps } from "./walls.js";
import { EDITOR_STYLE, FloorEditor } from "./editor.js";
import { PANEL_STYLE } from "./panel-style.js";

export const LONG_PRESS_MS = 550;
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const ENERGY_CORE = [
  ["solar", "mdi:white-balance-sunny", "Solar"],
  ["einspeisung", "mdi:transmission-tower-import", "Einspeisung"],
  ["haus_pv", "mdi:solar-power-variant", "PV Dach"],
  ["netz", "mdi:transmission-tower", "Netz"],
  ["verbrauch", "mdi:home-lightning-bolt-outline", "Verbrauch"],
  ["akku_ladestand", "mdi:battery", "Akku"],
  ["akku_leistung", "mdi:battery-charging", "Akkuleistung"],
  ["ertrag_heute", "mdi:counter", "Ertrag heute"],
];

/** Gruppen der Energie-Einstellungen. */
export const ENERGY_GROUPS = [
  ["Balkonkraftwerk", ["solar", "einspeisung", "ertrag_heute"]],
  ["Haus", ["haus_pv", "netz", "verbrauch"]],
  ["Akku", ["akku_ladestand", "akku_leistung"]],
];

/** Zeilen der Energie-Anzeige: feste Werte des Balkonkraftwerks plus frei gewählte (settings.energy.extra). */
export function energyRows(energy, hass) {
  const rows = ENERGY_CORE.filter(([key]) => energy[key] && hass.states[energy[key]]).map(([key, icon, name]) => ({ key, icon, name, entity: energy[key] }));
  for (const x of energy.extra ?? []) {
    const id = typeof x === "string" ? x : x?.entity;
    const st = id && hass.states[id];
    if (!st) continue;
    rows.push({ key: null, entity: id, name: (typeof x === "object" && x.name) || st.attributes.friendly_name || id, icon: st.attributes.icon ?? SENSOR_ICONS[st.attributes.device_class] ?? "mdi:flash" });
  }
  return rows;
}

/** Ebenen und ihre Namen im Einstellungsfenster. */
export const LAYERS = [
  ["walls", "Wände"],
  ["openings", "Fenster & Türen"],
  ["floors", "Böden"],
  ["furniture", "Möbel"],
  ["garden", "Garten"],
  ["grid", "Raster im Hintergrund"],
  ["roof", "Dach (in „Alle“)"],
  ["weather", "Wetter (Regen, Schnee)"],
  ["shadows", "Schatten der Sonne"],
  ["solar", "Solarmodule"],
  ["flow", "Energiefluss"],
  ["devices", "Geräte"],
  ["labels", "Raumnamen"],
  ["climate", "Temperatur & Feuchte"],
  ["energy", "Energieanzeige"],
  ["status", "Statusleiste (Licht, offen, Schlösser)"],
  ["presence", "Anwesenheit (Personen, Bewegung)"],
  ["sun", "Sonnenstand (Licht aus Richtung der echten Sonne)"],
  ["lightcolor", "Lichtfarbe und Helligkeit übernehmen"],
];

export const DEFAULT_SETTINGS = { style: "auto", deviceMode: "icons", quality: "auto", perfHud: false, layers: Object.fromEntries(LAYERS.map(([k]) => [k, true])) };

export function loadSettings(raw, legacyStyle) {
  let saved = {};
  try {
    saved = JSON.parse(raw ?? "{}") ?? {};
  } catch {
    saved = {};
  }
  const out = { ...DEFAULT_SETTINGS, ...saved, layers: { ...DEFAULT_SETTINGS.layers, ...(saved.layers ?? {}) } };
  if (!raw && legacyStyle === "cyber") out.style = "cyber";
  if (out.style === "standard") out.style = "day";
  return out;
}
export const fmt = (v, digits = 1) => (v == null ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: 0 }));

export const ICONS = {
  light: ["mdi:lightbulb-on", "mdi:lightbulb-outline"],
  switch: ["mdi:toggle-switch", "mdi:toggle-switch-off-outline"],
  fan: ["mdi:fan", "mdi:fan-off"],
  cover: ["mdi:window-shutter-open", "mdi:window-shutter"],
  climate: ["mdi:thermostat", "mdi:thermostat"],
  lock: ["mdi:lock-open-variant", "mdi:lock"],
  camera: ["mdi:cctv", "mdi:cctv"],
  vacuum: ["mdi:robot-vacuum", "mdi:robot-vacuum"],
};
export const CONTACT_ICONS = {
  window: ["mdi:window-open-variant", "mdi:window-closed-variant"],
  door: ["mdi:door-open", "mdi:door-closed"],
  garage_door: ["mdi:garage-open", "mdi:garage"],
  opening: ["mdi:square-outline", "mdi:square"],
};

export const DOMAIN_ICONS = {
  sensor: "mdi:eye-outline",
  binary_sensor: "mdi:checkbox-blank-circle-outline",
  media_player: "mdi:speaker",
  lock: "mdi:lock",
  vacuum: "mdi:robot-vacuum",
  camera: "mdi:cctv",
  scene: "mdi:palette",
  script: "mdi:script-text-outline",
  button: "mdi:gesture-tap-button",
  input_button: "mdi:gesture-tap-button",
  input_boolean: "mdi:toggle-switch-outline",
  automation: "mdi:robot",
  humidifier: "mdi:air-humidifier",
  water_heater: "mdi:water-boiler",
  alarm_control_panel: "mdi:shield-home",
  siren: "mdi:bullhorn",
  number: "mdi:ray-vertex",
  select: "mdi:format-list-bulleted",
  person: "mdi:account",
  device_tracker: "mdi:map-marker",
  weather: "mdi:weather-partly-cloudy",
};
export const SENSOR_ICONS = { temperature: "mdi:thermometer", humidity: "mdi:water-percent", power: "mdi:flash", energy: "mdi:lightning-bolt", battery: "mdi:battery", illuminance: "mdi:brightness-5", motion: "mdi:motion-sensor", occupancy: "mdi:account-eye", carbon_dioxide: "mdi:molecule-co2" };

/** Leistung: unter 1000 W in W, sonst kW. */
export const fmtPower = (w) => (w == null ? "–" : Math.abs(w) < 1000 ? `${fmt(w, 0)} W` : `${fmt(w / 1000, 2)} kW`);

/** Text setzen und bei leerem Text verstecken (nur wenn sich etwas ändert). */
export function setText(el, text) {
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
  const hide = !text;
  if (el.hidden !== hide) el.hidden = hide;
}

export function iconFor(kind, stateObj) {
  if (stateObj.attributes?.icon) return stateObj.attributes.icon;
  if (kind === "other") {
    const domain = stateObj.entity_id.split(".")[0];
    return SENSOR_ICONS[stateObj.attributes?.device_class] ?? DOMAIN_ICONS[domain] ?? "mdi:circle-medium";
  }
  const active = isActive(kind, stateObj);
  if (kind === "contact") return (CONTACT_ICONS[stateObj.attributes.device_class] ?? CONTACT_ICONS.opening)[active ? 0 : 1];
  if (kind === "cover" && stateObj.attributes.device_class === "garage") return CONTACT_ICONS.garage_door[active ? 0 : 1];
  return (ICONS[kind] ?? ["mdi:help-circle-outline"])[active ? 0 : 1];
}

export function isActive(kind, stateObj) {
  if (kind === "cover" || kind === "contact") return isOpen(stateObj);
  if (kind === "other") return ["on", "open", "playing", "unlocked", "cleaning", "home", "heat", "cool"].includes(stateObj.state);
  if (kind === "climate") return !["off", "unavailable", "unknown"].includes(stateObj.state);
  if (kind === "lock") return stateObj.state !== "locked"; // offen = auffällig
  if (kind === "vacuum") return ["cleaning", "returning"].includes(stateObj.state);
  if (kind === "camera") return ["recording", "streaming"].includes(stateObj.state);
  return stateObj.state === "on";
}


