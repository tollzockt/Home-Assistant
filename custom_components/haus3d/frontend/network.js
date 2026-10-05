// Netzwerkgeräte (ohne DOM, mit node testbar): device_tracker mit source_type „router“ – z. B. aus der
// UniFi-Network-Integration (Clients, Access Points, Switches, Gateways). Zusatzwerte kommen aus den
// Attributen und aus den übrigen Entitäten desselben Geräts (Laufzeit, Clients, CPU, Temperatur, Neustart).

const ONLINE = ["home", "connected", "on"];

/** Ist das ein Netzwerk-Tracker (Router/Controller statt GPS)? */
export function isNetworkTracker(st) {
  if (!st || !st.entity_id?.startsWith("device_tracker.")) return false;
  return st.attributes?.source_type === "router";
}

export const isOnline = (st) => !!st && ONLINE.includes(st.state);

const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** Art des Geräts nach Geräte-Infos bzw. Namen: ap, switch, gateway, client. */
export function networkRole(st, device = null) {
  const text = `${device?.model ?? ""} ${device?.name ?? ""} ${st?.attributes?.friendly_name ?? ""}`.toLowerCase();
  if (/\b(u6|uap|u7|nanohd|ac[- ]?(lite|pro|lr|mesh)|access ?point)\b|\bap\b/.test(text)) return "ap";
  if (/\b(usw|switch|us-\d+|flex mini)\b/.test(text)) return "switch";
  if (/\b(udm|uxg|usg|ucg|udr|gateway|dream ?machine|cloud gateway|router)\b/.test(text)) return "gateway";
  return "client";
}

export const ROLE_ICONS = { ap: "mdi:access-point-network", switch: "mdi:switch", gateway: "mdi:router-network", client: "mdi:lan-connect" };

/** Laufzeit in Sekunden oder Zeitpunkt (ISO) → „3 T 4 h“, „5 h 12 min“, „8 min“. */
export function formatUptime(v, now = Date.now()) {
  let s = num(v);
  if (s === null && typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) s = Math.max(0, (now - t) / 1000);
  }
  if (s === null) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} T ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Signal (dBm) → Stufe 0–4 und Text. */
export function signalLevel(dbm) {
  const v = num(dbm);
  if (v === null) return null;
  const level = v >= -55 ? 4 : v >= -65 ? 3 : v >= -72 ? 2 : v >= -80 ? 1 : 0;
  return { dbm: v, level, text: ["sehr schwach", "schwach", "mittel", "gut", "sehr gut"][level] };
}

// Entitäten desselben Geräts nach Endung bzw. translation_key
const SIBLINGS = [
  ["uptime", /(_uptime|_laufzeit)$/, "Laufzeit"],
  ["clients", /_clients$/, "Clients"],
  ["cpu", /_cpu_(utilization|auslastung)$/, "CPU"],
  ["memory", /_memory_(utilization|auslastung)$/, "Speicher"],
  ["temperature", /_temperature$/, "Temperatur"],
  ["state", /_state$/, "Status"],
  ["rx", /_rx$/, "Empfangen"],
  ["tx", /_tx$/, "Gesendet"],
];

/** Weitere Entitäten des Geräts: {key → entity_id} und Neustart-Taste. */
function siblings(entityId, hass) {
  const dev = hass.entities?.[entityId]?.device_id;
  const out = { values: {}, restart: null };
  if (!dev) return out;
  for (const [id, e] of Object.entries(hass.entities ?? {})) {
    if (id === entityId || e.device_id !== dev || !hass.states?.[id]) continue;
    if (id.startsWith("button.") && /restart|neustart/.test(`${id} ${e.translation_key ?? ""}`)) out.restart ??= id;
    if (!id.startsWith("sensor.")) continue;
    const tk = e.translation_key ?? "";
    for (const [key, re] of SIBLINGS) {
      if (out.values[key]) continue;
      if (re.test(id) || tk === `device_${key}` || tk === `client_${key}`) out.values[key] = id;
    }
  }
  return out;
}

/**
 * Alles für das Netzwerk-Fenster: Name, online, IP, MAC, WLAN, Signal, Access Point, Laufzeit, Werte.
 * @returns {object|null}
 */
export function networkInfo(entityId, hass, now = Date.now()) {
  const st = hass?.states?.[entityId];
  if (!st) return null;
  const a = st.attributes ?? {};
  const ent = hass.entities?.[entityId];
  const device = ent?.device_id ? hass.devices?.[ent.device_id] : null;
  const sib = siblings(entityId, hass);
  const val = (key) => {
    const id = sib.values[key];
    const s = id ? hass.states[id] : null;
    if (!s || ["unknown", "unavailable"].includes(s.state)) return null;
    return { id, state: s.state, unit: s.attributes?.unit_of_measurement ?? "", cls: s.attributes?.device_class ?? null };
  };
  const up = val("uptime");
  const uptime = formatUptime(up ? up.state : a.uptime ?? null, now);
  // Access Point des Clients: per MAC unter den Netzwerkgeräten suchen
  let ap = a.ap_name ?? null;
  if (!ap && a.ap_mac) {
    const mac = String(a.ap_mac).toLowerCase();
    const hit = Object.values(hass.states).find((s) => isNetworkTracker(s) && String(s.attributes?.mac ?? "").toLowerCase() === mac);
    ap = hit?.attributes?.friendly_name ?? a.ap_mac;
  }
  const wired = a.is_wired === true ? true : a.is_wired === false ? false : null;
  const role = networkRole(st, device);
  const extra = [];
  for (const [key, , label] of SIBLINGS) {
    if (key === "uptime") continue;
    const v = val(key);
    if (v) extra.push({ key, label, id: v.id, text: `${v.state}${v.unit ? ` ${v.unit}` : ""}` });
  }
  return {
    id: entityId,
    name: a.friendly_name ?? device?.name_by_user ?? device?.name ?? entityId,
    online: isOnline(st),
    role,
    icon: ROLE_ICONS[role],
    ip: a.ip ?? null,
    mac: a.mac ?? null,
    host: a.host_name ?? a.hostname ?? null,
    essid: a.essid ?? null,
    wired,
    signal: signalLevel(a.signal ?? a.rssi ?? null),
    ap,
    uptime,
    model: device?.model ?? null,
    manufacturer: device?.manufacturer ?? null,
    extra,
    restart: sib.restart,
    unifi: ent?.platform === "unifi",
  };
}

/** Alle Netzwerkgeräte, Infrastruktur zuerst, dann nach Name; offline am Ende jeder Gruppe. */
export function networkDevices(hass) {
  const order = { gateway: 0, switch: 1, ap: 2, client: 3 };
  return Object.values(hass?.states ?? {})
    .filter(isNetworkTracker)
    .filter((st) => !hass.entities?.[st.entity_id]?.hidden)
    .map((st) => networkInfo(st.entity_id, hass))
    .sort((x, y) => order[x.role] - order[y.role] || Number(y.online) - Number(x.online) || x.name.localeCompare(y.name, "de"));
}
