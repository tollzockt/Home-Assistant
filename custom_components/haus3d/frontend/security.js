// Gute-Nacht-Check und „Haus verlassen“ (ohne DOM, mit node testbar): was ist noch offen, an oder
// nicht abgeschlossen – und mit welchen Sammel-Aufrufen lässt es sich erledigen.

import { bulkCalls } from "./actions.js";
import { domainOf, isShown, placesOf } from "./devices.js";

const KIND_TEXT = { window: "Fenster", door: "Tür", garage: "Tor" };

/**
 * Abschnitte der Checkliste.
 * @param {object} status houseStatus(...)
 * @param {object} o
 * @param {"goodnight"|"leave"} [o.mode] Gute Nacht (mit Rollläden) oder Haus verlassen
 * @param {string[]} [o.keepOn] Entitäten, die anbleiben dürfen (nicht vorausgewählt)
 * @returns {{key: string, title: string, info?: boolean, confirm?: boolean, items: {entity_id: string, label: string, floorId: string|null, roomId: string|null, checked: boolean, call: string[]|null, note?: string}[]}[]}
 */
export function checklist(status, hass, building, places, { mode = "goodnight", keepOn = [] } = {}) {
  const keep = new Set(keepOn);
  const where = (x) => {
    const f = building.floors.find((ff) => ff.id === x.floorId);
    const r = f && placesOf(f).find((rr) => rr.id === x.roomId);
    return [f?.name, r?.name].filter(Boolean).join(" · ");
  };
  const label = (x, extra = "") => {
    const name = hass.states[x.entity_id]?.attributes?.friendly_name ?? x.entity_id;
    const w = where(x);
    return `${w ? `${w} · ` : ""}${name}${extra}`;
  };
  const sections = [];
  // Fenster und Türen kann Haus 3D nicht schließen: nur anzeigen (Tipp fliegt hin)
  const open = status.open.filter((o) => o.kind !== "garage");
  if (open.length) sections.push({ key: "open", title: "Offen", info: true, items: open.map((o) => ({ entity_id: o.entity_id, label: label(o, ` – ${KIND_TEXT[o.kind] ?? ""} ${o.state === "tilted" ? "gekippt" : "offen"}`.replace(/ {2,}/g, " ")), floorId: o.floorId, roomId: o.roomId, checked: false, call: null })) });
  const garage = status.open.filter((o) => o.kind === "garage" && domainOf(o.entity_id) === "cover");
  if (garage.length) sections.push({ key: "garage", title: "Tore", confirm: true, items: garage.map((o) => ({ entity_id: o.entity_id, label: label(o), floorId: o.floorId, roomId: o.roomId, checked: true, call: ["cover", "close_cover"] })) });
  if (status.unlocked.length) sections.push({ key: "locks", title: "Nicht abgeschlossen", items: status.unlocked.map((o) => ({ entity_id: o.entity_id, label: label(o), floorId: o.floorId, roomId: o.roomId, checked: true, call: ["lock", "lock"] })) });
  if (status.lights.length) sections.push({ key: "lights", title: "Licht an", items: status.lights.map((o) => ({ entity_id: o.entity_id, label: label(o), floorId: o.floorId, roomId: o.roomId, checked: !keep.has(o.entity_id), call: ["light", "turn_off"] })) });
  if (mode === "goodnight") {
    // Rollläden (keine Tore) im Haus, die noch offen sind
    const covers = [...places].filter(([id]) => domainOf(id) === "cover" && isShown(hass, id) && !["garage", "gate"].includes(hass.states[id]?.attributes?.device_class) && ["open", "opening"].includes(hass.states[id]?.state));
    if (covers.length) sections.push({ key: "covers", title: "Rollläden offen", items: covers.map(([id, p]) => ({ entity_id: id, label: label({ entity_id: id, ...p }), floorId: p.floorId, roomId: p.roomId, checked: !keep.has(id), call: ["cover", "close_cover"] })) });
  }
  return sections;
}

/** Sammel-Aufrufe der angehakten Einträge (ein Aufruf je Dienst). */
export function checklistCalls(sections, keys = null) {
  const items = sections.filter((s) => !keys || keys.includes(s.key)).flatMap((s) => s.items.filter((i) => i.checked && i.call));
  return bulkCalls(items);
}

/** Alles erledigt? (nichts offen, nichts an, alles zu) */
export function allSecure(sections) {
  return sections.every((s) => s.items.length === 0);
}

/** Skript/Szene des Ablaufs (settings.routines.goodnight / leave) oder null. */
export function routineCall(routines, mode, hass) {
  const id = routines?.[mode];
  if (!id || typeof id !== "string" || !id.includes(".")) return null;
  const d = domainOf(id);
  const service = d === "automation" ? "trigger" : d === "button" || d === "input_button" ? "press" : "turn_on";
  return { domain: d, service, data: { entity_id: id }, exists: !!hass.states[id] };
}
