// Heizung direkt am Heizkörper (Mixin für Haus3DPanel): Tipp auf einen Heizkörper bzw. ein Thermostat
// öffnet ein kleines Fenster mit Ist/Soll, − und + (gesammelt gesendet) und den Betriebsarten.

import { stepTarget } from "./devices.js";
import { esc, fmt } from "./panel-util.js";

const MODES = { heat: ["mdi:fire", "Heizen"], off: ["mdi:power", "Aus"], auto: ["mdi:thermostat-auto", "Auto"], cool: ["mdi:snowflake", "Kühlen"], heat_cool: ["mdi:sun-snowflake-variant", "Heizen/Kühlen"], dry: ["mdi:water-percent", "Trocknen"], fan_only: ["mdi:fan", "Lüften"] };

/** Werte eines Thermostats für das Fenster (wie roomActions in devices.js). */
export function thermoInfo(st) {
  if (!st) return null;
  const a = st.attributes ?? {};
  const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    entity: st.entity_id,
    name: a.friendly_name ?? st.entity_id,
    target: num(a.temperature),
    current: num(a.current_temperature),
    step: num(a.target_temp_step) ?? 0.5,
    min: num(a.min_temp) ?? 5,
    max: num(a.max_temp) ?? 30,
    action: a.hvac_action ?? null,
    mode: st.state,
    modes: (Array.isArray(a.hvac_modes) ? a.hvac_modes : []).filter((m) => MODES[m]),
  };
}

export const ClimateMethods = {
  /** Thermostat-Fenster (Heizkörper oder Thermostat angetippt). */
  _climatePopup(entityId) {
    this._closePopup();
    const el = document.createElement("div");
    el.className = "popup climpop";
    let pending = null;
    let timer = null;
    const draw = () => {
      const c = thermoInfo(this._hass?.states[entityId]);
      if (!c) return this._closePopup();
      const target = pending ?? c.target;
      el.innerHTML = `<div class="head"><ha-icon icon="mdi:radiator"></ha-icon><span>${esc(c.name)}</span><button class="icon x" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="cbody">
          <div class="now">${c.current != null ? `ist <b>${fmt(c.current)} °C</b>` : ""}${c.action === "heating" ? ' · <span class="heat">heizt</span>' : ""}</div>
          <div class="cstep"><button class="minus" title="kälter">−</button><span class="tval${pending != null ? " pending" : ""}">${target != null ? `${fmt(target)} °C` : esc(c.mode)}</span><button class="plus" title="wärmer">+</button></div>
          ${c.modes.length ? `<div class="cmodes">${c.modes.map((m) => `<button data-mode="${m}" class="${m === c.mode ? "sel" : ""}"><ha-icon icon="${MODES[m][0]}"></ha-icon><span>${MODES[m][1]}</span></button>`).join("")}</div>` : ""}
          <button class="more"><ha-icon icon="mdi:information-outline"></ha-icon><span>Weitere Infos</span></button>
        </div>`;
      const step = (n) => {
        const cur = thermoInfo(this._hass?.states[entityId]);
        pending = stepTarget(cur, pending, n);
        draw();
        clearTimeout(timer);
        timer = setTimeout(() => {
          const v = pending;
          this._hass.callService("climate", "set_temperature", { entity_id: entityId, temperature: v }).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
          setTimeout(() => {
            pending = null;
            if (el.isConnected) draw();
          }, 1500);
        }, 700);
      };
      el.querySelector(".minus").addEventListener("click", () => step(-1));
      el.querySelector(".plus").addEventListener("click", () => step(1));
      el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
        this._hass.callService("climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: b.dataset.mode }).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
        el.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("sel", x === b));
      }));
      el.querySelector(".x").addEventListener("click", () => this._closePopup());
      el.querySelector(".more").addEventListener("click", () => {
        this._closePopup();
        this._moreInfo(entityId);
      });
    };
    draw();
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el._refresh = () => pending == null && draw();
    this._els.stage.appendChild(el);
    this._popup = el;
  },
};

export const CLIMATE_STYLE = `
.popup.climpop { left: 50%; top: auto; bottom: 24px; right: auto; transform: translateX(-50%); width: min(340px, calc(100% - 32px)); padding: 0; }
.climpop .head { display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px 14px; font-weight: 600; }
.climpop .head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.climpop .head .x { width: auto; flex: none; padding: 8px; }
.climpop .cmodes button, .climpop .more { width: auto; }
.climpop .cstep button { width: auto; justify-content: center; }
.climpop .cbody { padding: 4px 14px 14px; display: grid; gap: 10px; }
.climpop .now { color: var(--secondary-text-color); }
.climpop .now .heat { color: #e65100; font-weight: 600; }
.climpop .cstep { display: grid; grid-template-columns: 64px 1fr 64px; align-items: center; gap: 8px; }
.climpop .cstep button { height: 56px; border-radius: 16px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: var(--secondary-background-color, rgba(127,127,127,.08)); color: inherit; font: inherit; font-size: 28px; cursor: pointer; }
.climpop .tval { text-align: center; font-size: 30px; font-weight: 600; }
.climpop .tval.pending { color: var(--primary-color, #03a9f4); }
.climpop .cmodes { display: flex; gap: 6px; flex-wrap: wrap; }
.climpop .cmodes button, .climpop .more { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; min-height: 40px; padding: 0 12px; border-radius: 20px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: transparent; color: inherit; cursor: pointer; }
.climpop .cmodes button.sel { background: var(--primary-color, #03a9f4); border-color: transparent; color: #fff; }
.climpop .more { justify-self: start; }
`;
