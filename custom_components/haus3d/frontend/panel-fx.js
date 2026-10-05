// Jahreszeit, Energiefluss im Haus, PV-Verschattung und Schatten-Zeitraffer (Mixin für Haus3DPanel).

import { daySamples, houseFlowItems, resolveSeason, shadingSummary } from "./fx.js";
import { gridState } from "./energy.js";
import { roomPower } from "./devices.js";
import { energyEntities } from "./energymodel.js";
import { esc, fmt } from "./panel-util.js";
import { sunFromHass } from "./sun.js";

const hhmm = (t) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export const FxMethods = {
  /** Jahreszeit im Garten (Einstellung „season“, sonst nach Datum und Breite). */
  _applySeason() {
    const lat = Number(this._hass?.config?.latitude);
    this._scene?.setSeason(resolveSeason(this._building?.settings?.season ?? "auto", new Date(), Number.isFinite(lat) ? lat : 50));
  },

  /** Verbrauch je Raum und Netz → Linien vom Hausanschluss (Ebene „Energiefluss“). */
  _updateHouseFlow(energy) {
    if (!this._scene || !this._building) return;
    if (this._settings.layers.flow === false || this._building.settings?.house_flow === false) return this._scene.setHouseFlow([]);
    const hass = this._hass;
    const cfg = this._building.settings?.energy ?? {};
    const exclude = new Set(energyEntities(cfg));
    const watts = new Map();
    for (const f of this._building.floors) {
      for (const r of f.rooms ?? []) {
        if (r.energy_role) continue;
        const w = roomPower(r, hass, this._byArea, exclude);
        if (w != null) watts.set(r.id, w);
      }
    }
    this._scene.setHouseFlow(houseFlowItems(watts, gridState(energy?.netz)));
  },

  /** Verschattung der PV-Felder heute (oder am Tag day): Verlust je Feld, Verlauf, Zeitraffer. */
  async _pvShadingDialog(day = new Date()) {
    this._closePopup?.();
    this._closeDialog();
    const lat = Number(this._hass?.config?.latitude);
    const lon = Number(this._hass?.config?.longitude);
    const el = document.createElement("div");
    el.className = "dialog-backdrop sheet-backdrop";
    el.innerHTML = `<div class="dialog sheet pvshade" role="dialog" aria-label="PV-Verschattung"><div class="dialog-head"><span>PV-Verschattung</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dialog-body"><p class="hint">Rechne …</p></div></div>`;
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    this._els.stage.appendChild(el);
    this._dialog = el;
    const body = el.querySelector(".dialog-body");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      body.innerHTML = `<p class="hint">Standort fehlt (Einstellungen → System → Allgemein in Home Assistant).</p>`;
      return;
    }
    await new Promise((r) => setTimeout(r, 30)); // „Rechne …“ zeigen
    const north = Number(this._building?.settings?.north) || 0;
    const samples = daySamples(day, lat, lon);
    const rows = this._scene.pvShadingRows(samples, north);
    const names = this._pvInfo ?? new Map();
    this._pvShading = new Map([...rows].map(([id, r]) => [id, shadingSummary(r)]));
    const dateIn = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const chart = (s) => {
      if (!s.hours.length) return "";
      const t0 = s.hours[0].t;
      const t1 = s.hours.at(-1).t || t0 + 1;
      const W = 280;
      const H = 44;
      const bw = Math.max(2, W / s.hours.length - 1);
      return `<svg viewBox="0 0 ${W} ${H + 12}" class="shchart">${s.hours.map((h) => {
        const x = ((h.t - t0) / Math.max(1, t1 - t0)) * (W - bw);
        const hh = Math.max(1, h.frac * H);
        return `<rect x="${x.toFixed(1)}" y="${(H - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" class="${h.frac > 0.5 ? "hi" : h.frac > 0 ? "mid" : "lo"}"/>`;
      }).join("")}<text x="0" y="${H + 11}">${hhmm(t0)}</text><text x="${W}" y="${H + 11}" text-anchor="end">${hhmm(t1)}</text></svg>`;
    };
    const list = [...this._pvShading].map(([id, s]) => `<div class="shrow"><div class="shhead"><b>${esc(names.get(id)?.name ?? id)}</b><span class="${s.loss > 0.15 ? "bad" : s.loss > 0.03 ? "mid" : "ok"}">${s.loss < 0.005 ? "keine Verschattung" : `≈ ${fmt(s.loss * 100, 0)} % Verlust`}</span></div>${chart(s)}${s.worst ? `<p class="hint">Am stärksten um ${hhmm(s.worst.t)} (${fmt(s.worst.frac * 100, 0)} % der Module im Schatten)</p>` : ""}</div>`).join("");
    body.innerHTML = `<div class="en-row"><span>Tag</span><input type="date" data-day value="${dateIn}"></div>
      ${list || `<p class="hint">Keine PV-Felder auf dem Dach (Bearbeiten → Ebene „Dach“).</p>`}
      <p class="hint">Geprüft wird jede Modulmitte alle 20 min gegen Dach, Gauben, Kamine, Wände und Bäume. Verlust gewichtet nach Sonnenhöhe (grobe Schätzung).</p>
      <div class="btns"><button data-act="play" class="primary"><ha-icon icon="mdi:play"></ha-icon> Schatten-Zeitraffer</button></div>`;
    body.querySelector("[data-day]").addEventListener("change", (ev) => {
      const d = new Date(`${ev.target.value}T12:00:00`);
      if (!Number.isNaN(d.getTime())) this._pvShadingDialog(d);
    });
    body.querySelector('[data-act="play"]').addEventListener("click", () => {
      this._closeDialog();
      this._sunTimelapse(samples);
    });
  },

  /** Sonne in ~12 s über den Tag laufen lassen (mit Schatten), danach zurück zum echten Stand. */
  _sunTimelapse(samples) {
    if (!samples?.length || !this._scene) return;
    clearInterval(this._lapseTimer);
    const north = Number(this._building?.settings?.north) || 0;
    const wasShadow = this._scene.layers.shadows;
    this._scene.layers.shadows = true;
    const q = this._scene.quality;
    if (!q.shadows) this._scene.quality = { ...q, shadows: true };
    this._scene._applyShadows();
    const chip = document.createElement("div");
    chip.className = "lapsechip";
    chip.innerHTML = `<ha-icon icon="mdi:weather-sunny"></ha-icon><span></span><button class="icon" title="Stopp"><ha-icon icon="mdi:stop"></ha-icon></button>`;
    this._els.stage.appendChild(chip);
    let i = 0;
    const stop = () => {
      clearInterval(this._lapseTimer);
      this._lapseTimer = null;
      chip.remove();
      this._scene.layers.shadows = wasShadow;
      this._scene.quality = q;
      this._scene._applyShadows();
      this._scene.setSun(sunFromHass(this._hass), north);
    };
    chip.querySelector("button").addEventListener("click", stop);
    const step = () => {
      if (i >= samples.length) return stop();
      const s = samples[i++];
      chip.querySelector("span").textContent = hhmm(s.t);
      this._scene.setSun({ azimuth: s.azimuth, elevation: s.elevation }, north);
    };
    step();
    this._lapseTimer = setInterval(step, Math.max(120, 12000 / samples.length));
  },
};

export const FX_STYLE = `
.pvshade .shrow { border-top: 1px solid var(--divider-color, rgba(127,127,127,.25)); padding: 8px 0; }
.pvshade .shhead { display: flex; justify-content: space-between; gap: 8px; }
.pvshade .shhead .ok { color: var(--success-color, #43a047); }
.pvshade .shhead .mid { color: var(--warning-color, #ff9800); }
.pvshade .shhead .bad { color: var(--error-color, #db4437); }
.pvshade .shchart { width: 100%; height: 60px; margin-top: 4px; }
.pvshade .shchart rect.lo { fill: rgba(127,127,127,.25); }
.pvshade .shchart rect.mid { fill: var(--warning-color, #ff9800); }
.pvshade .shchart rect.hi { fill: var(--error-color, #db4437); }
.pvshade .shchart text { font-size: 9px; fill: var(--secondary-text-color); }
.lapsechip { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 14px; border-radius: 22px; background: var(--card-background-color, #fff); box-shadow: 0 2px 10px rgba(0,0,0,.3); font-weight: 600; z-index: 6; }
.lapsechip ha-icon { color: #f9a825; }
`;
