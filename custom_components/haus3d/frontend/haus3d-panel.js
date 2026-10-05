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
import { ROOF_TYPES, compass16, fieldInfo, roofModel, roofSettings, weatherEntity, weatherKind } from "./exterior.js";
import { exportFile, normalize, parseImport } from "./model.js";
import { SIM_WEATHER, Simulator } from "./sim.js";
import { FUNCTION_KEYS, LEGACY_FUNCTION_KEYS, MAX_CARDS, WHEEL_VISIBLE, labelPlace, nextStyle, migrateView, nextView, normalizeCards, normalizeFunctions, pointerAngle, rotateWheel, wheelFling, wheelLayout, wheelPlusAngle, wheelPositions } from "./hud.js";
import { entityAction } from "./actions.js";
import { entityPlaces, houseStatus, openState, statusChips } from "./status.js";
import { ALERT_DEFAULTS, evaluateAlerts, exteriorOpenings, normalizeAlerts, visibleAlerts } from "./alerts.js";
import { QUALITY_CHOICES, adaptDpr, idleState, inTimeRange, normalizeIdle, resolveQuality } from "./perf.js";
import { batteryState, batteryText, ema, fieldPower, formatPower, gridState, gridText, surplus } from "./energy.js";
import { sunFromHass } from "./sun.js";
import { lightLook, roomLight } from "./light.js";
import { HouseScene } from "./scene.js";
import { closeGaps } from "./walls.js";
import { EDITOR_STYLE, FloorEditor } from "./editor.js";
import { PANEL_STYLE } from "./panel-style.js";
import { EnergyMethods } from "./panel-energy.js";
import { TabletMethods } from "./panel-tablet.js";
import { VIEW_PRESETS, normalizeViews, poseInBox } from "./camera.js";

import { LONG_PRESS_MS, esc, plural, ENERGY_CORE, energyRows, LAYERS, DEFAULT_SETTINGS, loadSettings, fmt, ICONS, CONTACT_ICONS, DOMAIN_ICONS, SENSOR_ICONS, fmtPower, setText, iconFor, isActive } from "./panel-util.js";
import { DialogMethods } from "./panel-dialogs.js";

/** Uhrzeit der Simulation („echt“ oder HH:MM). */
const simTime = (min) => (min === null || min === undefined ? "echt" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

class Haus3DPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._building = null;
    this._revision = null;
    this._view = "none"; // Bodenfarbe: none | temp | humidity | power
    this._securityView = false; // Sicherheitsansicht (Fenster/Türen grün, orange, rot)
    this._filter = "all";
    try {
      this._filter = localStorage.getItem("haus3d.filter") || "all";
      this._view = migrateView(localStorage.getItem("haus3d.view"), localStorage.getItem("haus3d.temp"));
      this._settings = loadSettings(localStorage.getItem("haus3d.settings"), localStorage.getItem("haus3d.style"));
    } catch {
      /* ohne Speicher */
    }
    // Wandtablet: /haus3d?kiosk&etage=eg (gilt nur für diesen Aufruf), sonst Einstellung dieses Geräts
    try {
      const q = new URLSearchParams(location.search);
      this._kioskUrl = q.has("kiosk");
      this._startFloor = q.get("etage") || this._settings.kiosk?.startFloor || null;
      if (q.get("etage")) this._filter = q.get("etage");
    } catch {
      this._kioskUrl = false;
    }
    this._overlays = new Map(); // key -> {el, position: Vector3, floorId}
    this._watched = [];
    this._watchedRefs = [];
    this._extraWatched = () => this._panelIds();
  }

  set hass(real) {
    this._realHass = real;
    // Simulation: Schicht über dem echten hass, nichts geht an Home Assistant
    const hass = this._sim ? this._sim.wrap(real, { building: this._building, onChange: () => this._simChanged(), onToast: (t) => this._toast(t) }) : real;
    const prev = this._hass;
    this._hass = hass;
    if (!this._built) return;
    if (!prev || prev.themes?.darkMode !== hass.themes?.darkMode) this._applyTheme();
    if (!prev || prev.states?.["sun.sun"] !== hass.states?.["sun.sun"]) {
      this._applyStyle();
      this._applySun();
    }
    if (!prev || prev.user?.is_admin !== hass.user?.is_admin) this._renderToolbar();
    if (!this._building) return;
    if (!prev || prev.entities !== hass.entities || prev.devices !== hass.devices) {
      this._refreshEntities();
      return;
    }
    this._applyWeather();
    const changed = this._watchedChanged();
    if (changed === "membership") this._refreshEntities();
    else if (changed) this._queueUpdate();
  }

  /**
   * Qualitätsstufe anwenden (perf.js). ?quality=… in der Adresse hat Vorrang (z. B. zum Testen).
   * Bei „auto“ wird die Auflösung alle paar Sekunden an die gemessene Bildrate angepasst.
   */
  _applyQuality() {
    if (!this._scene) return;
    let name = this._settings.quality ?? "auto";
    try {
      name = new URLSearchParams(location.search).get("quality") || name;
    } catch {
      /* egal */
    }
    const coarse = !!window.matchMedia?.("(pointer: coarse)").matches;
    const profile = resolveQuality(name, { coarse });
    if (profile.auto) {
      let saved = NaN;
      try {
        saved = Number(localStorage.getItem("haus3d.dpr"));
      } catch {
        /* ohne Speicher */
      }
      if (saved >= 1) profile.dpr = Math.min(saved, profile.maxDpr);
    }
    this._quality = profile;
    this._scene.setQuality(profile);
    clearInterval(this._qualityTimer);
    this._qualityTimer = null;
    if (profile.auto || this._settings.perfHud) this._qualityTimer = setInterval(() => this._qualityTick(), 3000);
    this._perfEl?.remove();
    this._perfEl = null;
    if (this._settings.perfHud) {
      this._perfEl = document.createElement("div");
      this._perfEl.className = "perfhud";
      this._els.stage.appendChild(this._perfEl);
      this._perfRenders = this._scene.stats.renders;
      this._perfAt = performance.now();
      this._qualityTick();
    }
  }

  _qualityTick() {
    const sc = this._scene;
    const q = this._quality;
    if (!sc || !q || !this.isConnected) return;
    if (q.auto && sc.stats.frameMs.length >= 20) {
      const cur = q.dpr ?? q.maxDpr;
      const next = adaptDpr(cur, sc.stats.frameMs, { min: 1, max: q.maxDpr });
      sc.stats.frameMs.length = 0;
      if (next !== cur) {
        q.dpr = next;
        try {
          localStorage.setItem("haus3d.dpr", String(next));
        } catch {
          /* egal */
        }
        sc.setQuality(q);
      }
    }
    if (this._perfEl) {
      const now = performance.now();
      const fps = ((sc.stats.renders - this._perfRenders) * 1000) / Math.max(1, now - this._perfAt);
      this._perfRenders = sc.stats.renders;
      this._perfAt = now;
      this._perfEl.textContent = `${fps.toFixed(1)} Bilder/s · Auflösung ${sc.renderer.getPixelRatio().toFixed(2)} · ${QUALITY_CHOICES.find(([k]) => k === q.name)?.[1] ?? q.name}${q.auto ? " (auto)" : ""}`;
    }
  }

  /**
   * Zustände gebündelt aktualisieren: höchstens einmal pro Bild (viele Sensoren melden kurz
   * nacheinander), im Hintergrund (Tab verborgen) erst beim Zurückkommen.
   */
  _queueUpdate() {
    if (this._updPending) return;
    this._updPending = true;
    const run = () => {
      if (!this._updPending) return;
      cancelAnimationFrame(this._updRaf);
      clearTimeout(this._updTimer);
      this._updPending = false;
      if (document.hidden) {
        this._staleHidden = true;
        return;
      }
      this._updateStates();
    };
    this._updRaf = requestAnimationFrame(run);
    this._updTimer = setTimeout(run, 200); // falls kein Bild kommt
  }

  /** Regen/Schnee aus der Wetter-Entität (settings.weather, sonst die erste weather.*). */
  _applyWeather() {
    const id = weatherEntity(this._hass, this._building?.settings);
    const st = id ? this._hass.states[id] : null;
    if (st === this._weatherRef && id === this._weatherId) return;
    this._weatherRef = st;
    this._weatherId = id;
    this._scene?.setWeather(weatherKind(st));
    if (this._places) this._queueUpdate(); // Hinweis „Regen – Fenster offen“
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
      <label>Uhrzeit <input type="range" min="-15" max="1440" step="15" data-sim="time" value="${sim.time ?? -15}"><span class="tv">${simTime(sim.time)}</span></label>
      <label>Solar <input type="range" min="0" max="1600" step="20" data-sim="solar" value="${sim.solar ?? 0}"><span class="sv">${sim.solar === null ? "echt" : `${sim.solar} W`}</span></label>
      <label><input type="checkbox" data-sim="demo"${this._settings.simDemo ? " checked" : ""}> Beispielgeräte</label>
      <button data-sim="reset">Zurücksetzen</button><button data-sim="stop">Beenden</button>`;
    el.querySelector("[data-sim=weather]").addEventListener("change", (ev) => {
      sim.weather = ev.target.value;
      sim._cache = null;
      this._simChanged();
    });
    el.querySelector("[data-sim=time]").addEventListener("input", (ev) => {
      const v = Number(ev.target.value);
      sim.time = v < 0 ? null : Math.min(1439, v);
      sim._cache = null;
      el.querySelector(".tv").textContent = simTime(sim.time);
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

  set narrow(value) {
    this.toggleAttribute("narrow", !!value);
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    if (!this._built) this._build();
    this._applyKiosk();
    this._setupIdle();
    if (this._scene && !this._qualityTimer && (this._quality?.auto || this._settings.perfHud)) this._applyQuality();
    if (!this._onVisible) {
      this._onVisible = () => {
        // verborgen (anderer Tab, Bildschirm aus): nicht zeichnen
        if (document.hidden) this._scene?.stop();
        else if (!this._editor) this._scene?.start();
        this._applyKiosk();
        if (!document.hidden && this._staleHidden) {
          this._staleHidden = false;
          this._updateStates();
        }
      };
    }
    document.addEventListener("visibilitychange", this._onVisible);
    if (!this._editor) this._scene?.start();
    if (!this._building && !this._loading) this._load();
  }

  disconnectedCallback() {
    this._scene?.stop();
    clearInterval(this._tickTimer);
    this._tickTimer = null;
    this._tickers?.clear();
    clearInterval(this._qualityTimer);
    this._qualityTimer = null;
    document.removeEventListener("visibilitychange", this._onVisible);
    this._wakeLock?.release().catch(() => {});
    this._wakeLock = null;
    clearInterval(this._idleTimer);
    this._idleTimer = null;
  }

  // (Beobachter der Ecken bleibt an der Shadow-DOM-Bühne hängen und wird mit ihr entsorgt)

  // ------------------------------------------------------------------ Aufbau

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${PANEL_STYLE}${EDITOR_STYLE}</style>
      <div class="wrap">
        <header>
          <button class="icon menu" title="Menü"><ha-icon icon="mdi:menu"></ha-icon></button>
          <div class="title">Haus 3D</div>
          <div class="status" aria-label="Status"><div class="people"></div><div class="chips"></div></div>
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
          <button class="kgear" title="Einstellungen"><ha-icon icon="mdi:cog"></ha-icon></button>
          <div class="wheel left"></div>
          <div class="wheel right"></div>
        </div>
      </div>
      <input type="file" accept="application/json,.json" hidden>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._els = {
      floors: $(".floors"),
      status: $(".status"),
      people: $(".people"),
      chips: $(".chips"),
      cards: $(".cards"),
      floorbar: $(".floorbar"),
      kgear: $(".kgear"),
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
    this._els.temp.addEventListener("click", () => this._cycleView());
    this._els.more.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._toggleMenu();
    });
    this._els.file.addEventListener("change", () => this._importFile());
    this.shadowRoot.addEventListener("click", (ev) => {
      if (this._popup && !ev.composedPath().includes(this._popup)) this._closePopup();
    });

    for (const type of ["pointerdown", "keydown", "wheel"]) {
      this.addEventListener(type, () => {
        this._lastInput = Date.now();
        if (this._idle) this._wake();
      }, { capture: true, passive: true });
    }
    // Karten oben rechts und Etagenleiste dürfen sich nicht überdecken (Tablet hochkant/quer)
    this._layoutObs = new ResizeObserver(() => this._queueLayout());
    this._layoutObs.observe(this._els.stage);
    this._layoutObs.observe(this._els.cards);
    this._layoutObs.observe(this._els.floorbar);
    // neue/entfernte Karten (Energie, eigene Karten) ebenfalls beobachten
    new MutationObserver(() => this._queueLayout()).observe(this._els.cards, { childList: true });
    window.addEventListener("resize", () => this._queueLayout());
    this._els.kgear.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._openSettings();
    });
    try {
      this._scene = new HouseScene(this._els.canvas, {
        dark: !!this._hass?.themes?.darkMode,
        onCameraChange: () => {
          this._positionOverlays();
          clearTimeout(this._viewTimer);
          this._viewTimer = setTimeout(() => this._rememberView(), 800);
        },
      });
      this._scene.setLayers(this._settings.layers);
      this._applyQuality();
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
      if (this._settings.sim && !this._sim) {
        if (this.hasAttribute("kiosk")) this._toastAction("Simulation war aktiv.", "Fortsetzen", () => this._setSim(true));
        else this._setSim(true);
      }
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
      if (this._startFloor && !this._startApplied && this._building.floors.some((f) => f.id === this._startFloor || this._startFloor === "all")) this._filter = this._startFloor;
      this._startApplied = true;
      this._scene.filter = this._filter; // wird in setBuilding gegen die Etagen geprüft
      this._scene.setBuilding(this._building, { keepCamera });
      this._applySun();
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

  /** Meldung mit Knopf (z. B. „Fortsetzen“), bleibt 10 s. */
  _toastAction(text, label, run) {
    this._toast(text);
    const el = this._toastEl;
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => {
      el.remove();
      run();
    });
    el.append(" ", b);
    el.classList.add("action");
    setTimeout(() => el.remove(), 10000);
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
    this._els.temp.classList.toggle("on", this._view !== "none");
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
    // gemerkte Ansicht der Etage, solange sie noch zum Haus passt; sonst einpassen
    const saved = this._views()[id];
    this._scene?.setFilter(id, { fit: false });
    if (this._scene && saved && poseInBox(saved, this._scene.viewBox())) this._scene.setView(saved, { duration: 0 });
    else this._scene?.fitCamera();
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
    this._places = entityPlaces(this._building, hass, this._byArea, this._links);
    this._alertSig = null; // Beschriftungen werden neu gebaut
    // Außenwand-Öffnungen nur einmal je Gebäude berechnen (Regen-Hinweis)
    if (this._exteriorFor !== this._building) {
      this._exterior = exteriorOpenings(this._building);
      this._exteriorFor = this._building;
    }
    this._chipKeys = null; // Statusleiste neu aufbauen
    this._buildOverlays();
    this._updateStates();
  }

  /** Beobachtete Entitäten neu bestimmen (eine Stelle: devices.js:watchedEntities). */
  _computeWatched() {
    const hass = this._hass;
    this._watched = watchedEntities(this._building, hass, this._byArea, { links: this._links, extra: this._extraWatched?.() ?? [], power: this._view === "power" });
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
        el.innerHTML = `<div class="label"><b></b><div class="clim" hidden></div><div class="heat" hidden></div><div class="occ" hidden></div><div class="warn" hidden></div><div class="alarmtext" hidden></div></div><div class="devs"></div>`;
        el.querySelector("b").textContent = room.name;
        const devs = el.querySelector(".devs");
        if (!threeD) for (const icon of icons.filter((i) => i.room === room.id && !i.manual)) devs.appendChild(this._iconEl(icon));
        layer.appendChild(el);
        const pos = anchor?.position.clone() ?? new THREE.Vector3(0, elev, 0);
        pos.y += 0.95; // knapp 1 m über dem Boden (bei Hängen über der Fläche)
        const label = el.firstElementChild;
        this._overlays.set(`room:${floor.id}:${room.id}`, { el, label, parts: { clim: label.querySelector(".clim"), heat: label.querySelector(".heat"), occ: label.querySelector(".occ"), warn: label.querySelector(".warn"), alarm: label.querySelector(".alarmtext") }, floorId: floor.id, position: pos, room });
      }
      // Geräte mit manueller Position (placements) stehen frei an ihrer Stelle
      for (const icon of icons.filter((i) => i.manual && !threeD)) {
        const el = this._iconEl(icon);
        el.classList.add("free");
        layer.appendChild(el);
        this._overlays.set(`icon:${floor.id}:${icon.entity_id}`, { el, floorId: floor.id, position: new THREE.Vector3(icon.x, elev + (icon.y ?? 1.3), icon.z), free: true });
      }
    }
    // PV-Felder auf dem Dach: Schild mit Leistung (eigener Sensor oder „ca.“), Tipp → Infokarte
    this._pvInfo = this._pvFieldInfo();
    for (const a of this._scene.anchors) {
      if (!a.key.startsWith("pv:")) continue;
      const id = a.key.slice(3);
      const info = this._pvInfo.get(id);
      if (!info) continue;
      const el = document.createElement("button");
      el.className = "pvbadge";
      el.innerHTML = `<span class="pn"></span><b></b>`;
      el.querySelector(".pn").textContent = info.short;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._pvCard(id);
      });
      el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      layer.appendChild(el);
      this._overlays.set(a.key, { el, floorId: null, roof: true, pvField: id, position: a.position });
    }
    this._energyEl?.remove();
    this._energyEl = null;
    this._energySetupEl?.remove();
    this._energySetupEl = null;
    const rows = energyRows(this._building.settings?.energy ?? {}, hass);
    const energyCfg = this._building.settings?.energy ?? {};
    const unset = !Object.entries(energyCfg).some(([k, v]) => k !== "extra" && typeof v === "string" && v.includes(".")) && !(energyCfg.extra ?? []).length;
    if (!rows.length && unset && hass.user?.is_admin && this._settings.layers.energy !== false && !this._cardState().energieSetupHidden) {
      // frische Installation: Hinweis statt leerer Karte
      const el = document.createElement("div");
      el.className = "energy setup";
      el.innerHTML = `<h3><ha-icon icon="mdi:lightning-bolt-circle"></ha-icon><span>Energie einrichten</span><ha-icon class="icon x" icon="mdi:close" title="Ausblenden"></ha-icon></h3>`;
      el.querySelector("h3").addEventListener("click", () => {
        this._openSettings();
        setTimeout(() => this._dialog?.querySelector(".energy-cfg")?.scrollIntoView({ block: "start" }), 50);
      });
      el.querySelector(".x").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._cardState({ energieSetupHidden: true });
        el.remove();
      });
      this._els.cards.appendChild(el);
      this._energySetupEl = el;
    }
    if (rows.length) {
      const el = document.createElement("div");
      el.className = "energy";
      el.innerHTML = `<h3><ha-icon icon="mdi:lightning-bolt-circle"></ha-icon><span>Energie</span><i class="sdot" hidden></i><ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></h3>` +
        rows.map((r, i) => `<div class="row" data-i="${i}" data-k="${r.key ?? ""}"><ha-icon icon="${r.icon}"></ha-icon><span></span>${r.key === "ertrag_heute" ? "" : `<svg class="spark" viewBox="0 0 60 16" preserveAspectRatio="none" hidden><path/></svg>`}<b></b>${r.key === "akku_ladestand" ? `<i class="bbar"><i></i></i>` : ""}</div>`).join("");
      rows.forEach((r, i) => (el.querySelector(`.row[data-i="${i}"] span`).textContent = r.name));
      el.querySelector("h3").addEventListener("click", () => {
        this._energyCollapsed = el.classList.toggle("collapsed");
        this._queueLayout();
        this._cardState({ energie: this._energyCollapsed });
        this._refreshSparks();
      });
      el.querySelector(".chev").insertAdjacentHTML("beforebegin", `<ha-icon class="chart" icon="mdi:chart-line" title="Tagesverlauf"></ha-icon>`);
      el.querySelector(".chart").addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._energyChart(0);
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
      this._sparkAt = 0;
      setTimeout(() => this._refreshSparks(), 0);
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
    const lights = new Map(); // Raum → {color, level} (echtes Licht)
    const lightColors = this._settings.layers.lightcolor !== false;
    const temps = new Map();
    const open = new Set();
    const covers = new Map();
    const roomAlerts = new Map();
    const view = this._securityView ? "none" : this._view;
    const security = { tilted: new Set(), closed: new Set() };
    VIEW_MODES.humidity.warn = Number(this._building.settings?.climate?.humidity_max) || 65;
    const heatRooms = new Set();
    // Werte der Energie-Anzeige (PV, Einspeisung, Akku) zählen nicht als Raumverbrauch
    const energyIds = new Set(Object.values(this._building.settings?.energy ?? {}).filter((v) => typeof v === "string"));
    const now = Date.now();
    const showPresence = this._settings.layers.presence !== false;
    const holdMs = Math.max(1, Number(this._building.settings?.presence?.hold_minutes) || 5) * 60000;
    let recent = false;
    // Kontakte, die irgendeiner Öffnung (auf irgendeiner Etage) zugeordnet sind
    const linkedContacts = new Set([...this._links.values()].flatMap((m) => [...m.values()].map((l) => l.contact)).filter(Boolean));
    for (const floor of this._building.floors) {
      const links = this._links.get(floor.id);
      for (const o of floor.openings) {
        const l = links.get(o.id);
        if (!l) continue;
        const key = `${floor.id}:${o.id}`;
        if (l.contact && isOpen(hass.states[l.contact])) open.add(key);
        if (l.contact) {
          const os = openState(hass.states[l.contact], l.tilt ? hass.states[l.tilt] : null);
          if (os === "tilted") {
            security.tilted.add(key);
            open.add(key);
          } else if (os === "closed" && this._securityView) security.closed.add(key);
        }
        if (l.cover) {
          const st = hass.states[l.cover];
          covers.set(key, coverClosedFraction(st));
          if (o.type === "garage" && isOpen(st)) open.add(key);
        }
      }
      for (const room of placesOf(floor)) {
        const key = `${floor.id}:${room.id}`;
        if (roomLit(room, hass, this._byArea)) {
          lit.add(key);
          const look = lightColors ? roomLight(room, hass, this._byArea) : null;
          if (look) lights.set(key, look);
        }
        const climate = roomClimate(room, hass, this._byArea);
        const th = roomHeating(room, hass, this._byArea);
        if (th?.action === "heating") heatRooms.add(key);
        const value = view === "temp" ? climate.temperature : view === "humidity" ? climate.humidity : view === "power" ? roomPower(room, hass, this._byArea, energyIds) : null;
        temps.set(key, value);
        // offene Kontakte im Bereich, die keiner Öffnung zugeordnet sind
        const unassigned = (this._byArea.get(room.area_id) ?? []).filter(
          (id) => !linkedContacts.has(id) && iconKind(hass.states[id]) === "contact" && isOpen(hass.states[id]),
        );
        roomAlerts.set(key, unassigned.length);
        const ov = this._overlays.get(`room:${key}`);
        if (ov) {
          // nur Texte setzen (kein Neuaufbau): flackert nicht und verschluckt keine Tipps
          const parts = [];
          if (climate.temperature != null) parts.push(`${fmt(climate.temperature)} °C`);
          if (climate.humidity != null) parts.push(`${fmt(climate.humidity, 0)} %`);
          if (view === "power") parts.push(value != null ? fmtPower(value) : "– W");
          setText(ov.parts.clim, parts.join(" · "));
          setText(ov.parts.heat, th?.action === "heating" ? `heizt${th.target != null ? ` → ${fmt(th.target)} °C` : ""}` : "");
          setText(ov.parts.warn, unassigned.length ? `${unassigned.length} offen` : "");
          // Anwesenheit: Bewegung jetzt oder vor kurzem
          const pr = showPresence ? roomPresence(room, hass, this._byArea, now, holdMs) : { level: null };
          if (pr.level === "recent") recent = true;
          setText(ov.parts.occ, pr.level === "occupied" ? "● Bewegung" : pr.level === "recent" ? `Bewegung ${agoText(now - pr.since)}` : "");
          ov.parts.occ.classList.toggle("now", pr.level === "occupied");
        }
      }
    }
    const energy = energyValues(this._building.settings, hass);
    const onEntities = new Set(this._watched.filter((id) => hass.states[id]?.state === "on"));
    const lightLooks = new Map();
    if (lightColors) for (const id of onEntities) if (id.startsWith("light.")) lightLooks.set(id, lightLook(hass.states[id]));
    const heating = new Set(this._watched.filter((id) => id.startsWith("climate.") && hass.states[id]?.attributes?.hvac_action === "heating"));
    const alertRooms = this._evalAlerts(energy);
    if (this._securityView) temps.clear(); // Böden neutral grau
    this._scene?.applyStates({ security, lit, temps, tempMode: view !== "none" || this._securityView, tempColor: (v) => viewColor(view, v) ?? [0.6, 0.6, 0.6], open, covers, feedIn: energy.einspeisung, onEntities, heating, heatRooms, alerts: alertRooms, lights, lightLooks });
    this._renderRoomPanel();

    for (const { el, icon } of this._iconEls) {
      const st = hass.states[icon.entity_id];
      if (!st) continue;
      const active = isActive(icon.kind, st);
      const alertKind = icon.kind === "contact" || icon.kind === "lock";
      el.classList.toggle("active", active && !alertKind);
      el.classList.toggle("alert", active && alertKind);
      el.classList.toggle("unavailable", st.state === "unavailable");
      el.firstElementChild.setAttribute("icon", iconFor(icon.kind, st));
      el.title = `${st.attributes.friendly_name ?? st.entity_id}: ${hass.formatEntityState ? hass.formatEntityState(st) : st.state}`;
    }

    if (this._energyEl) {
      this._updateEnergy(energy, hass);
      this._refreshSparks(); // höchstens alle 5 min
    }
    this._updatePv(energy, hass);
    this._updateCards();
    this._updateWheelStates();
    this._renderLegend();
    this._updateStatusBar();
    this._updatePeople();
    // „vor n min“ weiterzählen, solange ein Raum „kürzlich“ ist
    this._needTick("presence", recent);
  }

  /** PV-Felder (roof.items) mit Kenndaten: Name, kWp, Ausrichtung, Neigung, Entitäten. */
  _pvFieldInfo() {
    const out = new Map();
    const items = (this._building?.settings?.roof?.items ?? []).filter((it) => it?.type === "pv" && it.id);
    if (!items.length) return out;
    const model = this._scene?.roofModel ?? roofModel(this._building);
    if (!model) return out;
    const north = Number(this._building.settings?.north) || 0;
    items.forEach((it, i) => {
      const f = fieldInfo(model, it, north, this._building.settings.roof.items);
      const dir = f.azimuth === null ? "flach" : compass16(f.azimuth);
      out.set(it.id, { ...f, id: it.id, name: it.name || `PV ${dir}`, short: it.name || dir, dir, entity: it.entity || null, energy: it.energy_entity || null, index: i });
    });
    return out;
  }

  /** Leistung je PV-Feld: Schilder und Glanz der Module. */
  _updatePv(energy, hass) {
    if (!this._pvInfo?.size) return;
    const lang = hass.locale?.language;
    const fields = [...this._pvInfo.values()].map((f) => {
      const st = f.entity ? hass.states[f.entity] : null;
      const w = st ? Number(st.state) * (st.attributes?.unit_of_measurement === "kW" ? 1000 : 1) : NaN;
      return { id: f.id, kwp: f.kwp, azimuth: f.azimuth, tilt: f.tilt, w: Number.isFinite(w) ? w : null };
    });
    const power = fieldPower(fields, energy.haus_pv, sunFromHass(hass));
    this._pvPower = power;
    const ratios = new Map();
    for (const [id, p] of power) {
      const f = this._pvInfo.get(id);
      if (Number.isFinite(p.w) && f.kwp > 0) ratios.set(id, p.w / (f.kwp * 1000));
      const ov = this._overlays.get(`pv:${id}`);
      if (ov) setText(ov.el.querySelector("b"), Number.isFinite(p.w) ? `${p.estimated ? "ca. " : ""}${formatPower(p.w, lang)}` : `${fmt(f.kwp, 2)} kWp`);
    }
    this._scene?.setPvPower(ratios);
  }

  /** Infokarte eines PV-Felds: Module/kWp, Ausrichtung/Neigung, Leistung jetzt, W je kWp, Ertrag heute. */
  _pvCard(id) {
    const f = this._pvInfo?.get(id);
    if (!f) return;
    this._closePopup();
    const hass = this._hass;
    const lang = hass.locale?.language;
    const p = this._pvPower?.get(id);
    const est = p?.estimated ? "ca. " : "";
    const yieldSt = f.energy ? hass.states[f.energy] : null;
    const rows = [
      ["Module", `${f.count} × ${f.wp} Wp = ${fmt(f.kwp, 2)} kWp`],
      ["Ausrichtung", f.azimuth === null ? "flach" : `${Math.round(f.azimuth)}° (${f.dir}) · Neigung ${Math.round(f.tilt)}°`],
      ["Leistung jetzt", Number.isFinite(p?.w) ? `${est}${formatPower(p.w, lang)}` : "–"],
      ["je kWp", Number.isFinite(p?.w) && f.kwp > 0 ? `${est}${fmt(p.w / f.kwp, 0)} W` : "–"],
      ["Ertrag heute", yieldSt ? (hass.formatEntityState ? hass.formatEntityState(yieldSt) : `${yieldSt.state} ${yieldSt.attributes?.unit_of_measurement ?? ""}`) : "–"],
    ];
    const el = document.createElement("div");
    el.className = "popup pvpop";
    el.innerHTML = `<div class="head"></div><div class="scroll">${rows.map(() => `<div class="item"><span></span><b></b></div>`).join("")}${p?.estimated ? `<p class="hint">Geschätzt aus der Gesamtleistung (PV Dach) nach Größe und Sonnenstand.</p>` : ""}</div>${f.entity ? `<div class="foot"><button class="more"><ha-icon icon="mdi:information-outline"></ha-icon><span>Weitere Infos</span></button></div>` : ""}`;
    el.querySelector(".head").textContent = `PV-Feld ${f.name}`;
    el.querySelectorAll(".item").forEach((row, i) => {
      row.querySelector("span").textContent = rows[i][0];
      row.querySelector("b").textContent = rows[i][1];
    });
    el.querySelector(".more")?.addEventListener("click", () => {
      this._closePopup();
      this._moreInfo(f.entity);
    });
    el.addEventListener("click", (ev) => ev.stopPropagation());
    this._els.stage.appendChild(el);
    this._popup = el;
  }

  /** Energie-Karte: Werte, Akku-Balken und -Restzeit, Netz-Richtung, Überschuss-Punkt, Kurzanzeige. */
  _updateEnergy(energy, hass) {
    const cfg = this._building.settings?.energy ?? {};
    const lang = hass.locale?.language;
    const bat = batteryState(energy.akku_ladestand, energy.akku_leistung, { invert: !!cfg.akku_invert, capacityKWh: cfg.akku_kapazitaet, reservePct: cfg.akku_reserve ?? 10 });
    // Restzeit glätten (Akkuleistung schwankt), Richtungswechsel setzt zurück
    const e = (this._energyEma = this._energyEma ?? {});
    if (bat.dir !== e.dir) Object.assign(e, { dir: bat.dir, eta: null });
    e.eta = ema(e.eta, bat.etaMin);
    const batS = { ...bat, etaMin: Number.isFinite(e.eta) ? e.eta : bat.etaMin };
    const grid = gridState(energy.netz, !!cfg.netz_invert);
    const sur = surplus({ netz: energy.netz, netzInvert: !!cfg.netz_invert, einspeisung: energy.einspeisung }, cfg.ueberschuss, this._surplusLevel);
    this._surplusLevel = sur.level;
    const texts = {};
    for (const row of this._energyEl.querySelectorAll(".row")) {
      const r = this._energyRows[Number(row.dataset.i)];
      const v = energy[r.key];
      let text;
      if (!r.key) text = hass.states[r.entity] ? (hass.formatEntityState ? hass.formatEntityState(hass.states[r.entity]) : hass.states[r.entity].state) : "–";
      else if (r.key === "netz") text = gridText(grid, lang);
      else if (r.key === "akku_leistung") text = bat.dir ? batteryText(batS, Date.now(), lang) : "–";
      else if (r.key === "akku_ladestand") text = `${fmt(v, 0)} %`;
      else if (r.key === "ertrag_heute") text = `${fmt(v, 2)} kWh`;
      else text = formatPower(v, lang);
      texts[r.key ?? ""] = texts[r.key ?? ""] ?? text;
      setText(row.querySelector("b"), text);
      if (r.key === "netz") {
        row.classList.toggle("import", grid.dir === "import");
        row.classList.toggle("export", grid.dir === "export");
      }
      if (r.key === "akku_leistung") row.firstElementChild.setAttribute("icon", bat.dir === "charge" || bat.dir === "discharge" ? bat.icon : "mdi:battery-charging");
      if (r.key === "akku_ladestand") {
        row.firstElementChild.setAttribute("icon", batteryState(v, null).icon);
        const bar = row.querySelector(".bbar");
        bar.className = `bbar ${bat.level ?? ""}`;
        bar.firstElementChild.style.width = `${Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0}%`;
      }
    }
    const dot = this._energyEl.querySelector(".sdot");
    dot.hidden = !sur.level;
    dot.className = `sdot ${sur.level ?? ""}`;
    dot.title = sur.level ? `Überschuss ${sur.level}: ${formatPower(sur.w, lang)}${sur.proxy ? " (Einspeisung Balkonkraftwerk)" : ""}` : "";
    // eingeklappt: gewählter Wert (settings.energy.kurz), sonst der erste
    const arrow = { charge: " ↑", discharge: " ↓" }[bat.dir] ?? "";
    const short = {
      akku: Number.isFinite(energy.akku_ladestand) ? `Akku ${fmt(energy.akku_ladestand, 0)} %${arrow}` : null,
      solar: Number.isFinite(energy.solar ?? energy.haus_pv) ? `☀ ${formatPower(energy.solar ?? energy.haus_pv, lang)}` : null,
      netz: grid.dir ? gridText(grid, lang) : null,
      verbrauch: Number.isFinite(energy.verbrauch) ? `Verbrauch ${formatPower(energy.verbrauch, lang)}` : null,
      ueberschuss: sur.level ? `☀ Überschuss ${formatPower(sur.w, lang)}` : null,
    }[cfg.kurz] ?? this._energyEl.querySelector(".row b")?.textContent ?? "";
    setText(this._energyEl.querySelector(".short"), short);
  }

  /** Ausgeblendete Hinweise (dieses Gerät): {key: Zeitpunkt}. */
  _alertAck(next) {
    try {
      if (next) localStorage.setItem("haus3d.alerts.ack", JSON.stringify(next));
      return next ?? JSON.parse(localStorage.getItem("haus3d.alerts.ack") || "{}") ?? {};
    } catch {
      return next ?? this._ackMem ?? {};
    }
  }

  /**
   * Hinweise auswerten (alerts.js) und anzeigen: Banner, Glocke, Zeile am Raumnamen, Bodenfarbe.
   * Neu gezeichnet wird nur, wenn sich die Hinweise ändern.
   * @returns {Map<string, string>} Raum → Stufe (für die Bodenfarbe)
   */
  _evalAlerts(energy) {
    const hass = this._hass;
    const weather = weatherKind(this._weatherRef ?? null).kind;
    const res = evaluateAlerts({
      building: this._building, hass, byArea: this._byArea, links: this._links, places: this._places ?? new Map(), exterior: this._exterior ?? new Set(),
      weather, energy, now: Date.now(), cfg: this._building.settings?.alerts, humidityMax: Number(this._building.settings?.climate?.humidity_max) || 65,
    });
    this._needTick("alerts", res.pending);
    // Ausblenden gilt, bis der Hinweis verschwindet (dann darf er wiederkommen)
    let ack = this._alertAck();
    const keys = new Set(res.alerts.map((a) => a.key));
    const pruned = Object.fromEntries(Object.entries(ack).filter(([k]) => keys.has(k)));
    if (Object.keys(pruned).length !== Object.keys(ack).length) ack = this._alertAck(pruned);
    const visible = visibleAlerts(res.alerts, ack);
    this._alerts = res.alerts;
    this._visibleAlerts = visible;
    const rooms = new Map();
    for (const a of visible) {
      if (!a.roomId) continue;
      const k = `${a.floorId}:${a.roomId}`;
      if (!rooms.has(k) || a.level === "critical") rooms.set(k, a.level);
    }
    const sig = visible.map((a) => a.key).join("|");
    if (sig !== this._alertSig) {
      this._alertSig = sig;
      this._renderAlerts();
    }
    return rooms;
  }

  /** Banner oben, Glocke in der Statusleiste, Zeile am Raumnamen. */
  _renderAlerts() {
    const list = this._visibleAlerts ?? [];
    // Raumnamen
    for (const ov of this._overlays.values()) {
      if (!ov.parts) continue;
      const mine = list.filter((x) => ov.room && x.roomId === ov.room.id && ov.floorId === x.floorId);
      const a = mine[0];
      setText(ov.parts.alarm, a ? `${a.text}${mine.length > 1 ? ` (+${mine.length - 1})` : ""}` : "");
      ov.label.classList.toggle("alarm", !!a);
      ov.label.classList.toggle("crit", a?.level === "critical");
    }
    // Hinweis (Warnung/kritisch) weckt das ruhende oder gedimmte Tablet und zeigt den Raum
    const top = list[0];
    if (top && top.level !== "info" && (this._idle || this._dimmer)) {
      this._wake();
      if (top.roomId) setTimeout(() => this._showAlert(top), 0);
    }
    // Banner (Karten rücken auf schmalen Bildschirmen darunter)
    this._alertBar?.remove();
    this._alertBar = null;
    this._els.stage.classList.toggle("alerting", list.length > 0);
    if (list.length) {
      const a = list[0];
      const el = document.createElement("div");
      el.className = `alertbar ${a.level}`;
      el.setAttribute("role", "alert");
      el.innerHTML = `<ha-icon icon="${esc(a.icon)}"></ha-icon><span class="at"></span>${list.length > 1 ? `<button class="more" title="Alle Hinweise">+${list.length - 1}</button>` : ""}${a.roomId ? `<button class="show">Zeigen</button>` : ""}<button class="ack" title="Ausblenden, bis sich etwas ändert">Ausblenden</button>`;
      el.querySelector(".at").textContent = a.text;
      el.querySelector(".show")?.addEventListener("click", () => this._showAlert(a));
      el.querySelector(".ack").addEventListener("click", () => this._ackAlert(a));
      el.querySelector(".more")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._alertsPopup();
      });
      this._els.stage.appendChild(el);
      this._alertBar = el;
    }
    // Glocke
    const box = this._els?.chips;
    let bell = this._els?.status?.querySelector(".bell");
    if (!list.length) bell?.remove();
    else {
      if (!bell) {
        bell = document.createElement("button");
        bell.className = "chip bell";
        bell.innerHTML = `<ha-icon icon="mdi:bell-ring-outline"></ha-icon><span></span>`;
        bell.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._alertsPopup();
        });
        box?.parentElement.insertBefore(bell, box);
      }
      bell.classList.toggle("crit", list.some((x) => x.level === "critical"));
      bell.querySelector("span").textContent = String(list.length);
      bell.title = `${list.length} Hinweis${list.length > 1 ? "e" : ""}`;
    }
  }

  _showAlert(a) {
    this._closePopup();
    if (!a.roomId) return;
    this._setFilter(a.floorId);
    this._selectRoom({ floorId: a.floorId, roomId: a.roomId });
  }

  _ackAlert(a) {
    const ack = this._alertAck();
    ack[a.key] = Date.now();
    this._alertAck(ack);
    this._alertSig = null;
    this._closePopup();
    this._updateStates();
  }

  /**
   * Gemeinsamer Takt (15 s) für zeitabhängige Anzeigen, nur solange ihn jemand braucht
   * (Anwesenheit „vor n min“, später Hinweise mit Dauer, Ruhemodus).
   */
  _needTick(who, on) {
    this._tickers = this._tickers ?? new Set();
    if (on) this._tickers.add(who);
    else this._tickers.delete(who);
    if (this._tickers.size && !this._tickTimer) this._tickTimer = setInterval(() => this._onTick(), 15000);
    else if (!this._tickers.size && this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  _onTick() {
    if (!this.isConnected || document.hidden) return;
    if (this._tickers?.has("presence") || this._tickers?.has("alerts")) this._queueUpdate();
  }

  /** Statusleiste in der Kopfzeile: Chips werden nur neu gebaut, wenn sich ihre Art ändert. */
  _updateStatusBar() {
    const box = this._els?.chips;
    if (!box || !this._places) return;
    const show = this._settings.layers.status !== false;
    this._els.status.hidden = !show && this._settings.layers.presence === false;
    box.hidden = !show;
    if (!show) return;
    const status = houseStatus(this._building, this._hass, this._byArea, this._links, this._places);
    this._status = status;
    const chips = statusChips(status);
    // Solarüberschuss: guter Moment für Waschmaschine & Co.
    if (this._surplusLevel === "hoch" && this._energyEl && !this._energyEl.hidden) chips.push({ key: "sun", icon: "mdi:solar-power", text: "Überschuss", level: "ok" });
    const keys = chips.map((c) => c.key).join(",");
    if (keys !== this._chipKeys) {
      this._chipKeys = keys;
      box.innerHTML = chips.map((c) => `<button class="chip ${c.level}" data-key="${c.key}"><ha-icon icon="${c.icon}"></ha-icon><span></span></button>`).join("");
      box.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (b.dataset.key === "sun") {
          if (this._energyEl?.classList.contains("collapsed")) this._energyEl.querySelector("h3").click();
          return;
        }
        this._statusPopup(b.dataset.key);
      }));
    }
    for (const c of chips) {
      const b = box.querySelector(`.chip[data-key="${c.key}"]`);
      if (!b) continue;
      setText(b.querySelector("span"), c.text);
      b.title = c.text;
    }
    this._updateFloorBadges(status.perFloor);
  }

  /** Zahl offener Fenster bzw. brennender Lichter an den Etagen der Leiste. */
  _updateFloorBadges(perFloor) {
    const bar = this._els?.floorbar;
    if (!bar) return;
    for (const b of bar.querySelectorAll("[data-floor]")) {
      const f = perFloor?.get(b.dataset.floor);
      let badge = b.querySelector(".badge");
      const n = f ? f.open || f.lights : 0;
      if (!n || this._settings.layers.status === false) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        b.appendChild(badge);
      }
      badge.className = `badge${f.open ? " warn" : ""}`;
      badge.textContent = String(n);
      b.title = [f.open ? `${f.open} offen` : "", f.lights ? `${f.lights} Licht an` : ""].filter(Boolean).join(" · ");
    }
  }

  /** Personen als runde Bilder (zu Hause farbig, unterwegs grau mit Ort). */
  _updatePeople() {
    const box = this._els?.people;
    if (!box) return;
    const hide = this._settings.layers.presence === false || this._building?.settings?.presence?.hide_persons;
    const list = hide ? [] : persons(this._hass);
    const sig = list.map((p) => `${p.entity_id}|${p.home}|${p.zone}|${p.picture}`).join(";") + (this._settings.initialsOnly ? "|i" : "");
    if (sig === this._peopleSig) return;
    this._peopleSig = sig;
    box.hidden = !list.length;
    box.innerHTML = list
      .map((p) => {
        const pic = p.picture && !this._settings.initialsOnly ? `<img alt="" src="${esc(p.picture)}">` : `<span class="ini">${esc(p.name.slice(0, 2).toUpperCase())}</span>`;
        return `<button class="avatar${p.home ? " home" : " away"}" data-entity="${esc(p.entity_id)}" title="${esc(`${p.full}: ${p.zone}`)}">${pic}${p.home ? "" : `<small>${esc(p.zone)}</small>`}</button>`;
      })
      .join("");
    box.querySelectorAll(".avatar").forEach((b) => b.addEventListener("click", () => this._moreInfo(b.dataset.entity)));
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
      revision: this._revision,
      onSave: async (building, { keepOpen = false } = {}) => {
        try {
          const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
          this._setBuilding(res.building, res.revision, { keepCamera: true });
          if (!keepOpen) this._toast("Gespeichert.");
          return res.revision;
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

  /** Licht aus Richtung der echten Sonne (sun.sun bzw. Breite/Länge), Ebene „Sonnenstand“. */
  _applySun() {
    if (!this._scene) return;
    const on = this._settings.layers.sun !== false;
    this._scene.setSun(on ? sunFromHass(this._hass) : null, Number(this._building?.settings?.north) || 0);
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
    if (this._building && this._places) {
      this._peopleSig = null;
      this._updateStatusBar();
      this._updatePeople();
    }
    this._renderWheels?.();
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
        const ent = hit?.entity_id ?? (hit?.pvField ? this._pvInfo?.get(hit.pvField)?.entity : null);
        if (ent) {
          down.long = true;
          this._moreInfo(ent);
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
      else if (hit?.pvField) this._pvCard(hit.pvField);
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
    this._rewatch(); // Geräte der offenen Raumfenster mit beobachten
    this._renderRoomPanel();
  }

  /**
   * Raumfenster: Name, Klima, Schnellaktionen und die Geräte des Raums in Gruppen; verschiebbar, mit
   * „Geräte anpassen“ für Admins. Wird einmal aufgebaut und danach nur aktualisiert (Text, Klassen),
   * damit Tipps nicht verloren gehen und die Liste mit dem Finger scrollt.
   */
  _renderRoomPanel() {
    this._panels = this._panels ?? [];
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
        // oben links, unter einem Hinweis-Banner (sonst liegt der Banner über dem Kopf)
        const top = this._alertBar?.isConnected ? this._alertBar.offsetTop + this._alertBar.offsetHeight + 8 : 12;
        p.x = p.x ?? 12 + idx * 28;
        p.y = p.y ?? top + idx * 28;
        this._els.stage.appendChild(p.el);
        this._dragPanel(p);
      }
      p.el.style.left = `${p.x}px`;
      p.el.style.top = `${p.y}px`;
      this._updateRoomPanel(p, floor, room);
    });
  }

  /** Geräte, die ein Raumfenster zeigt (ohne ausgeblendete). */
  _panelEntities(room) {
    const hass = this._hass;
    return roomEntities(room, hass, this._byArea, this._building).filter((id) => displayKind(hass.states[id]));
  }

  /** IDs aller geöffneten Raumfenster (werden zusätzlich beobachtet). */
  _panelIds() {
    const out = [];
    for (const p of this._panels ?? []) {
      const floor = this._building?.floors.find((f) => f.id === p.floorId);
      const room = floor && placesOf(floor).find((r) => r.id === p.roomId);
      if (room) out.push(...this._panelEntities(room));
    }
    return out;
  }

  /** Gerüst eines Raumfensters bauen (einmal bzw. wenn sich die Geräteliste ändert). */
  _createRoomPanel(p, floor, room, ids) {
    const hass = this._hass;
    const admin = !!hass.user?.is_admin;
    p.el.innerHTML = `<div class="rp-head"><ha-icon class="grip" icon="mdi:drag"></ha-icon><b></b>${admin ? `<button class="icon cfg" title="Geräte anpassen"><ha-icon icon="mdi:tune-variant"></ha-icon></button>` : ""}<button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="rp-sub"></div><div class="rp-clim" hidden><span class="cv"></span><span class="vent" hidden></span></div><div class="rp-actions"></div><div class="rp-list"></div>`;
    p.el.querySelector("b").textContent = room.name;
    p.el.querySelector(".close").addEventListener("click", () => this._selectRoom({ floorId: p.floorId, roomId: p.roomId }, { toggle: true }));
    p.el.querySelector(".cfg")?.addEventListener("click", () => this._customizeRoom(p, room));
    // Schnellaktionen
    const acts = roomActions(ids, hass);
    p.actions = acts;
    const bar = p.el.querySelector(".rp-actions");
    const btn = (cls, icon, text, title = text) => `<button class="${cls}" title="${esc(title)}"><ha-icon icon="${icon}"></ha-icon><span>${esc(text)}</span></button>`;
    let html = "";
    if (acts.lights.all.length) html += btn("act-light", "mdi:lightbulb-group", "Licht");
    if (acts.covers.length) html += `<span class="seg">${btn("act-up", "mdi:arrow-up", "Auf")}${btn("act-stop", "mdi:stop", "Stopp")}${btn("act-down", "mdi:arrow-down", "Zu")}</span>`;
    if (acts.climate) html += `<span class="stepper"><button class="act-minus" title="kälter">−</button><span class="target"></span><button class="act-plus" title="wärmer">+</button></span>`;
    for (const id of acts.scenes) html += `<button class="chip act-scene" data-entity="${esc(id)}"><ha-icon icon="mdi:palette"></ha-icon><span>${esc(hass.states[id]?.attributes?.friendly_name ?? id)}</span></button>`;
    bar.innerHTML = html;
    bar.hidden = !html;
    const bulk = (domain, service, list) => {
      if (!list.length) return;
      this._hass.callService(domain, service, { entity_id: list }).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
    };
    bar.querySelector(".act-light")?.addEventListener("click", () => {
      const on = p.actions.lights.on;
      if (on.length) bulk("light", "turn_off", on);
      else bulk("light", "turn_on", p.actions.lights.all);
    });
    bar.querySelector(".act-up")?.addEventListener("click", () => bulk("cover", "open_cover", p.actions.covers));
    bar.querySelector(".act-stop")?.addEventListener("click", () => bulk("cover", "stop_cover", p.actions.covers));
    bar.querySelector(".act-down")?.addEventListener("click", () => bulk("cover", "close_cover", p.actions.covers));
    const step = (n) => {
      const c = p.actions.climate;
      if (!c) return;
      const now = performance.now();
      const cur = p.pending && now < p.pending.until ? p.pending.value : null;
      const value = stepTarget(c, cur, n);
      p.pending = { value, until: now + 10000 };
      this._updateRoomPanel(p, floor, room);
      clearTimeout(p.climateTimer);
      // gesammelt senden: ein Aufruf nach kurzer Pause
      p.climateTimer = setTimeout(() => {
        this._hass.callService("climate", "set_temperature", { entity_id: c.entity, temperature: value }).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
      }, 700);
    };
    bar.querySelector(".act-minus")?.addEventListener("click", () => step(-1));
    bar.querySelector(".act-plus")?.addEventListener("click", () => step(1));
    bar.querySelectorAll(".act-scene").forEach((b) => b.addEventListener("click", () => this._runAction(b.dataset.entity, { source: "wheel", quiet: false })));
    // Geräte in Gruppen
    const list = p.el.querySelector(".rp-list");
    p.rows = new Map();
    if (!ids.length) list.innerHTML = `<div class="rp-empty">Keine Geräte.${admin ? " Über das Regler-Symbol oben hinzufügen." : ""}</div>`;
    for (const g of groupRoomEntities(ids, hass)) {
      const h = document.createElement("div");
      h.className = "rp-group";
      h.textContent = g.title;
      list.appendChild(h);
      for (const id of g.ids) {
        const row = document.createElement("div");
        row.className = "rp-row";
        row.dataset.entity = id;
        row.innerHTML = `<span class="rp-icon"><ha-icon></ha-icon></span><span class="rp-name"></span><span class="rp-state"></span>`;
        this._bindIcon(row, id);
        list.appendChild(row);
        p.rows.set(id, { row, icon: row.querySelector("ha-icon"), dot: row.firstElementChild, name: row.querySelector(".rp-name"), state: row.querySelector(".rp-state") });
      }
    }
  }

  /** Raumfenster aktualisieren: nur Texte und Klassen; neu aufbauen nur, wenn sich die Geräte ändern. */
  _updateRoomPanel(p, floor, room) {
    const hass = this._hass;
    const ids = this._panelEntities(room);
    const sig = `${ids.join(",")}|${!!hass.user?.is_admin}|${room.name}`;
    if (p.sig !== sig || !p.rows) {
      p.sig = sig;
      this._createRoomPanel(p, floor, room, ids);
    }
    p.actions = roomActions(ids, hass);
    const climate = roomClimate(room, hass, this._byArea);
    const parts = [];
    if (climate.temperature != null) parts.push(`${fmt(climate.temperature)} °C`);
    if (climate.humidity != null) parts.push(`${fmt(climate.humidity, 0)} %`);
    const pr = this._settings.layers.presence !== false ? roomPresence(room, hass, this._byArea, Date.now(), Math.max(1, Number(this._building.settings?.presence?.hold_minutes) || 5) * 60000) : { level: null };
    if (pr.level === "occupied") parts.push("Bewegung");
    else if (pr.level === "recent") parts.push(`Bewegung ${agoText(Date.now() - pr.since)}`);
    p.el.querySelector(".rp-sub").textContent = [floor.name, ...parts].join(" · ") + (room.area_id ? "" : " · kein Bereich zugeordnet");
    // Klima: Feuchte, Taupunkt, heizt, Lüften-Ampel (Außenwerte aus der Wetter-Entität)
    const climEl = p.el.querySelector(".rp-clim");
    if (climEl) {
      const bits = [];
      if (climate.humidity != null) bits.push(`Feuchte ${fmt(climate.humidity, 0)} %`);
      const dp = dewPoint(climate.temperature, climate.humidity);
      if (dp != null) bits.push(`Taupunkt ${fmt(dp)} °C`);
      const th = p.actions.climate;
      if (th?.action === "heating") bits.push("heizt");
      const wId = weatherEntity(hass, this._building?.settings);
      const wa = wId ? hass.states[wId]?.attributes ?? {} : {};
      const outside = wa.humidity != null && wa.temperature != null ? { temperature: Number(wa.temperature), humidity: Number(wa.humidity) } : null;
      const moldRh = Number(this._building?.settings?.climate?.humidity_max) || 65;
      const adv = ventAdvice(climate, outside, { moldRh });
      setText(climEl.querySelector(".cv"), bits.join(" · "));
      const vent = climEl.querySelector(".vent");
      setText(vent, adv?.text ?? "");
      vent.className = `vent ${adv?.level ?? ""}`;
      climEl.hidden = !bits.length && !adv;
    }
    const light = p.el.querySelector(".act-light span");
    if (light) {
      const on = p.actions.lights.on.length;
      light.textContent = on ? `Licht aus (${on})` : "Licht an";
      light.parentElement.classList.toggle("on", on > 0);
    }
    const c = p.actions.climate;
    const target = p.el.querySelector(".stepper .target");
    if (c && target) {
      const now = performance.now();
      if (p.pending && (now > p.pending.until || (c.target != null && Math.abs(c.target - p.pending.value) < 1e-6))) p.pending = null;
      const v = p.pending ? p.pending.value : c.target;
      target.textContent = v != null ? `${fmt(v)} °C` : c.mode;
      target.classList.toggle("pending", !!p.pending);
      target.classList.toggle("heating", c.action === "heating");
      target.title = c.action === "heating" ? "heizt" : c.current != null ? `ist ${fmt(c.current)} °C` : "";
    }
    for (const [id, r] of p.rows) {
      const st = hass.states[id];
      if (!st) continue;
      const kind = displayKind(st);
      const active = isActive(kind, st);
      r.dot.className = `rp-icon${active ? (kind === "contact" || kind === "lock" ? " alert" : " active") : ""}`;
      r.icon.setAttribute("icon", iconFor(kind, st));
      r.name.textContent = st.attributes.friendly_name ?? id;
      r.state.textContent = hass.formatEntityState ? hass.formatEntityState(st) : st.state;
    }
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
      el.querySelector("h3").addEventListener("click", () => {
        this._cardState({ [c.id]: el.classList.toggle("collapsed") });
        this._queueLayout();
      });
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
    bar.querySelectorAll("[data-floor]").forEach((b) => b.addEventListener("click", () => {
      // Doppeltipp auf die gewählte Etage: Ansicht einpassen und vergessen
      const now = performance.now();
      const again = b.dataset.floor === this._filter && now - (this._floorTap ?? 0) < 400;
      this._floorTap = now;
      if (again) return this._resetView();
      this._setFilter(b.dataset.floor);
    }));
    bar.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => this._setFilter(order[Math.min(order.length - 1, Math.max(0, idx + Number(b.dataset.step)))])));
    this._updateFloorBadges(this._status?.perFloor);
    this._queueLayout();
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
      temp: { icon: VIEW_MODES[this._view]?.icon ?? "mdi:thermometer", name: `Bodenfarbe: ${VIEW_MODES[this._view]?.label ?? "aus"}`, on: this._view !== "none", run: () => this._cycleView() },
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
      presence: layer("presence", "mdi:motion-sensor", "Anwesenheit"),
      security: { icon: "mdi:shield-home-outline", name: "Sicherheit", on: this._securityView, run: () => {
        this._securityView = !this._securityView;
        this._updateStates();
        this._renderWheels();
      } },
      goodnight: { icon: "mdi:weather-night", name: "Gute Nacht", on: false, run: () => this._checkSheet("goodnight") },
      fit: { icon: "mdi:fit-to-screen-outline", name: "Ansicht einpassen", on: false, run: () => this._resetView() },
      view: { icon: "mdi:camera-switch-outline", name: "Blickwinkel", on: false, run: () => this._viewChips() },
      ...(document.fullscreenEnabled ? { fullscreen: { icon: document.fullscreenElement ? "mdi:fullscreen-exit" : "mdi:fullscreen", name: "Vollbild", on: !!document.fullscreenElement, run: () => this._toggleFullscreen() } } : {}),
    };
  }

  /** Einträge des Funktionsrads (unten rechts): eingebaute Umschalter und eigene Einträge aus settings.functions. */
  _functionItems() {
    const builtin = this._builtinFunctions();
    const items = normalizeFunctions(this._building?.settings?.functions, this._building?.settings?.functions_seen ?? LEGACY_FUNCTION_KEYS).map((f) => (f.key ? builtin[f.key] : this._entityItem(f))).filter(Boolean);
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

  /** Bodenfarbe weiterschalten (aus → Temperatur → Feuchte → Leistung). */
  _cycleView() {
    const before = this._view;
    this._view = nextView(this._view);
    this._store("haus3d.view", this._view);
    // Leistungssensoren nur in der Ansicht „Leistung“ beobachten
    if ((before === "power") !== (this._view === "power")) this._rewatch();
    this._renderToolbar();
    this._updateStates();
  }

  /** Legende der Bodenfarbe (je Ansicht neu). */
  _renderLegend() {
    const mode = this._view;
    if (mode === this._legendMode && (mode === "none") === !this._legend) return;
    this._legend?.remove();
    this._legend = null;
    this._legendMode = mode;
    const def = VIEW_MODES[mode];
    if (!def) return;
    const [lo, hi] = def.range;
    const vals = mode === "power" ? [10, 50, 200, 800, 2000] : Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    const stops = vals.map((v, i) => `rgb(${viewColor(mode, mode === "humidity" ? Math.min(v, (def.warn ?? 100) - 0.1) : v).map((c) => Math.round(c * 255)).join(",")}) ${i * 25}%`).join(",");
    const el = document.createElement("div");
    el.className = "legend";
    const unit = (v) => (mode === "power" ? fmtPower(v) : `${fmt(v, def.digits)} ${def.unit}`);
    el.innerHTML = `<span class="lt"></span><div class="bar" style="background: linear-gradient(90deg, ${stops})"></div><div class="ticks"><span>${unit(vals[0])}</span><span>${unit(vals[2])}</span><span>${unit(vals[4])}</span></div>${def.warn ? `<div class="lwarn">ab ${def.warn} % Schimmelgefahr</div>` : ""}`;
    el.querySelector(".lt").textContent = `Bodenfarbe: ${def.label}`;
    this._els.stage.appendChild(el);
    this._legend = el;
  }

  // ------------------------------------------------------------------ Overlays positionieren

  _positionOverlays() {
    if (!this._scene) return;
    for (const ov of this._overlays.values()) {
      const visible = ov.roof ? this._scene._roofShown() && this._settings.layers.solar !== false && this._settings.layers.labels !== false : this._scene.isFloorVisible(ov.floorId);
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

  _closePopup() {
    this._popup?.remove();
    this._popup = null;
  }

}

// Dialoge und Energie-Verlauf einmischen (panel-dialogs.js, panel-energy.js)
Object.assign(Haus3DPanel.prototype, DialogMethods, EnergyMethods, TabletMethods);

// Nach einem Update ohne Neuladen ist das Element der alten Version noch registriert: ein zweites
// define würfe einen Fehler und das Panel ließe sich gar nicht laden
if (!customElements.get("haus3d-panel")) customElements.define("haus3d-panel", Haus3DPanel);
