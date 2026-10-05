// Tagesverlauf der Energie-Karte (Mixin für Haus3DPanel): Daten aus Statistik bzw. Verlauf holen
// (5 min zwischengespeichert, nur bei aufgeklappter Karte und sichtbarer Seite), Mini-Kurven je Zeile,
// Dialog „Tagesverlauf“ mit Wischen, Gestern/Heute und Summen.

import { formatPower } from "./energy.js";
import { normalizeEnergy } from "./energymodel.js";
import { dayStart, downsample, integrateKWh, normalizeHistory, normalizeStats, sparkPath, valueAt, valueRange } from "./history.js";
import { esc, fmt } from "./panel-util.js";

const TTL = 5 * 60000;
const HOUR = 3600000;
// Reihen im Diagramm aus dem Energie-Modell: je Quelle, Haus, Netz
const COLORS = { pv: ["#ff9800", "#ffb300", "#f57c00"], bkw: ["#fbc02d", "#c0ca33", "#fdd835"], speicher: ["#1e88e5", "#3949ab", "#039be5"] };
export function chartSeries(cfg) {
  const e = normalizeEnergy(cfg);
  const out = [];
  const n = { pv: 0, bkw: 0, speicher: 0 };
  for (const s of e.sources) {
    const color = COLORS[s.type][n[s.type]++ % 3];
    if (s.power) out.push({ key: s.type === "speicher" ? "akku_leistung" : `src:${s.id}`, gen: s.type !== "speicher", name: s.name, color, unit: "W", id: s.power, invert: s.type === "speicher" && s.invert });
    if (s.soc) out.push({ key: "akku_ladestand", name: `${s.name} %`, color: "#00acc1", unit: "%", id: s.soc });
  }
  if (e.haus) out.push({ key: "verbrauch", name: "Hausverbrauch", color: "#8e24aa", unit: "W", id: e.haus });
  if (e.netz) out.push({ key: "netz", name: "Netz", color: "#e53935", unit: "W", id: e.netz, invert: e.netz_invert });
  if (e.netz_bezug) out.push({ key: "bezug", name: "Netzbezug", color: "#e53935", unit: "W", id: e.netz_bezug });
  if (e.netz_einspeisung) out.push({ key: "einspeisung", name: "Einspeisung", color: "#43a047", unit: "W", id: e.netz_einspeisung });
  return out;
}

export const EnergyMethods = {
  /** Zeitreihen holen: erst Statistik (5 min, Mittelwert), sonst Verlauf; 5 min zwischengespeichert. */
  async _fetchSeries(ids, start, end) {
    const out = new Map();
    if (!ids.length || !this._hass?.callWS) return out;
    const key = `${ids.join(",")}|${start}|${Math.floor(end / TTL)}`;
    this._seriesCache = this._seriesCache ?? new Map();
    const hit = this._seriesCache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    const range = { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() };
    try {
      const resp = await this._hass.callWS({ type: "recorder/statistics_during_period", ...range, statistic_ids: ids, period: "5minute", types: ["mean"] });
      for (const id of ids) {
        const pts = normalizeStats(resp, id, "mean");
        if (pts.length) out.set(id, pts);
      }
    } catch {
      // ohne Statistik weiter mit dem Verlauf
    }
    const missing = ids.filter((id) => !out.has(id));
    if (missing.length) {
      try {
        const resp = await this._hass.callWS({ type: "history/history_during_period", ...range, entity_ids: missing, minimal_response: true, no_attributes: true, significant_changes_only: false });
        for (const id of missing) {
          const pts = downsample(normalizeHistory(resp, id), 400);
          if (pts.length) out.set(id, pts);
        }
      } catch {
        // kein Verlauf: leere Kurven
      }
    }
    if (this._seriesCache.size > 20) this._seriesCache.clear();
    this._seriesCache.set(key, { at: Date.now(), data: out });
    return out;
  },

  /** Mini-Kurven der letzten 24 h in den Zeilen der Energie-Karte (nur aufgeklappt und sichtbar). */
  async _refreshSparks(force = false) {
    const el = this._energyEl;
    if (!el || el.classList.contains("collapsed") || el.hidden || document.hidden) return;
    if (!force && this._sparkAt && Date.now() - this._sparkAt < TTL) return;
    this._sparkAt = Date.now();
    const rows = this._energyRows ?? [];
    const ids = [...new Set(rows.filter((r) => r.key !== "ertrag_heute").map((r) => r.entity).filter(Boolean))];
    const end = Date.now();
    const data = await this._fetchSeries(ids, end - 24 * HOUR, end);
    if (el !== this._energyEl) return;
    for (const row of el.querySelectorAll(".row")) {
      const r = rows[Number(row.dataset.i)];
      const svg = row.querySelector(".spark");
      if (!svg || !r) continue;
      const pts = downsample(data.get(r.entity) ?? [], 60);
      svg.querySelector("path").setAttribute("d", pts.length > 1 ? sparkPath(pts, 60, 16, { t0: end - 24 * HOUR, t1: end, ...rangeOf(pts, r.key) }) : "");
      svg.hidden = pts.length < 2;
    }
  },

  /** Dialog „Tagesverlauf“: 0–24 Uhr, Wischen zeigt die Werte, Gestern/Heute, Summen. */
  async _energyChart(dayOffset = 0) {
    this._closePopup();
    this._closeDialog();
    const hass = this._hass;
    const cfg = this._building?.settings?.energy ?? {};
    const lang = hass.locale?.language;
    const tz = hass.config?.time_zone;
    const start = dayStart(Date.now(), tz, dayOffset);
    const end = Math.min(Date.now(), dayStart(start + 30 * HOUR, tz));
    const dayEnd = dayStart(start + 30 * HOUR, tz);
    const series = chartSeries(cfg);
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `<div class="dialog chart" role="dialog" aria-label="Tagesverlauf">
      <div class="dialog-head"><span>Tagesverlauf</span><span class="seg day"><button data-day="-1" class="${dayOffset === -1 ? "sel" : ""}">‹ Gestern</button><button data-day="0" class="${dayOffset === 0 ? "sel" : ""}">Heute</button></span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body"><p class="hint loading">Lade Verlauf …</p></div></div>`;
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => this._energyChart(Number(b.dataset.day))));
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    this._els.stage.appendChild(el);
    this._dialog = el;
    const data = await this._fetchSeries(series.map((s) => s.id), start, end);
    if (this._dialog !== el) return;
    const body = el.querySelector(".dialog-body");
    const shown = series.map((s) => ({ ...s, pts: downsample(data.get(s.id) ?? [], 300) })).filter((s) => s.pts.length > 1);
    if (!shown.length) {
      body.innerHTML = `<p class="hint">Keine Verlaufsdaten – die Sensoren brauchen eine Statistik (state_class) oder einen Verlauf im Recorder.</p>`;
      return;
    }
    const W = 640;
    const H = 220;
    const watt = shown.filter((s) => s.unit === "W");
    const [lo, hi] = valueRange(watt.flatMap((s) => s.pts), { zero: true });
    const x = (t) => ((t - start) / (dayEnd - start)) * W;
    const ticks = [0, 6, 12, 18, 24].map((h) => `<line x1="${(h / 24) * W}" y1="0" x2="${(h / 24) * W}" y2="${H}" class="grid"/><text x="${Math.min(W - 14, (h / 24) * W + 2)}" y="${H - 4}" class="tick">${String(h).padStart(2, "0")}</text>`).join("");
    const zeroY = H - ((0 - lo) / (hi - lo || 1)) * H;
    const paths = shown.map((s) => {
      const range = s.unit === "%" ? { lo: 0, hi: 100 } : { lo, hi };
      return `<path d="${sparkPath(s.pts, W, H, { t0: start, t1: dayEnd, ...range })}" stroke="${s.color}" class="${s.unit === "%" ? "pct" : ""}"/>`;
    }).join("");
    // Summen: Ertrag/Einspeisung/Verbrauch aus der Leistung; Netz getrennt nach Bezug/Einspeisung
    const sums = [];
    const kwh = (k) => integrateKWh(shown.find((s) => s.key === k)?.pts ?? []);
    const gens = shown.filter((s) => s.gen);
    for (const s of gens) sums.push(`${s.name} ${fmt(integrateKWh(s.pts), 1)} kWh`);
    if (gens.length > 1) sums.push(`Erzeugung gesamt ${fmt(gens.reduce((a, s) => a + integrateKWh(s.pts), 0), 1)} kWh`);
    for (const [k, label] of [["verbrauch", "Hausverbrauch"], ["bezug", "Netzbezug"], ["einspeisung", "Einspeisung"]]) if (shown.some((s) => s.key === k)) sums.push(`${label} ${fmt(kwh(k), 1)} kWh`);
    const grid = shown.find((s) => s.key === "netz");
    if (grid) {
      const sign = grid.invert ? -1 : 1;
      sums.push(`Bezug ${fmt(integrateKWh(grid.pts.map((p) => ({ t: p.t, v: Math.max(0, sign * p.v) }))), 1)} kWh`);
      sums.push(`Netz-Einspeisung ${fmt(integrateKWh(grid.pts.map((p) => ({ t: p.t, v: Math.max(0, -sign * p.v) }))), 1)} kWh`);
    }
    body.innerHTML = `<div class="clegend">${shown.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>
      <div class="chartbox"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chartsvg">${ticks}<line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" class="zero"/>${paths}<line class="cursor" x1="0" y1="0" x2="0" y2="${H}" style="display:none"/></svg><div class="readout" hidden></div></div>
      <p class="sums">${sums.map(esc).join(" · ")}</p>`;
    const svg = body.querySelector("svg");
    const cursor = svg.querySelector(".cursor");
    const readout = body.querySelector(".readout");
    const scrub = (ev) => {
      const r = svg.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const t = start + f * (dayEnd - start);
      cursor.setAttribute("x1", f * W);
      cursor.setAttribute("x2", f * W);
      cursor.style.display = "";
      const d = new Date(t);
      const clock = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined }).format(d);
      readout.hidden = false;
      readout.textContent = `${clock} · ${shown.map((s) => {
        const v = valueAt(s.pts, t);
        return `${s.name} ${v === null ? "–" : s.unit === "%" ? `${fmt(v, 0)} %` : formatPower(v, lang)}`;
      }).join(" · ")}`;
    };
    svg.addEventListener("pointerdown", (ev) => {
      svg.setPointerCapture?.(ev.pointerId);
      scrub(ev);
    });
    svg.addEventListener("pointermove", (ev) => (ev.buttons || ev.pointerType === "mouse") && scrub(ev));
    // Ende der Daten markieren (heute: jetzt)
    if (dayOffset === 0) svg.insertAdjacentHTML("beforeend", `<line x1="${x(end)}" y1="0" x2="${x(end)}" y2="${H}" class="now"/>`);
  },
};

/** Wertebereich einer Mini-Kurve: Ladestand 0–100 %, Leistung mit 0. */
function rangeOf(pts, key) {
  if (key === "akku_ladestand") return { lo: 0, hi: 100 };
  const [lo, hi] = valueRange(pts, { zero: key !== null && key !== undefined });
  return { lo, hi };
}
