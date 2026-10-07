// Zuordnung von Home-Assistant-Entitäten zu Räumen und Öffnungen (ohne Three.js, mit node testbar).

import { labelPoint, pointInPolygon } from "./walls.js";
import { energyEntities, energyTotals, legacyValues } from "./energymodel.js";

export const CONTACT_CLASSES = ["window", "door", "opening", "garage_door"];
const ICON_DOMAINS = ["light", "switch", "fan", "cover", "climate", "lock", "camera", "vacuum"];
const TOGGLE_DOMAINS = ["light", "switch", "fan", "cover"];
// Rollläden vor Fenstern/Glastüren bzw. Tore vor Garagenöffnungen (wie bei NeonPlan)
const BLIND_CLASSES = [undefined, null, "shutter", "blind", "awning", "shade", "curtain", "window"];
const GARAGE_CLASSES = ["garage", "gate"];

export const domainOf = (entityId) => entityId.slice(0, entityId.indexOf("."));

/** Bereich einer Entität: eigener Bereich, sonst der ihres Geräts. */
export function areaOf(hass, entityId) {
  const entry = hass.entities?.[entityId];
  if (!entry) return null;
  if (entry.area_id) return entry.area_id;
  return (entry.device_id && hass.devices?.[entry.device_id]?.area_id) || null;
}

/** Versteckte sowie Diagnose- und Konfigurations-Entitäten werden nicht gezeigt. */
export function isShown(hass, entityId) {
  const entry = hass.entities?.[entityId];
  if (!entry) return true;
  return !entry.hidden && !entry.entity_category;
}

/** Welche Art Symbol eine Entität bekommt (oder null, wenn keins). */
export function iconKind(stateObj) {
  if (!stateObj) return null;
  const domain = domainOf(stateObj.entity_id);
  if (ICON_DOMAINS.includes(domain)) return domain;
  if (domain === "device_tracker" && stateObj.attributes?.source_type === "router") return "network"; // UniFi u. a.
  if (domain === "binary_sensor" && CONTACT_CLASSES.includes(stateObj.attributes?.device_class)) return "contact";
  return null;
}

export const canToggle = (entityId) => TOGGLE_DOMAINS.includes(domainOf(entityId));

/** Art für Entitäten, die von Hand zu einem Raum hinzugefügt wurden: Symbolart oder "other". */
export const displayKind = (stateObj) => iconKind(stateObj) ?? (stateObj ? "other" : null);

/** Ausgeblendete Entitäten eines Raums (hidden_entities) und global (settings.hidden_entities). */
export function hiddenSet(room, building) {
  return new Set([...(room?.hidden_entities ?? []), ...(building?.settings?.hidden_entities ?? [])]);
}

/**
 * Entitäten eines Raums: alle des Bereichs (ohne ausgeblendete) plus von Hand hinzugefügte (panel).
 * @returns {string[]}
 */
export function roomEntities(room, hass, byArea, building = null) {
  const hidden = hiddenSet(room, building);
  const ids = (room.area_id ? byArea.get(room.area_id) ?? [] : []).filter((id) => !hidden.has(id));
  for (const id of room.panel ?? []) if (hass.states?.[id] && !hidden.has(id) && !ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * Orte einer Etage, denen Geräte zugeordnet werden: Räume und Gartenflächen mit area_id
 * (Erweiterung von Haus 3D; NeonPlan ignoriert area_id/name an Gartenflächen).
 */
export function placesOf(floor) {
  const outdoor = (floor.outdoor ?? []).filter((o) => o.area_id).map((o) => ({ ...o, name: o.name ?? o.area_id, outdoor: true }));
  return [...(floor.rooms ?? []), ...outdoor];
}

/** Map Bereich -> sichtbare Entitäts-IDs (nur Entitäten mit Zustand). */
export function entitiesByArea(hass) {
  const map = new Map();
  for (const entityId of Object.keys(hass.entities ?? {})) {
    if (!hass.states?.[entityId] || !isShown(hass, entityId)) continue;
    const area = areaOf(hass, entityId);
    if (!area) continue;
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(entityId);
  }
  for (const list of map.values()) list.sort();
  return map;
}

/**
 * Manuelle Positionen aller Etagen: placements[] und – wie bei aktuellen NeonPlan-Exporten –
 * Lampen aus furniture[] mit verknüpfter Entität. placements haben Vorrang.
 * @returns {Map<string, {floorId: string, x: number, z: number, y: number|null}>}
 */
export function manualPositions(building) {
  const map = new Map();
  for (const floor of building.floors ?? []) {
    for (const m of floor.furniture ?? []) {
      if (typeof m.type !== "string" || !/^(lamp|led)_/.test(m.type)) continue;
      if (!m.entity || m.entity === "none" || map.has(m.entity)) continue;
      map.set(m.entity, { floorId: floor.id, x: m.x, z: m.z, y: m.mount_y ?? null });
    }
  }
  for (const floor of building.floors ?? []) {
    for (const p of floor.placements ?? []) map.set(p.entity_id, { floorId: floor.id, x: p.x, z: p.z, y: p.y ?? null, rotation: p.rotation ?? null, range: p.range ?? null, fov: p.fov ?? null, tilt: p.tilt ?? null });
  }
  return map;
}

/**
 * Symbole aller Etagen. Je Bereich zeigt nur ein Raum (der erste) die Geräte automatisch;
 * Entitäten mit manueller Position (irgendwo im Gebäude) stehen nur dort.
 * @returns {Map<string, {entity_id: string, kind: string, x: number, z: number, y: number|null, room: string|null, manual: boolean}[]>}
 */
export function buildingIcons(building, hass, byArea = entitiesByArea(hass)) {
  const manual = manualPositions(building);
  const result = new Map((building.floors ?? []).map((f) => [f.id, []]));
  const ownedAreas = new Set();
  for (const floor of building.floors ?? []) {
    const icons = result.get(floor.id);
    for (const room of placesOf(floor)) {
      if ((!room.area_id && !room.panel?.length) || (room.area_id && ownedAreas.has(room.area_id))) continue;
      if (room.area_id) ownedAreas.add(room.area_id);
      const extra = new Set(room.panel ?? []);
      const auto = roomEntities(room, hass, byArea, building).filter((id) => (extra.has(id) ? displayKind(hass.states[id]) : iconKind(hass.states[id])) && !manual.has(id));
      const spots = layout(room.points, auto.length);
      auto.forEach((id, i) => icons.push({ entity_id: id, kind: displayKind(hass.states[id]), x: spots[i][0], z: spots[i][1], y: null, room: room.id, manual: false }));
    }
  }
  for (const [entityId, p] of manual) {
    const kind = displayKind(hass.states?.[entityId]);
    const icons = result.get(p.floorId);
    if (!kind || !icons) continue;
    const floor = building.floors.find((f) => f.id === p.floorId);
    const room = placesOf(floor).find((r) => pointInPolygon([p.x, p.z], r.points));
    // ausgeblendet (im Raum an dieser Stelle oder global): auch fest platziert nicht zeigen
    if (hiddenSet(room, building).has(entityId)) continue;
    icons.push({ entity_id: entityId, kind, x: p.x, z: p.z, y: p.y, room: room?.id ?? null, manual: true, rotation: p.rotation ?? null, range: p.range ?? null, fov: p.fov ?? null, tilt: p.tilt ?? null });
  }
  return result;
}

/** Symbole einer Etage (siehe buildingIcons). */
export function floorIcons(floor, hass, byArea = entitiesByArea(hass), building = { floors: [floor] }) {
  return buildingIcons(building, hass, byArea).get(floor.id) ?? [];
}

/**
 * Verteilt n Punkte in einem Raster um einen inneren Punkt des Raums. Nur Punkte im Polygon
 * werden genommen; reicht das Raster nicht, wird es nach außen erweitert.
 */
export function layout(points, n) {
  if (!n) return [];
  const c = labelPoint(points);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...zs) - Math.min(...zs);
  const cols = Math.ceil(Math.sqrt(n));
  const step = Math.max(0.35, Math.min(0.8, (w * 0.7) / cols, (d * 0.7) / Math.ceil(n / cols)));
  // Kandidaten nach Abstand zum Mittelpunkt sortiert (Ringe), nur im Raum
  const candidates = [];
  const R = Math.ceil(Math.max(w, d) / step) + 1;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      const p = [c[0] + i * step, c[1] + j * step];
      if (pointInPolygon(p, points)) candidates.push({ p, r: Math.hypot(i, j * 1.01) });
    }
  }
  candidates.sort((a, b) => a.r - b.r);
  const out = candidates.slice(0, n).map((x) => x.p);
  while (out.length < n) out.push(c); // winziger Raum: alle auf den Mittelpunkt
  return out;
}

const num = (stateObj) => {
  if (!stateObj) return null;
  const v = parseFloat(stateObj.state);
  return Number.isFinite(v) ? v : null;
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * Klima eines Raums: Mittelwert der Temperatur- und Feuchtesensoren im Bereich.
 * room.climate (NeonPlan) erlaubt feste Sensoren oder "none".
 */
export function roomClimate(room, hass, byArea) {
  const ids = room.area_id ? byArea.get(room.area_id) ?? [] : [];
  const pick = (cls) => {
    const fixed = room.climate?.[cls];
    if (fixed === "none") return null;
    if (fixed) return num(hass.states[fixed]);
    return mean(
      ids
        .filter((id) => domainOf(id) === "sensor" && hass.states[id]?.attributes?.device_class === cls)
        .map((id) => num(hass.states[id]))
        .filter((v) => v !== null),
    );
  };
  let temperature = pick("temperature");
  let humidity = pick("humidity");
  // ohne eigene Sensoren: Werte des Thermostats im Raum
  if (temperature === null || humidity === null) {
    const th = roomHeating(room, hass, { get: () => ids });
    const a = th ? hass.states[th.entity]?.attributes ?? {} : {};
    if (temperature === null && room.climate?.temperature !== "none" && Number.isFinite(Number(a.current_temperature)) && a.current_temperature !== null) temperature = Number(a.current_temperature);
    if (humidity === null && room.climate?.humidity !== "none" && Number.isFinite(Number(a.current_humidity)) && a.current_humidity !== null) humidity = Number(a.current_humidity);
  }
  return { temperature, humidity };
}

/** Ist mindestens ein Licht im Bereich des Raums an? */
export function roomLit(room, hass, byArea) {
  if (!room.area_id) return false;
  return (byArea.get(room.area_id) ?? []).some((id) => domainOf(id) === "light" && hass.states[id]?.state === "on");
}

const CONTACT_FOR_TYPE = {
  window: ["window", "opening"],
  door: ["door", "opening"],
  garage: ["garage_door", "opening"],
};

/**
 * Kontakt- und Rollladen-Entitäten je Öffnung, über alle Etagen (jede Entität höchstens einmal).
 * Ein gesetztes Feld (contact/cover) gilt, "none" heißt keins, null heißt automatisch: freie
 * Sensoren bzw. Rollläden des Raumbereichs werden der Reihe nach Öffnungen passenden Typs zugeordnet.
 * @returns {Map<string, Map<string, {contact: string|null, cover: string|null}>>} Etage -> Öffnung -> Verknüpfung
 */
export function buildingLinks(building, hass, byArea) {
  const result = new Map();
  const taken = new Set();
  for (const floor of building.floors ?? []) {
    for (const o of floor.openings ?? []) {
      for (const key of ["contact", "cover", "contact2", "tilt", "tilt2", "position"]) if (o[key] && o[key] !== "none") taken.add(o[key]);
    }
  }
  for (const floor of building.floors ?? []) {
    const links = new Map();
    result.set(floor.id, links);
    const rooms = new Map((floor.rooms ?? []).map((r) => [r.id, r]));
    const sorted = [...(floor.openings ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    for (const o of sorted) {
      // Kippsensor nur ausdrücklich (o.tilt), nie automatisch zugeordnet
      const link = { contact: null, cover: null, tilt: o.tilt && o.tilt !== "none" ? o.tilt : null };
      links.set(o.id, link);
      const ids = byArea.get(rooms.get(o.room_id)?.area_id) ?? [];
      if (o.contact && o.contact !== "none") link.contact = o.contact;
      else if (o.contact !== "none") {
        const classes = CONTACT_FOR_TYPE[o.type] ?? [];
        const free = ids.find((id) => !taken.has(id) && domainOf(id) === "binary_sensor" && classes.includes(hass.states[id]?.attributes?.device_class));
        if (free) {
          link.contact = free;
          taken.add(free);
        }
      }
      if (o.cover && o.cover !== "none") link.cover = o.cover;
      else if (o.cover !== "none" && (o.type !== "door" || o.style === "glass" || o.style === "sliding")) {
        const classes = o.type === "garage" ? GARAGE_CLASSES : BLIND_CLASSES;
        const free = ids.find((id) => !taken.has(id) && domainOf(id) === "cover" && classes.includes(hass.states[id]?.attributes?.device_class));
        if (free) {
          link.cover = free;
          taken.add(free);
        }
      }
    }
  }
  return result;
}

/** Verknüpfungen einer Etage (siehe buildingLinks). */
export function openingLinks(floor, hass, byArea, building = { floors: [floor] }) {
  return buildingLinks(building, hass, byArea).get(floor.id) ?? new Map();
}

const OPEN_WORDS = ["on", "open", "opened", "offen", "geöffnet", "tilted", "gekippt"];

/**
 * Offen-Zustand: binary_sensor an, Cover offen/öffnend, Fenstergriff-Sensoren (Zustand oder
 * Attribut window_state "open"/"tilted", auch auf Deutsch) zählen als offen.
 */
export function isOpen(stateObj) {
  if (!stateObj) return false;
  const domain = domainOf(stateObj.entity_id);
  if (domain === "cover") return ["open", "opening"].includes(stateObj.state);
  if (domain === "binary_sensor") return stateObj.state === "on";
  const value = String(stateObj.attributes?.window_state ?? stateObj.state).toLowerCase();
  return OPEN_WORDS.includes(value);
}

/** Anteil, zu dem ein Rollladen geschlossen ist (0 = offen, 1 = ganz zu), oder null ohne Zustand. */
export function coverClosedFraction(stateObj) {
  if (!stateObj || ["unavailable", "unknown"].includes(stateObj.state)) return null;
  const pos = stateObj.attributes?.current_position;
  if (typeof pos === "number") return Math.min(1, Math.max(0, 1 - pos / 100));
  return stateObj.state === "closed" ? 1 : 0;
}

const POWER_UNITS = { mW: 1e-3, W: 1, kW: 1e3, MW: 1e6, GW: 1e9 };
const ENERGY_UNITS = { mWh: 1e-6, Wh: 1e-3, kWh: 1, MWh: 1e3, GWh: 1e6, kJ: 1 / 3600, MJ: 1 / 3.6, GJ: 1000 / 3.6 };

/** Leistung in Watt (Einheit wie in HA, Groß-/Kleinschreibung zählt: mW ≠ MW). */
export function powerW(stateObj) {
  const v = num(stateObj);
  if (v === null) return null;
  return v * (POWER_UNITS[stateObj.attributes?.unit_of_measurement ?? "W"] ?? 1);
}

/** Energie in kWh. */
export function energyKWh(stateObj) {
  const v = num(stateObj);
  if (v === null) return null;
  return v * (ENERGY_UNITS[stateObj.attributes?.unit_of_measurement ?? "kWh"] ?? 1);
}

/** Energie-Werte (summiert über alle Quellen, Vorzeichen korrigiert) – siehe energymodel.js. */
export function energyValues(settings, hass) {
  return legacyValues(energyTotals(settings?.energy, hass));
}

/** Farbe der Temperaturansicht: 18 °C blau bis 26 °C rot (als [r, g, b] 0..1). */
export function temperatureColor(t) {
  const f = Math.min(1, Math.max(0, (t - 18) / 8));
  // Farbton von 240° (blau) über grün/gelb nach 0° (rot)
  const h = (1 - f) * 240;
  return hsl(h / 360, 0.75, 0.52);
}

function hsl(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [conv(h + 1 / 3), conv(h), conv(h - 1 / 3)];
}

/**
 * Alle Entitäten, deren Zustand das Modell betrifft. Nur wenn sich einer davon ändert (oder
 * erscheint/verschwindet), wird neu gezeichnet – hass ändert sich bei jedem Zustandswechsel.
 */
export function watchedEntities(building, hass, byArea, { links = null, extra = [], power = false } = {}) {
  const ids = new Set();
  const put = (id) => {
    if (typeof id === "string" && id.includes(".") && id !== "none") ids.add(id);
  };
  // Leitungen: eigener Sensor, sonst Leistung des Zielraums
  const pipeRooms = new Set();
  for (const floor of building.floors ?? []) {
    for (const n of floor.nodes ?? []) put(n.entity);
    for (const p of floor.pipes ?? []) {
      put(p.device);
      if (p.entity) put(p.entity);
      else if (p.type === "strom" && p.room && !p.device) pipeRooms.add(p.room);
    }
  }
  for (const floor of building.floors ?? []) {
    for (const room of placesOf(floor)) {
      for (const id of byArea.get(room.area_id) ?? []) {
        const d = domainOf(id);
        if (d === "sensor") {
          const cls = hass.states[id]?.attributes?.device_class;
          if (cls === "temperature" || cls === "humidity" || cls === "carbon_dioxide") ids.add(id);
        } else if (iconKind(hass.states[id])) ids.add(id);
        else if (d === "lock" || d === "alarm_control_panel") ids.add(id); // Statusleiste
        else if (d === "binary_sensor" && ["moisture", "smoke", "gas", "carbon_monoxide", "heat", "safety"].includes(hass.states[id]?.attributes?.device_class)) ids.add(id); // Hinweise
      }
      for (const id of presenceSensors(room, hass, byArea)) ids.add(id); // Anwesenheit
      if (power || pipeRooms.has(room.id)) {
        // Bodenfarbe „Leistung“: Leistungssensoren nur in dieser Ansicht beobachten
        if (room.power && room.power !== "none") ids.add(room.power);
        else for (const id of byArea.get(room.area_id) ?? []) if (domainOf(id) === "sensor" && hass.states[id]?.attributes?.device_class === "power") ids.add(id);
      }
      const th = room.climate?.thermostat;
      if (th && th !== "none") ids.add(th);
      for (const id of room.panel ?? []) ids.add(id);
      for (const key of ["temperature", "humidity"]) {
        const fixed = room.climate?.[key];
        if (fixed && fixed !== "none") ids.add(fixed);
      }
    }
    for (const o of floor.openings ?? []) for (const key of ["contact", "cover"]) if (o[key] && o[key] !== "none") ids.add(o[key]);
  }
  for (const id of manualPositions(building).keys()) ids.add(id);
  const s = building.settings ?? {};
  // Energie: feste Werte und Zusatzzeilen (Text oder {entity})
  for (const id of energyEntities(s.energy)) put(id);
  // Karten, Kurzwahl, eigene Einträge im Funktionsrad
  for (const c of Array.isArray(s.cards) ? s.cards : []) for (const e of Array.isArray(c?.entities) ? c.entities : []) put(typeof e === "string" ? e : e?.entity);
  for (const q of Array.isArray(s.quick) ? s.quick : []) put(q?.entity);
  for (const f of Array.isArray(s.functions) ? s.functions : []) put(f?.entity);
  // verknüpfte Kontakte und Rollläden der Öffnungen
  if (links) for (const per of links.values()) for (const l of per.values()) for (const id of [l.contact, l.cover, l.tilt]) put(id);
  for (const id of Array.isArray(s.security?.locks) ? s.security.locks : []) put(id);
  for (const id of extra) put(id);
  for (const id of Object.keys(hass?.states ?? {})) if (id.startsWith("person.")) ids.add(id);
  return [...ids].sort();
}

// ------------------------------------------------------------------ Raumfenster: Gruppen und Aktionen

const GROUPS = [
  ["light", "Licht"],
  ["switch", "Schalter"],
  ["cover", "Beschattung"],
  ["opening", "Fenster & Türen"],
  ["climate", "Klima"],
  ["media", "Medien"],
  ["scene", "Szenen & Abläufe"],
  ["sensor", "Sensoren"],
  ["other", "Weitere"],
];

function groupOf(id, st) {
  const d = domainOf(id);
  const cls = st?.attributes?.device_class;
  if (d === "light") return "light";
  if (d === "switch" || d === "input_boolean" || d === "fan" || d === "humidifier") return "switch";
  if (d === "cover") return cls === "garage" || cls === "gate" ? "opening" : "cover";
  if (d === "lock" || (d === "binary_sensor" && CONTACT_CLASSES.includes(cls))) return "opening";
  if (d === "climate" || d === "water_heater" || (d === "sensor" && (cls === "temperature" || cls === "humidity"))) return "climate";
  if (d === "media_player") return "media";
  if (d === "scene" || d === "script" || d === "automation" || d === "button" || d === "input_button") return "scene";
  if (d === "sensor" || d === "binary_sensor") return "sensor";
  return "other";
}

/** Geräte eines Raums in feste Gruppen mit Überschrift sortieren (nur nicht leere). */
export function groupRoomEntities(ids, hass) {
  const by = new Map(GROUPS.map(([k]) => [k, []]));
  for (const id of ids) by.get(groupOf(id, hass.states[id])).push(id);
  return GROUPS.filter(([k]) => by.get(k).length).map(([key, title]) => ({ key, title, ids: by.get(key) }));
}

/**
 * Schnellaktionen eines Raums (aus den angezeigten Geräten): Lichter an/aus, Rollläden (ohne Garagen-
 * und Hoftore), erstes Thermostat mit Schrittweite und Grenzen, Szenen.
 */
export function roomActions(ids, hass) {
  const st = (id) => hass.states[id];
  // Lichtgruppen (attributes.entity_id) nicht doppelt zählen
  const lights = ids.filter((id) => domainOf(id) === "light" && !Array.isArray(st(id)?.attributes?.entity_id) && st(id)?.state !== "unavailable");
  const covers = ids.filter((id) => domainOf(id) === "cover" && !["garage", "gate"].includes(st(id)?.attributes?.device_class));
  const cid = ids.find((id) => domainOf(id) === "climate" && st(id) && st(id).state !== "unavailable");
  let climate = null;
  if (cid) {
    const a = st(cid).attributes ?? {};
    const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
    climate = {
      entity: cid,
      target: num(a.temperature),
      current: num(a.current_temperature),
      step: num(a.target_temp_step) ?? 0.5,
      min: num(a.min_temp) ?? 5,
      max: num(a.max_temp) ?? 30,
      action: a.hvac_action ?? null,
      mode: st(cid).state,
    };
  }
  return {
    lights: { all: lights, on: lights.filter((id) => st(id)?.state === "on") },
    covers,
    climate,
    scenes: ids.filter((id) => domainOf(id) === "scene"),
  };
}

/** Solltemperatur um n Schritte ändern, auf Schrittweite runden und begrenzen. */
export function stepTarget(climate, current, n) {
  const base = current ?? climate.target ?? climate.current ?? 20;
  const step = climate.step || 0.5;
  const v = Math.round((base + n * step) / step) * step;
  return Math.min(climate.max, Math.max(climate.min, Math.round(v * 100) / 100));
}

// ------------------------------------------------------------------ Anwesenheit

/** Bewegungs- und Anwesenheitsmelder. */
export const PRESENCE_CLASSES = ["motion", "occupancy", "presence"];

/** Melder eines Raums: room.presence (eigene Wahl) oder die passenden binary_sensors im Bereich. */
export function presenceSensors(room, hass, byArea) {
  if (Array.isArray(room?.presence) && room.presence.length) return room.presence.filter((id) => typeof id === "string");
  return (byArea.get(room?.area_id) ?? []).filter((id) => domainOf(id) === "binary_sensor" && PRESENCE_CLASSES.includes(hass.states[id]?.attributes?.device_class) && isShown(hass, id));
}

/**
 * Anwesenheit im Raum: "occupied" (Melder an), "recent" (vor weniger als holdMs aus), sonst null.
 * since: Zeitpunkt der letzten Änderung des jüngsten Melders (ms).
 */
export function roomPresence(room, hass, byArea, now = Date.now(), holdMs = 5 * 60000) {
  let best = { level: null, since: null };
  for (const id of presenceSensors(room, hass, byArea)) {
    const st = hass.states[id];
    if (!st || st.state === "unavailable" || st.state === "unknown") continue;
    const t = Date.parse(st.last_changed ?? st.last_updated ?? "") || null;
    if (st.state === "on") {
      if (best.level !== "occupied" || (t && t > (best.since ?? 0))) best = { level: "occupied", since: t };
    } else if (best.level !== "occupied" && t && now - t < holdMs && t > (best.since ?? 0)) best = { level: "recent", since: t };
  }
  return best;
}

/** „gerade eben“, „vor 3 min“, „vor 2 h“. */
export function agoText(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 60000) return "gerade eben";
  if (ms < 3600000) return `vor ${Math.floor(ms / 60000)} min`;
  return `vor ${Math.floor(ms / 3600000)} h`;
}

/** Personen (person.*): Name (erstes Wort), Bild, zu Hause, Ort. */
export function persons(hass) {
  return Object.keys(hass?.states ?? {})
    .filter((id) => id.startsWith("person."))
    .sort()
    .map((id) => {
      const st = hass.states[id];
      const full = st.attributes?.friendly_name ?? id.slice(7);
      const zone = st.state === "home" ? "zu Hause" : st.state === "not_home" ? "unterwegs" : st.state;
      return { entity_id: id, name: String(full).split(/\s+/)[0], full, picture: st.attributes?.entity_picture ?? null, home: st.state === "home", zone };
    });
}

// ------------------------------------------------------------------ Raumklima

const numOrNull = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** Thermostat eines Raums: room.climate.thermostat (Entität oder "none") oder das erste climate im Bereich. */
export function roomHeating(room, hass, byArea) {
  const fixed = room?.climate?.thermostat;
  if (fixed === "none") return null;
  const id = fixed || (byArea.get(room?.area_id) ?? []).find((x) => domainOf(x) === "climate" && hass.states[x] && hass.states[x].state !== "unavailable");
  const st = id ? hass.states[id] : null;
  if (!st) return null;
  const a = st.attributes ?? {};
  const target = numOrNull(a.temperature);
  return {
    entity: id,
    current: numOrNull(a.current_temperature),
    target,
    low: numOrNull(a.target_temp_low),
    high: numOrNull(a.target_temp_high),
    step: numOrNull(a.target_temp_step) ?? 0.5,
    min: numOrNull(a.min_temp) ?? 5,
    max: numOrNull(a.max_temp) ?? 30,
    action: a.hvac_action ?? null,
    mode: st.state,
    readOnly: target === null,
  };
}

/** Taupunkt in °C (Magnus-Formel). */
export function dewPoint(t, rh) {
  if (t == null || rh == null || rh <= 0) return null;
  const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
  return Math.round(((243.12 * g) / (17.62 - g)) * 100) / 100;
}

/** Absolute Feuchte in g/m³. */
export function absHumidity(t, rh) {
  if (t == null || rh == null) return null;
  const sat = 6.112 * Math.exp((17.62 * t) / (243.12 + t)); // hPa
  return Math.round(((216.7 * (rh / 100) * sat) / (273.15 + t)) * 100) / 100;
}

/**
 * Lüften? Vergleicht die absolute Feuchte drinnen und draußen.
 * @returns {{level: "good"|"bad"|"neutral"|"mold", text: string}|null}
 */
export function ventAdvice(inside, outside, { margin = 1, moldRh = 65 } = {}) {
  if (!inside || inside.temperature == null || inside.humidity == null) return null;
  const mold = inside.humidity >= moldRh;
  if (!outside || outside.temperature == null || outside.humidity == null) {
    return mold ? { level: "mold", text: `Feuchte über ${moldRh} % – lüften` } : null;
  }
  const ai = absHumidity(inside.temperature, inside.humidity);
  const ao = absHumidity(outside.temperature, outside.humidity);
  if (ai - ao >= margin) return { level: mold ? "mold" : "good", text: mold ? `Feuchte über ${moldRh} % – jetzt lüften` : "Lüften lohnt sich (draußen trockener)" };
  if (ao - ai >= margin) return { level: "bad", text: "Lieber geschlossen lassen – draußen feuchter" };
  return { level: mold ? "mold" : "neutral", text: mold ? `Feuchte über ${moldRh} % – Lüften bringt wenig` : "Lüften ändert kaum etwas" };
}

// ------------------------------------------------------------------ Bodenfarbe nach Messwert

/** Ansichten der Bodenfarbe. */
export const VIEW_MODES = {
  temp: { label: "Temperatur", unit: "°C", range: [18, 26], icon: "mdi:thermometer", digits: 1 },
  humidity: { label: "Feuchte", unit: "%", range: [30, 70], warn: 65, icon: "mdi:water-percent", digits: 0 },
  co2: { label: "CO₂", unit: "ppm", range: [400, 1600], icon: "mdi:molecule-co2", digits: 0 },
  power: { label: "Leistung", unit: "W", range: [0, 2000], icon: "mdi:flash", digits: 0 },
  energy: { label: "Energie heute", unit: "kWh", range: [0, 10], icon: "mdi:lightning-bolt-outline", digits: 2 },
};

/** Mittelwert der Sensoren einer Geräteklasse im Bereich des Raums (z. B. carbon_dioxide); null ohne Sensor. */
export function roomSensorMean(room, hass, byArea, cls) {
  const vals = (byArea.get(room?.area_id) ?? [])
    .filter((id) => domainOf(id) === "sensor" && hass.states[id]?.attributes?.device_class === cls)
    .map((id) => Number(hass.states[id].state))
    .filter((v) => Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Energiesensoren (kWh, Zähler) im Bereich eines Raums – für „Energie heute“ aus der Statistik. */
export function roomEnergySensors(room, hass, byArea, exclude = new Set()) {
  return (byArea.get(room?.area_id) ?? []).filter((id) => {
    const a = hass.states[id]?.attributes ?? {};
    return domainOf(id) === "sensor" && !exclude.has(id) && a.device_class === "energy" && ["total", "total_increasing"].includes(a.state_class);
  });
}

/** Farbe [r, g, b] (0..1) für einen Wert in einer Ansicht; null ohne Wert. */
export function viewColor(mode, v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (mode === "temp") return temperatureColor(v);
  if (mode === "humidity") {
    // trocken (orange) → gut (grün) → feucht (blau); ab Warnwert violett
    if (v >= (VIEW_MODES.humidity.warn ?? 65)) return hsl(280 / 360, 0.6, 0.5);
    const f = Math.min(1, Math.max(0, (v - 30) / 35));
    return hsl((30 + f * 180) / 360, 0.7, 0.5);
  }
  if (mode === "co2") {
    // gut (grün) bis 800 ppm, ab 1000 gelb, ab 1400 rot
    const f = Math.min(1, Math.max(0, (v - 600) / 900));
    return hsl(((1 - f) * 120) / 360, 0.75, 0.48);
  }
  if (mode === "energy") {
    // logarithmisch: 0,05 kWh grün … 10 kWh rot
    const f = Math.min(1, Math.max(0, Math.log10(Math.max(0.05, v) / 0.05) / Math.log10(200)));
    return hsl(((1 - f) * 120) / 360, 0.8, 0.48);
  }
  if (mode === "power") {
    // logarithmisch: 10 W grün … 2 kW rot
    const f = Math.min(1, Math.max(0, Math.log10(Math.max(1, v)) / Math.log10(2000)));
    return hsl(((1 - f) * 120) / 360, 0.8, 0.48);
  }
  return null;
}

/**
 * Leistung eines Raums in W: room.power (Entität oder "none") oder Summe der Leistungssensoren im Bereich.
 * exclude: IDs, die nicht zählen (z. B. die Energie-Anzeige: PV, Einspeisung, Akku).
 */
export function roomPower(room, hass, byArea, exclude = new Set()) {
  if (room?.power === "none") return null;
  if (room?.power) return powerW(hass.states[room.power]);
  let sum = null;
  for (const id of byArea.get(room?.area_id) ?? []) {
    if (exclude.has(id) || domainOf(id) !== "sensor") continue;
    const st = hass.states[id];
    if (st?.attributes?.device_class !== "power") continue;
    const w = powerW(st);
    if (w === null) continue;
    sum = (sum ?? 0) + w;
  }
  return sum;
}

/** Sichtkegel der Kameras mit Blickrichtung (fest platziert): [{entity_id, floorId, x, z, rotation, range, fov}]. */
export function cameraCones(icons) {
  const out = [];
  for (const [floorId, list] of icons) {
    for (const ic of list) {
      if (ic.kind !== "camera" || ic.rotation == null || !Number.isFinite(Number(ic.rotation))) continue;
      const tilt = ic.tilt == null || ic.tilt === "" || !Number.isFinite(Number(ic.tilt)) ? null : Math.max(0, Math.min(89, Number(ic.tilt)));
      out.push({ entity_id: ic.entity_id, floorId, x: ic.x, z: ic.z, y: Number.isFinite(Number(ic.y)) && ic.y !== null ? Number(ic.y) : 2.2, rotation: Number(ic.rotation), range: Math.max(1, Math.min(30, Number(ic.range) || 6)), fov: Math.max(10, Math.min(180, Number(ic.fov) || 90)), tilt });
    }
  }
  return out;
}

/** Nah- und Fernabstand des sichtbaren Bodens (Höhe y, Neigung tilt nach unten, Bildhöhe ≈ 0,6 × Sichtfeld). */
export function coneReach(c) {
  if (c.tilt == null) return { near: 0, far: c.range };
  const rad = Math.PI / 180;
  const half = (c.fov * 0.6) / 2;
  const h = Math.max(0.3, c.y ?? 2.2);
  const lo = c.tilt + half; // unterer Bildrand
  const hi = c.tilt - half; // oberer Bildrand
  const near = lo >= 89 ? 0 : h / Math.tan(lo * rad);
  const far = hi <= 1 ? c.range : Math.min(c.range, h / Math.tan(hi * rad));
  return { near: Math.min(near, far - 0.1), far };
}

/** Sichtbereich als Polygon im Plan (Winkel wie im Editor: 0 = rechts, 90 = nach oben). */
export function conePolygon(c, steps = 8) {
  const { near, far } = coneReach(c);
  const arc = (r) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = ((c.rotation - c.fov / 2 + (c.fov * i) / steps) * Math.PI) / 180;
      pts.push([c.x + Math.cos(a) * r, c.z - Math.sin(a) * r]);
    }
    return pts;
  };
  if (near <= 0.05) return [[c.x, c.z], ...arc(far)];
  return [...arc(far), ...arc(near).reverse()];
}
