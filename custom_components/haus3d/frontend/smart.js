// Alltag (ohne DOM, mit node testbar): Waschmaschine & Co. erkennen (Lauf/fertig aus der Leistung),
// Termine und Müllabfuhr aus Kalendern bzw. Abfall-Sensoren, Strompreis (fest oder dynamisch, günstigste
// Stunden), Schimmel-Risiko je Raum und Lüften-Timer.

import { dewPoint } from "./devices.js";

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};
const OFF = ["unavailable", "unknown", "", undefined, null];

// ------------------------------------------------------------------ Haushaltsgeräte

/** Arten: [Schlüssel, Name, Symbol, Muster im Namen, Minuten unter „aus“ bis fertig]. */
export const APPLIANCE_KINDS = [
  ["washer", "Waschmaschine", "mdi:washing-machine", /wasch(?!b)|washer|washing/i, 3],
  ["dryer", "Trockner", "mdi:tumble-dryer", /trockn|dryer/i, 3],
  ["dishwasher", "Spülmaschine", "mdi:dishwasher", /spül|spuel|geschirr|dishwasher/i, 15],
  ["other", "Gerät", "mdi:power-plug-outline", null, 3],
];
export const APPLIANCE_START_W = 10; // darüber läuft es
export const APPLIANCE_IDLE_W = 4; // darunter ruht es

export const applianceKind = (key) => APPLIANCE_KINDS.find((k) => k[0] === key) ?? APPLIANCE_KINDS.at(-1);

/** Leistung in W (kW wird umgerechnet); null ohne Wert. */
export function watts(st) {
  if (!st || OFF.includes(st.state)) return null;
  const v = num(st.state);
  if (v === null) return null;
  return String(st.attributes?.unit_of_measurement ?? "W").toLowerCase() === "kw" ? v * 1000 : v;
}

/**
 * Vorschläge: Leistungssensoren, deren Name nach Waschmaschine, Trockner oder Spülmaschine klingt.
 * @returns {{power: string, name: string, kind: string}[]}
 */
export function guessAppliances(hass, taken = []) {
  const out = [];
  for (const [id, st] of Object.entries(hass?.states ?? {})) {
    if (!id.startsWith("sensor.") || taken.includes(id)) continue;
    const unit = String(st.attributes?.unit_of_measurement ?? "");
    if (st.attributes?.device_class !== "power" && !/^k?W$/.test(unit)) continue;
    const text = `${id} ${st.attributes?.friendly_name ?? ""}`;
    const kind = APPLIANCE_KINDS.find((k) => k[3]?.test(text));
    if (kind) out.push({ power: id, name: kind[1], kind: kind[0] });
  }
  return out;
}

/**
 * Ein Schritt der Erkennung. Zustand {phase: idle|running|done, startedAt, lowSince, doneAt}.
 * Läuft ab START_W; fertig, wenn es min. 5 min lief und dann `finish` Minuten unter IDLE_W blieb.
 * „fertig“ bleibt stehen, bis quittiert (ack) oder 3 h vergangen sind.
 */
export function applianceStep(prev, w, now, kind = "washer") {
  const st = { phase: "idle", startedAt: null, lowSince: null, doneAt: null, ...(prev ?? {}) };
  if (w === null) return st;
  const finishMin = applianceKind(kind)[4];
  if (st.phase !== "running") {
    if (w > APPLIANCE_START_W) return { phase: "running", startedAt: now, lowSince: null, doneAt: null };
    if (st.phase === "done" && now - st.doneAt > 3 * 3600000) return { phase: "idle", startedAt: null, lowSince: null, doneAt: null };
    return st;
  }
  if (w >= APPLIANCE_IDLE_W) return { ...st, lowSince: null };
  const lowSince = st.lowSince ?? now;
  if (now - lowSince >= finishMin * 60000) {
    if (now - st.startedAt - (now - lowSince) >= 5 * 60000) return { phase: "done", startedAt: st.startedAt, lowSince: null, doneAt: now };
    return { phase: "idle", startedAt: null, lowSince: null, doneAt: null }; // nur kurz an (Standby-Spitze)
  }
  return { ...st, lowSince };
}

/** Restzeit in Minuten aus einem Sensor (Minuten, „hh:mm:ss“ oder Zeitpunkt des Endes); null ohne Wert. */
export function remainingMinutes(st, now = Date.now()) {
  if (!st || OFF.includes(st.state)) return null;
  const s = String(st.state);
  if (st.attributes?.device_class === "timestamp" || /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? Math.max(0, Math.round((t - now) / 60000)) : null;
  }
  const hms = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + (hms[3] ? Math.round(Number(hms[3]) / 60) : 0);
  const v = num(s);
  if (v === null) return null;
  const unit = String(st.attributes?.unit_of_measurement ?? "min").toLowerCase();
  return Math.round(unit === "h" ? v * 60 : unit === "s" ? v / 60 : v);
}

/** „1:05 h“ / „25 min“. */
export const fmtMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")} h` : `${Math.round(m)} min`);

// ------------------------------------------------------------------ Termine und Müllabfuhr

const WASTE = /tonne|müll|muell|abfall|sack|papier|altpapier|bio|rest|wertstoff|glas|gelb|recycl|waste|garbage|bin\b/i;
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayDiff = (t, now) => Math.round((startOfDay(t) - startOfDay(now)) / 86400000);

/** Datum aus Kalender-/Sensor-Text: „2026-10-08“, „2026-10-08 06:00:00“, ISO. */
function parseWhen(v) {
  if (!v) return null;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00`) : Date.parse(s.replace(" ", "T"));
  return Number.isFinite(d) ? d : null;
}

/**
 * Nächste Termine aus Kalendern (calendar.*: message, start_time, all_day) und Abfall-Sensoren
 * (waste_collection_schedule u. ä.: daysTo/days, Datum als Zustand oder „in 2 Tagen“).
 * @returns {{entity: string, title: string, start: number, days: number, allDay: boolean, waste: boolean}[]}
 */
export function upcomingEvents(hass, ids, now = Date.now(), horizonDays = 7) {
  const out = [];
  for (const id of ids ?? []) {
    const st = hass?.states?.[id];
    if (!st || OFF.includes(st.state)) continue;
    const a = st.attributes ?? {};
    const label = a.friendly_name ?? id;
    let start = null;
    let title = label;
    let allDay = true;
    if (id.startsWith("calendar.")) {
      start = parseWhen(a.start_time);
      title = a.message || label;
      allDay = !!a.all_day;
    } else {
      const days = num(a.daysTo ?? a.days_to ?? a.days ?? a.daysUntil);
      if (days !== null) start = startOfDay(now) + days * 86400000;
      else start = parseWhen(st.state) ?? parseWhen(a.next_date ?? a.date);
      if (start === null) {
        const m = /(heute|morgen|übermorgen|today|tomorrow)|in (\d+) tag/i.exec(st.state);
        if (m) start = startOfDay(now) + 86400000 * (m[2] ? Number(m[2]) : /über/i.test(m[1]) ? 2 : /morgen|tomorrow/i.test(m[1]) ? 1 : 0);
      }
      const types = a.types ?? a.type ?? a.waste_type;
      if (types) title = Array.isArray(types) ? types.join(", ") : String(types);
    }
    if (start === null) continue;
    const days = dayDiff(start, now);
    if (days < 0 || days > horizonDays) continue;
    out.push({ entity: id, title, start, days, allDay, waste: !id.startsWith("calendar.") || WASTE.test(`${title} ${label}`) });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** „heute“, „morgen“, „Do“ (bis 7 Tage). */
export function dayLabel(days, start) {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days === 2) return "übermorgen";
  return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(start).getDay()];
}

/**
 * Müll-Erinnerung: abends (ab `eveningHour`) für morgen, morgens bis 10 Uhr für heute.
 * @returns {{entity: string, title: string, when: "heute"|"morgen", key: string}[]}
 */
export function wasteReminders(events, now = Date.now(), eveningHour = 16) {
  const h = new Date(now).getHours();
  return events
    .filter((e) => e.waste && ((e.days === 1 && h >= eveningHour) || (e.days === 0 && h < 10)))
    .map((e) => ({ entity: e.entity, title: e.title, when: e.days === 0 ? "heute" : "morgen", key: `waste:${e.entity}:${startOfDay(e.start)}` }));
}

// ------------------------------------------------------------------ Strompreis

/** Preis in €/kWh aus Zustand und Einheit (ct/kWh, €/MWh, EUR/kWh). */
export function priceOf(value, unit = "EUR/kWh") {
  const v = num(value);
  if (v === null) return null;
  const u = String(unit ?? "").toLowerCase().replace(/\s/g, "");
  if (/mwh/.test(u)) return v / 1000;
  if (/^(ct|cent|c)\b|ct\/|cent\//.test(u)) return v / 100;
  return v;
}

/**
 * Stundenpreise aus den Attributen gängiger Integrationen (Nordpool raw_today/raw_tomorrow, Tibber/
 * EPEX/aWATTar today/tomorrow/data/prices/forecast) als [{start, end, price}] in €/kWh.
 */
export function priceSeries(st) {
  if (!st) return [];
  const a = st.attributes ?? {};
  const unit = a.unit_of_measurement ?? "EUR/kWh";
  const out = [];
  for (const key of ["raw_today", "raw_tomorrow", "today", "tomorrow", "data", "prices", "forecast", "prices_today", "prices_tomorrow"]) {
    const list = a[key];
    if (!Array.isArray(list)) continue;
    list.forEach((it, i) => {
      if (typeof it === "number") {
        // Nordpool: 24 Zahlen je Tag
        const base = startOfDay(Date.now()) + (key.includes("tomorrow") ? 86400000 : 0);
        out.push({ start: base + i * 3600000, end: base + (i + 1) * 3600000, price: priceOf(it, unit) });
        return;
      }
      if (!it || typeof it !== "object") return;
      const start = parseWhen(it.start ?? it.start_time ?? it.startsAt ?? it.from ?? it.time);
      if (start === null) return;
      const end = parseWhen(it.end ?? it.end_time ?? it.endsAt ?? it.till) ?? start + 3600000;
      const raw = it.value ?? it.price ?? it.total ?? it.price_per_kwh ?? it.marketprice ?? it.price_eur_per_mwh;
      const u = it.price_eur_per_mwh !== undefined ? "EUR/MWh" : it.marketprice !== undefined ? it.unit ?? "EUR/MWh" : unit;
      const price = priceOf(raw, u);
      if (price !== null) out.push({ start, end, price });
    });
  }
  const seen = new Set();
  return out.filter((p) => !seen.has(p.start) && seen.add(p.start)).sort((x, y) => x.start - y.start);
}

/** Günstigstes Zeitfenster über `hours` Stunden ab jetzt (nur zusammenhängende Stunden). */
export function cheapestWindow(series, hours = 3, now = Date.now()) {
  const future = series.filter((p) => p.end > now);
  let best = null;
  for (let i = 0; i + hours <= future.length; i++) {
    const slice = future.slice(i, i + hours);
    if (slice.some((p, k) => k && Math.abs(p.start - slice[k - 1].end) > 60000)) continue;
    const avg = slice.reduce((s, p) => s + p.price, 0) / hours;
    if (!best || avg < best.avg - 1e-9) best = { start: slice[0].start, end: slice.at(-1).end, avg };
  }
  return best;
}

/** Aktueller Preis: fester Preis aus den Einstellungen oder Preis-Sensor. */
export function currentPrice(cfg, hass) {
  if (cfg?.price_entity) {
    const st = hass?.states?.[cfg.price_entity];
    return st && !OFF.includes(st.state) ? priceOf(st.state, st.attributes?.unit_of_measurement) : null;
  }
  const fixed = num(cfg?.price);
  return fixed !== null && fixed > 0 ? (fixed > 5 ? fixed / 100 : fixed) : null; // > 5: in ct angegeben
}

/** Kosten pro Stunde in € bei w Watt. */
export const costPerHour = (w, price) => (w === null || price === null ? null : (Math.max(0, w) / 1000) * price);

/** „12 ct/h“ bzw. „1,20 €/h“. */
export function fmtCost(eur, suffix = "/h") {
  if (eur === null || !Number.isFinite(eur)) return "–";
  return eur < 1 ? `${(eur * 100).toLocaleString("de-DE", { maximumFractionDigits: eur < 0.1 ? 1 : 0 })} ct${suffix}` : `${eur.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €${suffix}`;
}

// ------------------------------------------------------------------ Schimmel und Lüften

/**
 * Schimmel-Risiko: relative Feuchte an der kältesten Wandstelle. Die Wand ist um einen Teil des
 * Unterschieds zur Außentemperatur kälter als die Raumluft (ohne Außenwert 3 K).
 * @returns {{level: "ok"|"mittel"|"hoch", wallRh: number, wallT: number}|null}
 */
export function moldRisk(t, rh, outside = null) {
  if (t === null || rh === null || t === undefined || rh === undefined) return null;
  const dp = dewPoint(t, rh);
  if (dp === null) return null;
  const wallT = outside === null || outside === undefined ? t - 3 : t - Math.max(1, 0.25 * (t - outside));
  const sat = (x) => 6.112 * Math.exp((17.62 * x) / (243.12 + x));
  const wallRh = Math.min(100, (100 * sat(dp)) / sat(wallT));
  return { level: wallRh >= 80 ? "hoch" : wallRh >= 70 ? "mittel" : "ok", wallRh: Math.round(wallRh), wallT: Math.round(wallT * 10) / 10 };
}

/** Lüften-Timer (pro Gerät gemerkt): {"floor:room": Ende in ms}. Abgelaufene liefern `due`. */
export function ventTimers(timers, now = Date.now()) {
  const running = [];
  const due = [];
  for (const [key, end] of Object.entries(timers ?? {})) {
    if (!Number.isFinite(end)) continue;
    (end <= now ? due : running).push({ key, end, left: Math.max(0, Math.ceil((end - now) / 60000)) });
  }
  return { running, due };
}
