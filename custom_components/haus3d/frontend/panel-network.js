// Netzwerkgeräte (Mixin für Haus3DPanel): Tipp auf ein Netzwerk-Symbol öffnet ein kleines Fenster mit
// online/offline, IP, WLAN, Signal, Access Point, Laufzeit; „Netzwerk“ im Funktionsrad listet alle Geräte.

import { networkDevices, networkInfo } from "./network.js";
import { esc } from "./panel-util.js";

const bars = (s) => (s ? `<span class="nbars l${s.level}" title="${s.dbm} dBm">${[1, 2, 3, 4].map((i) => `<i class="${i <= s.level ? "on" : ""}"></i>`).join("")}</span>` : "");

/** Zeilen „Name: Wert“ eines Geräts. */
function infoRows(n) {
  const rows = [
    ["IP", n.ip],
    ["Verbindung", n.wired === true ? "Kabel" : n.wired === false ? `WLAN${n.essid ? ` „${n.essid}“` : ""}` : n.essid ? `WLAN „${n.essid}“` : null],
    ["Signal", n.signal ? `${bars(n.signal)} ${esc(n.signal.text)} (${n.signal.dbm} dBm)` : null, true],
    ["Access Point", n.ap],
    ["Laufzeit", n.uptime],
    ["Hostname", n.host],
    ["MAC", n.mac],
    ["Modell", [n.manufacturer, n.model].filter(Boolean).join(" ") || null],
    ...n.extra.map((x) => [x.label, x.text]),
  ];
  return rows.filter(([, v]) => v).map(([k, v, raw]) => `<div class="nrow"><span>${k}</span><b>${raw ? v : esc(v)}</b></div>`).join("");
}

export const NetworkMethods = {
  /** Fenster eines Netzwerkgeräts. */
  _networkPopup(entityId) {
    this._closePopup();
    const el = document.createElement("div");
    el.className = "popup netpop";
    const draw = () => {
      const n = networkInfo(entityId, this._hass);
      if (!n) return this._closePopup();
      el.innerHTML = `<div class="head"><ha-icon icon="${n.icon}"></ha-icon><span>${esc(n.name)}</span><button class="icon x" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="nbody">
          <div class="nstate ${n.online ? "on" : "off"}"><i></i>${n.online ? "online" : "offline"}</div>
          <div class="nrows">${infoRows(n)}</div>
          <div class="nbtns">${n.restart ? `<button class="restart"><ha-icon icon="mdi:restart"></ha-icon><span>Neu starten</span></button>` : ""}<button class="all"><ha-icon icon="mdi:lan"></ha-icon><span>Alle Netzwerkgeräte</span></button><button class="more"><ha-icon icon="mdi:information-outline"></ha-icon><span>Weitere Infos</span></button></div>
        </div>`;
      el.querySelector(".x").addEventListener("click", () => this._closePopup());
      el.querySelector(".more").addEventListener("click", () => {
        this._closePopup();
        this._moreInfo(entityId);
      });
      el.querySelector(".all").addEventListener("click", () => {
        this._closePopup();
        this._networkDialog();
      });
      el.querySelector(".restart")?.addEventListener("click", async () => {
        const ok = await this._confirm(`${n.name} neu starten?`, "Neu starten", { danger: true, sub: "Das Gerät ist dann kurz nicht erreichbar." });
        if (!ok) return;
        this._hass.callService("button", "press", { entity_id: n.restart }).then(() => this._toast(`${n.name}: Neustart ausgelöst`)).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
      });
    };
    draw();
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el._refresh = draw;
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  /** Liste aller Netzwerkgeräte (Infrastruktur zuerst), mit Raum, falls im Plan. */
  _networkDialog() {
    this._closePopup?.();
    this._closeDialog();
    const el = document.createElement("div");
    el.className = "dialog-backdrop sheet-backdrop";
    el.innerHTML = `<div class="dialog sheet netlist" role="dialog" aria-label="Netzwerk"><div class="dialog-head"><span>Netzwerk</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dialog-body"></div></div>`;
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    this._els.stage.appendChild(el);
    this._dialog = el;
    const body = el.querySelector(".dialog-body");
    const list = networkDevices(this._hass);
    if (!list.length) {
      body.innerHTML = `<p class="hint">Keine Netzwerkgeräte gefunden. In Home Assistant die Integration „UniFi Network“ einrichten – ihre Geräte-Tracker (Clients, Access Points, Switches) erscheinen dann hier und im Plan (Bereich zuordnen oder im Editor mit „Gerät“ platzieren).</p>`;
      return;
    }
    const online = list.filter((n) => n.online).length;
    const groups = [["Infrastruktur", list.filter((n) => n.role !== "client")], ["Clients", list.filter((n) => n.role === "client")]];
    body.innerHTML = `<p class="hint">${online} von ${list.length} online</p>${groups
      .filter(([, g]) => g.length)
      .map(([title, g]) => `<h4>${title}</h4>${g.map((n) => `<button class="nitem ${n.online ? "on" : "off"}" data-id="${esc(n.id)}"><ha-icon icon="${n.icon}"></ha-icon><span class="nn"><b>${esc(n.name)}</b><small>${esc([this._placeText?.(n.id), n.ip, n.wired === false && n.essid ? n.essid : null].filter(Boolean).join(" · "))}</small></span>${bars(n.signal)}<i class="dot"></i></button>`).join("")}`)
      .join("")}`;
    body.querySelectorAll(".nitem").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation(); // sonst schließt der Klick auf die Bühne das neue Fenster gleich wieder
      this._closeDialog();
      this._networkPopup(b.dataset.id);
    }));
  },
};

export const NETWORK_STYLE = `
.popup.netpop { left: 50%; top: auto; bottom: 24px; right: auto; transform: translateX(-50%); width: min(360px, calc(100% - 32px)); padding: 0; }
.netpop .head { display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px 14px; font-weight: 600; }
.netpop .head .x { width: auto; flex: none; padding: 8px; }
.netpop .nbtns button { width: auto; }
.netpop .head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.netpop .nbody { padding: 4px 14px 14px; display: grid; gap: 10px; }
.nstate { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.nstate i, .nitem .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--error-color, #db4437); flex: none; }
.nstate.on i, .nitem.on .dot { background: var(--success-color, #43a047); }
.nstate.off { color: var(--error-color, #db4437); }
.nrows { display: grid; gap: 4px; }
.nrow { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.nrow span { color: var(--secondary-text-color); }
.nrow b { font-weight: 500; text-align: right; overflow-wrap: anywhere; display: inline-flex; align-items: center; gap: 6px; }
.nbars { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.nbars i { width: 4px; background: rgba(127,127,127,.3); border-radius: 1px; }
.nbars i:nth-child(1) { height: 25%; } .nbars i:nth-child(2) { height: 50%; } .nbars i:nth-child(3) { height: 75%; } .nbars i:nth-child(4) { height: 100%; }
.nbars i.on { background: var(--success-color, #43a047); }
.nbars.l1 i.on { background: var(--warning-color, #ff9800); }
.nbars.l0 i.on { background: var(--error-color, #db4437); }
.nbtns { display: flex; gap: 6px; flex-wrap: wrap; }
.nbtns button { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; min-height: 40px; padding: 0 12px; border-radius: 20px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: transparent; color: inherit; cursor: pointer; }
.nbtns .restart { color: var(--error-color, #db4437); }
.netlist h4 { margin: 12px 0 4px; font-size: 13px; color: var(--secondary-text-color); font-weight: 600; }
.nitem { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 6px 8px; border: 0; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2)); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.nitem .nn { flex: 1; min-width: 0; display: grid; }
.nitem .nn b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nitem .nn small { color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nitem.off { opacity: .6; }
`;
