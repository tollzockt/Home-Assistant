// Kameras, Medien, Saugroboter und Kurzwahl 2.0 (Mixin für Haus3DPanel): Kamerafenster mit Standbild
// alle 2 s (Klingel öffnet es von selbst und weckt das Tablet), Medien- und Saugroboter-Steuerung im
// Raumfenster, Abläufe an der Kurzwahl (läuft gerade, zuletzt, Ablauf ansehen, an/aus).

import { cameraSrc, doorbellRang, mediaCall, mediaInfo, routineInfo, vacuumCall, vacuumInfo } from "./media.js";
import { esc } from "./panel-util.js";

const domainOf = (id) => String(id).split(".")[0];
const REFRESH_MS = 2000;
const DOORBELL_SHOW_MS = 60000;

export const MediaMethods = {
  // ------------------------------------------------------------------ Kamera

  /** Kamerafenster: Standbild, das sich alle 2 s erneuert; „Live“ öffnet die Details von HA. */
  _cameraDialog(entityId, { ring = false } = {}) {
    this._closePopup?.();
    this._closeDialog();
    const st = this._hass?.states[entityId];
    const name = st?.attributes?.friendly_name ?? entityId;
    const admin = !!this._hass?.user?.is_admin;
    const bell = this._building?.settings?.doorbell ?? {};
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `<div class="dialog camdlg${ring ? " ring" : ""}" role="dialog" aria-label="${esc(name)}">
      <div class="dialog-head"><span>${ring ? "🔔 Es klingelt – " : ""}${esc(name)}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="cam"><img alt=""><div class="camoff" hidden>Kein Bild</div></div>
      <div class="btns"><button data-act="live"><ha-icon icon="mdi:video"></ha-icon> Live</button>${admin ? `<button data-act="bell" class="${bell.camera === entityId ? "sel" : ""}" title="Diese Kamera öffnet sich, wenn es klingelt"><ha-icon icon="mdi:doorbell"></ha-icon> ${bell.camera === entityId ? "Klingel-Kamera" : "Als Klingel-Kamera"}</button>` : ""}</div>
      ${admin && bell.camera === entityId ? `<label class="bellrow">Klingel-Auslöser<input data-bell list="dl_bell" placeholder="event.… oder binary_sensor.…" value="${esc(bell.trigger ?? "")}"><datalist id="dl_bell">${Object.keys(this._hass.states).filter((e) => ["event", "binary_sensor", "input_button", "button"].includes(domainOf(e))).sort().map((e) => `<option value="${esc(e)}"></option>`).join("")}</datalist></label>` : ""}
    </div>`;
    const img = el.querySelector("img");
    const off = el.querySelector(".camoff");
    const load = () => {
      const src = cameraSrc(this._hass?.states[entityId], Date.now());
      off.hidden = !!src;
      img.hidden = !src;
      if (src) img.src = src;
    };
    img.addEventListener("error", () => {
      off.hidden = false;
      img.hidden = true;
    });
    load();
    const timer = setInterval(() => (el.isConnected ? load() : clearInterval(timer)), REFRESH_MS);
    const close = () => {
      clearInterval(timer);
      this._closeDialog();
    };
    el.querySelector(".close").addEventListener("click", close);
    el.addEventListener("click", (ev) => ev.target === el && close());
    el.querySelector('[data-act="live"]').addEventListener("click", () => {
      close();
      this._moreInfo(entityId);
    });
    el.querySelector('[data-act="bell"]')?.addEventListener("click", () => {
      const on = bell.camera === entityId;
      this._saveBuildingSettings({ doorbell: on ? { ...bell, camera: null } : { ...bell, camera: entityId } }, on ? "Klingel-Kamera entfernt." : "Klingel-Kamera gesetzt – jetzt den Auslöser wählen.").then(() => this._cameraDialog(entityId));
    });
    el.querySelector("[data-bell]")?.addEventListener("change", (ev) => {
      const v = ev.target.value.trim();
      this._saveBuildingSettings({ doorbell: { ...bell, trigger: v.includes(".") ? v : null } }, "Klingel-Auslöser gespeichert.");
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
    if (ring) setTimeout(() => this._dialog === el && close(), DOORBELL_SHOW_MS);
  },

  /** Bei jedem hass-Wechsel: hat es geklingelt? Dann Tablet wecken und Kamera zeigen. */
  _checkDoorbell(prev) {
    const bell = this._building?.settings?.doorbell;
    if (!bell?.trigger || !bell.camera || !prev) return;
    const cur = this._hass.states[bell.trigger];
    if (!doorbellRang(prev.states?.[bell.trigger], cur)) return;
    if (this._idle) this._wake?.();
    this._cameraDialog(bell.camera, { ring: true });
  },

  // ------------------------------------------------------------------ Raumfenster: Medien, Saugroboter, Kameras

  /** Abschnitt im Raumfenster aufbauen (einmal je Gerätesatz). */
  _buildMedia(p, ids) {
    const box = p.el.querySelector(".rp-media");
    if (!box) return;
    const hass = this._hass;
    const players = ids.filter((id) => domainOf(id) === "media_player" && hass.states[id]);
    const vacs = ids.filter((id) => domainOf(id) === "vacuum" && hass.states[id]);
    const cams = ids.filter((id) => domainOf(id) === "camera" && hass.states[id]);
    p.media = { players, vacs, cams };
    const b = (k, icon, title) => `<button class="icon" data-k="${k}" title="${title}"><ha-icon icon="${icon}"></ha-icon></button>`;
    box.innerHTML =
      players.map((id) => `<div class="mp" data-id="${esc(id)}"><div class="mtop"><ha-icon icon="mdi:speaker"></ha-icon><div class="mt"><b></b><span></span></div>${b("power", "mdi:power", "an/aus")}</div>
        <div class="mrow">${b("prev", "mdi:skip-previous", "zurück")}${b("play", "mdi:play", "Wiedergabe/Pause")}${b("next", "mdi:skip-next", "weiter")}${b("mute", "mdi:volume-high", "stumm")}<input type="range" min="0" max="100" step="2" data-k="volume" title="Lautstärke"></div></div>`).join("") +
      vacs.map((id) => `<div class="vac" data-id="${esc(id)}"><div class="mtop"><ha-icon icon="mdi:robot-vacuum"></ha-icon><div class="mt"><b></b><span></span></div></div>
        <div class="mrow"><button data-k="start"><ha-icon icon="mdi:play"></ha-icon><span>Saugen</span></button><button data-k="pause"><ha-icon icon="mdi:pause"></ha-icon><span>Pause</span></button><button data-k="home"><ha-icon icon="mdi:home-import-outline"></ha-icon><span>Zur Station</span></button>${b("locate", "mdi:map-marker-question", "Wo bist du?")}</div></div>`).join("") +
      cams.map((id) => `<button class="camthumb" data-id="${esc(id)}" title="Kamera öffnen"><img alt=""><span></span></button>`).join("");
    box.hidden = !box.innerHTML;
    const call = (c) => c && this._hass.callService(c[0], c[1], c[2]).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
    box.querySelectorAll(".mp").forEach((el) => {
      const info = () => mediaInfo(this._hass.states[el.dataset.id]);
      el.querySelectorAll("button[data-k]").forEach((x) => x.addEventListener("click", () => call(mediaCall(info(), x.dataset.k))));
      const vol = el.querySelector('input[data-k="volume"]');
      vol.addEventListener("input", () => (vol._busy = Date.now()));
      vol.addEventListener("change", () => call(mediaCall(info(), "volume", Number(vol.value))));
    });
    box.querySelectorAll(".vac").forEach((el) => {
      el.querySelectorAll("button[data-k]").forEach((x) => x.addEventListener("click", () => call(vacuumCall(vacuumInfo(this._hass.states[el.dataset.id]), x.dataset.k))));
    });
    box.querySelectorAll(".camthumb").forEach((el) => el.addEventListener("click", () => this._cameraDialog(el.dataset.id)));
    p.camAt = 0;
  },

  /** Abschnitt aktualisieren (Texte, Tasten, Lautstärke; Kamerabild höchstens alle 10 s). */
  _updateMedia(p) {
    const box = p.el.querySelector(".rp-media");
    if (!box || box.hidden) return;
    const hass = this._hass;
    box.querySelectorAll(".mp").forEach((el) => {
      const m = mediaInfo(hass.states[el.dataset.id]);
      if (!m) return;
      el.querySelector(".mt b").textContent = m.title || m.name;
      el.querySelector(".mt span").textContent = [m.title ? m.name : "", m.artist, m.stateText].filter(Boolean).join(" · ");
      const show = (k, on) => (el.querySelector(`[data-k="${k}"]`).hidden = !on);
      show("prev", m.can.prev);
      show("next", m.can.next);
      show("play", m.can.playPause);
      show("mute", m.can.mute);
      show("volume", m.can.volume);
      show("power", m.can.power);
      el.querySelector('[data-k="play"] ha-icon').setAttribute("icon", m.playing ? "mdi:pause" : "mdi:play");
      el.querySelector('[data-k="mute"] ha-icon').setAttribute("icon", m.muted ? "mdi:volume-off" : "mdi:volume-high");
      el.classList.toggle("on", m.playing);
      const vol = el.querySelector('input[data-k="volume"]');
      if (m.volume != null && !(Date.now() - (vol._busy ?? 0) < 3000)) vol.value = String(m.volume);
    });
    box.querySelectorAll(".vac").forEach((el) => {
      const v = vacuumInfo(hass.states[el.dataset.id]);
      if (!v) return;
      el.querySelector(".mt b").textContent = v.name;
      el.querySelector(".mt span").textContent = [v.stateText, v.battery != null ? `Akku ${v.battery} %` : ""].filter(Boolean).join(" · ");
      for (const k of ["start", "pause", "home", "locate"]) el.querySelector(`[data-k="${k}"]`).hidden = !v.can[k];
      el.classList.toggle("on", v.cleaning);
      el.classList.toggle("err", v.error);
    });
    const now = Date.now();
    const fresh = now - (p.camAt ?? 0) > 10000;
    if (fresh) p.camAt = now;
    box.querySelectorAll(".camthumb").forEach((el) => {
      const st = hass.states[el.dataset.id];
      el.querySelector("span").textContent = st?.attributes?.friendly_name ?? el.dataset.id;
      const src = cameraSrc(st, fresh ? now : 0);
      const img = el.querySelector("img");
      img.hidden = !src;
      if (src && (fresh || !img.src)) img.src = src;
    });
  },

  // ------------------------------------------------------------------ Kurzwahl 2.0

  /** Zusatz für Kurzwahl-Bubbles: läuft gerade (Ring), zuletzt (unter dem Namen), aus (blass). */
  _routineBadge(item) {
    const r = routineInfo(this._hass?.states[item.entity]);
    if (!r) return item;
    return { ...item, running: r.running, off: r.off, sub: r.running ? "läuft …" : r.off ? "aus" : r.lastText };
  },

  /** Langdruck auf einen Kurzwahl-Eintrag: Ablauf-Infos statt nur „Details“. */
  _routineSheet(entityId) {
    const st = this._hass?.states[entityId];
    const r = routineInfo(st);
    if (!r) return this._moreInfo(entityId);
    this._closePopup?.();
    this._closeDialog();
    const admin = !!this._hass?.user?.is_admin;
    const auto = domainOf(entityId) === "automation";
    const name = st.attributes?.friendly_name ?? entityId;
    const el = document.createElement("div");
    el.className = "dialog-backdrop sheet-backdrop";
    el.innerHTML = `<div class="dialog sheet routine" role="dialog" aria-label="${esc(name)}">
      <div class="dialog-head"><span>${esc(name)}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body">
        <div class="rstat ${r.running ? "run" : r.off ? "off" : ""}"><ha-icon icon="${r.running ? "mdi:progress-clock" : r.off ? "mdi:pause-circle-outline" : "mdi:check-circle-outline"}"></ha-icon><span>${r.running ? "läuft gerade" : r.off ? "ausgeschaltet" : "bereit"} · zuletzt ${esc(r.lastText)}</span></div>
        <div class="btns">
          <button data-r="run" class="primary"><ha-icon icon="mdi:play"></ha-icon> ${auto ? "Jetzt auslösen" : "Starten"}</button>
          ${r.running && !auto ? `<button data-r="stop"><ha-icon icon="mdi:stop"></ha-icon> Stoppen</button>` : ""}
          ${auto ? `<button data-r="toggle">${r.off ? "Einschalten" : "Ausschalten"}</button>` : ""}
          ${admin && r.trace ? `<button data-r="trace"><ha-icon icon="mdi:timeline-text-outline"></ha-icon> Ablauf ansehen</button>` : ""}
          ${admin && r.edit ? `<button data-r="edit"><ha-icon icon="mdi:pencil"></ha-icon> Bearbeiten</button>` : ""}
          <button data-r="info">Details</button>
        </div>
      </div></div>`;
    const go = (path) => {
      this._closeDialog();
      history.pushState(null, "", path);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
    };
    const svc = (domain, service) => this._hass.callService(domain, service, { entity_id: entityId }).then(() => this._closeDialog()).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    el.querySelector('[data-r="run"]').addEventListener("click", () => {
      this._closeDialog();
      this._runAction(entityId, { source: "wheel", name, quiet: false });
    });
    el.querySelector('[data-r="stop"]')?.addEventListener("click", () => svc("script", "turn_off"));
    el.querySelector('[data-r="toggle"]')?.addEventListener("click", () => svc("automation", r.off ? "turn_on" : "turn_off"));
    el.querySelector('[data-r="trace"]')?.addEventListener("click", () => go(r.trace));
    el.querySelector('[data-r="edit"]')?.addEventListener("click", () => go(r.edit));
    el.querySelector('[data-r="info"]').addEventListener("click", () => {
      this._closeDialog();
      this._moreInfo(entityId);
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  },
};

export const MEDIA_STYLE = `
.rp-media { display: grid; gap: 6px; margin: 6px 0; }
.rp-media .mp, .rp-media .vac { border: 1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius: 10px; padding: 6px 8px; }
.rp-media .on { border-color: var(--primary-color, #03a9f4); }
.rp-media .err { border-color: var(--error-color, #db4437); }
.rp-media .mtop { display: flex; align-items: center; gap: 8px; }
.rp-media .mt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.rp-media .mt b, .rp-media .mt span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-media .mt span { font-size: 12px; color: var(--secondary-text-color); }
.rp-media .mrow { display: flex; align-items: center; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.rp-media .mrow input[type=range] { flex: 1; min-width: 80px; }
.rp-media .mrow button:not(.icon) { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; min-height: 36px; padding: 0 10px; border-radius: 18px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: transparent; color: inherit; cursor: pointer; }
.rp-media [hidden] { display: none !important; }
.rp-media .camthumb { position: relative; padding: 0; border: 0; border-radius: 10px; overflow: hidden; cursor: pointer; background: #000; min-height: 60px; }
.rp-media .camthumb img { display: block; width: 100%; max-height: 160px; object-fit: cover; }
.rp-media .camthumb span { position: absolute; left: 6px; bottom: 4px; color: #fff; font-size: 12px; text-shadow: 0 1px 2px #000; }
.camdlg { width: min(720px, calc(100vw - 24px)); }
.camdlg .cam { background: #000; border-radius: 10px; overflow: hidden; aspect-ratio: 16 / 9; display: grid; place-items: center; }
.camdlg .cam img { width: 100%; height: 100%; object-fit: contain; }
.camdlg .camoff { color: #ccc; }
.camdlg.ring { box-shadow: 0 0 0 4px var(--warning-color, #ff9800), 0 8px 32px rgba(0,0,0,.4); }
.camdlg .bellrow { display: grid; gap: 4px; font-size: 12px; color: var(--secondary-text-color); margin-top: 8px; }
.camdlg .bellrow input { font: inherit; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: transparent; color: var(--primary-text-color); }
.routine .rstat { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.routine .rstat.run ha-icon { color: var(--primary-color, #03a9f4); animation: h3dspin 1.5s linear infinite; }
.routine .rstat.off { color: var(--secondary-text-color); }
.wheel .bub .sub { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); font-size: 10px; white-space: nowrap; background: var(--card-background-color, #fff); color: var(--secondary-text-color); border-radius: 6px; padding: 0 4px; pointer-events: none; }
.wheel .bub.run::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 3px solid transparent; border-top-color: var(--primary-color, #03a9f4); animation: h3dspin 1s linear infinite; }
.wheel .bub.off { opacity: calc(var(--o, 1) * .55); }
@keyframes h3dspin { to { transform: rotate(360deg); } }
`;
