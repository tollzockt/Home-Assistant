// Zeitstrahl (Mixin für Haus3DPanel): Regler unten – links der heutige Tag aus dem HA-Verlauf (welche Lichter,
// Fenster, Türen, wer wo), rechts die nächsten 24 h aus der Wettervorhersage (Wetter, Sonne, erwartete
// PV-Leistung). Im Zeitstrahl wird nur angesehen, nichts geschaltet.

import { weatherEntity } from "./exterior.js";
import { fmtPower } from "./panel-util.js";
import { TIMELINE_DOMAINS, cloudOf, forecastAt, historyStates, normalizeHistory, pvEstimate, sunState, timeLabel, timelineRange } from "./timeline.js";

export const TimelineMethods = {
  /** Zeitstrahl öffnen: Verlauf seit Mitternacht und Vorhersage laden. */
  async _timelineOpen() {
    if (this._sim) return this._toast("In der Simulation gibt es keinen Zeitstrahl.");
    if (this._tl) return this._timelineClose();
    const now = Date.now();
    const range = timelineRange(now);
    const hass = this._realHass ?? this._hass;
    const wid = weatherEntity(hass, this._building?.settings);
    this._tl = { ...range, t: now, history: {}, forecast: [], wid, loading: true };
    this._renderTimeline();
    const ids = [...new Set([...this._watched, ...(wid ? [wid] : [])])].filter((id) => TIMELINE_DOMAINS.includes(id.split(".")[0]));
    const [hist, fc] = await Promise.all([
      ids.length ? hass.callWS({ type: "history/history_during_period", start_time: new Date(range.from).toISOString(), end_time: new Date(now).toISOString(), entity_ids: ids, include_start_time_state: true, significant_changes_only: false, minimal_response: false, no_attributes: false }).catch(() => ({})) : {},
      wid ? hass.callWS({ type: "call_service", domain: "weather", service: "get_forecasts", service_data: { type: "hourly" }, target: { entity_id: wid }, return_response: true }).catch(() => null) : null,
    ]);
    if (!this._tl) return;
    this._tl.history = normalizeHistory(hist);
    this._tl.forecast = fc?.response?.[wid]?.forecast ?? [];
    this._tl.loading = false;
    this._renderTimeline();
  },

  _timelineClose() {
    clearInterval(this._tlPlay);
    this._tlPlay = null;
    this._tl = null;
    this._tlBar?.remove();
    this._tlBar = null;
    this._els?.stage.classList.remove("has-tlbar");
    if (this._realHass) this.hass = this._realHass;
    this._renderWheels?.();
  },

  /** hass zum Zeitpunkt des Reglers (Verlauf bzw. Vorhersage); Dienste gesperrt. */
  _tlWrap(real) {
    const tl = this._tl;
    const c = this._tlCache;
    if (c && c.real === real.states && c.t === tl.t && c.loaded === tl.loading) return c.hass;
    const lat = Number(real.config?.latitude ?? 51);
    const lon = Number(real.config?.longitude ?? 10);
    const loc = { lat: Number.isFinite(lat) ? lat : 51, lon: Number.isFinite(lon) ? lon : 10 };
    const now = Date.now();
    let states;
    if (tl.t < now - 60000) states = historyStates(real, tl.history, tl.t, loc);
    else {
      states = { ...real.states, "sun.sun": sunState(real.states["sun.sun"], tl.t, loc) };
      const f = forecastAt(tl.forecast, tl.t);
      if (f && tl.wid && real.states[tl.wid]) states[tl.wid] = { ...real.states[tl.wid], state: f.condition ?? real.states[tl.wid].state, attributes: { ...real.states[tl.wid].attributes, temperature: f.temperature ?? real.states[tl.wid].attributes.temperature } };
    }
    const hass = {
      ...real,
      states,
      haus3dTimeline: tl.t,
      callService: async () => {
        this._toast("Zeitstrahl: hier wird nur angesehen – „Jetzt“ tippen zum Schalten.");
      },
    };
    this._tlCache = { real: real.states, t: tl.t, loaded: tl.loading, hass };
    return hass;
  },

  _tlSet(t) {
    const tl = this._tl;
    if (!tl) return;
    tl.t = Math.max(tl.from, Math.min(tl.to, t));
    if (this._realHass) this.hass = this._realHass;
    this._tlInfo();
  },

  /** Zeile unter dem Regler: Zeit, Wetter, erwartete PV-Leistung bzw. Hinweis „Verlauf“. */
  _tlInfo() {
    const tl = this._tl;
    const bar = this._tlBar;
    if (!tl || !bar) return;
    const now = Date.now();
    bar.querySelector(".tlt").textContent = timeLabel(tl.t, now);
    bar.querySelector(".tlr").value = String(tl.t);
    let info = "";
    if (tl.loading) info = "lädt …";
    else if (tl.t < now - 60000) info = Object.keys(tl.history).length ? "Verlauf" : "kein Verlauf";
    else {
      const f = forecastAt(tl.forecast, tl.t);
      const elev = Number(this._hass?.states?.["sun.sun"]?.attributes?.elevation);
      const kwp = Number(this._building?.settings?.daily?.kwp) || 0;
      const bits = [];
      if (f?.temperature != null) bits.push(`${Math.round(f.temperature)} °C`);
      if (f) bits.push(`${cloudOf(f)} % Wolken`);
      if (kwp > 0) bits.push(`☀ ${fmtPower(pvEstimate(kwp, elev, cloudOf(f) ?? 0))} erwartet`);
      info = bits.join(" · ") || (tl.t > now + 60000 ? "Sonnenstand" : "");
    }
    bar.querySelector(".tli").textContent = info;
    bar.classList.toggle("future", tl.t > now + 60000);
    bar.classList.toggle("past", tl.t < now - 60000);
  },

  _renderTimeline() {
    this._tlBar?.remove();
    this._tlBar = null;
    const tl = this._tl;
    if (!tl || !this._els) return;
    const el = document.createElement("div");
    el.className = "tlbar";
    const now = Date.now();
    const nowPct = ((now - tl.from) / (tl.to - tl.from)) * 100;
    el.innerHTML = `<button class="icon tlplay" title="Abspielen"><ha-icon icon="mdi:play"></ha-icon></button>
      <div class="tlwrap"><input class="tlr" type="range" min="${tl.from}" max="${tl.to}" step="${tl.step}" value="${tl.t}" aria-label="Zeit"><i class="tlnow" style="left:${nowPct.toFixed(2)}%"></i></div>
      <span class="tlbox"><b class="tlt"></b><small class="tli"></small></span>
      <button class="tlj">Jetzt</button><button class="icon tlx" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>`;
    el.querySelector(".tlr").addEventListener("input", (ev) => this._tlSet(Number(ev.target.value)));
    el.querySelector(".tlj").addEventListener("click", () => this._tlSet(Date.now()));
    el.querySelector(".tlx").addEventListener("click", () => this._timelineClose());
    el.querySelector(".tlplay").addEventListener("click", () => {
      if (this._tlPlay) {
        clearInterval(this._tlPlay);
        this._tlPlay = null;
      } else {
        if (tl.t >= tl.to - tl.step) tl.t = tl.from;
        this._tlPlay = setInterval(() => {
          if (!this._tl || this._tl.t >= this._tl.to) {
            clearInterval(this._tlPlay);
            this._tlPlay = null;
          } else this._tlSet(this._tl.t + 3 * tl.step);
          this._tlPlayIcon();
        }, 200);
      }
      this._tlPlayIcon();
    });
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    this._els.stage.appendChild(el);
    this._els.stage.classList.add("has-tlbar");
    this._tlBar = el;
    this._tlInfo();
    if (this._realHass) this.hass = this._realHass;
  },

  _tlPlayIcon() {
    this._tlBar?.querySelector(".tlplay ha-icon")?.setAttribute("icon", this._tlPlay ? "mdi:pause" : "mdi:play");
  },
};

export const TIMELINE_STYLE = `
.tlbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 8px; width: min(720px, calc(100% - 140px)); padding: 6px 8px; border-radius: 14px; background: var(--card-background-color, #fff); color: var(--primary-text-color); box-shadow: 0 2px 12px rgba(0,0,0,.35); }
.tlbar.past { box-shadow: 0 0 0 2px #7e57c2, 0 2px 12px rgba(0,0,0,.35); }
.tlbar.future { box-shadow: 0 0 0 2px #29b6f6, 0 2px 12px rgba(0,0,0,.35); }
.tlbar .tlwrap { position: relative; flex: 1; min-width: 80px; display: flex; align-items: center; }
.tlbar .tlr { width: 100%; accent-color: var(--primary-color, #03a9f4); }
.tlbar .tlnow { position: absolute; top: -4px; width: 2px; height: 8px; background: #e53935; transform: translateX(-1px); pointer-events: none; }
.tlbar .tlbox { display: flex; flex-direction: column; min-width: 92px; line-height: 1.15; }
.tlbar .tlt { font-size: 14px; }
.tlbar .tli { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
.tlbar button { font: inherit; border: 0; border-radius: 10px; cursor: pointer; background: transparent; color: inherit; }
.tlbar .tlj { padding: 6px 10px; background: var(--primary-color, #03a9f4); color: #fff; font-size: 13px; }
.stage.has-tlbar .toast { bottom: 76px; }
@media (max-width: 600px) { .tlbar { width: calc(100% - 24px); bottom: 80px; flex-wrap: wrap; } .tlbar .tlwrap { order: 5; flex-basis: 100%; } }
`;

