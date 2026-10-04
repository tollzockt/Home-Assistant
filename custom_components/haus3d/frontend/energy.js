// Energie-Karte 2.0 (ohne DOM, mit node testbar): Vorschläge aus den HA-Energie-Einstellungen, Akku-Richtung
// und Restzeit, Netz Bezug/Einspeisung, Überschuss-Ampel, Leistung als W/kW.

const OFFLINE = ["unavailable", "unknown", ""];

/** Watt aus einem Zustand (W, kW, MW), sonst null. */
function watts(st) {
  if (!st || OFFLINE.includes(st.state)) return null;
  const v = Number(st.state);
  if (!Number.isFinite(v)) return null;
  const unit = String(st.attributes?.unit_of_measurement ?? "W");
  return unit === "kW" ? v * 1000 : unit === "MW" ? v * 1e6 : v;
}

/**
 * Geschwister-Sensor auf demselben Gerät (z. B. Leistung neben dem Zähler, Ladestand neben dem Akku).
 * @param {"power"|"battery"} cls device_class des gesuchten Sensors
 */
export function siblingOnDevice(id, hass, cls) {
  const dev = hass?.entities?.[id]?.device_id;
  if (!dev) return null;
  const hits = Object.values(hass.entities)
    .filter((e) => e?.device_id === dev && e.entity_id !== id && e.entity_id.startsWith("sensor.") && hass.states?.[e.entity_id]?.attributes?.device_class === cls)
    .map((e) => e.entity_id)
    .sort();
  return hits[0] ?? null;
}

/**
 * Vorschläge für settings.energy aus energy/get_prefs. Liest alte (flow_from/flow_to) und neuere Formen
 * (Zähler direkt am Eintrag, stat_rate/power) defensiv; nur Entitäten, die es gibt.
 * @returns {{[key: string]: {entity: string, label: string}}} z. B. {netz: {entity, label}}
 */
export function suggestEnergy(prefs, hass) {
  const out = {};
  const sources = Array.isArray(prefs?.energy_sources) ? prefs.energy_sources : [];
  const has = (id) => typeof id === "string" && id.includes(".") && !!hass?.states?.[id];
  const put = (key, id, label) => {
    if (!out[key] && has(id)) out[key] = { entity: id, label };
  };
  const rate = (src) => src?.stat_rate ?? src?.power_config?.stat_rate ?? src?.power?.[0]?.stat_rate ?? null;
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    if (src.type === "grid") {
      const from = [src.stat_energy_from, ...(Array.isArray(src.flow_from) ? src.flow_from.map((f) => f?.stat_energy_from) : [])].filter(Boolean);
      const to = [src.stat_energy_to, ...(Array.isArray(src.flow_to) ? src.flow_to.map((f) => f?.stat_energy_to) : [])].filter(Boolean);
      put("netz", rate(src), "Netz – Leistung");
      for (const id of [...from, ...to]) put("netz", siblingOnDevice(id, hass, "power"), "Netz – Leistung (Gerät des Zählers)");
      put("bezug_zaehler", from[0], "Netz – Bezug (Zähler)");
      put("einspeise_zaehler", to[0], "Netz – Einspeisung (Zähler)");
    } else if (src.type === "solar") {
      put("haus_pv", rate(src), "Solar – Leistung");
      put("haus_pv", siblingOnDevice(src.stat_energy_from, hass, "power"), "Solar – Leistung (Gerät des Zählers)");
      put("pv_zaehler", src.stat_energy_from, "Solar – Ertrag (Zähler)");
    } else if (src.type === "battery") {
      put("akku_leistung", rate(src), "Akku – Leistung");
      for (const id of [src.stat_energy_from, src.stat_energy_to]) {
        put("akku_leistung", siblingOnDevice(id, hass, "power"), "Akku – Leistung (Gerät des Akkus)");
        put("akku_ladestand", siblingOnDevice(id, hass, "battery"), "Akku – Ladestand");
      }
    }
  }
  return out;
}

/**
 * Akku: Richtung (±idleW ruht), Leistung, Minuten bis voll bzw. bis zur Reserve.
 * Vorzeichen: positiv = lädt (invert dreht es um).
 * @returns {{dir: "charge"|"discharge"|"idle"|null, w: number|null, etaMin: number|null, level: "low"|"mid"|"ok"|null, icon: string}}
 */
export function batteryState(soc, powerW, { invert = false, capacityKWh = null, reservePct = 10, idleW = 10 } = {}) {
  const s = Number.isFinite(soc) ? Math.min(100, Math.max(0, soc)) : null;
  const p = Number.isFinite(powerW) ? (invert ? -powerW : powerW) : null;
  const dir = p === null ? null : Math.abs(p) <= idleW ? "idle" : p > 0 ? "charge" : "discharge";
  const level = s === null ? null : s < 20 ? "low" : s < 50 ? "mid" : "ok";
  let etaMin = null;
  const cap = Number(capacityKWh);
  if (s !== null && cap > 0 && (dir === "charge" || dir === "discharge")) {
    const reserve = Math.min(100, Math.max(0, Number(reservePct) || 0));
    const pct = dir === "charge" ? 100 - s : s - reserve;
    etaMin = pct <= 0 ? 0 : Math.round(((pct / 100) * cap * 1000 * 60) / Math.abs(p));
  }
  const step = s === null ? null : Math.round(s / 10) * 10;
  const icon = dir === "charge" ? "mdi:battery-arrow-up-outline" : dir === "discharge" ? "mdi:battery-arrow-down-outline" : step === null ? "mdi:battery" : step >= 100 ? "mdi:battery" : step <= 0 ? "mdi:battery-outline" : `mdi:battery-${step}`;
  return { dir, w: p === null ? null : Math.abs(p), etaMin, level, icon };
}

/** Netz: positiv = Bezug (invert dreht es um), ±idleW ruht. */
export function gridState(powerW, invert = false, idleW = 5) {
  if (!Number.isFinite(powerW)) return { dir: null, w: null };
  const p = invert ? -powerW : powerW;
  return { dir: Math.abs(p) <= idleW ? "idle" : p > 0 ? "import" : "export", w: Math.abs(p) };
}

export const SURPLUS_DEFAULTS = { hoch: 600, mittel: 150 };

/**
 * Überschuss-Ampel: Einspeisung ins Netz (wenn ein Netz-Sensor da ist), sonst die Einspeisung des
 * Balkonkraftwerks als Näherung. 50 W Hysterese gegen Flackern.
 * @param {{netz?: number|null, netzInvert?: boolean, einspeisung?: number|null}} v
 * @returns {{level: "hoch"|"mittel"|"niedrig"|null, w: number|null, proxy: boolean}}
 */
export function surplus(v, cfg = {}, prev = null, hyst = 50) {
  const hoch = Number(cfg?.hoch) > 0 ? Number(cfg.hoch) : SURPLUS_DEFAULTS.hoch;
  const mittel = Number(cfg?.mittel) > 0 ? Math.min(Number(cfg.mittel), hoch) : SURPLUS_DEFAULTS.mittel;
  let w = null;
  let proxy = false;
  if (Number.isFinite(v?.netz)) {
    const g = gridState(v.netz, v.netzInvert);
    w = g.dir === "export" ? g.w : 0;
  } else if (Number.isFinite(v?.einspeisung)) {
    w = Math.max(0, v.einspeisung);
    proxy = true;
  }
  if (w === null) return { level: null, w: null, proxy };
  const up = (lvl, t) => w >= (prev === lvl || (prev === "hoch" && lvl === "mittel") ? t - hyst : t);
  const level = up("hoch", hoch) ? "hoch" : up("mittel", mittel) ? "mittel" : "niedrig";
  return { level, w, proxy };
}

/** Leistung lesbar: unter 1000 W in W, darüber in kW mit einer Stelle (deutsches Komma). */
export function formatPower(w, lang = "de-DE") {
  if (!Number.isFinite(w)) return "–";
  const fmt = (v, d) => {
    try {
      return v.toLocaleString(lang || "de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
    } catch {
      return v.toFixed(d);
    }
  };
  return Math.abs(w) >= 1000 ? `${fmt(w / 1000, 1)} kW` : `${fmt(Math.round(w), 0)} W`;
}

/** Gleitender Mittelwert (gegen springende Restzeiten). */
export function ema(prev, x, alpha = 0.25) {
  if (!Number.isFinite(x)) return prev ?? null;
  return Number.isFinite(prev) ? prev + alpha * (x - prev) : x;
}

/** Uhrzeit „HH:MM“ in etaMin Minuten, auf 10 Minuten gerundet. */
export function etaClock(etaMin, now = Date.now()) {
  if (!Number.isFinite(etaMin)) return null;
  const t = new Date(Math.round((now + etaMin * 60000) / 600000) * 600000);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/** Text der Akku-Zeile, z. B. „lädt 320 W · voll ca. 13:40“. */
export function batteryText(b, now = Date.now(), lang) {
  if (!b?.dir) return "–";
  if (b.dir === "idle") return "ruht";
  const head = `${b.dir === "charge" ? "lädt" : "entlädt"} ${formatPower(b.w, lang)}`;
  if (!Number.isFinite(b.etaMin)) return head;
  if (b.etaMin === 0) return `${head} · ${b.dir === "charge" ? "voll" : "Reserve erreicht"}`;
  if (b.etaMin > 48 * 60) return head;
  return `${head} · ${b.dir === "charge" ? "voll" : "reicht bis"} ca. ${etaClock(b.etaMin, now)}`;
}

/** Text der Netz-Zeile: „Bezug 450 W“ / „Einspeisung 1,2 kW“ / „ruht“. */
export function gridText(g, lang) {
  if (!g?.dir) return "–";
  return g.dir === "idle" ? "ruht" : `${g.dir === "import" ? "Bezug" : "Einspeisung"} ${formatPower(g.w, lang)}`;
}

/**
 * Anteil der Sonne, der auf eine geneigte Fläche fällt (Kosinus des Einfallswinkels, 0 wenn die Sonne
 * hinter der Fläche oder unter dem Horizont steht). azimuth null = flach.
 */
export function poaFactor(sun, azimuth, tiltDeg) {
  if (!sun || !Number.isFinite(sun.elevation) || sun.elevation <= 0) return 0;
  const R = Math.PI / 180;
  const t = (Number(tiltDeg) || 0) * R;
  const a = (Number(azimuth) || 0) * R;
  const el = sun.elevation * R;
  const az = sun.azimuth * R;
  const n = [Math.sin(t) * Math.sin(a), Math.sin(t) * Math.cos(a), Math.cos(t)];
  const s = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
  return Math.max(0, n[0] * s[0] + n[1] * s[1] + n[2] * s[2]);
}

/**
 * Leistung je PV-Feld: eigener Sensor gilt; der Rest der Gesamtleistung (haus_pv) wird nach kWp ×
 * Sonneneinfall verteilt und als geschätzt markiert (ohne Sonnenstand nur nach kWp).
 * @param {{id: string, kwp: number, azimuth: number|null, tilt: number, w?: number|null}[]} fields
 * @returns {Map<string, {w: number|null, estimated: boolean}>}
 */
export function fieldPower(fields, totalW, sun = null) {
  const out = new Map();
  const own = fields.filter((f) => Number.isFinite(f.w));
  for (const f of own) out.set(f.id, { w: f.w, estimated: false });
  const rest = fields.filter((f) => !Number.isFinite(f.w));
  if (!rest.length) return out;
  if (!Number.isFinite(totalW)) {
    for (const f of rest) out.set(f.id, { w: null, estimated: true });
    return out;
  }
  const left = Math.max(0, totalW - own.reduce((s, f) => s + f.w, 0));
  let weights = rest.map((f) => (Number(f.kwp) || 0) * (sun ? poaFactor(sun, f.azimuth, f.tilt) : 1));
  if (!weights.some((x) => x > 0)) weights = rest.map((f) => Number(f.kwp) || 0);
  const sum = weights.reduce((s, x) => s + x, 0);
  rest.forEach((f, i) => out.set(f.id, { w: sum > 0 ? (left * weights[i]) / sum : 0, estimated: true }));
  return out;
}

/** Auswahl „Eingeklappt zeigen“. */
export const SHORT_CHOICES = [["", "erster Wert"], ["akku", "Akku"], ["solar", "Solar"], ["netz", "Netz"], ["verbrauch", "Verbrauch"], ["ueberschuss", "Überschuss"]];
