// Zuordnung von Home-Assistant-Entitäten zu Räumen und Öffnungen (ohne Three.js, mit node testbar).

import { labelPoint, pointInPolygon } from "./walls.js";

export const CONTACT_CLASSES = ["window", "door", "opening", "garage_door"];
const ICON_DOMAINS = ["light", "switch", "fan", "cover", "climate"];
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
      if (typeof m.type !== "string" || !m.type.startsWith("lamp_")) continue;
      if (!m.entity || m.entity === "none" || map.has(m.entity)) continue;
      map.set(m.entity, { floorId: floor.id, x: m.x, z: m.z, y: m.mount_y ?? null });
    }
  }
  for (const floor of building.floors ?? []) {
    for (const p of floor.placements ?? []) map.set(p.entity_id, { floorId: floor.id, x: p.x, z: p.z, y: p.y ?? null });
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
    icons.push({ entity_id: entityId, kind, x: p.x, z: p.z, y: p.y, room: room?.id ?? null, manual: true });
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
  return { temperature: pick("temperature"), humidity: pick("humidity") };
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
      const link = { contact: null, cover: null };
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

/** Werte des Balkonkraftwerks aus settings.energy. */
export function energyValues(settings, hass) {
  const e = settings?.energy ?? {};
  const st = (key) => (e[key] ? hass.states?.[e[key]] : undefined);
  return {
    solar: powerW(st("solar")),
    einspeisung: powerW(st("einspeisung")),
    akku_ladestand: num(st("akku_ladestand")),
    akku_leistung: powerW(st("akku_leistung")),
    ertrag_heute: energyKWh(st("ertrag_heute")),
  };
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
export function watchedEntities(building, hass, byArea, { links = null, extra = [] } = {}) {
  const ids = new Set();
  const put = (id) => {
    if (typeof id === "string" && id.includes(".") && id !== "none") ids.add(id);
  };
  for (const floor of building.floors ?? []) {
    for (const room of placesOf(floor)) {
      for (const id of byArea.get(room.area_id) ?? []) {
        const d = domainOf(id);
        if (d === "sensor") {
          const cls = hass.states[id]?.attributes?.device_class;
          if (cls === "temperature" || cls === "humidity") ids.add(id);
        } else if (iconKind(hass.states[id])) ids.add(id);
      }
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
  for (const [key, id] of Object.entries(s.energy ?? {})) if (key !== "extra") put(id);
  for (const e of Array.isArray(s.energy?.extra) ? s.energy.extra : []) put(typeof e === "string" ? e : e?.entity);
  // Karten, Kurzwahl, eigene Einträge im Funktionsrad
  for (const c of Array.isArray(s.cards) ? s.cards : []) for (const e of Array.isArray(c?.entities) ? c.entities : []) put(typeof e === "string" ? e : e?.entity);
  for (const q of Array.isArray(s.quick) ? s.quick : []) put(q?.entity);
  for (const f of Array.isArray(s.functions) ? s.functions : []) put(f?.entity);
  // verknüpfte Kontakte und Rollläden der Öffnungen
  if (links) for (const per of links.values()) for (const l of per.values()) for (const id of [l.contact, l.cover]) put(id);
  for (const id of extra) put(id);
  return [...ids].sort();
}
