// Simulationsmodus: legt eine Schicht über das echte hass-Objekt. Zustände werden nur hier geändert,
// Dienstaufrufe gehen nie an Home Assistant, Grundriss-Speichern bleibt lokal. Ohne DOM, mit node testbar.
import { sunPosition } from "./sun.js";

const now = () => new Date().toISOString();

/** Wetterzustände zum Ausprobieren (Name für die Auswahl). */
export const SIM_WEATHER = [
  ["", "wie echt"],
  ["sunny", "Sonne"],
  ["cloudy", "Bewölkt"],
  ["rainy", "Regen"],
  ["pouring", "Starkregen"],
  ["lightning-rainy", "Gewitter"],
  ["snowy", "Schnee"],
  ["hail", "Hagel"],
];

export class Simulator {
  constructor() {
    this.overrides = new Map(); // entity_id -> state-Objekt
    this.demo = { states: {}, entities: {} };
    this.weather = ""; // "" = wie echt
    this.daytime = ""; // "" = wie echt, "day", "night"
    this.time = null; // Uhrzeit in Minuten (0..1440) oder null = wie echt
    this.solar = null; // Watt oder null = wie echt
    this.building = null; // lokale Kopie beim Speichern in der Simulation
    this.revision = 0;
    this.log = []; // letzte simulierte Aktionen (für Anzeige/Tests)
    this._cache = null;
  }

  /** Zustand eines Geräts in der Simulation (überschreibt echt bzw. Beispielgerät). */
  set(entityId, state, attributes = {}, base = null) {
    const prev = this.overrides.get(entityId) ?? base ?? this.demo.states[entityId] ?? { entity_id: entityId, attributes: {} };
    this.overrides.set(entityId, {
      ...prev,
      entity_id: entityId,
      state: String(state),
      attributes: { ...(prev.attributes ?? {}), ...attributes },
      last_changed: now(),
      last_updated: now(),
    });
    this._cache = null;
  }

  reset() {
    this.overrides.clear();
    this.weather = "";
    this.daytime = "";
    this.time = null;
    this.solar = null;
    this.log = [];
    this._cache = null;
  }

  /**
   * Beispielgeräte für Räume ohne eigene Geräte: Licht, Temperatur, Fensterkontakt und Bewegungsmelder je Raum.
   * Sie hängen am Bereich des Raums (oder einem eigenen Sim-Bereich, wenn der Raum keinen hat).
   */
  makeDemo(building, real) {
    const states = {};
    const entities = {};
    const used = new Set(Object.values(real?.entities ?? {}).map((e) => e.area_id).filter(Boolean));
    let k = 0;
    for (const floor of building?.floors ?? []) {
      for (const room of floor.rooms ?? []) {
        if (room.area_id && used.has(room.area_id)) continue;
        const slug = (room.id || `raum${k}`).replace(/[^a-z0-9_]/gi, "_").toLowerCase();
        const area = room.area_id || `sim_${slug}`;
        const name = room.name || "Raum";
        const add = (id, state, attributes) => {
          states[id] = { entity_id: id, state, attributes: { friendly_name: attributes.friendly_name, ...attributes }, last_changed: now(), last_updated: now() };
          entities[id] = { entity_id: id, area_id: area, platform: "haus3d_sim" };
        };
        add(`light.sim_${slug}`, k % 3 === 0 ? "on" : "off", { friendly_name: `${name} Licht (Sim)` });
        add(`sensor.sim_${slug}_temperatur`, (19.5 + ((k * 1.7) % 5)).toFixed(1), { friendly_name: `${name} Temperatur (Sim)`, device_class: "temperature", unit_of_measurement: "°C" });
        add(`binary_sensor.sim_${slug}_fenster`, "off", { friendly_name: `${name} Fenster (Sim)`, device_class: "window" });
        add(`binary_sensor.sim_${slug}_bewegung`, k % 4 === 1 ? "on" : "off", { friendly_name: `${name} Bewegung (Sim)`, device_class: "motion" });
        if (!room.area_id) room.area_id = area; // nur in der Sim-Kopie des Gebäudes
        k++;
      }
    }
    this.demo = { states, entities };
    this._cache = null;
    return k;
  }

  clearDemo() {
    this.demo = { states: {}, entities: {} };
    for (const id of [...this.overrides.keys()]) if (id.includes(".sim_")) this.overrides.delete(id);
    this._cache = null;
  }

  /**
   * Simuliertes hass-Objekt. Dieselben Objekte, solange sich nichts ändert (damit das Panel nicht
   * ständig neu zeichnet). onChange wird nach jeder simulierten Aktion aufgerufen.
   */
  wrap(real, { building = null, onChange = () => {}, onToast = () => {} } = {}) {
    if (!real) return real;
    const c = this._cache;
    if (c && c.realStates === real.states && c.realEntities === real.entities && c.building === building) return c.hass;
    const states = { ...real.states, ...this.demo.states };
    for (const [id, st] of this.overrides) states[id] = st;
    // Tageszeit
    const sunBase = real.states["sun.sun"] ?? { entity_id: "sun.sun", attributes: {} };
    if (this.time !== null) {
      // Uhrzeit: Sonnenstand heute um diese Zeit am Ort aus hass.config
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const lat = Number(real.config?.latitude ?? 51);
      const lon = Number(real.config?.longitude ?? 10);
      const p = sunPosition(d.getTime() + this.time * 60000, Number.isFinite(lat) ? lat : 51, Number.isFinite(lon) ? lon : 10);
      states["sun.sun"] = { ...sunBase, state: p.elevation > -0.83 ? "above_horizon" : "below_horizon", attributes: { ...sunBase.attributes, azimuth: Math.round(p.azimuth * 10) / 10, elevation: Math.round(p.elevation * 10) / 10 } };
    } else if (this.daytime) {
      const night = this.daytime === "night";
      states["sun.sun"] = { ...sunBase, state: night ? "below_horizon" : "above_horizon", attributes: { ...sunBase.attributes, azimuth: night ? 0 : 180, elevation: night ? -20 : 45 } };
    }
    // Wetter: eingestellte bzw. erste Wetter-Entität, sonst eine simulierte
    if (this.weather) {
      const wid = building?.settings?.weather && building.settings.weather !== "none" ? building.settings.weather : Object.keys(real.states).sort().find((e) => e.startsWith("weather.")) ?? "weather.simulation";
      states[wid] = { ...(real.states[wid] ?? { entity_id: wid, attributes: { friendly_name: "Wetter (Sim)" } }), state: this.weather };
    }
    // Solarleistung
    if (this.solar !== null) {
      const e = building?.settings?.energy ?? {};
      const put = (id, v, unit = "W") => {
        if (id) states[id] = { ...(real.states[id] ?? { entity_id: id, attributes: {} }), state: String(v), attributes: { ...(real.states[id]?.attributes ?? {}), unit_of_measurement: unit } };
      };
      put(e.solar, Math.round(this.solar));
      put(e.einspeisung, Math.round(this.solar * 0.92));
      // Netz: Einspeisung als negativer Bezug (bzw. umgekehrt, wenn das Vorzeichen gedreht ist)
      put(e.netz, Math.round(this.solar * 0.92) * (e.netz_invert ? 1 : -1));
    }
    const entities = Object.keys(this.demo.entities).length ? { ...real.entities, ...this.demo.entities } : real.entities;
    const sim = this;
    const hass = {
      ...real,
      states,
      entities,
      haus3dSimulation: true,
      // Dienste: nur simulieren, nie an Home Assistant senden
      callService: async (domain, service, data = {}) => {
        const ids = [].concat(data.entity_id ?? []);
        for (const id of ids) sim.service(domain, service, id, states[id], data);
        sim.log.push({ domain, service, entity_id: ids.join(",") });
        if (sim.log.length > 50) sim.log.shift();
        if (!ids.length) onToast(`Simulation: ${domain}.${service}`);
        onChange();
      },
      // Grundriss: lesen echt (bzw. lokale Kopie), speichern nur lokal; Verlauf in der Simulation aus
      callWS: async (msg) => {
        if (msg.type === "haus3d/building/get") {
          if (sim.building) return { building: structuredClone(sim.building), revision: sim.revision };
          return real.callWS(msg);
        }
        if (msg.type === "haus3d/building/save") {
          sim.building = structuredClone(msg.building);
          sim.revision = (msg.revision ?? sim.revision) + 1;
          return { building: structuredClone(sim.building), revision: sim.revision };
        }
        // nur lesende Abfragen gehen an Home Assistant
        if (["energy/get_prefs", "recorder/statistics_during_period", "history/history_during_period"].includes(msg.type)) return real.callWS(msg);
        if (String(msg.type).startsWith("haus3d/history")) throw new Error("In der Simulation gibt es keinen Verlauf.");
        throw new Error(`Simulation: ${msg.type} ist gesperrt.`);
      },
    };
    this._cache = { realStates: real.states, realEntities: real.entities, building, hass };
    return hass;
  }

  /** Wirkung eines Dienstes auf den simulierten Zustand. */
  service(domain, service, entityId, st, data = {}) {
    const state = st?.state;
    const base = st ?? null;
    const toggle = (on, off) => this.set(entityId, state === on ? off : on, {}, base);
    if (service === "toggle") {
      if (domain === "cover") return this.service(domain, state === "open" || state === "opening" ? "close_cover" : "open_cover", entityId, st);
      if (domain === "lock") return this.service(domain, state === "locked" ? "unlock" : "lock", entityId, st);
      return toggle("on", "off");
    }
    if (service === "turn_on") return this.set(entityId, "on", data.brightness != null ? { brightness: data.brightness } : {}, base);
    if (service === "turn_off") return this.set(entityId, "off", {}, base);
    if (service === "open_cover") return this.set(entityId, "open", { current_position: 100 }, base);
    if (service === "close_cover") return this.set(entityId, "closed", { current_position: 0 }, base);
    if (service === "set_cover_position") {
      const p = Math.max(0, Math.min(100, Number(data.position) || 0));
      return this.set(entityId, p > 0 ? "open" : "closed", { current_position: p }, base);
    }
    if (service === "lock") return this.set(entityId, "locked", {}, base);
    if (service === "unlock") return this.set(entityId, "unlocked", {}, base);
    if (service === "media_play_pause") return toggle("playing", "paused");
    if (service === "set_temperature") {
      // heizt, solange das Soll über dem Ist liegt
      const target = Number(data.temperature);
      const cur = Number(st?.attributes?.current_temperature);
      const action = Number.isFinite(cur) ? (target > cur + 0.2 ? "heating" : "idle") : st?.attributes?.hvac_action;
      return this.set(entityId, state ?? "heat", { temperature: target, ...(action ? { hvac_action: action } : {}) }, base);
    }
    // press, scene/script turn_on usw.: nur protokollieren
    return null;
  }
}
