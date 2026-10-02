// Haus 3D – Panel für die Home-Assistant-Seitenleiste.

import * as THREE from "./vendor/three.module.min.js";
import {
  canToggle,
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
import { exportFile, normalize, parseImport } from "./model.js";
import { HouseScene } from "./scene.js";
import { closeGaps } from "./walls.js";

const LONG_PRESS_MS = 550;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Ebenen und ihre Namen im Einstellungsfenster. */
const LAYERS = [
  ["walls", "Wände"],
  ["openings", "Fenster & Türen"],
  ["floors", "Böden"],
  ["furniture", "Möbel"],
  ["garden", "Garten"],
  ["solar", "Solarmodule"],
  ["flow", "Energiefluss"],
  ["devices", "Geräte"],
  ["labels", "Raumnamen"],
  ["climate", "Temperatur & Feuchte"],
  ["energy", "Energieanzeige"],
];

const DEFAULT_SETTINGS = { style: "standard", deviceMode: "icons", layers: Object.fromEntries(LAYERS.map(([k]) => [k, true])) };

function loadSettings(raw, legacyStyle) {
  let saved = {};
  try {
    saved = JSON.parse(raw ?? "{}") ?? {};
  } catch {
    saved = {};
  }
  const out = { ...DEFAULT_SETTINGS, ...saved, layers: { ...DEFAULT_SETTINGS.layers, ...(saved.layers ?? {}) } };
  if (!raw && legacyStyle === "cyber") out.style = "cyber";
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

function iconFor(kind, stateObj) {
  if (stateObj.attributes?.icon) return stateObj.attributes.icon;
  const active = isActive(kind, stateObj);
  if (kind === "contact") return (CONTACT_ICONS[stateObj.attributes.device_class] ?? CONTACT_ICONS.opening)[active ? 0 : 1];
  if (kind === "cover" && stateObj.attributes.device_class === "garage") return CONTACT_ICONS.garage_door[active ? 0 : 1];
  return (ICONS[kind] ?? ["mdi:help-circle-outline"])[active ? 0 : 1];
}

function isActive(kind, stateObj) {
  if (kind === "cover" || kind === "contact") return isOpen(stateObj);
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
.dialog-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 10; display: flex; align-items: flex-start; justify-content: flex-end; padding: 8px; }
.dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; width: min(360px, 100%); max-height: calc(100% - 16px); overflow: auto; box-shadow: 0 8px 28px rgba(0,0,0,.4); }
.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 6px 6px 16px; font-size: 17px; font-weight: 500; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2)); }
.dialog-body { padding: 4px 16px 16px; }
.dialog h4 { margin: 14px 0 6px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
.seg { display: flex; background: rgba(127,127,127,.15); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { flex: 1; border: none; background: none; color: inherit; font: inherit; padding: 8px; border-radius: 8px; cursor: pointer; min-height: 38px; }
.seg button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
.toggles label { display: flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer; font-size: 14px; }
.toggles input { width: 18px; height: 18px; accent-color: var(--primary-color, #03a9f4); }
.hint { font-size: 12px; color: var(--secondary-text-color); margin: 14px 0 0; }
.roompanel { position: absolute; left: 12px; bottom: 12px; width: min(320px, calc(100% - 24px)); max-height: 55%; overflow: auto; z-index: 4;
  background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.rp-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 4px 0 14px; font-size: 16px; }
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
.energy h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
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
  max-width: calc(100% - 32px); box-shadow: 0 2px 8px rgba(0,0,0,.4); z-index: 5;
}
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

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._built) return;
    if (!prev || prev.themes?.darkMode !== hass.themes?.darkMode) this._applyTheme();
    if (!prev || prev.user?.is_admin !== hass.user?.is_admin) this._renderToolbar();
    if (!this._building) return;
    if (!prev || prev.entities !== hass.entities || prev.devices !== hass.devices) {
      this._refreshEntities();
      return;
    }
    const changed = this._watchedChanged();
    if (changed === "presence") this._refreshEntities();
    else if (changed) this._updateStates();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this.toggleAttribute("narrow", !!value);
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    if (!this._built) this._build();
    this._scene?.start();
    if (!this._building && !this._loading) this._load();
  }

  disconnectedCallback() {
    this._scene?.stop();
  }

  // ------------------------------------------------------------------ Aufbau

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap">
        <header>
          <button class="icon menu" title="Menü"><ha-icon icon="mdi:menu"></ha-icon></button>
          <div class="title">Haus 3D</div>
          <div class="floors" role="tablist" aria-label="Etage"></div>
          <button class="icon temp" title="Temperaturansicht"><ha-icon icon="mdi:thermometer"></ha-icon></button>
          <button class="icon fit" title="Ansicht zurücksetzen"><ha-icon icon="mdi:fit-to-screen-outline"></ha-icon></button>
          <button class="icon more" title="Daten" hidden><ha-icon icon="mdi:dots-vertical"></ha-icon></button>
          <button class="icon gear" title="Einstellungen"><ha-icon icon="mdi:cog"></ha-icon></button>
        </header>
        <div class="stage">
          <div class="canvas"></div>
          <div class="overlay"></div>
          <div class="msg">Lade Grundriss …</div>
        </div>
      </div>
      <input type="file" accept="application/json,.json" hidden>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      floors: $(".floors"),
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
    $(".gear").addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._openSettings();
    });
    this.toggleAttribute("cyber", this._settings.style === "cyber");
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
      this._scene.setStyle(this._settings.style);
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
      this._scene.start();
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
    el.textContent = text;
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
    this._els.temp.classList.toggle("on", this._tempMode);
    this._els.more.hidden = !this._hass?.user?.is_admin;
  }

  _setFilter(id) {
    this._filter = id;
    if (this._selected && this._selected.floorId !== id) this._selectRoom(null);
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
    this._watched = watchedEntities(this._building, hass, this._byArea);
    for (const links of this._links.values()) for (const l of links.values()) for (const id of [l.contact, l.cover]) if (id) this._watched.push(id);
    this._buildOverlays();
    this._watchedRefs = this._watched.map((id) => hass.states[id]);
    this._updateStates();
  }

  /** false, true (Zustand geändert) oder "presence" (eine beobachtete Entität kam oder ging). */
  _watchedChanged() {
    const states = this._hass.states;
    let changed = false;
    for (let i = 0; i < this._watched.length; i++) {
      const s = states[this._watched[i]];
      const old = this._watchedRefs[i];
      if (s !== old) {
        this._watchedRefs[i] = s;
        if (!s !== !old) return "presence";
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
    const energy = this._building.settings?.energy ?? {};
    if (Object.values(energy).some((id) => typeof id === "string" && hass.states[id])) {
      const el = document.createElement("div");
      el.className = "energy";
      el.innerHTML = `
        <h3><ha-icon icon="mdi:solar-power-variant"></ha-icon>Balkonkraftwerk</h3>
        ${[
          ["solar", "mdi:white-balance-sunny", "Solar"],
          ["einspeisung", "mdi:transmission-tower-import", "Einspeisung"],
          ["akku_ladestand", "mdi:battery", "Akku"],
          ["akku_leistung", "mdi:battery-charging", "Akkuleistung"],
          ["ertrag_heute", "mdi:counter", "Ertrag heute"],
        ]
          .filter(([key]) => energy[key] && hass.states[energy[key]])
          .map(([key, icon, name]) => `<div class="row" data-key="${key}" data-entity="${energy[key]}"><ha-icon icon="${icon}"></ha-icon><span>${name}</span><b></b></div>`)
          .join("")}`;
      el.querySelector("h3").addEventListener("click", () => {
        this._energyCollapsed = el.classList.toggle("collapsed");
      });
      for (const row of el.querySelectorAll(".row")) {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => this._moreInfo(row.dataset.entity));
      }
      // eingeklappt bleibt eingeklappt (auch nach Neuaufbau); Standard: auf schmalen Bildschirmen zu
      const collapsed = this._energyCollapsed ?? !!window.matchMedia?.("(max-width: 600px)").matches;
      el.classList.toggle("collapsed", collapsed);
      this._els.stage.appendChild(el);
      this._energyEl = el;
      el.hidden = this._settings.layers.energy === false;
    }
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

  _activate(entityId) {
    if (!canToggle(entityId)) {
      this._moreInfo(entityId);
      return;
    }
    const domain = domainOf(entityId);
    this._hass.callService(domain, "toggle", { entity_id: entityId }).catch((err) => this._toast(`Schalten fehlgeschlagen: ${err.message ?? err}`));
  }

  _moreInfo(entityId) {
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
        const v = energy[row.dataset.key];
        const text = {
          solar: `${fmt(v, 0)} W`,
          einspeisung: `${fmt(v, 0)} W`,
          akku_ladestand: `${fmt(v, 0)} %`,
          akku_leistung: `${fmt(v, 0)} W`,
          ertrag_heute: `${fmt(v, 2)} kWh`,
        }[row.dataset.key];
        row.querySelector("b").textContent = text;
      }
    }
    this._renderLegend();
  }

  // ------------------------------------------------------------------ Einstellungen

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
            <button data-value="standard">Standard</button><button data-value="cyber">Cyberpunk</button>
          </div>
          <h4>Geräte anzeigen als</h4>
          <div class="seg" data-key="deviceMode">
            <button data-value="icons">Symbole</button><button data-value="3d">3D-Objekte</button>
          </div>
          <h4>Einblenden</h4>
          <div class="toggles">
            ${LAYERS.map(([k, name]) => `<label><input type="checkbox" data-layer="${k}"${st.layers[k] !== false ? " checked" : ""}><span>${name}</span></label>`).join("")}
          </div>
          <p class="hint">Die Einstellungen gelten für dieses Gerät/diesen Browser.</p>
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
        if (seg.dataset.key === "style") {
          this.toggleAttribute("cyber", st.style === "cyber");
          this._scene?.setStyle(st.style);
          this._scene?.setLayers(st.layers);
        }
        this._refreshEntities();
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
    this._els.stage.appendChild(el);
    this._dialog = el;
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
        const same = this._selected && this._selected.floorId === hit.floorId && this._selected.roomId === hit.roomId;
        this._selectRoom(same ? null : hit);
      } else this._selectRoom(null);
    });
    target.addEventListener("contextmenu", (ev) => {
      const hit = this._scene?.pick(ev.clientX, ev.clientY);
      if (hit?.entity_id) {
        ev.preventDefault();
        this._moreInfo(hit.entity_id);
      }
    });
  }

  _selectRoom(sel) {
    this._selected = sel ? { floorId: sel.floorId, roomId: sel.roomId } : null;
    this._scene?.selectRoom(this._selected);
    this._renderRoomPanel();
  }

  /** Raumfenster: Name, Klima und alle Geräte des Bereichs zum Schalten. */
  _renderRoomPanel() {
    const sel = this._selected;
    const floor = sel && this._building?.floors.find((f) => f.id === sel.floorId);
    const room = floor && placesOf(floor).find((r) => r.id === sel.roomId);
    if (!room) {
      this._roomPanel?.remove();
      this._roomPanel = null;
      return;
    }
    const hass = this._hass;
    if (!this._roomPanel) {
      this._roomPanel = document.createElement("div");
      this._roomPanel.className = "roompanel";
      this._els.stage.appendChild(this._roomPanel);
    }
    const ids = (this._byArea.get(room.area_id) ?? []).filter((id) => iconKind(hass.states[id]) || ["temperature", "humidity"].includes(hass.states[id]?.attributes?.device_class));
    const climate = roomClimate(room, hass, this._byArea);
    const parts = [];
    if (climate.temperature != null) parts.push(`${fmt(climate.temperature)} °C`);
    if (climate.humidity != null) parts.push(`${fmt(climate.humidity, 0)} %`);
    const p = this._roomPanel;
    p.innerHTML = `<div class="rp-head"><b></b><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="rp-sub"></div><div class="rp-list"></div>`;
    p.querySelector("b").textContent = room.name;
    p.querySelector(".rp-sub").textContent = [floor.name, ...parts].join(" · ") + (room.area_id ? "" : " · kein Bereich zugeordnet");
    p.querySelector(".close").addEventListener("click", () => this._selectRoom(null));
    const list = p.querySelector(".rp-list");
    if (!ids.length) list.innerHTML = `<div class="rp-empty">Keine Geräte im Bereich.</div>`;
    for (const id of ids) {
      const st = hass.states[id];
      const kind = iconKind(st) ?? "sensor";
      const row = document.createElement("div");
      row.className = "rp-row";
      const active = kind !== "sensor" && isActive(kind, st);
      row.innerHTML = `<span class="rp-icon${active ? (kind === "contact" ? " alert" : " active") : ""}"><ha-icon></ha-icon></span><span class="rp-name"></span><span class="rp-state"></span>`;
      row.querySelector("ha-icon").setAttribute("icon", kind === "sensor" ? (st.attributes.device_class === "humidity" ? "mdi:water-percent" : "mdi:thermometer") : iconFor(kind, st));
      row.querySelector(".rp-name").textContent = st.attributes.friendly_name ?? id;
      row.querySelector(".rp-state").textContent = hass.formatEntityState ? hass.formatEntityState(st) : st.state;
      this._bindIcon(row, id);
      list.appendChild(row);
    }
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
    if (gapCount && confirm(`Zwischen den Räumen gibt es ${plural(gapCount, "Lücke", "Lücken")} (bis 45 cm). Schließen, damit daraus Innenwände werden?\n(Wie „Lücken schließen“ in NeonPlan.)`)) {
      building.floors.forEach((f, i) => (f.rooms = closed[i].rooms));
    }
    const rooms = building.floors.reduce((n, f) => n + f.rooms.length, 0);
    if (!confirm(`Grundriss mit ${plural(building.floors.length, "Etage", "Etagen")} und ${plural(rooms, "Raum", "Räumen")} importieren?\nDer aktuelle Stand wird vorher im Verlauf gesichert.`)) return;
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
        if (!confirm(`Stand vom ${when} wiederherstellen?\nDer aktuelle Stand wird vorher gesichert.`)) return;
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
