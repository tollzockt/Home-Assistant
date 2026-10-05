// Meine Ansicht, Dienste und Begehen (Mixin für Haus3DPanel):
// - Ansicht je Benutzer: Stil, Ebenen, Qualität und gemerkte Blickwinkel liegen in den Benutzerdaten
//   von Home Assistant und gelten auf allen Geräten dieses Benutzers (Wandtablet: abschaltbar).
// - Dienste haus3d.show/notify/highlight/reload (Abo haus3d/subscribe), optional nur für ein Tablet.
// - Begehen: Blick aus Augenhöhe mit Joystick, Tippen geht hin.

import { VIEW_PRESETS, normalizeViews } from "./camera.js";
import { esc } from "./panel-util.js";

const USER_KEY = "haus3d";
const SYNC_KEYS = ["style", "deviceMode", "quality", "perfHud", "layers"];
const PRESET_KEYS = new Set(VIEW_PRESETS.map(([k]) => k));

export const UserMethods = {
  // ------------------------------------------------------------------ Meine Ansicht

  _userSync() {
    return !this._kioskUrl && !this._settings.kiosk?.nosync && !!this._hass?.callWS && !this._sim;
  },

  /** Beim Start: Ansicht des Benutzers übernehmen (falls vorhanden). */
  async _loadUserData() {
    if (!this._userSync() || this._userLoaded) return;
    this._userLoaded = true;
    try {
      const res = await this._hass.callWS({ type: "frontend/get_user_data", key: USER_KEY });
      const v = res?.value;
      if (!v || typeof v !== "object") return;
      if (v.settings && typeof v.settings === "object") {
        for (const k of SYNC_KEYS) {
          if (!(k in v.settings)) continue;
          this._settings[k] = k === "layers" ? { ...this._settings.layers, ...v.settings.layers } : v.settings[k];
        }
        this._store("haus3d.settings", JSON.stringify(this._settings));
      }
      if (Array.isArray(v.views)) this._store("haus3d.savedViews", JSON.stringify(normalizeViews(v.views)));
      this._applyStyle?.();
      this._scene?.setLayers(this._settings.layers);
      this._applyOverlayLayers?.();
      this._applyQuality?.();
      this._renderWheels?.();
    } catch {
      /* ältere HA-Version oder offline: lokal weiter */
    }
  },

  /** Nach Änderungen (gebündelt): Ansicht in die Benutzerdaten schreiben. */
  _pushUserData() {
    if (!this._userSync()) return;
    clearTimeout(this._userTimer);
    this._userTimer = setTimeout(() => {
      const settings = Object.fromEntries(SYNC_KEYS.map((k) => [k, this._settings[k]]));
      this._hass.callWS({ type: "frontend/set_user_data", key: USER_KEY, value: { settings, views: this._savedViews?.() ?? [], updated: Date.now() } }).catch(() => {});
    }, 1500);
  },

  // ------------------------------------------------------------------ Dienste

  /** Befehle der Dienste empfangen (einmal je Verbindung). */
  _subscribeCommands() {
    const conn = this._realHass?.connection ?? this._hass?.connection;
    if (!conn?.subscribeMessage || this._cmdConn === conn) return;
    this._cmdConn = conn;
    this._cmdUnsub?.then?.((u) => u?.()).catch?.(() => {});
    this._cmdUnsub = conn.subscribeMessage((msg) => this._onCommand(msg), { type: "haus3d/subscribe" });
    this._cmdUnsub?.catch?.(() => {
      this._cmdConn = null; // Integration ohne Dienste (ältere Version)
    });
  },

  /** Raum per ID oder Name finden. */
  _findRoom(key) {
    const k = String(key ?? "").trim().toLowerCase();
    if (!k) return null;
    for (const f of this._building?.floors ?? []) {
      const r = (f.rooms ?? []).find((x) => x.id.toLowerCase() === k) ?? (f.rooms ?? []).find((x) => String(x.name ?? "").toLowerCase() === k || x.area_id === k);
      if (r) return { floor: f, room: r };
    }
    return null;
  },

  _onCommand(c) {
    if (!c || typeof c !== "object" || !this._building) return;
    const me = String(this._settings.kiosk?.name ?? "").trim().toLowerCase();
    if (c.target && String(c.target).trim().toLowerCase() !== me) return;
    if (this._idle) this._wake?.();
    if (c.service === "reload") return this._load();
    if (c.service === "show") {
      if (c.floor) this._setFilter(c.floor === "all" || !this._building.floors.some((f) => f.id === c.floor) ? "all" : c.floor);
      if (c.view) {
        const north = Number(this._building.settings?.north) || 0;
        if (PRESET_KEYS.has(c.view)) this._scene?.viewPreset(c.view, north);
        else {
          const v = this._savedViews().find((x) => x.name.toLowerCase() === String(c.view).toLowerCase());
          if (v) {
            if (v.floor && v.floor !== this._filter) this._setFilter(v.floor);
            this._scene?.setView(v);
          }
        }
      }
      if (c.room) {
        const hit = this._findRoom(c.room);
        if (hit) {
          if (this._filter !== "all" && this._filter !== hit.floor.id) this._setFilter(hit.floor.id);
          this._selectRoom({ floorId: hit.floor.id, roomId: hit.room.id });
        }
      }
      return;
    }
    if (c.service === "highlight") {
      const hit = this._findRoom(c.room);
      if (!hit) return;
      clearInterval(this._hlTimer);
      this._highlight = { key: `${hit.floor.id}:${hit.room.id}`, until: Date.now() + (Number(c.seconds) || 10) * 1000, on: true };
      this._hlTimer = setInterval(() => {
        if (!this._highlight || Date.now() > this._highlight.until) {
          clearInterval(this._hlTimer);
          this._highlight = null;
        } else this._highlight.on = !this._highlight.on;
        this._updateStates();
      }, 600);
      this._updateStates();
      return;
    }
    if (c.service === "notify") this._notice(c);
  },

  /** Blinkender Raum (Dienst highlight) in die Hinweis-Färbung mischen. */
  _applyHighlight(rooms) {
    if (this._highlight?.on) rooms.set(this._highlight.key, "critical");
    return rooms;
  },

  /** Hinweis-Banner aus dem Dienst notify. */
  _notice(c) {
    this._noticeEl?.remove();
    const el = document.createElement("div");
    const level = ["info", "warn", "critical"].includes(c.level) ? c.level : "warn";
    el.className = `notice ${level}`;
    const hit = c.room ? this._findRoom(c.room) : null;
    el.innerHTML = `<ha-icon icon="${esc(c.icon || (level === "info" ? "mdi:information-outline" : level === "critical" ? "mdi:alert-octagon" : "mdi:alert"))}"></ha-icon><span></span>${hit ? `<button class="show">Zeigen</button>` : ""}<button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>`;
    el.querySelector("span").textContent = String(c.message ?? "");
    const close = () => {
      el.remove();
      if (this._noticeEl === el) this._noticeEl = null;
    };
    el.querySelector(".close").addEventListener("click", close);
    el.querySelector(".show")?.addEventListener("click", () => {
      this._onCommand({ service: "show", room: c.room });
      close();
    });
    this._els.stage.appendChild(el);
    this._noticeEl = el;
    if (level !== "critical") setTimeout(close, 120000);
  },

  // ------------------------------------------------------------------ Begehen

  /** Begehen starten: gewählte Etage (bei „Alle“ das Erdgeschoss), optional im offenen Raum. */
  _startWalk() {
    if (!this._scene || this._scene.isWalking()) return;
    const floors = [...this._building.floors].filter((f) => f.rooms?.length).sort((a, b) => Math.abs(a.elevation ?? 0) - Math.abs(b.elevation ?? 0));
    const panel = (this._panels ?? []).at(-1);
    const floorId = this._filter !== "all" ? this._filter : panel?.floorId ?? floors[0]?.id;
    const floor = this._building.floors.find((f) => f.id === floorId);
    if (!floor) return;
    const room = panel && panel.floorId === floorId ? floor.rooms.find((r) => r.id === panel.roomId) : null;
    this._walkPrev = this._filter;
    this._setFilter(floorId);
    const c = room ? room.points.reduce((s, p) => [s[0] + p[0] / room.points.length, s[1] + p[1] / room.points.length], [0, 0]) : null;
    if (!this._scene.enterWalk(floorId, c)) return this._toast("Begehen geht nur auf Etagen mit Räumen.");
    this._closePopup?.();
    this._els.stage.classList.add("walking");
    const ui = document.createElement("div");
    ui.className = "walkui";
    ui.innerHTML = `<div class="walkbar"><ha-icon icon="mdi:walk"></ha-icon><span>Begehen: ${esc(floor.name)}</span><button class="primary exit">Verlassen</button></div>
      <div class="joy" title="Gehen"><div class="knob"></div></div>
      <p class="walkhint">Ziehen = umsehen · Tippen auf den Boden = hingehen · Joystick, WASD oder Pfeiltasten = gehen</p>`;
    ui.querySelector(".exit").addEventListener("click", () => this._stopWalk());
    const joy = ui.querySelector(".joy");
    const knob = ui.querySelector(".knob");
    let jp = null;
    const set = (ev) => {
      const r = joy.getBoundingClientRect();
      const R = r.width / 2;
      let dx = ev.clientX - (r.left + R);
      let dy = ev.clientY - (r.top + R);
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this._scene.walkInput(-dy / R, dx / R);
    };
    joy.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      joy.setPointerCapture(ev.pointerId);
      jp = ev.pointerId;
      set(ev);
    });
    joy.addEventListener("pointermove", (ev) => ev.pointerId === jp && set(ev));
    const end = () => {
      jp = null;
      knob.style.transform = "";
      this._scene.walkInput(0, 0);
    };
    joy.addEventListener("pointerup", end);
    joy.addEventListener("pointercancel", end);
    this._els.stage.appendChild(ui);
    this._walkUi = ui;
    this._walkEsc = (ev) => ev.key === "Escape" && this._stopWalk();
    window.addEventListener("keydown", this._walkEsc);
  },

  _stopWalk() {
    if (!this._scene?.isWalking()) return;
    this._scene.exitWalk();
    this._walkUi?.remove();
    this._walkUi = null;
    window.removeEventListener("keydown", this._walkEsc);
    this._els.stage.classList.remove("walking");
    if (this._walkPrev && this._walkPrev !== this._filter) this._setFilter(this._walkPrev);
  },
};

export const USER_STYLE = `
.notice { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 7; display: flex; align-items: center; gap: 10px; max-width: calc(100% - 32px); padding: 8px 8px 8px 14px; border-radius: 14px; color: #fff; background: #1e88e5; box-shadow: 0 4px 16px rgba(0,0,0,.3); font-weight: 600; }
.notice.warn { background: #ef6c00; }
.notice.critical { background: #c62828; animation: h3dpulse 1.2s ease-in-out infinite; }
.notice span { flex: 1; }
.notice button { font: inherit; border: 0; border-radius: 10px; padding: 6px 12px; min-height: 36px; cursor: pointer; background: rgba(255,255,255,.95); color: #222; }
.notice button.icon { background: transparent; color: #fff; }
@keyframes h3dpulse { 50% { box-shadow: 0 0 0 6px rgba(198,40,40,.35); } }
.stage.walking .floorbar, .stage.walking .cards, .stage.walking .wheel, .stage.walking .overlay, .stage.walking .rp { display: none !important; }
.walkui { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.walkui .walkbar { pointer-events: auto; position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border-radius: 24px; background: var(--card-background-color, #fff); box-shadow: 0 2px 10px rgba(0,0,0,.3); font-weight: 600; }
.walkui .walkbar button { font: inherit; border: 0; border-radius: 18px; min-height: 40px; padding: 0 16px; cursor: pointer; background: var(--primary-color, #03a9f4); color: #fff; }
.walkui .joy { pointer-events: auto; position: absolute; left: 24px; bottom: 24px; width: 132px; height: 132px; border-radius: 50%; background: rgba(0,0,0,.25); border: 2px solid rgba(255,255,255,.6); touch-action: none; }
.walkui .knob { position: absolute; left: 41px; top: 41px; width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,.9); box-shadow: 0 2px 6px rgba(0,0,0,.3); }
.walkui .walkhint { position: absolute; right: 16px; bottom: 16px; margin: 0; max-width: 46%; padding: 6px 10px; border-radius: 10px; background: rgba(0,0,0,.45); color: #fff; font-size: 12px; }
`;
