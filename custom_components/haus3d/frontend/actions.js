// Was ein Tipp auf ein Gerät auslöst – eine Stelle für Raumfenster, Bubbles, 3D-Geräte, Kurzwahl und
// Funktionsrad. Ohne DOM (mit node testbar). Heikle Aktionen (Haustür aufschließen, Garagentor, Sirene)
// bekommen eine Nachfrage; Automationen werden nur aus der Kurzwahl/dem Rad ausgelöst, ein Tipp
// anderswo zeigt ihre Details (früher schaltete er sie versehentlich ab).

const domainOf = (id) => String(id).slice(0, String(id).indexOf("."));
const OFFLINE = ["unavailable", "unknown"];
const TOGGLE = ["light", "switch", "fan", "input_boolean", "humidifier"];

/** Text zum Zustand eines Schlosses. */
export function lockText(state) {
  return { locked: "abgeschlossen", unlocked: "offen", open: "geöffnet", jammed: "blockiert", locking: "schließt ab …", unlocking: "schließt auf …", opening: "öffnet …" }[state] ?? state ?? "–";
}

/**
 * Aktion für eine Entität.
 * @param {string} id Entität
 * @param {object} st Zustand (hass.states[id])
 * @param {{source?: "tap"|"wheel", safety?: boolean, confirm?: boolean}} [o]
 *   source: Tipp im Haus (tap) oder Kurzwahl/Funktionsrad (wheel); safety: Nachfrage bei heiklen
 *   Aktionen (Standard an); confirm: diese Aktion immer nachfragen (Häkchen am Eintrag)
 * @returns {{call: string[]|null, data: object, confirm: {question: string, ok: string, danger: boolean}|null, dialog: "moreinfo"|null, verb: string}}
 */
export function entityAction(id, st, { source = "tap", safety = true, confirm = false } = {}) {
  const domain = domainOf(id);
  const state = st?.state;
  const out = { call: null, data: {}, confirm: null, dialog: null, verb: "" };
  const details = () => ({ ...out, dialog: "moreinfo" });
  if (st && OFFLINE.includes(state)) return details();
  const ask = (question, ok, danger = false) => (safety ? { question, ok, danger } : null);

  if (domain === "automation") {
    if (source !== "wheel") return details();
    Object.assign(out, { call: ["automation", "trigger"], verb: "ausgelöst" });
  } else if (domain === "script") Object.assign(out, { call: ["script", "turn_on"], verb: "gestartet" });
  else if (domain === "scene") Object.assign(out, { call: ["scene", "turn_on"], verb: "aktiviert" });
  else if (domain === "button" || domain === "input_button") Object.assign(out, { call: [domain, "press"], verb: "gedrückt" });
  else if (domain === "lock") {
    if (!st) Object.assign(out, { call: ["lock", "lock"], verb: "wird abgeschlossen" });
    else if (state === "locked") Object.assign(out, { call: ["lock", "unlock"], verb: "wird aufgeschlossen", confirm: ask("aufschließen", "Aufschließen", true) });
    else if (state === "unlocked") Object.assign(out, { call: ["lock", "lock"], verb: "wird abgeschlossen" });
    else return details(); // blockiert, offen oder gerade in Bewegung
  } else if (domain === "cover") {
    const cls = st?.attributes?.device_class;
    if (cls === "garage" || cls === "gate") {
      const open = state === "open" || state === "opening";
      Object.assign(out, open
        ? { call: ["cover", "close_cover"], verb: "wird geschlossen", confirm: ask("schließen", "Schließen") }
        : { call: ["cover", "open_cover"], verb: "wird geöffnet", confirm: ask("öffnen", "Öffnen", true) });
    } else Object.assign(out, { call: ["cover", "toggle"], verb: state === "open" || state === "opening" ? "fährt zu" : "fährt auf" });
  } else if (domain === "siren") {
    if (state === "on") Object.assign(out, { call: ["siren", "turn_off"], verb: "aus" });
    else Object.assign(out, { call: ["siren", "turn_on"], verb: "an", confirm: ask("einschalten", "Sirene an", true) });
  } else if (domain === "media_player") Object.assign(out, { call: ["media_player", "media_play_pause"], verb: state === "playing" ? "Pause" : "Wiedergabe" });
  else if (TOGGLE.includes(domain)) Object.assign(out, { call: [domain, "toggle"], verb: state === "on" ? "aus" : "an" });
  else if (source === "wheel") Object.assign(out, { call: [domain, "toggle"], verb: "umgeschaltet" });
  else return details(); // Klima, Alarm, Sensoren …: Details

  if (confirm && out.call && !out.confirm) out.confirm = { question: "ausführen", ok: "Ausführen", danger: false };
  return out;
}

/** Sammel-Aktionen: gleiche Dienste zusammenfassen ([{entity_id, call}] → je Dienst ein Aufruf). */
export function bulkCalls(items) {
  const groups = new Map();
  for (const it of items ?? []) {
    if (!it?.call || !it.entity_id) continue;
    const key = it.call.join(".");
    if (!groups.has(key)) groups.set(key, { domain: it.call[0], service: it.call[1], data: { entity_id: [] } });
    const g = groups.get(key);
    if (!g.data.entity_id.includes(it.entity_id)) g.data.entity_id.push(it.entity_id);
  }
  return [...groups.values()];
}
