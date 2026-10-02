// Zuordnung von Home-Assistant-Entitäten zu Räumen und Öffnungen (ohne Three.js, mit node testbar).

import { centroid, pointInPolygon } from "./walls.js";

export const CONTACT_CLASSES = ["window", "door", "opening", "garage_door"];
const ICON_DOMAINS = ["light", "switch", "fan", "cover", "climate"];
const TOGGLE_DOMAINS = ["light", "switch", "fan", "cover"];

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
 * Symbole einer Etage: je Raum mit area_id alle passenden Entitäten, automatisch im Raum verteilt.
 * Manuelle Positionen aus floor.placements haben Vorrang (auch für Entitäten ohne passenden Raum).
 * @returns {{entity_id: string, kind: string, x: number, z: number, y: number|null, room: string|null, manual: boolean}[]}
 */
export function floorIcons(floor, hass, byArea = entitiesByArea(hass)) {
  const placements = new Map((floor.placements ?? []).map((p) => [p.entity_id, p]));
  const icons = [];
  const used = new Set();
  for (const room of floor.rooms ?? []) {
    if (!room.area_id) continue;
    const ids = (byArea.get(room.area_id) ?? []).filter((id) => iconKind(hass.states[id]));
    const auto = ids.filter((id) => !placements.has(id));
    const spots = layout(room.points, auto.length);
    auto.forEach((id, i) => {
      icons.push({ entity_id: id, kind: iconKind(hass.states[id]), x: spots[i][0], z: spots[i][1], y: null, room: room.id, manual: false });
      used.add(id);
    });
    for (const id of ids.filter((x) => placements.has(x))) {
      const p = placements.get(id);
      icons.push({ entity_id: id, kind: iconKind(hass.states[id]), x: p.x, z: p.z, y: p.y ?? null, room: room.id, manual: true });
      used.add(id);
    }
  }
  for (const p of placements.values()) {
    if (used.has(p.entity_id)) continue;
    const kind = iconKind(hass.states?.[p.entity_id]);
    if (!kind) continue;
    const room = (floor.rooms ?? []).find((r) => pointInPolygon([p.x, p.z], r.points));
    icons.push({ entity_id: p.entity_id, kind, x: p.x, z: p.z, y: p.y ?? null, room: room?.id ?? null, manual: true });
  }
  return icons;
}

/** Verteilt n Punkte in einem Raster um den Schwerpunkt, innerhalb des Polygons. */
export function layout(points, n) {
  if (!n) return [];
  const c = centroid(points);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...zs) - Math.min(...zs);
  const step = Math.max(0.35, Math.min(0.8, (w * 0.7) / cols, (d * 0.7) / rows));
  const out = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const p = [c[0] + (col - (inRow - 1) / 2) * step, c[1] + (row - (rows - 1) / 2) * step + 0.45];
    out.push(pointInPolygon(p, points) ? p : [c[0], c[1] + 0.45]);
  }
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
 * Kontakt- und Rollladen-Entitäten je Öffnung. Ein gesetztes Feld (contact/cover) gilt, "none" heißt
 * keins, null heißt automatisch: freie Sensoren bzw. Rollläden des Raumbereichs werden der Reihe
 * nach Öffnungen passenden Typs zugeordnet.
 * @returns {Map<string, {contact: string|null, cover: string|null}>}
 */
export function openingLinks(floor, hass, byArea) {
  const links = new Map();
  const rooms = new Map((floor.rooms ?? []).map((r) => [r.id, r]));
  const explicit = new Set();
  for (const o of floor.openings ?? []) {
    for (const key of ["contact", "cover"]) if (o[key] && o[key] !== "none") explicit.add(o[key]);
  }
  const taken = new Set(explicit);
  const sorted = [...(floor.openings ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const o of sorted) links.set(o.id, { contact: null, cover: null });
  for (const o of sorted) {
    const link = links.get(o.id);
    const ids = byArea.get(rooms.get(o.room_id)?.area_id) ?? [];
    if (o.contact === "none") link.contact = null;
    else if (o.contact) link.contact = o.contact;
    else {
      const classes = CONTACT_FOR_TYPE[o.type] ?? [];
      const free = ids.find(
        (id) => !taken.has(id) && domainOf(id) === "binary_sensor" && classes.includes(hass.states[id]?.attributes?.device_class),
      );
      if (free) {
        link.contact = free;
        taken.add(free);
      }
    }
    if (o.cover === "none") link.cover = null;
    else if (o.cover) link.cover = o.cover;
    else if (o.type !== "door" || o.style === "glass" || o.style === "sliding") {
      const wantGarage = o.type === "garage";
      const free = ids.find((id) => {
        if (taken.has(id) || domainOf(id) !== "cover") return false;
        return (hass.states[id]?.attributes?.device_class === "garage") === wantGarage;
      });
      if (free) {
        link.cover = free;
        taken.add(free);
      }
    }
  }
  return links;
}

/** Offen-Zustand eines Kontakts (binary_sensor an = offen; Cover offen/öffnend). */
export function isOpen(stateObj) {
  if (!stateObj) return false;
  if (domainOf(stateObj.entity_id) === "cover") return ["open", "opening"].includes(stateObj.state);
  return stateObj.state === "on";
}

/** Anteil, zu dem ein Rollladen geschlossen ist (0 = offen, 1 = ganz zu), oder null ohne Zustand. */
export function coverClosedFraction(stateObj) {
  if (!stateObj || ["unavailable", "unknown"].includes(stateObj.state)) return null;
  const pos = stateObj.attributes?.current_position;
  if (typeof pos === "number") return Math.min(1, Math.max(0, 1 - pos / 100));
  return stateObj.state === "closed" ? 1 : 0;
}

/** Leistung in Watt (rechnet kW/MW um). */
export function powerW(stateObj) {
  const v = num(stateObj);
  if (v === null) return null;
  const unit = (stateObj.attributes?.unit_of_measurement ?? "W").toLowerCase();
  if (unit === "kw") return v * 1000;
  if (unit === "mw") return v * 1e6;
  return v;
}

/** Energie in kWh (rechnet Wh/MWh um). */
export function energyKWh(stateObj) {
  const v = num(stateObj);
  if (v === null) return null;
  const unit = (stateObj.attributes?.unit_of_measurement ?? "kWh").toLowerCase();
  if (unit === "wh") return v / 1000;
  if (unit === "mwh") return v * 1000;
  return v;
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
 * Kurzer Schlüssel über alle Zustände, die das Modell betreffen. Nur wenn er sich ändert,
 * wird neu gezeichnet (hass ändert sich bei jedem beliebigen Zustandswechsel).
 */
export function watchedEntities(building, hass, byArea) {
  const ids = new Set();
  for (const floor of building.floors ?? []) {
    for (const room of floor.rooms ?? []) {
      for (const id of byArea.get(room.area_id) ?? []) {
        const d = domainOf(id);
        if (d === "sensor") {
          const cls = hass.states[id]?.attributes?.device_class;
          if (cls === "temperature" || cls === "humidity") ids.add(id);
        } else if (iconKind(hass.states[id])) ids.add(id);
      }
      for (const key of ["temperature", "humidity"]) {
        const fixed = room.climate?.[key];
        if (fixed && fixed !== "none") ids.add(fixed);
      }
    }
    for (const o of floor.openings ?? []) for (const key of ["contact", "cover"]) if (o[key] && o[key] !== "none") ids.add(o[key]);
    for (const p of floor.placements ?? []) ids.add(p.entity_id);
  }
  for (const id of Object.values(building.settings?.energy ?? {})) if (typeof id === "string") ids.add(id);
  return [...ids].sort();
}
