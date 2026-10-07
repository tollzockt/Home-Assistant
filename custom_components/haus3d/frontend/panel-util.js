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
import { energyRowSpecs } from "./energymodel.js";
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
/**
 * Finger-Scrollen als Rückfallebene: Scrollt der Browser selbst, bricht er die Zeiger-Gesten ab
 * (pointercancel) und hier passiert nichts. Blockiert etwas das native Scrollen (manche Tablet-Apps),
 * schiebt die Hilfe die Liste selbst und verschluckt danach den Klick, damit kein Haken umspringt.
 */
export function touchScroll(el, { skip = ".rp-head, input:not([type=checkbox]), select, textarea" } = {}) {
  let start = null;
  el.addEventListener("pointerdown", (ev) => {
    start = ev.pointerType === "touch" && !ev.target.closest(skip) ? { y: ev.clientY, top: el.scrollTop, moved: false } : null;
  }, true);
  el.addEventListener("pointermove", (ev) => {
    if (!start || ev.pointerType !== "touch") return;
    const dy = ev.clientY - start.y;
    if (!start.moved && Math.abs(dy) < 8) return;
    start.moved = true;
    el.scrollTop = start.top - dy;
  }, true);
  el.addEventListener("pointercancel", () => (start = null), true);
  el.addEventListener("pointerup", () => {
    if (!start?.moved) return (start = null);
    start = null;
    const eat = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => el.removeEventListener("click", eat, { capture: true }), 350); // nur den Klick dieser Geste
  }, true);
}

/** Name oben links: settings.title, sonst „Haus 3D“. */
export const DEFAULT_TITLE = "Haus 3D";
export const houseTitle = (building) => String(building?.settings?.title ?? "").trim() || DEFAULT_TITLE;

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

/**
 * Alle möglichen Zeilen der Energie-Karte (feste Werte plus settings.energy.extra) in der Reihenfolge
 * von settings.energy_card.rows, mit hidden und eigenem Namen (custom). id: Schlüssel bzw. x:Entität.
 */
export function energyRowList(energy, hass, card = null) {
  const rows = energyRowSpecs(energy, hass);
  for (const x of energy?.extra ?? []) {
    const id = typeof x === "string" ? x : x?.entity;
    const st = id && hass.states[id];
    if (!st) continue;
    rows.push({ id: `x:${id}`, key: null, entity: id, base: (typeof x === "object" && x.name) || st.attributes.friendly_name || id, icon: st.attributes.icon ?? SENSOR_ICONS[st.attributes.device_class] ?? "mdi:flash" });
  }
  const order = (card?.rows ?? []).map((r) => r?.key);
  const cfg = new Map((card?.rows ?? []).filter((r) => r?.key).map((r) => [r.key, r]));
  const pos = (r) => {
    const i = order.indexOf(r.id);
    return i < 0 ? order.length + rows.indexOf(r) : i;
  };
  return [...rows]
    .sort((a, b) => pos(a) - pos(b))
    .map((r) => {
      const c = cfg.get(r.id);
      return { ...r, hidden: !!c?.hidden, custom: c?.name || undefined, name: c?.name || r.base };
    });
}

/** Sichtbare Zeilen der Energie-Karte. */
export function energyRows(energy, hass, card = null) {
  return energyRowList(energy, hass, card).filter((r) => !r.hidden);
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
  ["pipes", "Leitungen (Strom, Wasser)"],
  ["devices", "Geräte"],
  ["cameras", "Kamera-Sichtbereich"],
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
/** Spenden (leere URL = nicht anzeigen): [Schlüssel, Name, URL, Symbol]. */
export const SUPPORT_LINKS = [
  ["github", "GitHub Sponsors", "https://github.com/sponsors/tollzockt", "mdi:github"],
  ["kofi", "Ko-fi", "", "mdi:coffee"],
  ["patreon", "Patreon", "", "mdi:patreon"],
  ["paypal", "PayPal", "https://paypal.me/RobinK24", "mdi:hand-heart"],
];

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
  network: ["mdi:lan-connect", "mdi:lan-disconnect"],
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
  if (kind === "network" && stateObj.attributes?.is_wired === false) return active ? "mdi:wifi" : "mdi:wifi-off";
  if (kind === "cover" && stateObj.attributes.device_class === "garage") return CONTACT_ICONS.garage_door[active ? 0 : 1];
  return (ICONS[kind] ?? ["mdi:help-circle-outline"])[active ? 0 : 1];
}

export function isActive(kind, stateObj) {
  if (kind === "cover" || kind === "contact") return isOpen(stateObj);
  if (kind === "other") return ["on", "open", "playing", "unlocked", "cleaning", "home", "heat", "cool"].includes(stateObj.state);
  if (kind === "climate") return !["off", "unavailable", "unknown"].includes(stateObj.state);
  if (kind === "lock") return stateObj.state !== "locked"; // offen = auffällig
  if (kind === "vacuum") return ["cleaning", "returning"].includes(stateObj.state);
  if (kind === "network") return ["home", "connected", "on"].includes(stateObj.state);
  if (kind === "camera") return ["recording", "streaming"].includes(stateObj.state);
  return stateObj.state === "on";
}


