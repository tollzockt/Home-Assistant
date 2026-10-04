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
  temperatureColor,
  watchedEntities,
} from "./devices.js";
import { ROOF_TYPES, roofSettings, weatherEntity, weatherKind } from "./exterior.js";
import { exportFile, normalize, parseImport } from "./model.js";
import { SIM_WEATHER, Simulator } from "./sim.js";
import { FUNCTION_KEYS, LEGACY_FUNCTION_KEYS, MAX_CARDS, WHEEL_VISIBLE, labelPlace, nextStyle, normalizeCards, normalizeFunctions, rotateWheel, wheelLayout, wheelPlusAngle } from "./hud.js";
import { entityAction } from "./actions.js";
import { HouseScene } from "./scene.js";
import { closeGaps } from "./walls.js";
import { EDITOR_STYLE, FloorEditor } from "./editor.js";

const LONG_PRESS_MS = 550;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ENERGY_CORE = [
  ["solar", "mdi:white-balance-sunny", "Solar"],
  ["einspeisung", "mdi:transmission-tower-import", "Einspeisung"],
  ["akku_ladestand", "mdi:battery", "Akku"],
  ["akku_leistung", "mdi:battery-charging", "Akkuleistung"],
  ["ertrag_heute", "mdi:counter", "Ertrag heute"],
];

/** Zeilen der Energie-Anzeige: feste Werte des Balkonkraftwerks plus frei gewählte (settings.energy.extra). */
function energyRows(energy, hass) {
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
const LAYERS = [
  ["walls", "Wände"],
  ["openings", "Fenster & Türen"],
  ["floors", "Böden"],
  ["furniture", "Möbel"],
  ["garden", "Garten"],
  ["grid", "Raster im Hintergrund"],
  ["roof", "Dach (in „Alle“)"],
  ["weather", "Wetter (Regen, Schnee)"],
  ["solar", "Solarmodule"],
  ["flow", "Energiefluss"],
  ["devices", "Geräte"],
  ["labels", "Raumnamen"],
  ["climate", "Temperatur & Feuchte"],
  ["energy", "Energieanzeige"],
];

const DEFAULT_SETTINGS = { style: "auto", deviceMode: "icons", layers: Object.fromEntries(LAYERS.map(([k]) => [k, true])) };

function loadSettings(raw, legacyStyle) {
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
const fmt = (v, digits = 1) => (v == null ? "–" : v.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: 0 }));

const ICONS = {
  light: ["mdi:lightbulb-on", "mdi:lightbulb-outline"],
  switch: ["mdi:toggle-switch", "mdi:toggle-switch-off-outline"],
  fan: ["mdi:fan", "mdi:fan-off"],
  cover: ["mdi:window-shutter-open", "mdi:window-shutter"],
  climate: ["mdi:thermostat", "mdi:thermostat"],
};
const CONTACT_ICONS = {
  window: ["mdi:window-open-variant", "mdi:window-closed-variant"],
  door: ["mdi:door-open", "mdi:door-closed"],
  garage_door: ["mdi:garage-open", "mdi:garage"],
  opening: ["mdi:square-outline", "mdi:square"],
};

const DOMAIN_ICONS = {
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
const SENSOR_ICONS = { temperature: "mdi:thermometer", humidity: "mdi:water-percent", power: "mdi:flash", energy: "mdi:lightning-bolt", battery: "mdi:battery", illuminance: "mdi:brightness-5", motion: "mdi:motion-sensor", occupancy: "mdi:account-eye", carbon_dioxide: "mdi:molecule-co2" };

function iconFor(kind, stateObj) {
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

function isActive(kind, stateObj) {
  if (kind === "cover" || kind === "contact") return isOpen(stateObj);
  if (kind === "other") return ["on", "open", "playing", "unlocked", "cleaning", "home", "heat", "cool"].includes(stateObj.state);
  if (kind === "climate") return !["off", "unavailable", "unknown"].includes(stateObj.state);
  return stateObj.state === "on";
}

const STYLE = `
:host {
  display: block;
  /* HA gibt dem Panel-Container keine Höhe vor: volle Fensterhöhe (dvh: mobile Adressleiste) */
  height: 100vh;
  height: 100dvh;
  background: var(--primary-background-color);
  color: var(--primary-text-color);
  font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
  -webkit-tap-highlight-color: transparent;
}
[hidden] { display: none !important; }
.hide-labels .label, .hide-devices .devs, .hide-devices .dev.free, .hide-climate .label .clim { display: none !important; }
.confirm-backdrop { position: absolute; inset: 0; z-index: 12; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
.confirm { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 16px; padding: 18px; width: min(380px, 100%); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.confirm .ct { font-size: 17px; font-weight: 600; line-height: 1.35; }
.confirm .cs { margin-top: 4px; font-size: 13px; color: var(--secondary-text-color); }
.confirm .cb { display: flex; gap: 10px; margin-top: 18px; }
.confirm .cb button { flex: 1; min-height: 56px; border-radius: 12px; border: none; font: inherit; font-size: 16px; cursor: pointer; background: var(--secondary-background-color, #eee); color: inherit; }
.confirm .cb .yes { background: var(--primary-color, #03a9f4); color: #fff; }
.confirm .cb .yes.danger { background: #d32f2f; }
.dialog-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 10; display: flex; align-items: flex-start; justify-content: flex-end; padding: 8px; }
.dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; width: min(440px, 100%); max-height: calc(100% - 16px); overflow: auto; box-shadow: 0 8px 28px rgba(0,0,0,.4); }
.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 6px 6px 16px; font-size: 17px; font-weight: 500; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2)); }
.dialog-body { padding: 4px 16px 16px; }
.dialog h4 { margin: 14px 0 6px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
.seg { display: flex; background: rgba(127,127,127,.15); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { flex: 1; border: none; background: none; color: inherit; font: inherit; padding: 8px; border-radius: 8px; cursor: pointer; min-height: 38px; }
.seg button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
.toggles label { display: flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer; font-size: 14px; }
.toggles input { width: 18px; height: 18px; accent-color: var(--primary-color, #03a9f4); }
.en-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 13px; }
.en-row span { width: 90px; flex: none; color: var(--secondary-text-color); }
.en-row input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.en-row input[data-extra-name] { flex: 0 0 90px; }
.dialog .btns { display: flex; gap: 8px; margin-top: 10px; }
.dialog .btns button { flex: 1; font: inherit; padding: 9px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; }
.dialog .btns .primary { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
.hint { font-size: 12px; color: var(--secondary-text-color); margin: 14px 0 0; }
.roompanel { position: absolute; left: 12px; top: 12px; width: min(320px, calc(100% - 24px)); max-height: 60%; overflow: auto; z-index: 4; touch-action: none;
  background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.rp-head { display: flex; align-items: center; gap: 4px; padding: 4px 4px 0 8px; font-size: 16px; cursor: grab; user-select: none; }
.rp-head b { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-head .grip { color: var(--secondary-text-color); --mdc-icon-size: 18px; }
.rp-check { display: flex; align-items: center; gap: 10px; padding: 6px 14px; min-height: 40px; font-size: 14px; }
.rp-check span { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.rp-check small { color: var(--secondary-text-color); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.rp-check input { width: 20px; height: 20px; accent-color: var(--primary-color, #03a9f4); }
.rp-add { display: flex; gap: 6px; padding: 6px 14px; }
.rp-add input { flex: 1; min-width: 0; font: inherit; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.rp-add button, .rp-btns button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; min-height: 40px; }
.rp-btns { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 14px 14px; }
.rp-btns .primary { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
/* Tablet und Touch: größere Ziele */
@media (pointer: coarse) {
  button.icon { width: 48px; height: 48px; }
  .floors button { min-height: 40px; padding: 8px 16px; font-size: 15px; }
  .dev { width: 42px; height: 42px; --mdc-icon-size: 22px; }
  .rp-row { min-height: 52px; }
  .rp-icon { width: 38px; height: 38px; }
  .toggles label { min-height: 44px; }
  .seg button { min-height: 44px; }
  .energy { font-size: 14px; }
  .energy .row { padding: 5px 0; }
}
.rp-sub { padding: 0 14px 6px; font-size: 12px; color: var(--secondary-text-color); }
.rp-row { display: flex; align-items: center; gap: 10px; padding: 6px 14px; min-height: 44px; cursor: pointer; user-select: none; --mdc-icon-size: 20px; }
.rp-row:hover { background: rgba(127,127,127,.1); }
.rp-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(127,127,127,.15); flex: none; }
.rp-icon.active { background: #ffc107; color: #3b2a00; }
.rp-icon.alert { background: var(--error-color, #db4437); color: #fff; }
.rp-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-state { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; }
.rp-empty { padding: 8px 14px 14px; color: var(--secondary-text-color); font-size: 13px; }
.wrap { display: flex; flex-direction: column; height: 100%; }
header {
  display: flex; align-items: center; gap: 8px;
  min-height: 56px; padding: 0 8px 0 4px;
  padding-top: env(safe-area-inset-top);
  background: var(--app-header-background-color, var(--primary-color));
  color: var(--app-header-text-color, #fff);
  border-bottom: var(--app-header-border-bottom, none);
  box-sizing: border-box; flex-wrap: wrap;
}
header .title { font-size: 20px; font-weight: 400; margin-right: auto; padding-left: 8px; white-space: nowrap; }
button.icon {
  background: none; border: none; color: inherit; cursor: pointer;
  width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
}
button.icon:hover, button.icon:focus-visible { background: rgba(127,127,127,.2); outline: none; }
button.icon.on { background: rgba(255,255,255,.25); }
button.icon.menu { display: none; }
:host([narrow]) button.icon.menu { display: inline-flex; }
.floors { display: inline-flex; background: rgba(0,0,0,.18); border-radius: 18px; padding: 3px; gap: 2px; overflow-x: auto; max-width: 100%; }
.floors button {
  border: none; background: none; color: inherit; font: inherit; font-size: 14px; cursor: pointer;
  padding: 6px 14px; border-radius: 15px; min-height: 32px; white-space: nowrap;
}
.floors button.sel { background: var(--card-background-color, #fff); color: var(--primary-text-color); }
.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
header .floors, header .temp, header .fit { display: none; }
/* Kartenleiste oben rechts: Energie + bis zu 5 eigene Karten, jede einzeln aufklappbar */
.cards { position: absolute; top: 10px; right: 10px; left: 60px; display: flex; flex-direction: row-reverse; flex-wrap: wrap; align-items: flex-start; gap: 8px; pointer-events: none; z-index: 4; }
.cards > * { pointer-events: auto; }
.cards .energy, .cards .card { position: static; }
.card { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: var(--ha-card-border-radius, 12px); padding: 10px 12px; font-size: 13px; min-width: 170px; max-width: 260px; box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.25)); --mdc-icon-size: 18px; }
.card h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; min-height: 32px; }
.card h3 span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card h3 .cedit { opacity: .55; }
.card h3 .cedit:hover { opacity: 1; }
.card .chev, .energy .chev { transition: transform .2s; }
.card.collapsed h3 { margin: 0; }
.card.collapsed .chev { transform: rotate(-90deg); }
.card.collapsed .row { display: none; }
.card .row { display: flex; align-items: center; gap: 8px; padding: 2px 0; cursor: pointer; }
.card .row span { margin-right: auto; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .row b { font-weight: 500; white-space: nowrap; }
.card .short, .energy .short { display: none; font-weight: 500; margin-left: 4px; }
.card.collapsed .short, .energy.collapsed .short { display: inline; }
.cards .addcard { width: 44px; height: 44px; border-radius: 12px; border: 2px dashed var(--primary-color, #03a9f4); background: color-mix(in srgb, var(--card-background-color, #fff) 70%, transparent); color: var(--primary-color, #03a9f4); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
/* Etagen-Leiste rechts */
.floorbar { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 5px; border-radius: 24px; background: color-mix(in srgb, var(--card-background-color, #fff) 92%, transparent); color: var(--primary-text-color); box-shadow: 0 2px 10px rgba(0,0,0,.25); }
.floorbar button { border: none; background: none; color: inherit; font: inherit; font-size: 12px; font-weight: 600; min-width: 46px; min-height: 36px; border-radius: 14px; cursor: pointer; padding: 0 6px; }
.floorbar button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.floorbar button.arrow { min-height: 28px; opacity: .65; --mdc-icon-size: 20px; }
.floorbar button:disabled { opacity: .25; cursor: default; }
/* Rad-Menüs unten links (Kurzwahl) und unten rechts (Funktionen) */
.wheel { position: absolute; bottom: 14px; width: 0; height: 0; z-index: 5; }
.wheel.left { left: 14px; } .wheel.right { right: 14px; }
.wheel .fab { position: absolute; bottom: 0; width: 56px; height: 56px; border-radius: 50%; border: none; background: #fff; color: #222; box-shadow: 0 4px 16px rgba(0,0,0,.35); cursor: pointer; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 26px; }
.wheel.left .fab { left: 0; } .wheel.right .fab { right: 0; }
.wheel .bub { position: absolute; width: 48px; height: 48px; margin: 4px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: var(--card-background-color, #fff); color: var(--primary-text-color); box-shadow: 0 3px 10px rgba(0,0,0,.3); --mdc-icon-size: 22px; transition: left .25s, right .25s, bottom .25s, opacity .25s, transform .25s; opacity: 0; transform: scale(.4); pointer-events: none; }
.wheel.open .bub.vis { opacity: 1; transform: scale(1); pointer-events: auto; }
.wheel .bub.on { background: var(--primary-color, #03a9f4); color: #fff; }
.wheel .bub .lab { position: absolute; white-space: nowrap; font-size: 11px; padding: 2px 7px; border-radius: 8px; background: rgba(0,0,0,.72); color: #fff; pointer-events: none; z-index: 1; }
.wheel .bub .lab.top { bottom: 52px; }
.wheel.left .bub .lab.top { left: 0; } .wheel.right .bub .lab.top { right: 0; }
.wheel .bub .lab.diag { bottom: 44px; }
.wheel.left .bub .lab.diag { left: 36px; } .wheel.right .bub .lab.diag { right: 36px; }
.wheel .bub .lab.side { top: 14px; }
.wheel.left .bub .lab.side { left: 54px; } .wheel.right .bub .lab.side { right: 54px; }
.wheel .bub.plus { border: 2px dashed var(--primary-color, #03a9f4); background: var(--card-background-color, #fff); color: var(--primary-color, #03a9f4); }
.wheel .spin { position: absolute; bottom: 64px; width: 26px; height: 26px; padding: 0; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); color: #fff; --mdc-icon-size: 18px; opacity: 0; pointer-events: none; transition: opacity .2s; }
.wheel.open .spin { opacity: .9; pointer-events: auto; }
.wheel.left .spin.up { left: 70px; bottom: 70px; } .wheel.left .spin.down { left: 100px; bottom: 40px; }
.wheel.right .spin.up { right: 70px; bottom: 70px; } .wheel.right .spin.down { right: 100px; bottom: 40px; }
.qedit .qrow .fixed { flex: 1; font-size: 13px; }
.qedit select.addkey { flex: 1; font: inherit; font-size: 13px; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.legend { left: 50% !important; transform: translateX(-50%); bottom: 80px !important; }
.qedit .qrow { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
.qedit .qrow input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.qedit .qrow input.nm { flex: 0 0 110px; }
.qedit .qrow .qc { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; }
.qedit .qrow .qc input { flex: none; width: auto; }
.pvarr { display: grid; grid-template-columns: 62px 1fr 1fr 66px 1fr 1fr 30px; gap: 4px; align-items: center; font-size: 12px; margin: 3px 0; }
.pvarr input, .pvarr select { font: inherit; font-size: 12px; padding: 5px 3px; border-radius: 6px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: var(--primary-text-color); min-width: 0; }
.pvarr.head { color: var(--secondary-text-color); }
.house-cfg .swatches { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px 96px; }
.house-cfg .swatches button { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); padding: 0; cursor: pointer; }
.house-cfg .rc-reset { font: inherit; font-size: 12px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; }
.house-cfg input[type=color] { width: 44px; height: 30px; padding: 2px; flex: none; }
.pvrow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.pvrow label { display: flex; flex-direction: column; font-size: 12px; color: var(--secondary-text-color); }
.pvrow input { font: inherit; padding: 6px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: var(--primary-text-color); }
.simbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; max-width: calc(100% - 24px); padding: 6px 10px; border-radius: 12px; background: repeating-linear-gradient(135deg, #ff9800 0 12px, #fb8c00 12px 24px); color: #1b1b1b; font-size: 13px; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
.simbar b { letter-spacing: .08em; }
.simbar select, .simbar input[type=range] { font: inherit; font-size: 12px; border-radius: 6px; border: none; padding: 3px; max-width: 130px; }
.simbar label { display: inline-flex; align-items: center; gap: 4px; }
.simbar button { font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 7px; border: none; background: rgba(0,0,0,.75); color: #fff; cursor: pointer; }
.simdlg .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.simdlg input[type=number], .simdlg input[type=text] { flex: 1; min-width: 0; font: inherit; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.simdlg input[type=range] { flex: 1; }
.canvas { position: absolute; inset: 0; }
.overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.room {
  position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: opacity .2s;
}
.devs { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 168px; }
.label {
  background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent);
  color: var(--primary-text-color); border-radius: 8px; padding: 3px 8px;
  font-size: 12px; line-height: 1.3; text-align: center; white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: opacity .2s;
}
.label b { font-weight: 500; font-size: 13px; }
.label .clim { color: var(--secondary-text-color); }
.label .warn { color: var(--error-color, #db4437); font-weight: 500; }
.dev {
  position: relative; width: 36px; height: 36px; flex: none;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--card-background-color, #fff); color: var(--secondary-text-color);
  box-shadow: 0 1px 4px rgba(0,0,0,.35); pointer-events: auto; cursor: pointer;
  touch-action: none; user-select: none; -webkit-user-select: none; transition: opacity .2s;
  --mdc-icon-size: 20px;
}
.dev.free { position: absolute; left: 0; top: 0; }
.dev.active { background: #ffc107; color: #3b2a00; }
.dev.alert { background: var(--error-color, #db4437); color: #fff; }
.dev.unavailable { opacity: .45; }
.hidden-behind { opacity: .15 !important; }
.hidden-behind, .hidden-behind .dev { pointer-events: none !important; }
.energy {
  position: absolute; right: 12px; top: 12px; min-width: 180px;
  background: var(--card-background-color, #fff); color: var(--primary-text-color);
  border-radius: var(--ha-card-border-radius, 12px); padding: 10px 12px; font-size: 13px;
  box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.25));
  --mdc-icon-size: 18px;
}
.energy h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; min-height: 32px; }
.energy h3 span { flex: 1; }
.energy .chev { transition: transform .2s; }
.energy.collapsed h3 { margin: 0; }
.energy.collapsed .chev { transform: rotate(-90deg); }
.energy .row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.energy .row span:nth-child(2) { margin-right: auto; color: var(--secondary-text-color); }
.energy .row b { font-weight: 500; }
.energy.collapsed .row { display: none; }
.legend {
  position: absolute; left: 12px; bottom: 12px; padding: 8px 10px; border-radius: 10px; font-size: 12px;
  background: var(--card-background-color, #fff); box-shadow: 0 1px 4px rgba(0,0,0,.25);
}
.legend .bar { width: 160px; height: 10px; border-radius: 5px; margin: 4px 0 2px; }
.legend .ticks { display: flex; justify-content: space-between; color: var(--secondary-text-color); }
.toast {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  background: #323232; color: #fff; padding: 10px 16px; border-radius: 6px; font-size: 14px;
  max-width: calc(100% - 32px); box-shadow: 0 2px 8px rgba(0,0,0,.4); z-index: 7;
}
/* in der Simulation liegt die Simbar unten: Meldungen darüber */
.stage.has-simbar .toast { bottom: 72px; }
.msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; color: var(--secondary-text-color); }
.popup {
  position: absolute; right: 8px; top: 8px; z-index: 6; min-width: 220px;
  background: var(--card-background-color, #fff); color: var(--primary-text-color);
  border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.35); padding: 6px 0; font-size: 14px;
}
.popup button {
  display: flex; align-items: center; gap: 12px; width: 100%; border: none; background: none; color: inherit;
  font: inherit; text-align: left; padding: 10px 16px; cursor: pointer; min-height: 44px;
}
.popup button:hover { background: rgba(127,127,127,.15); }
.popup .head { padding: 8px 16px; font-weight: 500; }
.popup .item { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 16px; }
.popup .item span { margin-right: auto; font-size: 13px; }
.popup .item button { width: auto; padding: 6px 10px; min-height: 36px; color: var(--primary-color); }
.popup .scroll { max-height: 50vh; overflow-y: auto; }
:host([night]) .label { background: rgba(14,20,44,.85); color: #e3e8ff; }
:host([night]) .label .clim { color: #aab4e8; }
:host([cyber]) { background: #07030f; }
:host([cyber]) header { background: linear-gradient(90deg, #12052a, #07030f 60%, #1a0630); color: #e0f7ff; border-bottom: 1px solid #ff2bd6; box-shadow: 0 0 12px rgba(255,43,214,.35); }
:host([cyber]) header .title { font-family: "Orbitron", "Rajdhani", var(--paper-font-body1_-_font-family, sans-serif); letter-spacing: .12em; text-transform: uppercase; text-shadow: 0 0 8px #00e5ff; }
:host([cyber]) .floors { background: rgba(0,229,255,.08); border: 1px solid rgba(0,229,255,.35); }
:host([cyber]) .floors button.sel { background: #00e5ff; color: #07030f; box-shadow: 0 0 10px #00e5ff; }
:host([cyber]) button.icon.on { background: rgba(255,43,214,.3); box-shadow: 0 0 10px #ff2bd6; }
:host([cyber]) .label { background: rgba(10,4,25,.85); color: #e0f7ff; border: 1px solid #00e5ff; box-shadow: 0 0 8px rgba(0,229,255,.55); text-shadow: 0 0 6px rgba(0,229,255,.8); }
:host([cyber]) .label .clim { color: #ff8af0; }
:host([cyber]) .dev { background: #12082a; color: #ff8af0; border: 1px solid #ff2bd6; box-shadow: 0 0 8px rgba(255,43,214,.6); }
:host([cyber]) .dev.active { background: #ffd000; color: #1a0630; border-color: #fff176; box-shadow: 0 0 14px #ffd000; }
:host([cyber]) .dev.alert { background: #ff1744; color: #fff; box-shadow: 0 0 14px #ff1744; }
:host([cyber]) .dialog, :host([cyber]) .roompanel { background: rgba(10,4,25,.95); color: #e0f7ff; border: 1px solid #00e5ff; box-shadow: 0 0 18px rgba(0,229,255,.4); }
:host([cyber]) .seg button.sel { background: #ff2bd6; box-shadow: 0 0 10px #ff2bd6; }
:host([cyber]) .rp-icon.active { background: #ffd000; box-shadow: 0 0 10px #ffd000; }
:host([cyber]) .energy, :host([cyber]) .legend, :host([cyber]) .popup { background: rgba(10,4,25,.92); color: #e0f7ff; border: 1px solid #ff2bd6; box-shadow: 0 0 14px rgba(255,43,214,.45); }
:host([cyber]) .energy .row span:nth-child(2) { color: #8f7dff; }
:host([cyber]) .energy .row b { color: #00e5ff; text-shadow: 0 0 6px #00e5ff; }
@media (max-width: 600px) {
  header .title { display: none; }
  .label { font-size: 11px; padding: 2px 6px; }
  .label b { font-size: 12px; }
  .dev { width: 32px; height: 32px; --mdc-icon-size: 18px; }
  .devs { max-width: 140px; gap: 3px; }
  .energy { right: 8px; top: 8px; min-width: 0; padding: 8px 10px; }
  .floors { order: 0; }
}
`;

class Haus3DPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._building = null;
    this._revision = null;
    this._tempMode = false;
    this._filter = "all";
    try {
      this._filter = localStorage.getItem("haus3d.filter") || "all";
      this._tempMode = localStorage.getItem("haus3d.temp") === "1";
      this._settings = loadSettings(localStorage.getItem("haus3d.settings"), localStorage.getItem("haus3d.style"));
    } catch {
      /* ohne Speicher */
    }
    this._overlays = new Map(); // key -> {el, position: Vector3, floorId}
    this._watched = [];
    this._watchedRefs = [];
  }

  set hass(real) {
    this._realHass = real;
    // Simulation: Schicht über dem echten hass, nichts geht an Home Assistant
    const hass = this._sim ? this._sim.wrap(real, { building: this._building, onChange: () => this._simChanged(), onToast: (t) => this._toast(t) }) : real;
    const prev = this._hass;
    this._hass = hass;
    if (!this._built) return;
    if (!prev || prev.themes?.darkMode !== hass.themes?.darkMode) this._applyTheme();
    if (!prev || prev.states?.["sun.sun"] !== hass.states?.["sun.sun"]) this._applyStyle();
    if (!prev || prev.user?.is_admin !== hass.user?.is_admin) this._renderToolbar();
    if (!this._building) return;
    if (!prev || prev.entities !== hass.entities || prev.devices !== hass.devices) {
      this._refreshEntities();
      return;
    }
    this._applyWeather();
    const changed = this._watchedChanged();
    if (changed === "membership") this._refreshEntities();
    else if (changed) this._updateStates();
  }

  /** Regen/Schnee aus der Wetter-Entität (settings.weather, sonst die erste weather.*). */
  _applyWeather() {
    const id = weatherEntity(this._hass, this._building?.settings);
    const st = id ? this._hass.states[id] : null;
    if (st === this._weatherRef && id === this._weatherId) return;
    this._weatherRef = st;
    this._weatherId = id;
    this._scene?.setWeather(weatherKind(st));
  }

  get hass() {
    return this._realHass ?? this._hass;
  }

  // ------------------------------------------------------------------ Simulation

  /** Simulation an/aus. Beim Start wird der Grundriss kopiert; beim Beenden der echte neu geladen. */
  async _setSim(on) {
    this._settings.sim = !!on;
    this._saveSettings();
    if (on && !this._sim) {
      this._sim = new Simulator();
      if (this._building) {
        this._simBase = structuredClone(this._building); // echter Stand, für Beispielgeräte an/aus
        this._sim.building = structuredClone(this._building);
        this._sim.revision = this._revision ?? 0;
        if (this._settings.simDemo) this._sim.makeDemo(this._sim.building, this._realHass);
        this._setBuilding(this._sim.building, this._sim.revision, { keepCamera: true });
      }
      this._toast("Simulation an: nichts wird wirklich geschaltet oder gespeichert.");
    } else if (!on && this._sim) {
      this._sim = null;
      this.hass = this._realHass;
      this._toast("Simulation beendet, echte Zustände.");
      await this._load();
    }
    this._renderSimBar();
    this._simChanged();
  }

  _simChanged() {
    if (this._realHass) this.hass = this._realHass;
  }

  _renderSimBar() {
    this._simBar?.remove();
    this._simBar = null;
    this._els?.stage.classList.toggle("has-simbar", !!this._sim);
    if (!this._sim || !this._els) return;
    const sim = this._sim;
    const el = document.createElement("div");
    el.className = "simbar";
    el.innerHTML = `<b>SIMULATION</b>
      <label>Wetter <select data-sim="weather">${SIM_WEATHER.map(([k, n]) => `<option value="${k}"${k === sim.weather ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Tageszeit <select data-sim="daytime">${[["", "wie echt"], ["day", "Tag"], ["night", "Nacht"]].map(([k, n]) => `<option value="${k}"${k === sim.daytime ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Solar <input type="range" min="0" max="1600" step="20" data-sim="solar" value="${sim.solar ?? 0}"><span class="sv">${sim.solar === null ? "echt" : `${sim.solar} W`}</span></label>
      <label><input type="checkbox" data-sim="demo"${this._settings.simDemo ? " checked" : ""}> Beispielgeräte</label>
      <button data-sim="reset">Zurücksetzen</button><button data-sim="stop">Beenden</button>`;
    el.querySelector("[data-sim=weather]").addEventListener("change", (ev) => {
      sim.weather = ev.target.value;
      sim._cache = null;
      this._simChanged();
    });
    el.querySelector("[data-sim=daytime]").addEventListener("change", (ev) => {
      sim.daytime = ev.target.value;
      sim._cache = null;
      this._simChanged();
    });
    el.querySelector("[data-sim=solar]").addEventListener("input", (ev) => {
      sim.solar = Number(ev.target.value);
      sim._cache = null;
      el.querySelector(".sv").textContent = `${sim.solar} W`;
      this._simChanged();
    });
    el.querySelector("[data-sim=demo]").addEventListener("change", (ev) => {
      this._settings.simDemo = ev.target.checked;
      this._saveSettings();
      // frische Kopie des Grundrisses (Beispielgeräte vergeben Bereiche nur in der Kopie)
      sim.clearDemo();
      sim.building = structuredClone(this._simBase ?? this._building);
      const n = this._settings.simDemo ? sim.makeDemo(sim.building, this._realHass) : 0;
      this._setBuilding(sim.building, sim.revision, { keepCamera: true });
      this._simChanged();
      if (this._settings.simDemo) this._toast(n === 1 ? "1 Raum ohne Geräte hat Beispielgeräte bekommen." : n ? `${n} Räume ohne Geräte haben Beispielgeräte bekommen.` : "Alle Räume haben schon Geräte.");
    });
    el.querySelector("[data-sim=reset]").addEventListener("click", () => {
      sim.reset();
      this._renderSimBar();
      this._simChanged();
    });
    el.querySelector("[data-sim=stop]").addEventListener("click", () => this._setSim(false));
    this._els.stage.appendChild(el);
    this._simBar = el;
  }

  /** Dialog statt „Weitere Infos“: Zustand des Geräts in der Simulation setzen. */
  _simDialog(entityId) {
    this._closeDialog();
    const st = this._hass.states[entityId];
    const domain = domainOf(entityId);
    const name = st?.attributes?.friendly_name ?? entityId;
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const onOff = ["light", "switch", "fan", "input_boolean", "binary_sensor", "automation", "siren", "humidifier"].includes(domain);
    const cls = st?.attributes?.device_class;
    const labels = domain === "binary_sensor" && ["window", "door", "opening", "garage_door"].includes(cls) ? ["Offen", "Zu"] : ["An", "Aus"];
    let body = "";
    if (onOff) body = `<div class="btns"><button data-set="on" class="${st?.state === "on" ? "primary" : ""}">${labels[0]}</button><button data-set="off" class="${st?.state !== "on" ? "primary" : ""}">${labels[1]}</button></div>`;
    else if (domain === "cover") body = `<div class="btns"><button data-svc="open_cover">Auf</button><button data-svc="close_cover">Zu</button></div><div class="row"><span>Position</span><input type="range" min="0" max="100" step="5" data-pos value="${st?.attributes?.current_position ?? (st?.state === "open" ? 100 : 0)}"><span class="pv">${st?.attributes?.current_position ?? ""} %</span></div>`;
    else if (domain === "lock") body = `<div class="btns"><button data-svc="unlock">Aufschließen</button><button data-svc="lock">Abschließen</button></div>`;
    else if (domain === "climate") body = `<div class="row"><span>Soll</span><input type="number" step="0.5" data-temp value="${st?.attributes?.temperature ?? 21}"><button data-act="temp">Setzen</button></div>`;
    else body = `<div class="row"><input type="${/^-?\d+(\.\d+)?$/.test(st?.state ?? "") ? "number" : "text"}" step="any" data-val value="${esc(st?.state ?? "")}"><button data-act="val">Setzen</button></div>`;
    el.innerHTML = `<div class="dialog simdlg" role="dialog" aria-label="Simulation">
      <div class="dialog-head"><span>${esc(name)}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body"><p class="hint">Simulation: ${esc(entityId)} ist gerade „${esc(st?.state ?? "unbekannt")}“. Änderungen bleiben in der Simulation.</p>${body}</div></div>`;
    const done = () => {
      this._simChanged();
      this._closeDialog();
    };
    el.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => {
      this._sim.set(entityId, b.dataset.set, {}, st);
      done();
    }));
    el.querySelectorAll("[data-svc]").forEach((b) => b.addEventListener("click", () => this._hass.callService(domain, b.dataset.svc, { entity_id: entityId }).then(() => this._closeDialog())));
    el.querySelector("[data-pos]")?.addEventListener("change", (ev) => this._hass.callService("cover", "set_cover_position", { entity_id: entityId, position: Number(ev.target.value) }).then(() => this._closeDialog()));
    el.querySelector("[data-act=temp]")?.addEventListener("click", () => this._hass.callService("climate", "set_temperature", { entity_id: entityId, temperature: Number(el.querySelector("[data-temp]").value) }).then(() => this._closeDialog()));
    el.querySelector("[data-act=val]")?.addEventListener("click", () => {
      this._sim.set(entityId, el.querySelector("[data-val]").value, {}, st);
      done();
    });
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  }

  set narrow(value) {
    this.toggleAttribute("narrow", !!value);
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    if (!this._built) this._build();
    if (!this._editor) this._scene?.start();
    if (!this._building && !this._loading) this._load();
  }

  disconnectedCallback() {
    this._scene?.stop();
  }

  // ------------------------------------------------------------------ Aufbau

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}${EDITOR_STYLE}</style>
      <div class="wrap">
        <header>
          <button class="icon menu" title="Menü"><ha-icon icon="mdi:menu"></ha-icon></button>
          <div class="title">Haus 3D</div>
          <div class="floors" role="tablist" aria-label="Etage"></div>
          <button class="icon temp" title="Temperaturansicht"><ha-icon icon="mdi:thermometer"></ha-icon></button>
          <button class="icon fit" title="Ansicht zurücksetzen"><ha-icon icon="mdi:fit-to-screen-outline"></ha-icon></button>
          <button class="icon edit" title="Bearbeiten" hidden><ha-icon icon="mdi:pencil-ruler"></ha-icon></button>
          <button class="icon more" title="Daten" hidden><ha-icon icon="mdi:dots-vertical"></ha-icon></button>
          <button class="icon gear" title="Einstellungen"><ha-icon icon="mdi:cog"></ha-icon></button>
        </header>
        <div class="stage">
          <div class="canvas"></div>
          <div class="overlay"></div>
          <div class="msg">Lade Grundriss …</div>
          <div class="cards"></div>
          <div class="floorbar" role="tablist" aria-label="Etage"></div>
          <div class="wheel left"></div>
          <div class="wheel right"></div>
        </div>
      </div>
      <input type="file" accept="application/json,.json" hidden>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      floors: $(".floors"),
      cards: $(".cards"),
      floorbar: $(".floorbar"),
      wheelL: $(".wheel.left"),
      wheelR: $(".wheel.right"),
      temp: $(".temp"),
      more: $(".more"),
      stage: $(".stage"),
      canvas: $(".canvas"),
      overlay: $(".overlay"),
      msg: $(".msg"),
      file: $("input[type=file]"),
    };
    $(".menu").addEventListener("click", () => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })));
    $(".fit").addEventListener("click", () => this._scene?.fitCamera());
    $(".edit").addEventListener("click", () => this._openEditor());
    $(".gear").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._openSettings();
    });
    this._applyOverlayLayers();
    this._bindCanvas();
    this.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        this._closeDialog();
        this._selectRoom(null);
      }
    });
    this._els.temp.addEventListener("click", () => {
      this._tempMode = !this._tempMode;
      this._store("haus3d.temp", this._tempMode ? "1" : "0");
      this._renderToolbar();
      this._updateStates();
    });
    this._els.more.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._toggleMenu();
    });
    this._els.file.addEventListener("change", () => this._importFile());
    this.shadowRoot.addEventListener("click", (ev) => {
      if (this._popup && !ev.composedPath().includes(this._popup)) this._closePopup();
    });

    try {
      this._scene = new HouseScene(this._els.canvas, {
        dark: !!this._hass?.themes?.darkMode,
        onCameraChange: () => this._positionOverlays(),
      });
      this._scene.setLayers(this._settings.layers);
    } catch (err) {
      this._showMessage(`3D-Darstellung nicht möglich (WebGL fehlt?): ${err.message}`);
    }
    this._renderToolbar();
  }

  async _load() {
    if (!this._hass) {
      // hass kommt kurz nach connectedCallback
      setTimeout(() => this._load(), 100);
      return;
    }
    this._loading = true;
    try {
      const res = await this._hass.callWS({ type: "haus3d/building/get" });
      this._setBuilding(res.building, res.revision);
      // Simulation war in diesem Browser an: wieder starten (Band oben zeigt es deutlich)
      if (this._settings.sim && !this._sim) this._setSim(true);
    } catch (err) {
      this._showMessage(`Grundriss konnte nicht geladen werden: ${err.message ?? err.code ?? err}`);
    } finally {
      this._loading = false;
    }
  }

  _setBuilding(building, revision, { keepCamera = false } = {}) {
    this._building = normalize(building);
    this._revision = revision;
    if (!this._building.floors.length) {
      this._showMessage("Noch kein Grundriss vorhanden. Als Admin über ⋮ → Importieren eine JSON-Datei einlesen.");
    } else if (this._scene) {
      this._els.msg.hidden = true;
    }
    if (this._scene) {
      this._scene.filter = this._filter; // wird in setBuilding gegen die Etagen geprüft
      this._scene.setBuilding(this._building, { keepCamera });
      if (this._scene.warnings.length) console.warn("Haus 3D:", this._scene.warnings);
      if (!this._editor) this._scene.start();
      this._weatherRef = undefined;
      this._applyWeather();
    }
    this._renderToolbar();
    this._refreshEntities();
  }

  _applyTheme() {
    if (!this._scene) return;
    this._scene.setTheme(!!this._hass.themes?.darkMode);
    // Wandfarben hängen vom Modus ab und stecken in der Geometrie: einmal neu bauen
    if (this._building) {
      this._scene.setBuilding(this._building, { keepCamera: true });
      this._lastStatesKey = null;
      this._updateStates();
    }
  }

  _showMessage(text) {
    this._els.msg.textContent = text;
    this._els.msg.hidden = false;
  }

  _toast(text) {
    this._toastEl?.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = text;
    // über der Simulationsleiste (sie kann zweizeilig sein)
    if (this._simBar?.isConnected) el.style.bottom = `${this._simBar.offsetHeight + 26}px`;
    this._els.stage.appendChild(el);
    this._toastEl = el;
    setTimeout(() => el.remove(), 4000);
  }

  _store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ohne Speicher */
    }
  }

  _renderToolbar() {
    if (!this._els) return;
    const floors = [...(this._building?.floors ?? [])].sort((a, b) => a.elevation - b.elevation);
    const options = [{ id: "all", name: "Alle" }, ...floors.map((f) => ({ id: f.id, name: f.name }))];
    if (this._building && !options.some((o) => o.id === this._filter)) this._filter = "all";
    this._els.floors.replaceChildren(
      ...options.map((o) => {
        const b = document.createElement("button");
        b.textContent = o.name;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(o.id === this._filter));
        b.classList.toggle("sel", o.id === this._filter);
        b.addEventListener("click", () => this._setFilter(o.id));
        return b;
      }),
    );
    this._els.floors.hidden = floors.length < 2;
    this._renderFloorbar(options);
    this._renderWheels();
    this._els.temp.classList.toggle("on", this._tempMode);
    this._els.more.hidden = !this._hass?.user?.is_admin;
    this.shadowRoot.querySelector(".edit").hidden = !this._hass?.user?.is_admin || !this._scene;
  }

  _setFilter(id) {
    this._filter = id;
    if (id !== "all" && (this._panels ?? []).some((p) => p.floorId !== id)) {
      for (const p of this._panels.filter((x) => x.floorId !== id)) p.el?.remove();
      this._panels = this._panels.filter((x) => x.floorId === id);
      this._scene?.selectRooms(this._panels.map((p) => ({ floorId: p.floorId, roomId: p.roomId })), { focus: false });
    }
    this._store("haus3d.filter", id);
    this._scene?.setFilter(id, { fit: true });
    this._renderToolbar();
    this._positionOverlays();
  }

  // ------------------------------------------------------------------ Entitäten und Zustände

  _refreshEntities() {
    const hass = this._hass;
    if (!hass || !this._building) return;
    this._byArea = entitiesByArea(hass);
    this._links = buildingLinks(this._building, hass, this._byArea);
    this._computeWatched();
    this._buildOverlays();
    this._updateStates();
  }

  /** Beobachtete Entitäten neu bestimmen (eine Stelle: devices.js:watchedEntities). */
  _computeWatched() {
    const hass = this._hass;
    this._watched = watchedEntities(this._building, hass, this._byArea, { links: this._links, extra: this._extraWatched?.() ?? [] });
    this._watchedRefs = this._watched.map((id) => hass.states[id]);
  }

  /** Günstig neu beobachten (z. B. geöffnetes Raumfenster), ohne Beschriftungen neu aufzubauen. */
  _rewatch() {
    if (!this._hass || !this._building || !this._byArea) return;
    this._computeWatched();
  }

  /** false, true (Zustand geändert) oder "membership" (eine beobachtete Entität kam oder ging). */
  _watchedChanged() {
    const states = this._hass.states;
    let changed = false;
    for (let i = 0; i < this._watched.length; i++) {
      const s = states[this._watched[i]];
      const old = this._watchedRefs[i];
      if (s !== old) {
        this._watchedRefs[i] = s;
        if (!s !== !old) return "membership";
        changed = true;
      }
    }
    return changed;
  }

  _buildOverlays() {
    const layer = this._els.overlay;
    layer.replaceChildren();
    this._overlays.clear();
    this._iconEls = [];
    const hass = this._hass;
    if (!this._scene) return; // ohne 3D keine Beschriftungen, die Fehlermeldung bleibt sichtbar
    const allIcons = buildingIcons(this._building, hass, this._byArea);
    // Geräte als 3D-Objekte statt Symbole: gleiche Positionen, Lampen unter der Decke
    const threeD = this._settings.deviceMode === "3d";
    const devices3d = [];
    if (threeD) {
      for (const floor of this._building.floors) {
        for (const icon of allIcons.get(floor.id) ?? []) {
          const y = icon.y ?? (icon.kind === "light" ? (floor.height ?? 2.5) - 0.25 : icon.kind === "climate" ? 0.6 : 1.1);
          devices3d.push({ entity_id: icon.entity_id, kind: icon.kind, stateObj: hass.states[icon.entity_id], floorId: floor.id, x: icon.x, y, z: icon.z });
        }
      }
    }
    this._scene.setDevices(devices3d);
    for (const floor of this._building.floors) {
      const elev = floor.elevation ?? 0;
      const icons = allIcons.get(floor.id) ?? [];
      for (const room of placesOf(floor)) {
        // Raumkarte über dem Raum: Name, Klima und die automatisch platzierten Geräte als Reihe
        const anchor = this._scene?.anchors.find((a) => a.key === `room:${floor.id}:${room.id}`);
        const el = document.createElement("div");
        el.className = "room";
        el.innerHTML = `<div class="label"></div><div class="devs"></div>`;
        const devs = el.querySelector(".devs");
        if (!threeD) for (const icon of icons.filter((i) => i.room === room.id && !i.manual)) devs.appendChild(this._iconEl(icon));
        layer.appendChild(el);
        const pos = anchor?.position.clone() ?? new THREE.Vector3(0, elev, 0);
        pos.y += 0.95; // knapp 1 m über dem Boden (bei Hängen über der Fläche)
        this._overlays.set(`room:${floor.id}:${room.id}`, { el, label: el.firstElementChild, floorId: floor.id, position: pos, room });
      }
      // Geräte mit manueller Position (placements) stehen frei an ihrer Stelle
      for (const icon of icons.filter((i) => i.manual && !threeD)) {
        const el = this._iconEl(icon);
        el.classList.add("free");
        layer.appendChild(el);
        this._overlays.set(`icon:${floor.id}:${icon.entity_id}`, { el, floorId: floor.id, position: new THREE.Vector3(icon.x, elev + (icon.y ?? 1.3), icon.z), free: true });
      }
    }
    this._energyEl?.remove();
    this._energyEl = null;
    const rows = energyRows(this._building.settings?.energy ?? {}, hass);
    if (rows.length) {
      const el = document.createElement("div");
      el.className = "energy";
      el.innerHTML = `<h3><ha-icon icon="mdi:lightning-bolt-circle"></ha-icon><span>Energie</span><ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></h3>` +
        rows.map((r, i) => `<div class="row" data-i="${i}"><ha-icon icon="${r.icon}"></ha-icon><span></span><b></b></div>`).join("");
      rows.forEach((r, i) => (el.querySelector(`.row[data-i="${i}"] span`).textContent = r.name));
      el.querySelector("h3").addEventListener("click", () => {
        this._energyCollapsed = el.classList.toggle("collapsed");
        this._cardState({ energie: this._energyCollapsed });
      });
      el.querySelectorAll(".row").forEach((row) => {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => this._moreInfo(rows[Number(row.dataset.i)].entity));
      });
      // eingeklappt bleibt eingeklappt (auch nach Neuaufbau); Standard: auf schmalen Bildschirmen zu
      const collapsed = this._energyCollapsed ?? this._cardState().energie ?? !!window.matchMedia?.("(max-width: 600px)").matches;
      el.classList.toggle("collapsed", collapsed);
      el.querySelector("h3 span").insertAdjacentHTML("afterend", `<b class="short"></b>`);
      if (this._hass?.user?.is_admin) {
        el.querySelector(".chev").insertAdjacentHTML("beforebegin", `<ha-icon class="cedit" icon="mdi:pencil-outline" title="Anpassen"></ha-icon>`);
        el.querySelector(".cedit").addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._openSettings();
          setTimeout(() => this._dialog?.querySelector(".energy-cfg")?.scrollIntoView({ block: "start" }), 50);
        });
      }
      this._els.cards.appendChild(el);
      this._energyEl = el;
      this._energyRows = rows;
      el.hidden = this._settings.layers.energy === false;
    }
    this._renderCards();
    this._positionOverlays();
  }

  _iconEl(icon) {
    const el = document.createElement("div");
    el.className = "dev";
    el.innerHTML = `<ha-icon></ha-icon>`;
    this._bindIcon(el, icon.entity_id);
    this._iconEls.push({ el, icon });
    return el;
  }

  _bindIcon(el, entityId) {
    let timer = null;
    let longPressed = false;
    let start = null;
    el.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      // Rechts-/Mittelklick schalten nie (Rechtsklick öffnet über contextmenu den Dialog)
      if (ev.pointerType === "mouse" && ev.button !== 0) {
        start = null;
        return;
      }
      longPressed = false;
      start = [ev.clientX, ev.clientY];
      clearTimeout(timer);
      timer = setTimeout(() => {
        longPressed = true;
        this._moreInfo(entityId);
      }, LONG_PRESS_MS);
    });
    const cancel = () => clearTimeout(timer);
    el.addEventListener("pointermove", (ev) => {
      if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 10) cancel();
    });
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerup", (ev) => {
      ev.stopPropagation();
      cancel();
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if (longPressed || !start) return;
      if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 10) return;
      start = null;
      this._activate(entityId);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      cancel();
      longPressed = true;
      this._moreInfo(entityId);
    });
  }

  /** Tipp auf ein Gerät im Haus (Bubble, Raumfenster, 3D-Objekt, Karte). */
  _activate(entityId) {
    return this._runAction(entityId, { source: "tap" });
  }

  /**
   * Eine Aktion ausführen (actions.js): heikle Aktionen fragen nach, Automationen nur aus der Kurzwahl.
   * hass wird erst beim Ausführen gelesen (Simulation kann inzwischen an/aus sein).
   */
  async _runAction(entityId, { source = "tap", name = null, confirm = false, quiet = source === "tap" } = {}) {
    const st = this._hass?.states[entityId];
    const label = name || st?.attributes?.friendly_name || entityId;
    const safety = this._building?.settings?.safety?.confirm !== false;
    const act = entityAction(entityId, st, { source, safety, confirm });
    if (act.dialog || !act.call) return this._moreInfo(entityId);
    if (act.confirm) {
      const where = this._placeText?.(entityId);
      const ok = await this._confirm(`${label} ${act.confirm.question}?`, act.confirm.ok, { danger: act.confirm.danger, sub: where });
      if (!ok) return;
    }
    try {
      await this._hass.callService(act.call[0], act.call[1], { entity_id: entityId, ...act.data });
      if (!quiet || act.confirm) this._toast(`${label}: ${act.verb}`);
    } catch (err) {
      this._toast(`Fehlgeschlagen: ${err.message ?? err}`);
    }
  }

  /** „EG · Flur“: wo eine Entität im Haus liegt (über ihren Bereich oder eine verknüpfte Öffnung). */
  _placeText(entityId) {
    const b = this._building;
    if (!b) return "";
    const area = this._hass?.entities?.[entityId]?.area_id;
    for (const f of b.floors ?? []) {
      for (const r of f.rooms ?? []) if (area && r.area_id === area) return `${f.name} · ${r.name}`;
      for (const o of f.openings ?? []) {
        if (o.contact !== entityId && o.cover !== entityId) continue;
        const r = (f.rooms ?? []).find((x) => x.id === o.room_id);
        return r ? `${f.name} · ${r.name}` : f.name;
      }
    }
    return "";
  }

  /**
   * Eigene Nachfrage (statt window.confirm): großer Abbrechen-Knopf hat den Fokus, Esc oder Tipp
   * daneben bricht ab, nach 15 s automatisch abgebrochen.
   * @returns {Promise<boolean>}
   */
  _confirm(text, okLabel = "OK", { danger = false, sub = "" } = {}) {
    this._confirmEl?._finish?.(false);
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "confirm-backdrop";
      el.innerHTML = `<div class="confirm" role="alertdialog" aria-modal="true" aria-label="${esc(text)}">
        <div class="ct">${esc(text).replace(/\n/g, "<br>")}</div>${sub ? `<div class="cs">${esc(sub)}</div>` : ""}
        <div class="cb"><button class="no">Abbrechen</button><button class="yes${danger ? " danger" : ""}">${esc(okLabel)}</button></div></div>`;
      let timer = null;
      const finish = (v) => {
        clearTimeout(timer);
        document.removeEventListener("keydown", onKey, true);
        el.remove();
        if (this._confirmEl === el) this._confirmEl = null;
        resolve(v);
      };
      const onKey = (ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          finish(false);
        }
      };
      el._finish = finish;
      // der Klick, der zum Tipp gehört, kommt erst nach pointerup an: kurz nichts annehmen
      const born = performance.now();
      const ready = () => performance.now() - born > 400;
      el.addEventListener("click", (ev) => {
        if (ev.target === el && ready()) finish(false);
      });
      el.querySelector(".no").addEventListener("click", () => ready() && finish(false));
      el.querySelector(".yes").addEventListener("click", () => ready() && finish(true));
      document.addEventListener("keydown", onKey, true);
      timer = setTimeout(() => finish(false), 15000);
      (this._els?.stage ?? this.shadowRoot).appendChild(el);
      this._confirmEl = el;
      el.querySelector(".no").focus();
    });
  }

  _moreInfo(entityId) {
    if (this._sim) return this._simDialog(entityId);
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _updateStates() {
    const hass = this._hass;
    if (!hass || !this._building || !this._byArea) return;
    const lit = new Set();
    const temps = new Map();
    const open = new Set();
    const covers = new Map();
    const roomAlerts = new Map();
    // Kontakte, die irgendeiner Öffnung (auf irgendeiner Etage) zugeordnet sind
    const linkedContacts = new Set([...this._links.values()].flatMap((m) => [...m.values()].map((l) => l.contact)).filter(Boolean));
    for (const floor of this._building.floors) {
      const links = this._links.get(floor.id);
      for (const o of floor.openings) {
        const l = links.get(o.id);
        if (!l) continue;
        const key = `${floor.id}:${o.id}`;
        if (l.contact && isOpen(hass.states[l.contact])) open.add(key);
        if (l.cover) {
          const st = hass.states[l.cover];
          covers.set(key, coverClosedFraction(st));
          if (o.type === "garage" && isOpen(st)) open.add(key);
        }
      }
      for (const room of placesOf(floor)) {
        const key = `${floor.id}:${room.id}`;
        if (roomLit(room, hass, this._byArea)) lit.add(key);
        const climate = roomClimate(room, hass, this._byArea);
        temps.set(key, climate.temperature);
        // offene Kontakte im Bereich, die keiner Öffnung zugeordnet sind
        const unassigned = (this._byArea.get(room.area_id) ?? []).filter(
          (id) => !linkedContacts.has(id) && iconKind(hass.states[id]) === "contact" && isOpen(hass.states[id]),
        );
        roomAlerts.set(key, unassigned.length);
        const ov = this._overlays.get(`room:${key}`);
        if (ov) {
          const label = ov.label;
          const parts = [];
          if (climate.temperature != null) parts.push(`${fmt(climate.temperature)} °C`);
          if (climate.humidity != null) parts.push(`${fmt(climate.humidity, 0)} %`);
          label.innerHTML = `<b></b>${parts.length ? `<div class="clim">${parts.join(" · ")}</div>` : ""}${unassigned.length ? `<div class="warn">${unassigned.length} offen</div>` : ""}`;
          label.querySelector("b").textContent = room.name;
        }
      }
    }
    const energy = energyValues(this._building.settings, hass);
    const onEntities = new Set(this._watched.filter((id) => hass.states[id]?.state === "on"));
    this._scene?.applyStates({ lit, temps, tempMode: this._tempMode, tempColor: temperatureColor, open, covers, feedIn: energy.einspeisung, onEntities });
    this._renderRoomPanel();

    for (const { el, icon } of this._iconEls) {
      const st = hass.states[icon.entity_id];
      if (!st) continue;
      const active = isActive(icon.kind, st);
      el.classList.toggle("active", active && icon.kind !== "contact");
      el.classList.toggle("alert", active && icon.kind === "contact");
      el.classList.toggle("unavailable", st.state === "unavailable");
      el.firstElementChild.setAttribute("icon", iconFor(icon.kind, st));
      el.title = `${st.attributes.friendly_name ?? st.entity_id}: ${hass.formatEntityState ? hass.formatEntityState(st) : st.state}`;
    }

    if (this._energyEl) {
      for (const row of this._energyEl.querySelectorAll(".row")) {
        const r = this._energyRows[Number(row.dataset.i)];
        const v = energy[r.key];
        const text = r.key
          ? { solar: `${fmt(v, 0)} W`, einspeisung: `${fmt(v, 0)} W`, akku_ladestand: `${fmt(v, 0)} %`, akku_leistung: `${fmt(v, 0)} W`, ertrag_heute: `${fmt(v, 2)} kWh` }[r.key]
          : hass.states[r.entity] ? (hass.formatEntityState ? hass.formatEntityState(hass.states[r.entity]) : hass.states[r.entity].state) : "–";
        row.querySelector("b").textContent = text;
      }
      // eingeklappt: erster Wert als Kurzanzeige
      const first = this._energyEl.querySelector(".row b");
      const short = this._energyEl.querySelector(".short");
      if (short) short.textContent = first?.textContent ?? "";
    }
    this._updateCards();
    this._updateWheelStates();
    this._renderLegend();
  }

  // ------------------------------------------------------------------ Editor

  _openEditor() {
    if (this._editor || !this._building) return;
    this._closePopup();
    this._closeDialog();
    this._selectRoom(null);
    const floorId = this._filter !== "all" ? this._filter : [...this._building.floors].sort((a, b) => a.elevation - b.elevation).find((f) => f.height >= 1)?.id;
    this._editor = new FloorEditor({
      container: this._els.stage,
      building: this._building,
      hass: this._hass,
      floorId,
      sceneStyle: this._appliedStyle === "cyber" ? "cyber" : this._appliedStyle === "night" ? "night" : "standard",
      dark: !!this._hass.themes?.darkMode,
      onSave: async (building) => {
        try {
          const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
          this._setBuilding(res.building, res.revision, { keepCamera: true });
          this._toast("Gespeichert.");
        } catch (err) {
          if (err.code === "conflict") throw new Error("Der Stand wurde inzwischen woanders geändert. Bitte Seite neu laden.");
          throw err;
        }
      },
      confirm: (text, ok, o) => this._confirm(text, ok, o),
      onClose: () => {
        this._editor?.destroy();
        this._editor = null;
        this._els.overlay.hidden = false;
        this._scene?.start();
        this._refreshEntities();
      },
    });
    // Hauptansicht ruht, solange der Editor offen ist (der hat seine eigene 3D-Ansicht)
    this._scene?.stop();
  }

  // ------------------------------------------------------------------ Einstellungen

  /** Tatsächlicher Stil: bei "auto" Tag/Nacht nach dem Sonnenstand (sun.sun). */
  _effectiveStyle() {
    const st = this._settings.style;
    if (st !== "auto") return st;
    return this._hass?.states?.["sun.sun"]?.state === "below_horizon" ? "night" : "day";
  }

  _applyStyle() {
    const style = this._effectiveStyle();
    if (style === this._appliedStyle) return;
    this._appliedStyle = style;
    this.toggleAttribute("cyber", style === "cyber");
    this.toggleAttribute("night", style === "night");
    this._scene?.setStyle(style);
    this._scene?.setLayers(this._settings.layers);
    if (this._building) this._refreshEntities();
  }

  _saveSettings() {
    this._store("haus3d.settings", JSON.stringify(this._settings));
  }

  _applyOverlayLayers() {
    const l = this._settings.layers;
    const ov = this._els?.overlay;
    if (!ov) return;
    ov.classList.toggle("hide-labels", l.labels === false);
    ov.classList.toggle("hide-climate", l.climate === false);
    ov.classList.toggle("hide-devices", l.devices === false);
    if (this._energyEl) this._energyEl.hidden = l.energy === false;
    this._renderWheels?.();
  }

  _openSettings() {
    this._closePopup();
    this._closeDialog();
    const st = this._settings;
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `
      <div class="dialog" role="dialog" aria-label="Einstellungen">
        <div class="dialog-head"><span>Einstellungen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <h4>Darstellung</h4>
          <div class="seg" data-key="style">
            <button data-value="auto">Auto</button><button data-value="day">Tag</button><button data-value="night">Nacht</button><button data-value="cyber">Cyberpunk</button>
          </div>
          <h4>Geräte anzeigen als</h4>
          <div class="seg" data-key="deviceMode">
            <button data-value="icons">Symbole</button><button data-value="3d">3D-Objekte</button>
          </div>
          <h4>Einblenden</h4>
          <div class="toggles">
            ${LAYERS.map(([k, name]) => `<label><input type="checkbox" data-layer="${k}"${st.layers[k] !== false ? " checked" : ""}><span>${name}</span></label>`).join("")}
          </div>
          <p class="hint">Darstellung und Einblenden gelten für dieses Gerät/diesen Browser.</p>
          <h4>Simulation</h4>
          <p class="hint">Zum Ausprobieren: Schalten, Wetter, Tag/Nacht und Solarleistung werden nur simuliert, nichts geht an echte Geräte, der Grundriss wird nicht gespeichert.</p>
          <div class="btns"><button class="simtoggle${this._sim ? "" : " primary"}">${this._sim ? "Simulation beenden" : "Simulation starten"}</button></div>
          ${this._hass?.user?.is_admin ? `<h4>Haus & Wetter (für alle)</h4><div class="house-cfg"></div><h4>Energie-Anzeige (für alle)</h4><div class="energy-cfg"></div>` : ""}
        </div>
      </div>`;
    const syncSeg = () => {
      for (const seg of el.querySelectorAll(".seg")) for (const b of seg.querySelectorAll("button")) b.classList.toggle("sel", st[seg.dataset.key] === b.dataset.value);
    };
    syncSeg();
    for (const seg of el.querySelectorAll(".seg")) {
      seg.addEventListener("click", (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        st[seg.dataset.key] = b.dataset.value;
        syncSeg();
        this._saveSettings();
        if (seg.dataset.key === "style") this._applyStyle();
        else this._refreshEntities();
      });
    }
    for (const box of el.querySelectorAll("input[data-layer]")) {
      box.addEventListener("change", () => {
        st.layers[box.dataset.layer] = box.checked;
        this._saveSettings();
        this._scene?.setLayers(st.layers);
        this._applyOverlayLayers();
      });
    }
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    el.querySelector(".simtoggle").addEventListener("click", () => {
      this._closeDialog();
      this._setSim(!this._sim);
    });
    const cfg = el.querySelector(".energy-cfg");
    if (cfg) this._renderEnergyConfig(cfg);
    const house = el.querySelector(".house-cfg");
    if (house) this._renderHouseConfig(house);
    this._els.stage.appendChild(el);
    this._dialog = el;
  }

  /** Gemeinsame Einstellungen speichern (ins Gebäude, mit Revision). */
  async _saveBuildingSettings(patch, message) {
    const building = structuredClone(this._building);
    building.settings = { ...(building.settings ?? {}), ...patch };
    try {
      const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
      this._setBuilding(res.building, res.revision, { keepCamera: true });
      this._toast(message);
    } catch (err) {
      this._toast(`Speichern fehlgeschlagen: ${err.message ?? err.code}`);
    }
  }

  /** Dach (Form, Neigung, Überstand, Firstrichtung) und Wetter-Entität. */
  _renderHouseConfig(box) {
    const hass = this._hass;
    const roof = roofSettings(this._building?.settings);
    const weather = this._building?.settings?.weather ?? "";
    const weathers = Object.keys(hass.states).filter((id) => id.startsWith("weather.")).sort();
    const pvItems = (roof.items ?? []).some((it) => it?.type === "pv");
    box.innerHTML = `
      <label class="en-row"><span>Dach</span><select data-r="type">${ROOF_TYPES.map(([k, n]) => `<option value="${k}"${k === roof.type ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="en-row"><span>Neigung (°)</span><input data-r="pitch" type="number" min="5" max="60" step="1" value="${roof.pitch}"></label>
      <label class="en-row"><span>Überstand (m)</span><input data-r="overhang" type="number" min="0" max="1.5" step="0.05" value="${roof.overhang}"></label>
      <label class="en-row"><span>Dachfarbe</span><input type="color" data-rc value="${/^#[0-9a-f]{6}$/i.test(roof.color ?? "") ? roof.color : "#9a4a36"}"><button class="rc-reset" title="Standardfarbe">Standard</button></label>
      <div class="swatches">${["#9a4a36", "#b5523b", "#6e2f25", "#4a3b32", "#3a3d42", "#23262b", "#5f6670", "#8c8f94", "#2f4f3f", "#3f5a78"].map((c) => `<button data-rcs="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div>
      <label class="en-row"><span>Flügel-Ende</span><select data-r="wing_end"><option value="gable"${roof.wing_end !== "hip" ? " selected" : ""}>Giebel</option><option value="hip"${roof.wing_end === "hip" ? " selected" : ""}>Walm (abgeschrägt)</option></select></label>
      <label class="en-row"><span>First</span><select data-r="direction">${[["auto", "lange Seite"], ["x", "Ost–West im Plan"], ["z", "Nord–Süd im Plan"]].map(([k, n]) => `<option value="${k}"${k === roof.direction ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="en-row" title="Haustür aufschließen, Garagentor öffnen/schließen, Sirene einschalten"><span>Nachfragen</span><span class="chk"><input type="checkbox" data-safety${this._building?.settings?.safety?.confirm === false ? "" : " checked"}> bei Schloss, Garagentor, Sirene</span></label>
      <label class="en-row"><span>Wetter</span><select data-w>
        <option value=""${weather === "" ? " selected" : ""}>automatisch${weathers[0] ? ` (${esc(weathers[0])})` : ""}</option>
        <option value="none"${weather === "none" ? " selected" : ""}>kein Wetter</option>
        ${weathers.map((id) => `<option value="${esc(id)}"${id === weather ? " selected" : ""}>${esc(hass.states[id].attributes.friendly_name ?? id)}</option>`).join("")}
      </select></label>
      ${pvItems ? `<p class="hint">PV, Kamin und Dachfenster sitzen frei verschiebbar auf dem Dach: Bearbeiten → Ebene „Dach“.</p>` : `<p class="hint">Genauer und verschiebbar: Bearbeiten → Ebene „Dach“ (dort lässt sich diese PV übernehmen).</p>`}
      <div class="pvlegacy"${pvItems ? " hidden" : ""}>
      <h4>PV auf dem Dach (Anzahl Module je Richtung)</h4>
      <div class="pvrow">${[["E", "Ost"], ["S", "Süd"], ["W", "West"], ["N", "Nord"]].map(([k, n]) => `<label><span>${n}</span><input type="number" min="0" max="60" step="1" data-pv="${k}" value="${Number(roof.solar?.[k]) || 0}"></label>`).join("")}</div>
      <h4>PV-Felder (genaue Anordnung, ersetzt die Anzahl oben)</h4>
      <div class="pvarrays"></div>
      <div class="btns"><button class="pvadd">+ PV-Feld</button></div>
      </div>
      <label class="en-row"><span>Norden</span><select data-north>${[[0, "oben im Plan"], [90, "rechts im Plan"], [180, "unten im Plan"], [270, "links im Plan"]].map(([v, n]) => `<option value="${v}"${Number(this._building?.settings?.north ?? 0) === v ? " selected" : ""}>${n}</option>`).join("")}${[0, 90, 180, 270].includes(Number(this._building?.settings?.north ?? 0)) ? "" : `<option value="${this._building.settings.north}" selected>${this._building.settings.north}°</option>`}</select></label>
      <p class="hint">Das Dach erscheint nur in der Ansicht „Alle“. Wählt man eine Etage, schaut man hinein. Module liegen auf den Dachflächen, die in die Richtung zeigen (L-Dach: Hauptdach und Flügel).</p>
      <div class="btns"><button class="house-save primary">Speichern</button></div>`;
    // PV-Felder: Richtung, Spalten × Reihen, hoch/quer, Abstand von links (von außen gesehen), ab Reihe
    const arrays = structuredClone(roof.solar_arrays ?? []);
    const arrBox = box.querySelector(".pvarrays");
    const dirs = [["S", "Süd"], ["E", "Ost"], ["W", "West"], ["N", "Nord"]];
    const drawArrays = () => {
      arrBox.innerHTML = (arrays.length ? `<div class="pvarr head"><span>Richtung</span><span>Spalten</span><span>Reihen</span><span>Lage</span><span>von links (m)</span><span>ab Reihe</span><span></span></div>` : `<p class="hint">Keine Felder: Module werden nach der Anzahl je Richtung verteilt.</p>`) +
        arrays.map((a, i) => `<div class="pvarr" data-i="${i}"><select data-k="dir">${dirs.map(([k, n]) => `<option value="${k}"${k === a.dir ? " selected" : ""}>${n}</option>`).join("")}</select><input type="number" min="1" max="20" data-k="cols" value="${a.cols ?? 2}"><input type="number" min="1" max="10" data-k="rows" value="${a.rows ?? 1}"><select data-k="orient"><option value="portrait"${a.orient !== "landscape" ? " selected" : ""}>hoch</option><option value="landscape"${a.orient === "landscape" ? " selected" : ""}>quer</option></select><input type="number" min="0" step="0.1" data-k="left" value="${a.left ?? 0.3}"><input type="number" min="0" max="10" data-k="row" value="${a.row ?? 0}"><button class="icon" data-rm="${i}" title="Feld entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("");
      arrBox.querySelectorAll(".pvarr[data-i] [data-k]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const a = arrays[Number(inp.closest(".pvarr").dataset.i)];
          a[inp.dataset.k] = inp.tagName === "SELECT" ? inp.value : Number(inp.value);
        }),
      );
      arrBox.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        arrays.splice(Number(b.dataset.rm), 1);
        drawArrays();
      }));
    };
    drawArrays();
    box.querySelector(".pvadd").addEventListener("click", () => {
      arrays.push({ dir: "S", cols: 3, rows: 2, orient: "portrait", left: 0.3, row: 0 });
      drawArrays();
    });
    let roofColor = roof.color ?? null;
    const colorInput = box.querySelector("[data-rc]");
    colorInput.addEventListener("input", () => (roofColor = colorInput.value));
    box.querySelector(".rc-reset").addEventListener("click", () => (roofColor = null));
    box.querySelectorAll("[data-rcs]").forEach((b) =>
      b.addEventListener("click", () => {
        roofColor = b.dataset.rcs;
        colorInput.value = roofColor;
      }),
    );
    box.querySelector(".house-save").addEventListener("click", () => {
      const next = { ...(this._building?.settings?.roof ?? {}) };
      if (roofColor) next.color = roofColor;
      else delete next.color;
      if (!pvItems) next.solar = Object.fromEntries([...box.querySelectorAll("[data-pv]")].map((i) => [i.dataset.pv, Math.max(0, Math.round(Number(i.value) || 0))]));
      if (!pvItems) next.solar_arrays = arrays.map((a) => ({ dir: a.dir ?? "S", cols: Math.max(1, Math.round(a.cols ?? 1)), rows: Math.max(1, Math.round(a.rows ?? 1)), orient: a.orient === "landscape" ? "landscape" : "portrait", left: Math.max(0, Number(a.left) || 0), row: Math.max(0, Math.round(a.row ?? 0)) }));
      for (const inp of box.querySelectorAll("[data-r]")) next[inp.dataset.r] = inp.type === "number" ? Number(inp.value) : inp.value;
      const w = box.querySelector("[data-w]").value;
      const r = roofSettings({ roof: next }); // begrenzt Neigung und Überstand
      const roof = { ...next, type: r.type, pitch: r.pitch, overhang: r.overhang, direction: r.direction };
      const safety = { ...(this._building?.settings?.safety ?? {}), confirm: box.querySelector("[data-safety]").checked };
      this._saveBuildingSettings({ roof, weather: w || null, north: Number(box.querySelector("[data-north]").value) || 0, safety }, "Dach und Wetter gespeichert.");
    });
  }

  /** Energie-Anzeige einstellen: feste Werte des Balkonkraftwerks und zusätzliche Entitäten. */
  _renderEnergyConfig(box) {
    const hass = this._hass;
    const energy = structuredClone(this._building?.settings?.energy ?? {});
    energy.extra = [...(energy.extra ?? [])].map((x) => (typeof x === "string" ? { entity: x } : x));
    const opts = `<datalist id="en-all">${Object.keys(hass.states).filter((id) => /^(sensor|binary_sensor|input_number|number)\./.test(id)).sort().map((id) => `<option value="${esc(id)}">${esc(hass.states[id].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>`;
    const render = () => {
      box.innerHTML = `${ENERGY_CORE.map(([k, , name]) => `<label class="en-row"><span>${name}</span><input list="en-all" data-core="${k}" value="${esc(energy[k] ?? "")}" placeholder="– keine –"></label>`).join("")}
        ${energy.extra.map((x, i) => `<div class="en-row"><input data-extra-name="${i}" value="${esc(x.name ?? "")}" placeholder="Name"><input list="en-all" data-extra="${i}" value="${esc(x.entity ?? "")}"><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
        ${opts}
        <div class="btns"><button class="en-add">+ Wert hinzufügen</button><button class="en-save primary">Speichern</button></div>`;
      box.querySelectorAll("[data-core]").forEach((i) => i.addEventListener("change", () => (energy[i.dataset.core] = i.value.trim() || null)));
      box.querySelectorAll("[data-extra]").forEach((i) => i.addEventListener("change", () => (energy.extra[Number(i.dataset.extra)].entity = i.value.trim())));
      box.querySelectorAll("[data-extra-name]").forEach((i) => i.addEventListener("change", () => (energy.extra[Number(i.dataset.extraName)].name = i.value.trim() || undefined)));
      box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        energy.extra.splice(Number(b.dataset.rm), 1);
        render();
      }));
      box.querySelector(".en-add").addEventListener("click", () => {
        energy.extra.push({ entity: "" });
        render();
      });
      box.querySelector(".en-save").addEventListener("click", async () => {
        const building = structuredClone(this._building);
        building.settings.energy = { ...energy, extra: energy.extra.filter((x) => x.entity) };
        try {
          const res = await hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
          this._setBuilding(res.building, res.revision, { keepCamera: true });
          this._toast("Energie-Anzeige gespeichert.");
        } catch (err) {
          this._toast(`Speichern fehlgeschlagen: ${err.message ?? err.code}`);
        }
      });
    };
    render();
  }

  _closeDialog() {
    this._dialog?.remove();
    this._dialog = null;
  }

  // ------------------------------------------------------------------ Klicks in die 3D-Szene, Raumauswahl

  _bindCanvas() {
    const target = this._els.canvas;
    let down = null;
    let timer = null;
    target.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      down = { x: ev.clientX, y: ev.clientY, t: performance.now(), long: false };
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!down) return;
        const hit = this._scene?.pick(down.x, down.y);
        if (hit?.entity_id) {
          down.long = true;
          this._moreInfo(hit.entity_id);
        }
      }, LONG_PRESS_MS);
    });
    target.addEventListener("pointermove", (ev) => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 8) {
        clearTimeout(timer);
        down = null;
      }
    });
    target.addEventListener("pointercancel", () => {
      clearTimeout(timer);
      down = null;
    });
    target.addEventListener("pointerup", (ev) => {
      clearTimeout(timer);
      const d = down;
      down = null;
      if (!d || d.long || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 8) return;
      const hit = this._scene?.pick(ev.clientX, ev.clientY);
      if (hit?.entity_id) this._activate(hit.entity_id);
      else if (hit?.roomId) {
        // erst die Etage wählen, dann den Raum: in "Alle" führt ein Klick zur Etage des Raums
        if (this._filter === "all") this._setFilter(hit.floorId);
        this._selectRoom(hit, { toggle: true });
      }
    });
    target.addEventListener("contextmenu", (ev) => {
      const hit = this._scene?.pick(ev.clientX, ev.clientY);
      if (hit?.entity_id) {
        ev.preventDefault();
        this._moreInfo(hit.entity_id);
      }
    });
  }

  /** Raum öffnen/schließen (null = alle schließen). Bis zu 3 Raumfenster gleichzeitig. */
  _selectRoom(sel, { toggle = false } = {}) {
    this._panels = this._panels ?? [];
    if (!sel) {
      for (const p of this._panels) p.el.remove();
      this._panels = [];
    } else {
      const i = this._panels.findIndex((p) => p.floorId === sel.floorId && p.roomId === sel.roomId);
      if (i >= 0 && toggle) {
        this._panels[i].el.remove();
        this._panels.splice(i, 1);
      } else if (i < 0) {
        this._panels.push({ floorId: sel.floorId, roomId: sel.roomId, el: null, editing: false });
        while (this._panels.length > 3) this._panels.shift().el?.remove();
      }
    }
    this._selected = this._panels.at(-1) ?? null;
    this._scene?.selectRooms(this._panels.map((p) => ({ floorId: p.floorId, roomId: p.roomId })), { focus: !!sel && !toggle });
    this._renderRoomPanel();
  }

  /** Raumfenster: Name, Klima und alle Geräte des Raums; verschiebbar, mit "Geräte anpassen" für Admins. */
  _renderRoomPanel() {
    this._panels = this._panels ?? [];
    const hass = this._hass;
    this._panels = this._panels.filter((p) => {
      const floor = this._building?.floors.find((f) => f.id === p.floorId);
      const room = floor && placesOf(floor).find((r) => r.id === p.roomId);
      if (!room) p.el?.remove();
      return !!room;
    });
    this._panels.forEach((p, idx) => {
      if (p.editing) return; // Eingaben nicht überschreiben
      const floor = this._building.floors.find((f) => f.id === p.floorId);
      const room = placesOf(floor).find((r) => r.id === p.roomId);
      if (!p.el) {
        p.el = document.createElement("div");
        p.el.className = "roompanel";
        const stage = this._els.stage.getBoundingClientRect();
        p.x = p.x ?? 12 + idx * 28;
        p.y = p.y ?? Math.max(12, stage.height - 360 - idx * 28);
        this._els.stage.appendChild(p.el);
        this._dragPanel(p);
      }
      p.el.style.left = `${p.x}px`;
      p.el.style.top = `${p.y}px`;
      const ids = roomEntities(room, hass, this._byArea, this._building).filter((id) => displayKind(hass.states[id]));
      const climate = roomClimate(room, hass, this._byArea);
      const parts = [];
      if (climate.temperature != null) parts.push(`${fmt(climate.temperature)} °C`);
      if (climate.humidity != null) parts.push(`${fmt(climate.humidity, 0)} %`);
      const admin = !!hass.user?.is_admin;
      p.el.innerHTML = `<div class="rp-head"><ha-icon class="grip" icon="mdi:drag"></ha-icon><b></b>${admin ? `<button class="icon cfg" title="Geräte anpassen"><ha-icon icon="mdi:tune-variant"></ha-icon></button>` : ""}<button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="rp-sub"></div><div class="rp-list"></div>`;
      p.el.querySelector("b").textContent = room.name;
      p.el.querySelector(".rp-sub").textContent = [floor.name, ...parts].join(" · ") + (room.area_id ? "" : " · kein Bereich zugeordnet");
      p.el.querySelector(".close").addEventListener("click", () => this._selectRoom({ floorId: p.floorId, roomId: p.roomId }, { toggle: true }));
      p.el.querySelector(".cfg")?.addEventListener("click", () => this._customizeRoom(p, room));
      const list = p.el.querySelector(".rp-list");
      if (!ids.length) list.innerHTML = `<div class="rp-empty">Keine Geräte. Über ⚙ hinzufügen.</div>`;
      for (const id of ids) {
        const st = hass.states[id];
        const kind = displayKind(st);
        const row = document.createElement("div");
        row.className = "rp-row";
        row.dataset.entity = id;
        const active = isActive(kind, st);
        row.innerHTML = `<span class="rp-icon${active ? (kind === "contact" ? " alert" : " active") : ""}"><ha-icon></ha-icon></span><span class="rp-name"></span><span class="rp-state"></span>`;
        row.querySelector("ha-icon").setAttribute("icon", iconFor(kind, st));
        row.querySelector(".rp-name").textContent = st.attributes.friendly_name ?? id;
        row.querySelector(".rp-state").textContent = hass.formatEntityState ? hass.formatEntityState(st) : st.state;
        this._bindIcon(row, id);
        list.appendChild(row);
      }
    });
  }

  /** Raumfenster am Kopf ziehen (Maus und Finger); bleibt im sichtbaren Bereich. */
  _dragPanel(p) {
    let start = null;
    p.el.addEventListener("pointerdown", (ev) => {
      if (!ev.target.closest(".rp-head") || ev.target.closest("button")) return;
      ev.preventDefault();
      p.el.setPointerCapture(ev.pointerId);
      start = { x: ev.clientX, y: ev.clientY, px: p.x, py: p.y };
      // nach vorn holen
      this._els.stage.appendChild(p.el);
    });
    p.el.addEventListener("pointermove", (ev) => {
      if (!start) return;
      const stage = this._els.stage.getBoundingClientRect();
      p.x = Math.max(0, Math.min(stage.width - 120, start.px + ev.clientX - start.x));
      p.y = Math.max(0, Math.min(stage.height - 48, start.py + ev.clientY - start.y));
      p.el.style.left = `${p.x}px`;
      p.el.style.top = `${p.y}px`;
    });
    const end = () => (start = null);
    p.el.addEventListener("pointerup", end);
    p.el.addEventListener("pointercancel", end);
  }

  /** Geräte eines Raums anpassen: Bereichsgeräte ein-/ausblenden, beliebige Entitäten hinzufügen. */
  _customizeRoom(p, room) {
    const hass = this._hass;
    p.editing = true;
    const areaIds = room.area_id ? this._byArea.get(room.area_id) ?? [] : [];
    const hidden = new Set(room.hidden_entities ?? []);
    const extra = [...(room.panel ?? [])];
    const name = (id) => hass.states[id]?.attributes.friendly_name ?? id;
    const render = () => {
      p.el.innerHTML = `<div class="rp-head"><ha-icon class="grip" icon="mdi:drag"></ha-icon><b>Geräte: ${esc(room.name)}</b></div>
        <div class="rp-sub">Haken = im Modell und im Raumfenster anzeigen.</div>
        <div class="rp-list">
          ${areaIds.map((id) => `<label class="rp-check"><input type="checkbox" data-id="${esc(id)}"${hidden.has(id) ? "" : " checked"}><span>${esc(name(id))}<small>${esc(id)}</small></span></label>`).join("") || `<div class="rp-empty">Kein Bereich zugeordnet.</div>`}
          ${extra.map((id, i) => `<div class="rp-check"><ha-icon icon="mdi:plus-circle-outline"></ha-icon><span>${esc(name(id))}<small>${esc(id)}</small></span><button class="icon rm" data-i="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
        </div>
        <div class="rp-add"><input list="rp-all" placeholder="Entität hinzufügen …"><datalist id="rp-all">${Object.keys(hass.states).sort().map((id) => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("")}</datalist><button class="add">+</button></div>
        <div class="rp-btns"><button class="cancel">Abbrechen</button><button class="save primary">Speichern</button></div>`;
      p.el.querySelectorAll("input[type=checkbox]").forEach((c) => c.addEventListener("change", () => (c.checked ? hidden.delete(c.dataset.id) : hidden.add(c.dataset.id))));
      p.el.querySelectorAll(".rm").forEach((b) => b.addEventListener("click", () => {
        extra.splice(Number(b.dataset.i), 1);
        render();
      }));
      const input = p.el.querySelector(".rp-add input");
      const add = () => {
        const id = input.value.trim();
        if (!hass.states[id]) {
          this._toast("Diese Entität gibt es nicht.");
          return;
        }
        if (areaIds.includes(id)) hidden.delete(id);
        else if (!extra.includes(id)) extra.push(id);
        render();
      };
      p.el.querySelector(".add").addEventListener("click", add);
      input.addEventListener("keydown", (ev) => ev.key === "Enter" && add());
      p.el.querySelector(".cancel").addEventListener("click", () => {
        p.editing = false;
        this._renderRoomPanel();
      });
      p.el.querySelector(".save").addEventListener("click", async () => {
        const building = structuredClone(this._building);
        for (const f of building.floors) {
          for (const r of [...f.rooms, ...(f.outdoor ?? [])]) {
            if (r.id !== room.id) continue;
            r.hidden_entities = [...hidden];
            r.panel = extra;
          }
        }
        try {
          const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
          p.editing = false;
          this._setBuilding(res.building, res.revision, { keepCamera: true });
          this._toast("Geräte gespeichert.");
        } catch (err) {
          this._toast(err.code === "conflict" ? "Der Stand wurde inzwischen geändert. Seite neu laden." : `Speichern fehlgeschlagen: ${err.message ?? err.code}`);
        }
      });
    };
    render();
  }

  // ------------------------------------------------------------------ Karten, Etagen-Leiste, Rad-Menüs

  /** Auf/zu je Karte (pro Browser). patch setzt Werte, ohne Argument wird gelesen. */
  _cardState(patch = null) {
    let st = {};
    try {
      st = JSON.parse(localStorage.getItem("haus3d.cards") ?? "{}") ?? {};
    } catch {
      st = {};
    }
    if (patch) {
      st = { ...st, ...patch };
      this._store("haus3d.cards", JSON.stringify(st));
    }
    return st;
  }

  /** Zusatzkarten (settings.cards, bis zu 5) neben „Energie“, dazu „+“ für Admins. */
  _renderCards() {
    const box = this._els?.cards;
    if (!box) return;
    box.querySelectorAll(".card, .addcard").forEach((x) => x.remove());
    const cards = normalizeCards(this._building?.settings?.cards);
    const state = this._cardState();
    const admin = !!this._hass?.user?.is_admin;
    this._cardEls = [];
    for (const c of cards) {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<h3><ha-icon icon="${esc(c.icon)}"></ha-icon><span>${esc(c.title)}</span><b class="short"></b>${admin ? `<ha-icon class="cedit" icon="mdi:pencil-outline" title="Karte anpassen"></ha-icon>` : ""}<ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></h3>` +
        (c.entities.length ? c.entities.map((e, i) => `<div class="row" data-i="${i}"><span>${esc(e.name || this._hass?.states[e.entity]?.attributes?.friendly_name || e.entity)}</span><b>–</b></div>`).join("") : `<div class="row"><span>Noch leer – über den Stift Werte wählen.</span></div>`);
      el.classList.toggle("collapsed", !!state[c.id]);
      el.querySelector("h3").addEventListener("click", () => this._cardState({ [c.id]: el.classList.toggle("collapsed") }));
      el.querySelector(".cedit")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._cardDialog(c.id);
      });
      el.querySelectorAll(".row[data-i]").forEach((row) => row.addEventListener("click", () => this._moreInfo(c.entities[Number(row.dataset.i)].entity)));
      box.appendChild(el);
      this._cardEls.push({ el, card: c });
    }
    if (admin && cards.length < MAX_CARDS && this._building) {
      const add = document.createElement("button");
      add.className = "addcard";
      add.title = `Karte hinzufügen (${cards.length}/${MAX_CARDS})`;
      add.textContent = "+";
      add.addEventListener("click", () => this._cardDialog(null));
      box.appendChild(add);
    }
    this._updateCards();
  }

  _updateCards() {
    const hass = this._hass;
    for (const { el, card } of this._cardEls ?? []) {
      card.entities.forEach((e, i) => {
        const st = hass?.states[e.entity];
        const b = el.querySelector(`.row[data-i="${i}"] b`);
        if (b) b.textContent = st ? (hass.formatEntityState ? hass.formatEntityState(st) : `${st.state}${st.attributes.unit_of_measurement ? ` ${st.attributes.unit_of_measurement}` : ""}`) : "–";
      });
      const short = el.querySelector(".short");
      if (short) short.textContent = el.querySelector(".row[data-i] b")?.textContent ?? "";
    }
  }

  /** Karte anlegen oder anpassen: Titel, Symbol, Werte (Entität + Name). id = null: neue Karte. */
  _cardDialog(id) {
    this._closeDialog();
    const hass = this._hass;
    const all = normalizeCards(this._building?.settings?.cards);
    const card = structuredClone(all.find((c) => c.id === id) ?? { id: `karte_${Date.now().toString(36)}`, title: "Neue Karte", icon: "mdi:card-text-outline", entities: [] });
    const icons = ["mdi:card-text-outline", "mdi:fire", "mdi:radiator", "mdi:water-boiler", "mdi:thermometer", "mdi:washing-machine", "mdi:server", "mdi:pool", "mdi:car-electric", "mdi:battery-charging", "mdi:weather-partly-cloudy", "mdi:home-automation"];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const render = () => {
      el.innerHTML = `<div class="dialog qedit" role="dialog" aria-label="Karte">
        <div class="dialog-head"><span>${id ? "Karte anpassen" : "Neue Karte"}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <h4>Titel</h4><div class="qrow"><input class="ttl" value="${esc(card.title)}"></div>
          <h4>Symbol</h4><div class="qrow" style="flex-wrap:wrap">${icons.map((ic) => `<button class="icon ${ic === card.icon ? "on" : ""}" data-icon="${ic}" title="${ic}" style="${ic === card.icon ? "background:var(--primary-color,#03a9f4);color:#fff" : ""}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}</div>
          <h4>Werte</h4>
          ${card.entities.map((e, i) => `<div class="qrow"><input class="nm" data-name="${i}" value="${esc(e.name ?? "")}" placeholder="Name"><input list="card-ents" data-ent="${i}" value="${esc(e.entity)}" placeholder="Entität"><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
          <datalist id="card-ents">${Object.keys(hass.states).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
          <div class="btns"><button class="addv">+ Wert</button></div>
          <div class="btns">${id ? `<button class="del">Karte löschen</button>` : ""}<button class="save primary">Speichern</button></div>
        </div></div>`;
      const sync = () => {
        card.title = el.querySelector(".ttl").value.trim() || card.title;
        el.querySelectorAll("[data-ent]").forEach((i) => (card.entities[Number(i.dataset.ent)].entity = i.value.trim()));
        el.querySelectorAll("[data-name]").forEach((i) => (card.entities[Number(i.dataset.name)].name = i.value.trim() || undefined));
      };
      el.querySelectorAll("[data-icon]").forEach((b) => b.addEventListener("click", () => {
        sync();
        card.icon = b.dataset.icon;
        render();
      }));
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        card.entities.splice(Number(b.dataset.rm), 1);
        render();
      }));
      el.querySelector(".addv").addEventListener("click", () => {
        sync();
        card.entities.push({ entity: "" });
        render();
      });
      el.querySelector(".del")?.addEventListener("click", () => {
        this._closeDialog();
        this._saveBuildingSettings({ cards: all.filter((c) => c.id !== id) }, "Karte gelöscht.");
      });
      el.querySelector(".save").addEventListener("click", () => {
        sync();
        card.entities = card.entities.filter((e) => e.entity.includes("."));
        const next = id ? all.map((c) => (c.id === id ? card : c)) : [...all, card];
        this._closeDialog();
        this._saveBuildingSettings({ cards: next.slice(0, MAX_CARDS) }, "Karte gespeichert.");
      });
      el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    };
    render();
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  }

  /** Etagen-Leiste rechts: ▲ Alle (mit Dach) / Etagen von oben nach unten ▼. */
  _renderFloorbar(options) {
    const bar = this._els?.floorbar;
    if (!bar) return;
    const floors = [...(this._building?.floors ?? [])].filter((f) => (f.rooms ?? []).length || f.height >= 1).sort((a, b) => b.elevation - a.elevation);
    const order = ["all", ...floors.map((f) => f.id)];
    const idx = Math.max(0, order.indexOf(this._filter));
    bar.hidden = floors.length < 1 || !this._building;
    bar.innerHTML = `<button class="arrow" data-step="-1" title="Etage höher"${idx <= 0 ? " disabled" : ""}><ha-icon icon="mdi:chevron-up"></ha-icon></button>` +
      order.map((id) => `<button data-floor="${esc(id)}" role="tab" aria-selected="${id === this._filter}" class="${id === this._filter ? "sel" : ""}">${id === "all" ? "Alle" : esc(floors.find((f) => f.id === id).name)}</button>`).join("") +
      `<button class="arrow" data-step="1" title="Etage tiefer"${idx >= order.length - 1 ? " disabled" : ""}><ha-icon icon="mdi:chevron-down"></ha-icon></button>`;
    bar.querySelectorAll("[data-floor]").forEach((b) => b.addEventListener("click", () => this._setFilter(b.dataset.floor)));
    bar.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => this._setFilter(order[Math.min(order.length - 1, Math.max(0, idx + Number(b.dataset.step)))])));
  }

  /** Eingebaute Funktionen (Umschalter der Ansicht), nach Schlüssel. */
  _builtinFunctions() {
    const l = this._settings.layers;
    const styleName = { auto: "Auto", day: "Tag", night: "Nacht", cyber: "Cyberpunk" }[this._settings.style] ?? "Auto";
    const layer = (key, icon, name) => ({ icon, name, on: l[key] !== false, run: () => {
      l[key] = l[key] === false;
      this._saveSettings();
      this._scene?.setLayers(l);
      this._applyOverlayLayers();
    } });
    return {
      flow: layer("flow", "mdi:transmission-tower-export", "Energiefluss"),
      temp: { icon: "mdi:thermometer", name: "Temperatur", on: this._tempMode, run: () => {
        this._tempMode = !this._tempMode;
        this._store("haus3d.temp", this._tempMode ? "1" : "0");
        this._renderToolbar();
        this._updateStates();
      } },
      style: { icon: { auto: "mdi:theme-light-dark", day: "mdi:white-balance-sunny", night: "mdi:weather-night", cyber: "mdi:robot" }[this._settings.style] ?? "mdi:theme-light-dark", name: `Stil: ${styleName}`, on: false, run: () => {
        this._settings.style = nextStyle(this._settings.style);
        this._saveSettings();
        this._applyStyle();
      } },
      roof: layer("roof", "mdi:home-roof", "Dach"),
      grid: layer("grid", "mdi:grid", "Raster"),
      weather: layer("weather", "mdi:weather-pouring", "Wetter"),
      labels: layer("labels", "mdi:label-outline", "Raumnamen"),
      devices: layer("devices", "mdi:lightbulb-group-outline", "Geräte"),
      furniture: layer("furniture", "mdi:sofa-outline", "Möbel"),
      fit: { icon: "mdi:fit-to-screen-outline", name: "Ansicht einpassen", on: false, run: () => this._scene?.fitCamera() },
    };
  }

  /** Einträge des Funktionsrads (unten rechts): eingebaute Umschalter und eigene Einträge aus settings.functions. */
  _functionItems() {
    const builtin = this._builtinFunctions();
    const items = normalizeFunctions(this._building?.settings?.functions, this._building?.settings?.functions_seen ?? LEGACY_FUNCTION_KEYS).map((f) => (f.key ? builtin[f.key] : this._entityItem(f)));
    if (this._hass?.user?.is_admin) items.push({ plus: true, icon: "mdi:plus", name: "Funktionen anpassen", run: () => this._functionDialog() });
    return items;
  }

  /** Bubble für eine Entität (Kurzwahl oder eigene Funktion): Automation auslösen, Skript starten, sonst umschalten. */
  _entityItem(q) {
    const st = this._hass?.states[q.entity];
    const domain = q.entity.split(".")[0];
    const icon = q.icon || st?.attributes?.icon || { automation: "mdi:robot", script: "mdi:script-text-play", scene: "mdi:palette", button: "mdi:gesture-tap-button", input_button: "mdi:gesture-tap-button", light: "mdi:lightbulb", switch: "mdi:toggle-switch", cover: "mdi:window-shutter", lock: "mdi:lock", fan: "mdi:fan", input_boolean: "mdi:toggle-switch-outline" }[domain] || "mdi:flash";
    const name = q.name || st?.attributes?.friendly_name || q.entity;
    return { icon, name, entity: q.entity, on: ["on", "open", "unlocked", "playing"].includes(st?.state) && domain !== "automation", run: () => this._runAction(q.entity, { source: "wheel", name, confirm: !!q.confirm, quiet: false }) };
  }

  /** Einträge der Kurzwahl (unten links): Automationen, Skripte, Szenen … aus settings.quick. */
  _quickItems() {
    const items = (this._building?.settings?.quick ?? []).filter((q) => q?.entity).map((q) => this._entityItem(q));
    if (this._hass?.user?.is_admin) items.push({ plus: true, icon: "mdi:plus", name: "Kurzwahl hinzufügen", run: () => this._quickDialog() });
    return items;
  }

  _renderWheels() {
    if (!this._els?.wheelL || !this._building) return;
    this._wheel(this._els.wheelL, "left", this._quickItems(), "mdi:gesture-tap", "Kurzwahl");
    this._wheel(this._els.wheelR, "right", this._functionItems(), "mdi:tune-variant", "Funktionen");
  }

  _updateWheelStates() {
    // Zustände (an/aus) ändern sich mit HA: nur neu zeichnen, wenn das Rad offen ist
    if (this._els?.wheelL?.classList.contains("open")) this._wheel(this._els.wheelL, "left", this._quickItems(), "mdi:gesture-tap", "Kurzwahl");
    if (this._els?.wheelR?.classList.contains("open")) this._wheel(this._els.wheelR, "right", this._functionItems(), "mdi:tune-variant", "Funktionen");
  }

  /**
   * Rad-Menü: weißer Knopf, darüber 4 Bubbles im Viertelkreis und am Ende fest das „+“ zum Hinzufügen.
   * Mehr Einträge lassen sich wie ein Rad durchdrehen (Mausrad, Wischen oder die kleinen Pfeile).
   */
  _wheel(box, side, all, icon, title) {
    const key = `_wheel_${side}`;
    const st = (this[key] ??= { open: false, offset: 0 });
    const plus = all.find((it) => it.plus);
    const items = all.filter((it) => !it.plus);
    const n = items.length;
    st.offset = n > WHEEL_VISIBLE ? ((st.offset % n) + n) % n : 0;
    const R = 170;
    const pos = (angle) => {
      const a = (angle * Math.PI) / 180;
      return `${side}:${(4 + Math.sin(a) * R).toFixed(1)}px; bottom:${(4 + Math.cos(a) * R).toFixed(1)}px`;
    };
    const layout = wheelLayout(n, st.offset);
    const bubble = (it, attr, angle, vis) => `<button class="bub${vis ? " vis" : ""}${it.on ? " on" : ""}${it.plus ? " plus" : ""}" ${attr} title="${esc(it.name)}" style="${pos(angle)}"><ha-icon icon="${esc(it.icon)}"></ha-icon><span class="lab ${labelPlace(angle)}">${esc(it.name)}</span></button>`;
    box.classList.toggle("open", st.open);
    box.innerHTML = `<button class="fab" title="${title}"><ha-icon icon="${st.open ? "mdi:close" : icon}"></ha-icon></button>` +
      items.map((it, i) => bubble(it, `data-i="${i}"`, layout[i].angle, layout[i].visible)).join("") +
      (plus ? bubble(plus, "data-plus", wheelPlusAngle(n), true) : "") +
      (n > WHEEL_VISIBLE ? `<button class="spin up" data-d="-1" title="zurückdrehen"><ha-icon icon="mdi:chevron-up"></ha-icon></button><button class="spin down" data-d="1" title="weiterdrehen (${n} Einträge)"><ha-icon icon="mdi:chevron-down"></ha-icon></button>` : "");
    const redraw = () => this._wheel(box, side, side === "right" ? this._functionItems() : this._quickItems(), icon, title);
    box.querySelector(".fab").addEventListener("click", () => {
      st.open = !st.open;
      // nur ein Rad gleichzeitig offen (auf schmalen Bildschirmen überlappen sie sonst)
      const other = side === "left" ? "right" : "left";
      if (st.open && this[`_wheel_${other}`]?.open) {
        this[`_wheel_${other}`].open = false;
        this._renderWheels();
      } else redraw();
    });
    box.querySelector("[data-plus]")?.addEventListener("click", () => {
      if (!this._wheelDragged) plus.run();
    });
    box.querySelectorAll(".spin").forEach((b) => b.addEventListener("click", () => box._turn?.(Number(b.dataset.d))));
    box.querySelectorAll(".bub[data-i]").forEach((b) => {
      let long = false;
      let start = null;
      const cancel = () => {
        clearTimeout(box._longTimer);
        box._longTimer = null;
      };
      b.addEventListener("pointerdown", (ev) => {
        long = false;
        start = [ev.clientX, ev.clientY];
        cancel();
        const it = items[Number(b.dataset.i)];
        if (it.entity) box._longTimer = setTimeout(() => {
          long = true;
          navigator.vibrate?.(15);
          this._moreInfo(it.entity);
        }, 550);
      });
      b.addEventListener("pointermove", (ev) => {
        if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 10) cancel();
      });
      b.addEventListener("pointerup", cancel);
      b.addEventListener("pointerleave", cancel);
      b.addEventListener("pointercancel", cancel);
      b.addEventListener("contextmenu", (ev) => ev.preventDefault());
      b.addEventListener("click", () => {
        if (long || this._wheelDragged) return;
        items[Number(b.dataset.i)].run();
        // Umschalter neu zeichnen (an/aus), das Rad bleibt offen
        if (side === "right") redraw();
      });
    });
    box._turn = (d) => {
      // Drehen bricht einen angefangenen Langdruck ab
      clearTimeout(box._longTimer);
      const next = rotateWheel(st.offset, d, n);
      if (next === st.offset) return;
      st.offset = next;
      redraw();
    };
    if (!box._wheelBound) {
      box._wheelBound = true;
      box.addEventListener("wheel", (ev) => {
        if (!box.classList.contains("open")) return;
        ev.preventDefault();
        const now = performance.now();
        if (now - (box._lastTurn ?? 0) < 120) return; // Touchpads liefern viele kleine Schritte
        box._lastTurn = now;
        box._turn?.(ev.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      // Wischen über die Bubbles dreht das Rad
      let start = null;
      box.addEventListener("pointerdown", (ev) => {
        start = [ev.clientX, ev.clientY];
        this._wheelDragged = false;
      });
      box.addEventListener("pointermove", (ev) => {
        if (!start) return;
        const d = side === "left" ? ev.clientX - start[0] - (ev.clientY - start[1]) : -(ev.clientX - start[0]) - (ev.clientY - start[1]);
        if (Math.abs(d) > 40) {
          this._wheelDragged = true;
          box._turn?.(d > 0 ? 1 : -1);
          start = [ev.clientX, ev.clientY];
        }
      });
      const end = () => {
        start = null;
        setTimeout(() => (this._wheelDragged = false), 0);
      };
      box.addEventListener("pointerup", end);
      box.addEventListener("pointercancel", end);
    }
  }

  /** Funktionsrad anpassen: eingebaute Umschalter ein-/ausblenden, sortieren, eigene Einträge (Entitäten) hinzufügen. */
  _functionDialog() {
    this._closeDialog();
    const hass = this._hass;
    const builtin = this._builtinFunctions();
    let list = normalizeFunctions(this._building?.settings?.functions, this._building?.settings?.functions_seen ?? LEGACY_FUNCTION_KEYS);
    const domains = ["automation", "script", "scene", "button", "input_button", "switch", "light", "input_boolean", "cover", "lock", "fan"];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const render = () => {
      const missing = FUNCTION_KEYS.filter((k) => !list.some((f) => f.key === k));
      el.innerHTML = `<div class="dialog qedit" role="dialog" aria-label="Funktionen">
        <div class="dialog-head"><span>Funktionen anpassen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <p class="hint">Im Rad sind ${WHEEL_VISIBLE} Einträge zu sehen, weitere werden durchgedreht. Eigene Einträge: Automation auslösen, Skript/Szene starten, sonst umschalten.</p>
          ${list.map((f, i) => `<div class="qrow">${f.key
            ? `<ha-icon icon="${esc(builtin[f.key].icon)}"></ha-icon><span class="fixed">${esc(builtin[f.key].name)}</span>`
            : `<input class="nm" data-name="${i}" value="${esc(f.name ?? "")}" placeholder="Name"><input list="fn-ents" data-ent="${i}" value="${esc(f.entity ?? "")}" placeholder="script.…"><label class="qc" title="Vor dem Ausführen nachfragen"><input type="checkbox" data-cf="${i}"${f.confirm ? " checked" : ""}>Nachfragen</label>`}
            <button class="icon" data-up="${i}" title="nach oben"><ha-icon icon="mdi:arrow-up"></ha-icon></button><button class="icon" data-rm="${i}" title="Ausblenden/Entfernen"><ha-icon icon="mdi:${f.key ? "eye-off-outline" : "delete-outline"}"></ha-icon></button></div>`).join("") || `<p class="hint">Keine Einträge.</p>`}
          <datalist id="fn-ents">${Object.keys(hass.states).filter((x) => domains.includes(x.split(".")[0])).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
          ${missing.length ? `<div class="qrow"><select class="addkey"><option value="">Ausgeblendete wieder zeigen …</option>${missing.map((k) => `<option value="${k}">${esc(builtin[k].name)}</option>`).join("")}</select></div>` : ""}
          <div class="btns"><button class="reset">Standard</button><button class="addq">+ Eigener Eintrag</button><button class="save primary">Speichern</button></div>
        </div></div>`;
      const sync = () => {
        el.querySelectorAll("[data-ent]").forEach((i) => (list[Number(i.dataset.ent)].entity = i.value.trim()));
        el.querySelectorAll("[data-name]").forEach((i) => (list[Number(i.dataset.name)].name = i.value.trim() || undefined));
        el.querySelectorAll("[data-cf]").forEach((i) => (list[Number(i.dataset.cf)].confirm = i.checked || undefined));
      };
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        list.splice(Number(b.dataset.rm), 1);
        render();
      }));
      el.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => {
        sync();
        const i = Number(b.dataset.up);
        if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        render();
      }));
      el.querySelector(".addkey")?.addEventListener("change", (ev) => {
        sync();
        if (ev.target.value) list.push({ key: ev.target.value });
        render();
      });
      el.querySelector(".addq").addEventListener("click", () => {
        sync();
        list.push({ entity: "" });
        render();
      });
      el.querySelector(".reset").addEventListener("click", () => {
        list = normalizeFunctions(null);
        render();
      });
      el.querySelector(".save").addEventListener("click", () => {
        sync();
        this._closeDialog();
        this._saveBuildingSettings({ functions: list.filter((f) => f.key || f.entity?.includes(".")), functions_seen: [...FUNCTION_KEYS] }, "Funktionen gespeichert.");
      });
      el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    };
    render();
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  }

  /** Kurzwahl bearbeiten: Automationen, Skripte, Szenen, Taster, Schalter. */
  _quickDialog() {
    this._closeDialog();
    const hass = this._hass;
    const list = structuredClone(this._building?.settings?.quick ?? []);
    const domains = ["automation", "script", "scene", "button", "input_button", "switch", "light", "input_boolean", "cover", "lock", "fan"];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const render = () => {
      el.innerHTML = `<div class="dialog qedit" role="dialog" aria-label="Kurzwahl">
        <div class="dialog-head"><span>Kurzwahl</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <p class="hint">Antippen löst aus: Automation (trigger), Skript/Szene (starten), Taster (drücken), sonst umschalten. Lange drücken öffnet die Details. Im Rad sind ${WHEEL_VISIBLE} zu sehen, weitere werden durchgedreht.</p>
          ${list.map((q, i) => `<div class="qrow"><input class="nm" data-name="${i}" value="${esc(q.name ?? "")}" placeholder="Name"><input list="quick-ents" data-ent="${i}" value="${esc(q.entity ?? "")}" placeholder="automation.…"><label class="qc" title="Vor dem Ausführen nachfragen"><input type="checkbox" data-cf="${i}"${q.confirm ? " checked" : ""}>Nachfragen</label><button class="icon" data-up="${i}" title="nach oben"><ha-icon icon="mdi:arrow-up"></ha-icon></button><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("") || `<p class="hint">Noch keine Einträge.</p>`}
          <datalist id="quick-ents">${Object.keys(hass.states).filter((x) => domains.includes(x.split(".")[0])).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
          <div class="btns"><button class="addq">+ Eintrag</button><button class="save primary">Speichern</button></div>
        </div></div>`;
      const sync = () => {
        el.querySelectorAll("[data-ent]").forEach((i) => (list[Number(i.dataset.ent)].entity = i.value.trim()));
        el.querySelectorAll("[data-name]").forEach((i) => (list[Number(i.dataset.name)].name = i.value.trim() || undefined));
        el.querySelectorAll("[data-cf]").forEach((i) => (list[Number(i.dataset.cf)].confirm = i.checked || undefined));
      };
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        list.splice(Number(b.dataset.rm), 1);
        render();
      }));
      el.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => {
        sync();
        const i = Number(b.dataset.up);
        if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        render();
      }));
      el.querySelector(".addq").addEventListener("click", () => {
        sync();
        list.push({ entity: "" });
        render();
      });
      el.querySelector(".save").addEventListener("click", () => {
        sync();
        this._closeDialog();
        this._saveBuildingSettings({ quick: list.filter((q) => q.entity?.includes(".")) }, "Kurzwahl gespeichert.");
      });
      el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    };
    render();
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  }

  _renderLegend() {
    if (this._tempMode && !this._legend) {
      const el = document.createElement("div");
      el.className = "legend";
      const stops = [18, 20, 22, 24, 26].map((t, i) => `rgb(${temperatureColor(t).map((c) => Math.round(c * 255)).join(",")}) ${i * 25}%`).join(",");
      el.innerHTML = `Temperatur<div class="bar" style="background: linear-gradient(90deg, ${stops})"></div><div class="ticks"><span>18 °C</span><span>22 °C</span><span>26 °C</span></div>`;
      this._els.stage.appendChild(el);
      this._legend = el;
    } else if (!this._tempMode && this._legend) {
      this._legend.remove();
      this._legend = null;
    }
  }

  // ------------------------------------------------------------------ Overlays positionieren

  _positionOverlays() {
    if (!this._scene) return;
    for (const ov of this._overlays.values()) {
      const visible = this._scene.isFloorVisible(ov.floorId);
      const p = visible ? this._scene.project(ov.position) : null;
      if (!p) {
        ov.el.style.display = "none";
        continue;
      }
      ov.el.style.display = "";
      ov.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    // Verdeckung teurer: erst prüfen, wenn die Kamera kurz stillsteht
    clearTimeout(this._occlusionTimer);
    this._occlusionTimer = setTimeout(() => this._checkOcclusion(), 150);
  }

  _checkOcclusion() {
    if (!this._scene) return;
    for (const ov of this._overlays.values()) {
      if (ov.el.style.display === "none") continue;
      ov.el.classList.toggle("hidden-behind", this._scene.occluded(ov.position, ov.floorId));
    }
  }

  // ------------------------------------------------------------------ Import/Export/Verlauf (Admin)

  _toggleMenu() {
    if (this._popup) {
      this._closePopup();
      return;
    }
    const el = document.createElement("div");
    el.className = "popup";
    const entries = [
      ["mdi:download", "Exportieren (JSON)", () => this._export()],
      ["mdi:upload", "Importieren (JSON) …", () => this._els.file.click()],
      ["mdi:content-save-outline", "Stand sichern", () => this._snapshot()],
      ["mdi:history", "Verlauf …", () => this._showHistory()],
    ];
    for (const [icon, text, fn] of entries) {
      const b = document.createElement("button");
      b.innerHTML = `<ha-icon icon="${icon}"></ha-icon><span></span>`;
      b.querySelector("span").textContent = text;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._closePopup();
        fn();
      });
      el.appendChild(b);
    }
    this._els.stage.appendChild(el);
    this._popup = el;
  }

  _closePopup() {
    this._popup?.remove();
    this._popup = null;
  }

  _export() {
    const blob = new Blob([JSON.stringify(exportFile(this._building), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `haus3d-${new Date().toISOString().slice(0, 10)}.json`;
    this.shadowRoot.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async _importFile() {
    const file = this._els.file.files?.[0];
    this._els.file.value = "";
    if (!file) return;
    let building;
    try {
      building = parseImport(await file.text());
    } catch (err) {
      this._toast(err.message);
      return;
    }
    // Räume mit Spalt dazwischen (Innenmaße statt Wandmitten) ergeben doppelte Außenwände: anbieten zu schließen
    const closed = building.floors.map((f) => closeGaps(f.rooms));
    const gapCount = closed.reduce((n, c) => n + c.gaps.length, 0);
    if (gapCount && (await this._confirm(`Zwischen den Räumen gibt es ${plural(gapCount, "Lücke", "Lücken")} (bis 45 cm). Schließen, damit daraus Innenwände werden?`, "Schließen", { sub: "Wie „Lücken schließen“ in NeonPlan." }))) {
      building.floors.forEach((f, i) => (f.rooms = closed[i].rooms));
    }
    const rooms = building.floors.reduce((n, f) => n + f.rooms.length, 0);
    if (!(await this._confirm(`Grundriss mit ${plural(building.floors.length, "Etage", "Etagen")} und ${plural(rooms, "Raum", "Räumen")} importieren?`, "Importieren", { sub: "Der aktuelle Stand wird vorher im Verlauf gesichert." }))) return;
    try {
      const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
      this._setBuilding(res.building, res.revision);
      this._toast("Grundriss importiert.");
    } catch (err) {
      if (err.code === "conflict") this._toast("Der Stand wurde inzwischen geändert. Seite neu laden und erneut versuchen.");
      else this._toast(`Import fehlgeschlagen: ${err.message ?? err.code}`);
    }
  }

  async _snapshot() {
    try {
      await this._hass.callWS({ type: "haus3d/history/snapshot" });
      this._toast("Stand gesichert.");
    } catch (err) {
      this._toast(`Sichern fehlgeschlagen: ${err.message ?? err.code}`);
    }
  }

  async _showHistory() {
    let items;
    try {
      ({ items } = await this._hass.callWS({ type: "haus3d/history/list" }));
    } catch (err) {
      this._toast(`Verlauf nicht verfügbar: ${err.message ?? err.code}`);
      return;
    }
    const el = document.createElement("div");
    el.className = "popup";
    const reasons = { save: "vor Speichern", restore: "vor Wiederherstellen", manual: "gesichert" };
    el.innerHTML = `<div class="head">Verlauf (letzte 20 Stände)</div><div class="scroll"></div>`;
    const list = el.querySelector(".scroll");
    if (!items.length) list.innerHTML = `<div class="item"><span>Noch keine Stände gesichert.</span></div>`;
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";
      const when = new Date(item.created).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
      row.innerHTML = `<span></span><button>Wiederherstellen</button>`;
      row.querySelector("span").textContent = `${when} · ${reasons[item.reason] ?? item.reason} · ${plural(item.floors, "Etage", "Etagen")}`;
      row.querySelector("button").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        this._closePopup();
        if (!(await this._confirm(`Stand vom ${when} wiederherstellen?`, "Wiederherstellen", { sub: "Der aktuelle Stand wird vorher gesichert." }))) return;
        try {
          const res = await this._hass.callWS({ type: "haus3d/history/restore", history_id: item.id });
          this._setBuilding(res.building, res.revision);
          this._toast("Stand wiederhergestellt.");
        } catch (err) {
          this._toast(`Wiederherstellen fehlgeschlagen: ${err.message ?? err.code}`);
        }
      });
      list.appendChild(row);
    }
    this._closePopup();
    this._els.stage.appendChild(el);
    this._popup = el;
  }
}

if (!customElements.get("haus3d-panel")) customElements.define("haus3d-panel", Haus3DPanel);
