// Hausstatus (ohne DOM, mit node testbar): wo liegt eine Entität, was ist offen/gekippt, welche Lichter
// brennen, welche Schlösser sind offen. Grundlage für Statusleiste, Hinweise und Gute-Nacht-Check.

import { CONTACT_CLASSES, domainOf, isOpen, isShown, placesOf } from "./devices.js";

const OFFLINE = ["unavailable", "unknown"];

/**
 * Wo liegt eine Entität: Map id → {floorId, roomId}. Bereichs-Entitäten im ersten Raum ihres Bereichs
 * (wie die Symbole), verknüpfte Kontakte/Rollläden an der Öffnung ihres Raums.
 */
export function entityPlaces(building, hass, byArea, links = null) {
  const map = new Map();
  for (const floor of building?.floors ?? []) {
    for (const room of placesOf(floor)) {
      for (const id of byArea?.get(room.area_id) ?? []) if (!map.has(id)) map.set(id, { floorId: floor.id, roomId: room.id });
      for (const id of room.panel ?? []) if (!map.has(id)) map.set(id, { floorId: floor.id, roomId: room.id });
    }
  }
  // zusätzliche Schlösser ohne Raum (Abläufe & Sicherheit)
  for (const id of Array.isArray(building?.settings?.security?.locks) ? building.settings.security.locks : []) if (!map.has(id)) map.set(id, { floorId: null, roomId: null });
  for (const floor of building?.floors ?? []) {
    const per = links?.get(floor.id);
    if (!per) continue;
    for (const o of floor.openings ?? []) {
      const l = per.get(o.id);
      for (const id of [l?.contact, l?.cover]) if (id) map.set(id, { floorId: floor.id, roomId: o.room_id, openingId: o.id });
    }
  }
  return map;
}

/** Fenster/Tür: "open", "tilted" (gekippt), "closed" oder null (nicht erreichbar). */
export function openState(st, tiltSt = null) {
  if (!st || OFFLINE.includes(st.state)) return null;
  const ws = String(st.attributes?.window_state ?? st.state).toLowerCase();
  if (["tilted", "gekippt", "tilt", "kipp"].includes(ws)) return "tilted";
  if (tiltSt && tiltSt.state === "on") return "tilted";
  return isOpen(st) ? "open" : "closed";
}

/** Art einer offenen Stelle. */
function openKind(id, st) {
  const cls = st?.attributes?.device_class;
  if (domainOf(id) === "cover" || cls === "garage_door") return "garage";
  if (cls === "door") return "door";
  return "window";
}

/**
 * Was ist los im Haus.
 * @returns {{lights: object[], open: object[], unlocked: object[], alarm: object|null, perFloor: Map<string, {lights: number, open: number}>}}
 */
export function houseStatus(building, hass, byArea, links = null, places = entityPlaces(building, hass, byArea, links), tilts = null) {
  const out = { lights: [], open: [], unlocked: [], alarm: null, perFloor: new Map() };
  // Kippsensoren der Öffnungen: Kontakt → Kippsensor
  if (!tilts) {
    tilts = new Map();
    if (links) for (const per of links.values()) for (const l of per.values()) if (l.contact && l.tilt) tilts.set(l.contact, l.tilt);
  }
  const floorOf = (fid) => {
    if (!out.perFloor.has(fid)) out.perFloor.set(fid, { lights: 0, open: 0 });
    return out.perFloor.get(fid);
  };
  for (const [id, place] of places) {
    const st = hass.states[id];
    if (!st || !isShown(hass, id)) continue;
    const d = domainOf(id);
    const cls = st.attributes?.device_class;
    if (d === "light") {
      // Lichtgruppen nicht doppelt zählen
      if (st.state === "on" && !Array.isArray(st.attributes?.entity_id)) {
        out.lights.push({ entity_id: id, ...place });
        floorOf(place.floorId).lights++;
      }
    } else if ((d === "binary_sensor" && CONTACT_CLASSES.includes(cls)) || (d === "cover" && (cls === "garage" || cls === "gate"))) {
      const s = d === "cover" ? (isOpen(st) ? "open" : OFFLINE.includes(st.state) ? null : "closed") : openState(st, tilts.get(id) ? hass.states[tilts.get(id)] : null);
      if (s === "open" || s === "tilted") {
        out.open.push({ entity_id: id, kind: openKind(id, st), state: s, ...place });
        floorOf(place.floorId).open++;
      }
    } else if (d === "lock") {
      if (st.state === "unlocked" || st.state === "open") out.unlocked.push({ entity_id: id, state: st.state, ...place });
    } else if (d === "alarm_control_panel" && !out.alarm) out.alarm = { entity_id: id, state: st.state, ...place };
  }
  return out;
}

/** Kurztexte der Statusleiste. */
export function statusChips(status) {
  const chips = [];
  const n = status.lights.length;
  if (n) chips.push({ key: "lights", icon: "mdi:lightbulb-group", text: `${n} Licht an`, level: "info" });
  const garage = status.open.filter((o) => o.kind === "garage");
  const rest = status.open.filter((o) => o.kind !== "garage");
  if (rest.length) {
    const tilted = rest.filter((o) => o.state === "tilted").length;
    const open = rest.length - tilted;
    const parts = [];
    if (open) parts.push(`${open} offen`);
    if (tilted) parts.push(`${tilted} gekippt`);
    chips.push({ key: "open", icon: "mdi:window-open-variant", text: parts.join(" · "), level: "warn" });
  }
  if (garage.length) chips.push({ key: "garage", icon: "mdi:garage-open", text: garage.length > 1 ? `${garage.length} Tore offen` : "Garage offen", level: "warn" });
  if (status.unlocked.length) chips.push({ key: "locks", icon: "mdi:lock-open-variant", text: `${status.unlocked.length} Schloss offen`, level: "warn" });
  if (status.alarm) {
    const armed = String(status.alarm.state).startsWith("armed");
    chips.push({ key: "alarm", icon: armed ? "mdi:shield-lock" : "mdi:shield-off-outline", text: status.alarm.state === "triggered" ? "Alarm!" : armed ? "Alarm scharf" : "Alarm aus", level: status.alarm.state === "triggered" ? "crit" : "info" });
  }
  if (!status.open.length && !status.unlocked.length) chips.push({ key: "ok", icon: "mdi:check-circle", text: "Alles zu", level: "ok" });
  return chips;
}
