// Kameras, Medien, Saugroboter und Abläufe (ohne DOM, mit node testbar): was im Raumfenster, im
// Kamerafenster und an der Kurzwahl angezeigt wird und welche Dienste die Tasten auslösen.

import { agoText } from "./devices.js";

const domainOf = (id) => String(id).split(".")[0];
const has = (st, bit) => ((Number(st?.attributes?.supported_features) || 0) & bit) !== 0;

// media_player: MediaPlayerEntityFeature
const MP = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256, STOP: 4096, PLAY: 16384 };
// vacuum: VacuumEntityFeature
const VAC = { PAUSE: 4, STOP: 8, RETURN_HOME: 16, BATTERY: 64, LOCATE: 512, START: 8192 };

const MEDIA_STATES = { playing: "spielt", paused: "pausiert", idle: "bereit", on: "an", off: "aus", standby: "Standby", buffering: "lädt …", unavailable: "nicht erreichbar" };
const VAC_STATES = { cleaning: "saugt", docked: "in der Station", returning: "fährt zurück", paused: "pausiert", idle: "bereit", error: "Fehler", unavailable: "nicht erreichbar" };

/** Medienplayer: Titel, Zustand und welche Tasten es gibt. */
export function mediaInfo(st) {
  if (!st) return null;
  const a = st.attributes ?? {};
  const playing = st.state === "playing";
  const off = ["off", "standby", "unavailable", "unknown"].includes(st.state);
  const title = a.media_title ?? (a.app_name || a.source || "");
  const artist = a.media_artist ?? a.media_album_artist ?? a.media_series_title ?? "";
  const volume = a.volume_level == null ? null : Math.round(Number(a.volume_level) * 100);
  return {
    id: st.entity_id,
    name: a.friendly_name ?? st.entity_id,
    state: st.state,
    stateText: MEDIA_STATES[st.state] ?? st.state,
    playing,
    off,
    title: String(title ?? ""),
    artist: String(artist ?? ""),
    picture: a.entity_picture ?? null,
    volume,
    muted: !!a.is_volume_muted,
    can: {
      playPause: !off && (has(st, MP.PAUSE) || has(st, MP.PLAY)),
      prev: !off && has(st, MP.PREVIOUS),
      next: !off && has(st, MP.NEXT),
      volume: !off && has(st, MP.VOLUME_SET) && volume != null,
      mute: !off && has(st, MP.VOLUME_MUTE),
      power: has(st, off ? MP.TURN_ON : MP.TURN_OFF),
    },
  };
}

/** Dienst zu einer Medientaste. */
export function mediaCall(info, key, value) {
  const id = info.id;
  switch (key) {
    case "play":
      return ["media_player", "media_play_pause", { entity_id: id }];
    case "prev":
      return ["media_player", "media_previous_track", { entity_id: id }];
    case "next":
      return ["media_player", "media_next_track", { entity_id: id }];
    case "mute":
      return ["media_player", "volume_mute", { entity_id: id, is_volume_muted: !info.muted }];
    case "volume":
      return ["media_player", "volume_set", { entity_id: id, volume_level: Math.max(0, Math.min(1, Number(value) / 100)) }];
    case "power":
      return ["media_player", info.off ? "turn_on" : "turn_off", { entity_id: id }];
    default:
      return null;
  }
}

/** Saugroboter: Zustand, Akku, Tasten. */
export function vacuumInfo(st) {
  if (!st) return null;
  const a = st.attributes ?? {};
  const battery = a.battery_level == null ? null : Math.round(Number(a.battery_level));
  const cleaning = st.state === "cleaning";
  const home = st.state === "docked";
  return {
    id: st.entity_id,
    name: a.friendly_name ?? st.entity_id,
    state: st.state,
    stateText: VAC_STATES[st.state] ?? st.state,
    cleaning,
    error: st.state === "error",
    battery,
    can: {
      start: !cleaning && has(st, VAC.START),
      pause: cleaning && has(st, VAC.PAUSE),
      home: !home && st.state !== "returning" && has(st, VAC.RETURN_HOME),
      locate: has(st, VAC.LOCATE),
    },
  };
}

export function vacuumCall(info, key) {
  const svc = { start: "start", pause: "pause", home: "return_to_base", locate: "locate" }[key];
  return svc ? ["vacuum", svc, { entity_id: info.id }] : null;
}

/** Bild einer Kamera (entity_picture mit Zugangsschlüssel); t erzwingt ein neues Standbild. */
export function cameraSrc(st, t = 0) {
  const url = st?.attributes?.entity_picture;
  if (!url || st.state === "unavailable") return null;
  return t && !url.startsWith("data:") ? `${url}${url.includes("?") ? "&" : "?"}t=${t}` : url;
}

/**
 * Klingel gedrückt? Auslöser ist ein event-Element (neuer Zeitstempel) oder ein Binärsensor (geht an).
 * prev/cur: Zustandsobjekte vorher/jetzt.
 */
export function doorbellRang(prev, cur) {
  if (!cur || cur === prev || !prev) return false;
  const d = domainOf(cur.entity_id);
  if (d === "event") return cur.state !== prev.state && !["unknown", "unavailable"].includes(cur.state);
  if (d === "binary_sensor" || d === "input_boolean" || d === "switch") return cur.state === "on" && prev.state !== "on";
  if (d === "button" || d === "input_button") return cur.state !== prev.state;
  return false;
}

/** Klingel-Vorschlag: event mit device_class doorbell oder Name mit „Klingel“/„doorbell“. */
export function guessDoorbell(states) {
  const list = Object.values(states ?? {});
  const ev = list.find((s) => domainOf(s.entity_id) === "event" && s.attributes?.device_class === "doorbell");
  if (ev) return ev.entity_id;
  const named = list.find((s) => ["event", "binary_sensor"].includes(domainOf(s.entity_id)) && /klingel|doorbell|ding/i.test(`${s.entity_id} ${s.attributes?.friendly_name ?? ""}`));
  return named?.entity_id ?? null;
}

/** Automation/Skript an der Kurzwahl: läuft gerade, zuletzt, aus, Link zum Ablauf (Trace). */
export function routineInfo(st, now = Date.now()) {
  if (!st) return null;
  const d = domainOf(st.entity_id);
  if (d !== "automation" && d !== "script") return null;
  const a = st.attributes ?? {};
  const running = d === "script" ? st.state === "on" : Number(a.current) > 0;
  const last = a.last_triggered ? Date.parse(a.last_triggered) : NaN;
  const off = d === "automation" && st.state === "off";
  const id = d === "automation" ? a.id : st.entity_id.slice(7);
  return {
    running,
    off,
    last: Number.isFinite(last) ? last : null,
    lastText: Number.isFinite(last) ? agoText(Math.max(0, now - last)) : "noch nie",
    trace: id ? `/config/${d}/trace/${encodeURIComponent(id)}` : null,
    edit: id ? `/config/${d}/edit/${encodeURIComponent(id)}` : null,
  };
}
