// PIN-Feld, Bearbeiten-Modus und gesperrtes Speichern (Mixin für Haus3DPanel).
// Bearbeiten und Admin-Einstellungen haben je eine eigene PIN (Standard 0000). Eine falsche PIN löst
// nichts aus; nur die richtige öffnet. Freigabe gilt bis „Beenden“/Fenster zu, längstens 10 min Ruhe.

import { esc } from "./panel-util.js";
import { accessScope, canAdmin, canEdit, clearAccess, currentToken, pinKey, setAccess, touchAccess, withToken } from "./access.js";

const CHECK_DELAY = 450; // ms nach der letzten Ziffer, dann still prüfen

export const AccessMethods = {
  _editing() {
    return !!this._editMode && canEdit();
  },

  /**
   * PIN abfragen (Bereich edit oder admin). Promise<boolean>: true, sobald die richtige PIN eingegeben
   * ist; false bei ✕. Falsche PINs: nichts passiert.
   */
  _pinPad(scope, { title = null, sub = null, icon = null, verify = null } = {}) {
    if (!verify && (scope === "edit" ? canEdit() : canAdmin())) return Promise.resolve(true);
    this._pinEl?._finish?.(false);
    return new Promise((resolve) => {
      let pin = "";
      let timer = null;
      let seq = 0;
      let done = false;
      const el = document.createElement("div");
      el.className = "confirm-backdrop pin-backdrop";
      el.innerHTML = `<div class="pinpad" role="dialog" aria-label="PIN">
        <div class="ptitle"><ha-icon icon="${icon ?? (scope === "admin" ? "mdi:cog" : "mdi:pencil")}"></ha-icon><span>${esc(title ?? (scope === "admin" ? "Admin-Einstellungen" : "Bearbeiten"))}</span><ha-icon icon="mdi:lock"></ha-icon></div>
        ${sub ? `<div class="psub">${esc(sub)}</div>` : ""}
        <div class="dots"></div>
        <div class="keys">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "close"].map((k) => `<button data-k="${k}"${k === "back" ? ' title="Löschen (lang drücken: alles)"' : k === "close" ? ' title="Abbrechen"' : ""}>${k === "back" ? '<ha-icon icon="mdi:backspace-outline"></ha-icon>' : k === "close" ? '<ha-icon icon="mdi:close"></ha-icon>' : k}</button>`).join("")}</div>
      </div>`;
      const dots = el.querySelector(".dots");
      const draw = () => {
        const n = Math.max(4, pin.length);
        dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? "on" : ""}"></i>`).join("");
      };
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("keydown", onKey, true);
        el.remove();
        if (this._pinEl === el) this._pinEl = null;
        resolve(ok);
      };
      el._finish = finish;
      const check = async () => {
        const my = ++seq;
        const tried = pin;
        let res = null;
        try {
          res = verify ? { ok: await verify(tried) } : await this._hass.callWS({ type: "haus3d/pin/verify", scope, pin: tried });
        } catch (err) {
          res = null;
          if (verify && err?.code && err.code !== "unknown_command") this._toast(`Fehlgeschlagen: ${err.message ?? err.code}`);
        }
        if (done || my !== seq) return;
        if (verify && res?.ok) finish(true);
        else if (res?.ok && res.token) {
          setAccess(res.token, res.scope ?? scope);
          finish(true);
        } else if (tried.length >= 8 && pin === tried) {
          // längste PIN falsch: still leeren
          pin = "";
          draw();
        }
      };
      const press = (k) => {
        if (k === "close") return finish(false);
        const r = pinKey(pin, k);
        pin = r.pin;
        draw();
        clearTimeout(timer);
        seq++; // laufende Prüfung einer kürzeren Eingabe verwerfen
        if (r.check) timer = setTimeout(check, pin.length >= 8 ? 0 : CHECK_DELAY);
      };
      const onKey = (ev) => {
        if (/^[0-9]$/.test(ev.key)) press(ev.key);
        else if (ev.key === "Backspace") press("back");
        else if (ev.key === "Escape") press("close");
        else return;
        ev.preventDefault();
        ev.stopPropagation();
      };
      el.querySelectorAll("[data-k]").forEach((b) => {
        let long = null;
        b.addEventListener("pointerdown", () => {
          if (b.dataset.k === "back") long = setTimeout(() => {
            long = "fired";
            press("clear");
          }, 600);
        });
        b.addEventListener("pointerup", () => long !== "fired" && clearTimeout(long));
        b.addEventListener("click", () => {
          if (long === "fired") {
            long = null;
            return;
          }
          press(b.dataset.k);
        });
      });
      el.addEventListener("click", (ev) => ev.target === el && finish(false));
      window.addEventListener("keydown", onKey, true);
      draw();
      this.shadowRoot.appendChild(el);
      this._pinEl = el;
    });
  },

  // ------------------------------------------------------------------ Türen

  /**
   * Schloss entriegeln/öffnen nur mit der Tür-PIN: das Backend prüft die PIN und schließt selbst auf.
   * Abbrechen wirft einen stillen Fehler (quiet), damit kein „Fehlgeschlagen“ erscheint.
   */
  async _doorUnlock(service, data = {}) {
    const ids = [].concat(data.entity_id ?? []).filter((e) => typeof e === "string" && e.startsWith("lock."));
    if (!ids.length) return this._realHass.callService("lock", service, data);
    const names = ids.map((e) => this._realHass.states?.[e]?.attributes?.friendly_name ?? e).join(", ");
    const ok = await this._pinPad("door", {
      title: service === "open" ? "Tür öffnen" : "Tür entriegeln",
      sub: names,
      icon: "mdi:door-open",
      verify: async (pin) => (await this._realHass.callWS({ type: "haus3d/lock/unlock", entity_id: ids, pin, service })).ok === true,
    });
    if (!ok) throw Object.assign(new Error("abgebrochen"), { quiet: true });
    this._toast(`${names}: ${service === "open" ? "wird geöffnet" : "wird entriegelt"}`);
  },

  // ------------------------------------------------------------------ Bearbeiten

  async _startEdit() {
    if (this._editing()) return true;
    if (!(await this._pinPad("edit"))) return false;
    this._editMode = true;
    this._watchAccess();
    this._refreshEditUi();
    return true;
  },

  /** „Beenden“: Bearbeiten aus, Freigabe zurückgeben (außer Admin ist noch aktiv). */
  _endEdit() {
    if (!this._editMode) return;
    this._editMode = false;
    if (!this._adminMode) this._lockAccess();
    this._refreshEditUi();
  },

  /** Admin-Modus (nach Admin-PIN) bis „Beenden“ bzw. 10 min Ruhe. */
  _startAdminMode() {
    this._adminMode = true;
    this._watchAccess();
    this._renderModes();
  },

  _endAdmin() {
    if (!this._adminMode) return;
    this._adminMode = false;
    if (this._adminOpen) this._closeDialog();
    this._adminOpen = false;
    if (!this._editMode) this._lockAccess();
    this._renderModes();
  },

  _lockAccess() {
    const token = currentToken();
    clearAccess();
    clearInterval(this._accessTimer);
    this._accessTimer = null;
    if (token) this._hass?.callWS({ type: "haus3d/pin/lock", token }).catch(() => {});
  },

  /** Nutzung verlängert die Freigabe; nach 10 min Ruhe ist sie weg (wie am Server). */
  _watchAccess() {
    if (!this._accessBound && this._els?.stage) {
      this._accessBound = true;
      this._els.stage.addEventListener("pointerdown", () => accessScope() && touchAccess(), true);
    }
    clearInterval(this._accessTimer);
    this._accessTimer = setInterval(() => {
      if (accessScope()) return;
      clearInterval(this._accessTimer);
      this._accessTimer = null;
      if (this._editMode || this._adminMode) {
        this._editMode = false;
        this._adminMode = false;
        this._refreshEditUi();
        this._toast("Bearbeiten/Admin beendet (10 min nichts geändert).");
      }
    }, 20000);
  },

  /** Knöpfe zum Bearbeiten ein-/ausblenden (Kopf, Karten, Raumfenster, Räder, Band). */
  _refreshEditUi() {
    this.toggleAttribute("editing", !!this._editMode);
    this._renderModes();
    this._renderToolbar?.();
    if (this._building) this._refreshEntities?.();
    for (const p of this._panels ?? []) p.sig = null;
    this._renderRoomPanel?.();
    this._renderWheels?.();
  },

  /** Aktive Modi oben (Kopfzeile bzw. am Wandtablet oben in der Ansicht), je mit „Beenden“. */
  _renderModes() {
    const box = this.shadowRoot?.querySelector(".modes");
    if (!box) return;
    const parts = [];
    if (this._editMode) parts.push(`<span class="mode m-edit"><ha-icon icon="mdi:pencil"></ha-icon><span class="mt">Bearbeiten</span>${this._scene ? `<button class="plan" title="Grundriss bearbeiten"><ha-icon icon="mdi:floor-plan"></ha-icon><span class="mt">Grundriss</span></button>` : ""}<button class="end" data-end="edit">Beenden</button></span>`);
    if (this._adminMode) parts.push(`<span class="mode m-admin"><button class="open" title="Admin-Einstellungen öffnen"><ha-icon icon="mdi:cog"></ha-icon><span class="mt">Admin</span></button><button class="end" data-end="admin">Beenden</button></span>`);
    box.innerHTML = parts.join("");
    box.hidden = !parts.length;
    box.querySelector(".plan")?.addEventListener("click", () => this._openEditor());
    box.querySelector(".open")?.addEventListener("click", () => this._openAdmin());
    box.querySelectorAll("[data-end]").forEach((b) => b.addEventListener("click", () => (b.dataset.end === "edit" ? this._endEdit() : this._endAdmin())));
  },

  /**
   * Schreibender Befehl mit Token; ist die Freigabe abgelaufen („locked“), einmal die PIN abfragen und
   * erneut senden.
   */
  async _callLocked(msg, scope = "edit") {
    try {
      return await this._hass.callWS(withToken(msg));
    } catch (err) {
      if (err?.code !== "locked") throw err;
      clearAccess();
      if (!(await this._pinPad(scope))) throw err;
      if (scope === "edit") this._watchAccess();
      return this._hass.callWS(withToken(msg));
    }
  },
};

export const ACCESS_STYLE = `
.pin-backdrop { z-index: 13; }
.pinpad { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 20px; padding: 18px 18px 14px; box-shadow: 0 10px 40px rgba(0,0,0,.4); width: min(320px, calc(100vw - 32px)); }
.pinpad .ptitle { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; font-size: 17px; }
.pinpad .ptitle ha-icon:last-child { color: var(--secondary-text-color); --mdc-icon-size: 18px; }
.pinpad .psub { text-align: center; color: var(--secondary-text-color); margin: -6px 0 6px; font-size: 14px; }
.pinpad .dots { display: flex; justify-content: center; gap: 12px; margin: 16px 0 14px; min-height: 16px; }
.pinpad .dots i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--secondary-text-color); box-sizing: border-box; }
.pinpad .dots i.on { background: var(--primary-text-color); border-color: var(--primary-text-color); }
.pinpad .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.pinpad .keys button { height: 62px; border-radius: 16px; border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: var(--secondary-background-color, rgba(127,127,127,.08)); color: inherit; font: inherit; font-size: 24px; font-weight: 500; cursor: pointer; touch-action: manipulation; }
.pinpad .keys button:active { background: var(--primary-color, #03a9f4); color: #fff; }
.modes { display: flex; gap: 6px; flex: none; }
.modes[hidden] { display: none; }
.mode { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 3px 0 10px; border-radius: 18px; color: #fff; font-weight: 600; font-size: 14px; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.mode.m-edit { background: #2e7d32; }
.mode.m-admin { background: #e65100; padding-left: 3px; }
.mode button { display: inline-flex; align-items: center; gap: 4px; font: inherit; border: 0; border-radius: 15px; height: 30px; padding: 0 10px; cursor: pointer; background: rgba(255,255,255,.2); color: #fff; }
.mode button.end { background: #fff; color: #333; }
.mode.m-edit button.end { color: #2e7d32; }
.mode.m-admin button.end { color: #e65100; }
.mode button.open { background: transparent; padding: 0 6px; }
@media (max-width: 700px) { .mode .mt { display: none; } }
@media (pointer: coarse) { .mode { height: 44px; } .mode button { height: 38px; } }
:host([kiosk]) .modes { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 9; }
`;
