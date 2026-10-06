// Unterstützen und Entwickler-Instanz (Mixin für Haus3DPanel). Haus 3D bleibt kostenlos: Spenden sind
// freiwillig (Zeile im Zahnrad, ein einziger dezenter Hinweis nach 14 Tagen). Die Entwickler-Instanz
// (Haus-Symbol unten rechts in den Admin-Einstellungen, Code wird im Backend als Hash geprüft) blendet
// das Spendenfeld aus und zeigt Entwickler-Infos – sie schaltet keine bezahlten Funktionen frei.

import { withToken } from "./access.js";
import { SUPPORT_LINKS, esc } from "./panel-util.js";

const HINT_AFTER_MS = 14 * 86400000;
const LS_FIRST = "haus3d.firstSeen";
const LS_HINTED = "haus3d.supportHinted";
// Version und Frontend-Stand aus der eigenen Adresse (…/haus3d_static/<version>/…)
const BUILD = (() => {
  try {
    return new URL(import.meta.url).pathname.split("/").at(-2) ?? "";
  } catch {
    return "";
  }
})();

/** Links mit URL (leere werden nicht gezeigt). */
export const supportLinks = (links = SUPPORT_LINKS) => links.filter((l) => typeof l[2] === "string" && /^https:\/\//.test(l[2]));

/** Soll der einmalige Hinweis jetzt kommen? */
export function supportHintDue({ firstSeen, hinted, now = Date.now(), kiosk = false, dev = false, links = supportLinks() }) {
  if (kiosk || dev || hinted || !links.length) return false;
  return Number.isFinite(firstSeen) && now - firstSeen >= HINT_AFTER_MS;
}

const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* privates Fenster */
    }
  },
};

export const SupportMethods = {
  /** Entwickler-Status vom Backend (einmal, dann gemerkt). */
  async _loadDev() {
    if (this._devLoaded) return this._dev;
    try {
      const st = await this._hass.callWS({ type: "haus3d/pin/status" });
      this._dev = st?.dev === true;
    } catch {
      this._dev = false;
    }
    this._devLoaded = true;
    return this._dev;
  },

  /** Nach dem Laden: ersten Besuch merken, nach 14 Tagen einmal dezent hinweisen. */
  async _supportHintCheck() {
    const now = Date.now();
    let first = Number(ls.get(LS_FIRST));
    if (!first) {
      ls.set(LS_FIRST, String(now));
      first = now;
    }
    const kiosk = this.hasAttribute("kiosk") || !!this._kioskUrl;
    if (!supportHintDue({ firstSeen: first, hinted: ls.get(LS_HINTED) === "1", now, kiosk, dev: false })) return;
    if (await this._loadDev()) return;
    ls.set(LS_HINTED, "1");
    this._toastAction?.("Gefällt dir Haus 3D? Es bleibt kostenlos – über eine Spende freue ich mich.", "Unterstützen", () => this._supportDialog());
  },

  /** Zeile im Zahnrad (leer in der Entwickler-Instanz oder ohne Links). */
  _supportRow() {
    if (this._dev || !supportLinks().length) return "";
    return `<button class="supportrow"><ha-icon icon="mdi:heart"></ha-icon><span>Haus 3D unterstützen</span><ha-icon class="go" icon="mdi:chevron-right"></ha-icon></button>`;
  },

  _supportDialog() {
    this._closePopup?.();
    this._closeDialog();
    const el = document.createElement("div");
    el.className = "dialog-backdrop sheet-backdrop";
    el.innerHTML = `<div class="dialog sheet supportdlg" role="dialog" aria-label="Unterstützen"><div class="dialog-head"><span>Haus 3D unterstützen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body">
        <p>Haus 3D ist kostenlos und bleibt es. Entwickelt in der Freizeit – wenn es dir gefällt, hilft eine kleine Spende, dass es weitergeht.</p>
        <div class="slinks">${supportLinks().map(([k, name, url, icon]) => `<a class="slink" data-k="${k}" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><ha-icon icon="${icon}"></ha-icon><span>${esc(name)}</span></a>`).join("")}</div>
        <p class="hint">Später gibt es optionale Zusatzpakete; alles, was es heute gibt, bleibt frei.</p>
      </div></div>`;
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  /** Haus-Symbol in den Admin-Einstellungen: Code eingeben, Instanz als Entwickler bestätigen. */
  async _devConfirm(onDone) {
    const ok = await this._pinPad("dev", {
      title: "Entwickler-Instanz",
      sub: "Code eingeben",
      icon: "mdi:home-heart",
      verify: async (code) => (await this._hass.callWS(withToken({ type: "haus3d/dev/set", code }))).ok === true,
    });
    if (!ok) return;
    this._dev = true;
    this._devLoaded = true;
    this._toast("Entwickler-Instanz bestätigt – kein Spendenfeld mehr.");
    onDone?.();
  },

  /** Admin → Entwickler. */
  _renderDevConfig(box, onClear) {
    const st = this._settings;
    const q = this._scene?.quality;
    box.innerHTML = `<div class="devinfo">
        <div><span>Frontend-Stand</span><b>${esc(BUILD || "–")}</b></div>
        <div><span>Qualität</span><b>${esc(st.quality)}${q ? ` · Auflösung ${Math.round((q.pixelRatio ?? 1) * 100) / 100}` : ""}</b></div>
        <div><span>Etagen / Räume</span><b>${this._building?.floors.length ?? 0} / ${this._building?.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0) ?? 0}</b></div>
        <div><span>Beobachtete Entitäten</span><b>${this._watched?.size ?? this._watched?.length ?? "–"}</b></div>
      </div>
      <label class="chkrow"><input type="checkbox" data-perfhud${st.perfHud ? " checked" : ""}> Leistungsanzeige (Bilder/s)</label>
      <div class="btns left"><button data-dev="sim"><ha-icon icon="mdi:test-tube"></ha-icon> Simulation ${this._sim ? "beenden" : "starten"}</button><button data-dev="hint"><ha-icon icon="mdi:heart-outline"></ha-icon> Spenden-Hinweis zurücksetzen</button></div>
      <div class="btns"><button data-dev="clear" class="danger">Entwickler-Instanz aufheben</button></div>`;
    box.querySelector("[data-perfhud]").addEventListener("change", (ev) => {
      st.perfHud = ev.target.checked;
      this._saveSettings();
      this._applyQuality?.();
    });
    box.querySelector('[data-dev="sim"]').addEventListener("click", () => {
      this._closeDialog();
      this._setSim(!this._sim);
    });
    box.querySelector('[data-dev="hint"]').addEventListener("click", () => {
      ls.set(LS_HINTED, "");
      this._toast("Hinweis zurückgesetzt (erscheint nicht in der Entwickler-Instanz).");
    });
    box.querySelector('[data-dev="clear"]').addEventListener("click", async () => {
      try {
        await this._callLocked({ type: "haus3d/dev/clear" }, "admin");
        this._dev = false;
        this._toast("Entwickler-Instanz aufgehoben.");
        onClear?.();
      } catch (e) {
        this._toast(`Fehlgeschlagen: ${e.message ?? e.code ?? e}`);
      }
    });
  },
};

export const SUPPORT_STYLE = `
.supportrow { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 12px; padding: 10px 14px; border-radius: 14px; border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent; color: var(--primary-text-color); font: inherit; cursor: pointer; text-align: left; }
.supportrow > ha-icon:first-child { color: #e91e63; }
.supportrow span { flex: 1; }
.supportrow .go { color: var(--secondary-text-color); }
.supportdlg .slinks { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 12px 0; }
.supportdlg .slink { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; border-radius: 14px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); color: var(--primary-text-color); text-decoration: none; font-weight: 600; }
.supportdlg .slink:hover { background: rgba(127,127,127,.1); }
.admin .devbtn { position: absolute; right: 14px; bottom: 12px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: transparent; color: var(--secondary-text-color); opacity: .45; cursor: pointer; --mdc-icon-size: 20px; }
.admin .devbtn:hover { opacity: .9; }
.admin .devbtn.on { color: #43a047; opacity: .9; }
.admin .dialog-body { position: relative; padding-bottom: 52px; }
.devinfo { display: grid; gap: 4px; margin-bottom: 10px; }
.devinfo div { display: flex; justify-content: space-between; gap: 12px; }
.devinfo span { color: var(--secondary-text-color); }
`;
