// Hinweise am Modell (ohne DOM, mit node testbar): Regen bei offenem Fenster, Rauch-/Wasser-/Gasmelder,
// Tür oder Garage zu lange offen, Heizung bei offenem Fenster, hohe Luftfeuchte, Akku leer.
// Läuft im Browser (nur solange ein Tablet offen ist); Push-Nachrichten bleiben Sache von HA-Automationen.

import { CONTACT_CLASSES, domainOf, isOpen, placesOf, roomClimate, roomHeating } from "./devices.js";
import { openState } from "./status.js";
import { normalizeEnergy } from "./energymodel.js";
import { computeWalls } from "./walls.js";

/** Standard-Einstellungen (settings.alerts); Minuten/Prozent 0 = Regel aus. */
export const ALERT_DEFAULTS = {
  rain_open: true,
  rain_tilted: true,
  safety: true,
  heat_open: true,
  humidity: true,
  door_open_min: 10,
  garage_open_min: 15,
  heating_open_min: 10,
  akku_min: 15,
};

const SAFETY = { moisture: "Wassermelder", smoke: "Rauchmelder", gas: "Gasmelder", carbon_monoxide: "CO-Melder", heat: "Hitzemelder", safety: "Sicherheitsmelder" };
export const SAFETY_CLASSES = Object.keys(SAFETY);
const LEVEL_ORDER = { critical: 0, warn: 1, info: 2 };

/** Einstellungen bereinigen (nie ablehnen: unbekannte Werte → Standard). */
export function normalizeAlerts(cfg) {
  const out = { ...ALERT_DEFAULTS };
  for (const [k, def] of Object.entries(ALERT_DEFAULTS)) {
    const v = cfg?.[k];
    if (typeof def === "boolean") {
      if (typeof v === "boolean") out[k] = v;
    } else if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))) out[k] = Math.min(1440, Math.max(0, Number(v)));
  }
  return out;
}

/** Öffnungen in Außenwänden: Set "floorId:openingId" (einmal je Gebäude berechnen). */
export function exteriorOpenings(building) {
  const out = new Set();
  for (const floor of building?.floors ?? []) {
    const { segments, openings } = computeWalls(floor, building.settings ?? {});
    const kind = new Map(segments.map((s) => [s.id, s.kind]));
    for (const p of openings) if (kind.get(p.segment) === "exterior") out.add(`${floor.id}:${p.opening.id}`);
  }
  return out;
}

const minutesSince = (st, now) => {
  const t = Date.parse(st?.last_changed ?? st?.last_updated ?? "");
  return Number.isFinite(t) ? (now - t) / 60000 : 0;
};

/**
 * Hinweise auswerten.
 * @returns {{alerts: {key: string, rule: string, level: "critical"|"warn"|"info", icon: string, text: string, floorId: string|null, roomId: string|null, entities: string[]}[], pending: boolean}}
 *   pending: eine Dauer-Regel wartet noch (Tür seit 3 min offen …) – dann regelmäßig neu prüfen
 */
export function evaluateAlerts({ building, hass, byArea, links, places, exterior = new Set(), weather = null, energy = {}, now = Date.now(), cfg = {}, humidityMax = 65 }) {
  const c = normalizeAlerts(cfg);
  const alerts = [];
  let pending = false;
  const roomName = (fid, rid) => {
    const f = building.floors.find((x) => x.id === fid);
    return (f && placesOf(f).find((r) => r.id === rid)?.name) || "";
  };
  const name = (id) => hass.states[id]?.attributes?.friendly_name ?? id;
  const keyOf = (rule, ids) => `${rule}:${[...ids].sort().map((id) => `${id}@${hass.states[id]?.last_changed ?? ""}`).join(",")}`;
  const push = (rule, level, icon, text, ids, place = {}) => alerts.push({ key: keyOf(rule, ids), rule, level, icon, text, floorId: place.floorId ?? null, roomId: place.roomId ?? null, entities: [...ids] });

  // Sicherheitsmelder (Wasser, Rauch, Gas, CO)
  if (c.safety) {
    for (const [id, place] of places) {
      const st = hass.states[id];
      const cls = st?.attributes?.device_class;
      if (domainOf(id) !== "binary_sensor" || !SAFETY[cls] || st.state !== "on") continue;
      const room = roomName(place.floorId, place.roomId);
      push("safety", "critical", cls === "moisture" ? "mdi:water-alert" : cls === "smoke" ? "mdi:smoke-detector-alert" : "mdi:alert", `${SAFETY[cls]}${room ? ` ${room}` : ""}!`, [id], place);
    }
  }

  // Öffnungen mit Kontakt: Regen, Tür zu lange offen
  const rainy = weather === "rain" || weather === "snow" || weather === "hail";
  const rainRooms = [];
  const rainIds = [];
  for (const floor of building.floors ?? []) {
    const per = links?.get(floor.id);
    if (!per) continue;
    for (const o of floor.openings ?? []) {
      const l = per.get(o.id);
      if (!l?.contact) continue;
      const st = hass.states[l.contact];
      const s = openState(st);
      const outside = exterior.has(`${floor.id}:${o.id}`);
      if (rainy && c.rain_open && outside && (s === "open" || (s === "tilted" && c.rain_tilted))) {
        rainIds.push(l.contact);
        const rn = roomName(floor.id, o.room_id);
        if (rn && !rainRooms.some((r) => r.name === rn)) rainRooms.push({ name: rn, floorId: floor.id, roomId: o.room_id });
      }
      if (o.type === "door" && outside && c.door_open_min > 0 && s === "open") {
        const min = minutesSince(st, now);
        if (min >= c.door_open_min) push("door_open", "warn", "mdi:door-open", `${name(l.contact)} seit ${Math.floor(min)} min offen`, [l.contact], { floorId: floor.id, roomId: o.room_id });
        else pending = true;
      }
    }
  }
  if (rainIds.length) {
    const what = weather === "snow" ? "Schnee" : weather === "hail" ? "Hagel" : "Regen";
    push("rain_open", "warn", "mdi:weather-pouring", `${what} – Fenster offen: ${rainRooms.map((r) => r.name).join(", ") || "außen"}`, rainIds, rainRooms[0] ?? {});
  }

  // Garagentore zu lange offen
  if (c.garage_open_min > 0) {
    for (const [id, place] of places) {
      const st = hass.states[id];
      if (domainOf(id) !== "cover" || !["garage", "gate"].includes(st?.attributes?.device_class) || !isOpen(st)) continue;
      const min = minutesSince(st, now);
      if (min >= c.garage_open_min) push("garage_open", "warn", "mdi:garage-open", `${name(id)} seit ${Math.floor(min)} min offen`, [id], place);
      else pending = true;
    }
  }

  // je Raum: Heizung bei offenem Fenster, Luftfeuchte
  for (const floor of building.floors ?? []) {
    for (const room of placesOf(floor)) {
      const place = { floorId: floor.id, roomId: room.id };
      if (c.heat_open && c.heating_open_min > 0) {
        const th = roomHeating(room, hass, byArea);
        if (th && (th.action === "heating" || (th.action == null && th.mode === "heat"))) {
          const windows = [...places].filter(([id, p]) => p.floorId === floor.id && p.roomId === room.id && domainOf(id) === "binary_sensor" && CONTACT_CLASSES.includes(hass.states[id]?.attributes?.device_class) && hass.states[id]?.attributes?.device_class !== "door" && ["open", "tilted"].includes(openState(hass.states[id])));
          const long = windows.filter(([id]) => minutesSince(hass.states[id], now) >= c.heating_open_min);
          if (long.length) push("heat_open", "warn", "mdi:radiator", `Fenster offen, Heizung läuft: ${room.name}`, [th.entity, ...long.map(([id]) => id)], place);
          else if (windows.length) pending = true;
        }
      }
      if (c.humidity && humidityMax > 0) {
        const h = roomClimate(room, hass, byArea).humidity;
        if (h != null && h > humidityMax) push("humidity", "warn", "mdi:water-percent-alert", `Luftfeuchte ${Math.round(h)} % – ${room.name} lüften`, [`room.${floor.id}.${room.id}`], place);
      }
    }
  }

  // Akku leer
  if (c.akku_min > 0 && energy.akku_ladestand != null && energy.akku_ladestand < c.akku_min) {
    const id = normalizeEnergy(building.settings?.energy).sources.find((s) => s.type === "speicher" && s.soc)?.soc;
    push("akku_low", "info", "mdi:battery-alert", `Akku ${Math.round(energy.akku_ladestand)} %`, id ? [id] : ["akku"], places.get(id) ?? {});
  }

  alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return { alerts, pending };
}

/** Nur die nicht ausgeblendeten Hinweise (ack: {key: Zeitpunkt}). */
export function visibleAlerts(list, ack = {}) {
  return (list ?? []).filter((a) => !ack[a.key]);
}
