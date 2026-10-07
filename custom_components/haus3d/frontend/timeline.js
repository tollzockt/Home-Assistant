// Zeitstrahl (ohne DOM, mit node testbar): den heutigen Tag zurückspulen (Verlauf aus Home Assistant)
// und in die nächsten Stunden schauen (Wettervorhersage, Sonnenstand, erwartete PV-Leistung).

import { sunPosition } from "./sun.js";

/** Domänen, deren Verlauf im Modell etwas zeigt. */
export const TIMELINE_DOMAINS = ["light", "switch", "binary_sensor", "cover", "lock", "person", "device_tracker", "climate", "media_player", "fan", "weather", "sensor"];

const ms = (v) => (typeof v === "number" ? (v > 1e12 ? v : v * 1000) : Date.parse(v ?? ""));

/**
 * Verlauf (history/history_during_period, kompakt {s, a, lu, lc} oder voll {state, attributes,
 * last_changed}) zu {entity_id: [{t, state, attributes}]} sortiert.
 */
export function normalizeHistory(raw) {
  const out = {};
  for (const [id, list] of Object.entries(raw ?? {})) {
    const items = (Array.isArray(list) ? list : [])
      .map((e) => ({ t: ms(e.lu ?? e.lc ?? e.last_updated ?? e.last_changed), state: e.s ?? e.state, attributes: e.a ?? e.attributes ?? null }))
      .filter((e) => Number.isFinite(e.t) && e.state !== undefined)
      .sort((x, y) => x.t - y.t);
    if (items.length) out[id] = items;
  }
  return out;
}

/** Zustand jeder Entität zum Zeitpunkt t (letzter Eintrag ≤ t); ohne frühere Einträge: undefined. */
export function stateAt(entries, t) {
  let lo = 0;
  let hi = entries.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].t <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best < 0 ? undefined : entries[best];
}

/**
 * hass zum Zeitpunkt t: Zustände aus dem Verlauf (Attribute aus dem Verlauf, sonst die aktuellen),
 * Sonne neu berechnet. Schalten ist im Zeitstrahl gesperrt.
 */
export function historyStates(real, history, t, sun = null) {
  const states = { ...real.states };
  for (const [id, entries] of Object.entries(history)) {
    const e = stateAt(entries, t);
    if (!e) continue;
    const cur = real.states[id] ?? { entity_id: id, attributes: {} };
    const iso = new Date(e.t).toISOString();
    states[id] = { ...cur, state: String(e.state), attributes: e.attributes ? { ...cur.attributes, ...e.attributes } : cur.attributes, last_changed: iso, last_updated: iso };
  }
  if (sun) states["sun.sun"] = sunState(real.states["sun.sun"], t, sun);
  return states;
}

/** sun.sun für den Zeitpunkt t am Ort {lat, lon}. */
export function sunState(base, t, { lat, lon }) {
  const p = sunPosition(t, lat, lon);
  const b = base ?? { entity_id: "sun.sun", attributes: {} };
  return { ...b, state: p.elevation > -0.83 ? "above_horizon" : "below_horizon", attributes: { ...b.attributes, azimuth: Math.round(p.azimuth * 10) / 10, elevation: Math.round(p.elevation * 10) / 10 } };
}

/** Eintrag der Vorhersage, der t am nächsten liegt (stündlich: [{datetime, condition, temperature, cloud_coverage, …}]). */
export function forecastAt(list, t) {
  let best = null;
  for (const f of list ?? []) {
    const ft = ms(f.datetime);
    if (!Number.isFinite(ft)) continue;
    if (!best || Math.abs(ft - t) < Math.abs(ms(best.datetime) - t)) best = f;
  }
  return best && Math.abs(ms(best.datetime) - t) <= 3 * 3600000 ? best : null;
}

/** Bewölkung in % aus der Vorhersage (cloud_coverage, sonst aus dem Zustand geschätzt). */
export function cloudOf(f) {
  if (!f) return null;
  const c = Number(f.cloud_coverage);
  if (Number.isFinite(c)) return Math.max(0, Math.min(100, c));
  return { sunny: 5, "clear-night": 5, partlycloudy: 45, cloudy: 90, fog: 95, rainy: 90, pouring: 100, snowy: 95, "snowy-rainy": 95, hail: 100, lightning: 95, "lightning-rainy": 100, windy: 40, "windy-variant": 60, exceptional: 80 }[f.condition] ?? 50;
}

/**
 * Erwartete PV-Leistung (W): klarer Himmel ~ kWp · sin(Sonnenhöhe) · 0,85, gedämpft nach Bewölkung
 * (Kasten-Czeplak). Grobe Schätzung ohne Ausrichtung der Module.
 */
export function pvEstimate(kwp, elevation, cloud = 0) {
  if (!(kwp > 0) || !(elevation > 0)) return 0;
  const clear = kwp * 1000 * Math.sin((elevation * Math.PI) / 180) * 0.85;
  const factor = 1 - 0.75 * Math.pow(Math.max(0, Math.min(100, cloud ?? 0)) / 100, 3.4);
  return Math.round(clear * factor);
}

/** Bereich des Zeitstrahls: heute ab Mitternacht (mind. 6 h zurück) bis 24 h voraus, Schritt 5 min. */
export function timelineRange(now = Date.now()) {
  const mid = new Date(now);
  mid.setHours(0, 0, 0, 0);
  const from = Math.min(mid.getTime(), now - 6 * 3600000);
  return { from, to: now + 24 * 3600000, step: 5 * 60000 };
}

/** „Mi 14:35“ bzw. „jetzt“. */
export function timeLabel(t, now = Date.now()) {
  if (Math.abs(t - now) < 150000) return "jetzt";
  const d = new Date(t);
  const day = new Date(now).toDateString() === d.toDateString() ? "" : `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()]} `;
  return `${day}${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}
