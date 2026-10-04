// Tagesverlauf (ohne DOM, mit node testbar): Statistik und Verlauf aus Home Assistant in Punktlisten,
// ausdünnen, Mini-Kurven, kWh aus Leistung, Tagesbeginn in der Zeitzone von Home Assistant.

const toMs = (t) => {
  if (typeof t === "number") return t < 1e11 ? t * 1000 : t; // Sekunden oder ms
  const v = Date.parse(t);
  return Number.isFinite(v) ? v : NaN;
};

/**
 * recorder/statistics_during_period → [{t, v}] (t in ms). field: mean, state, sum, change …
 * @returns {{t: number, v: number}[]}
 */
export function normalizeStats(resp, id, field = "mean") {
  const rows = Array.isArray(resp?.[id]) ? resp[id] : [];
  const out = [];
  for (const r of rows) {
    const t = toMs(r?.start);
    const v = Number(r?.[field]);
    if (Number.isFinite(t) && r?.[field] !== null && Number.isFinite(v)) out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * history/history_during_period (kompakt: {s, lu, lc?} bzw. ausführlich: {state, last_updated}) →
 * [{t, v}], nur Zahlen.
 */
export function normalizeHistory(resp, id) {
  const rows = Array.isArray(resp?.[id]) ? resp[id] : [];
  const out = [];
  for (const r of rows) {
    const s = r?.s ?? r?.state;
    const t = toMs(r?.lu ?? r?.lc ?? r?.last_updated ?? r?.last_changed);
    const v = Number(s);
    if (s === null || s === "" || !Number.isFinite(v) || !Number.isFinite(t)) continue;
    out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Höchstens max Punkte: je Abschnitt Minimum und Maximum (Spitzen bleiben sichtbar). */
export function downsample(points, max = 300) {
  if (!Array.isArray(points) || points.length <= max) return points ?? [];
  const buckets = Math.max(1, Math.floor(max / 2));
  const size = points.length / buckets;
  const out = [];
  for (let b = 0; b < buckets; b++) {
    const part = points.slice(Math.floor(b * size), Math.floor((b + 1) * size));
    if (!part.length) continue;
    let lo = part[0];
    let hi = part[0];
    for (const p of part) {
      if (p.v < lo.v) lo = p;
      if (p.v > hi.v) hi = p;
    }
    if (lo === hi) out.push(lo);
    else out.push(...(lo.t <= hi.t ? [lo, hi] : [hi, lo]));
  }
  return out;
}

/** Wertebereich (mit Rand, 0 einbezogen wenn gewünscht). */
export function valueRange(points, { zero = false } = {}) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.v < lo) lo = p.v;
    if (p.v > hi) hi = p.v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (zero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  return [lo, hi];
}

/**
 * SVG-Pfad einer Kurve in w × h. t0/t1: Zeitfenster (sonst erster/letzter Punkt), lo/hi: Wertebereich.
 */
export function sparkPath(points, w, h, { t0, t1, lo, hi } = {}) {
  if (!points?.length) return "";
  const a = t0 ?? points[0].t;
  const b = t1 ?? points[points.length - 1].t;
  const [vlo, vhi] = lo !== undefined && hi !== undefined ? [lo, hi] : valueRange(points);
  const x = (t) => (b > a ? ((t - a) / (b - a)) * w : 0);
  const y = (v) => h - ((v - vlo) / (vhi - vlo || 1)) * h;
  const r = (n) => Math.round(n * 10) / 10;
  return points.map((p, i) => `${i ? "L" : "M"}${r(x(p.t))} ${r(y(p.v))}`).join(" ");
}

/** Energie in kWh aus Leistungswerten in W (Trapezregel, Lücken über maxGapMs zählen nicht). */
export function integrateKWh(points, maxGapMs = 3 * 3600000) {
  let wh = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt <= 0 || dt > maxGapMs) continue;
    wh += ((points[i].v + points[i - 1].v) / 2) * (dt / 3600000);
  }
  return wh / 1000;
}

/** Abstand der Zeitzone zu UTC (ms) zum Zeitpunkt t. */
function tzOffset(t, timeZone) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  } catch {
    return -new Date(t).getTimezoneOffset() * 60000;
  }
}

/**
 * Mitternacht des Tages von t in der Zeitzone (hass.config.time_zone), dayOffset −1 = gestern.
 * Auch über die Zeitumstellung richtig.
 */
export function dayStart(t, timeZone, dayOffset = 0) {
  const ms = t instanceof Date ? t.getTime() : Number(t);
  const local = new Date(ms + tzOffset(ms, timeZone));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset);
  let start = guess - tzOffset(guess, timeZone);
  start = guess - tzOffset(start, timeZone);
  return start;
}

/** Wert zur Zeit t (letzter Punkt davor), für das Wischen im Diagramm. */
export function valueAt(points, t) {
  let best = null;
  for (const p of points) {
    if (p.t > t) break;
    best = p;
  }
  return best ? best.v : null;
}
