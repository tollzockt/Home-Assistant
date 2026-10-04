// Dialoge des Panels (Einstellungen, Karten, Kurzwahl, Funktionen, Raumgeräte, Daten, Hinweise).
// Als Methoden-Sammlung, die in Haus3DPanel eingemischt wird (this = Panel).

// Haus 3D – Panel für die Home-Assistant-Seitenleiste.

import * as THREE from "./vendor/three.module.min.js";
import {
  displayKind,
  roomEntities,
  coverClosedFraction,
  domainOf,
  energyValues,
  entitiesByArea,
  buildingIcons,
  buildingLinks,
  iconKind,
  isOpen,
  placesOf,
  roomClimate,
  roomLit,
  roomHeating,
  roomPower,
  VIEW_MODES,
  viewColor,
  dewPoint,
  ventAdvice,
  agoText,
  persons,
  roomPresence,
  groupRoomEntities,
  roomActions,
  stepTarget,
  temperatureColor,
  watchedEntities,
} from "./devices.js";
import { ROOF_TYPES, roofSettings, weatherEntity, weatherKind } from "./exterior.js";
import { exportFile, normalize, parseImport } from "./model.js";
import { SIM_WEATHER, Simulator } from "./sim.js";
import { FUNCTION_KEYS, LEGACY_FUNCTION_KEYS, MAX_CARDS, WHEEL_VISIBLE, labelPlace, nextStyle, migrateView, nextView, normalizeCards, normalizeFunctions, rotateWheel, wheelLayout, wheelPlusAngle } from "./hud.js";
import { entityAction } from "./actions.js";
import { entityPlaces, houseStatus, statusChips } from "./status.js";
import { ALERT_DEFAULTS, evaluateAlerts, exteriorOpenings, normalizeAlerts, visibleAlerts } from "./alerts.js";
import { QUALITY_CHOICES, adaptDpr, resolveQuality } from "./perf.js";
import { HouseScene } from "./scene.js";
import { closeGaps } from "./walls.js";
import { EDITOR_STYLE, FloorEditor } from "./editor.js";
import { PANEL_STYLE } from "./panel-style.js";

import { LONG_PRESS_MS, esc, plural, ENERGY_CORE, energyRows, LAYERS, DEFAULT_SETTINGS, loadSettings, fmt, ICONS, CONTACT_ICONS, DOMAIN_ICONS, SENSOR_ICONS, fmtPower, setText, iconFor, isActive } from "./panel-util.js";

export const DialogMethods = {
  /** Dialog statt „Weitere Infos“: Zustand des Geräts in der Simulation setzen. */
  _simDialog(entityId) {
    this._closeDialog();
    const st = this._hass.states[entityId];
    const domain = domainOf(entityId);
    const name = st?.attributes?.friendly_name ?? entityId;
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const onOff = ["light", "switch", "fan", "input_boolean", "binary_sensor", "automation", "siren", "humidifier"].includes(domain);
    const cls = st?.attributes?.device_class;
    const labels = domain === "binary_sensor" && ["window", "door", "opening", "garage_door"].includes(cls) ? ["Offen", "Zu"] : ["An", "Aus"];
    let body = "";
    if (onOff) body = `<div class="btns"><button data-set="on" class="${st?.state === "on" ? "primary" : ""}">${labels[0]}</button><button data-set="off" class="${st?.state !== "on" ? "primary" : ""}">${labels[1]}</button></div>`;
    else if (domain === "cover") body = `<div class="btns"><button data-svc="open_cover">Auf</button><button data-svc="close_cover">Zu</button></div><div class="row"><span>Position</span><input type="range" min="0" max="100" step="5" data-pos value="${st?.attributes?.current_position ?? (st?.state === "open" ? 100 : 0)}"><span class="pv">${st?.attributes?.current_position ?? ""} %</span></div>`;
    else if (domain === "lock") body = `<div class="btns"><button data-svc="unlock">Aufschließen</button><button data-svc="lock">Abschließen</button></div>`;
    else if (domain === "climate") body = `<div class="row"><span>Soll</span><input type="number" step="0.5" data-temp value="${st?.attributes?.temperature ?? 21}"><button data-act="temp">Setzen</button></div>`;
    else body = `<div class="row"><input type="${/^-?\d+(\.\d+)?$/.test(st?.state ?? "") ? "number" : "text"}" step="any" data-val value="${esc(st?.state ?? "")}"><button data-act="val">Setzen</button></div>`;
    el.innerHTML = `<div class="dialog simdlg" role="dialog" aria-label="Simulation">
      <div class="dialog-head"><span>${esc(name)}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body"><p class="hint">Simulation: ${esc(entityId)} ist gerade „${esc(st?.state ?? "unbekannt")}“. Änderungen bleiben in der Simulation.</p>${body}</div></div>`;
    const done = () => {
      this._simChanged();
      this._closeDialog();
    };
    el.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => {
      this._sim.set(entityId, b.dataset.set, {}, st);
      done();
    }));
    el.querySelectorAll("[data-svc]").forEach((b) => b.addEventListener("click", () => this._hass.callService(domain, b.dataset.svc, { entity_id: entityId }).then(() => this._closeDialog())));
    el.querySelector("[data-pos]")?.addEventListener("change", (ev) => this._hass.callService("cover", "set_cover_position", { entity_id: entityId, position: Number(ev.target.value) }).then(() => this._closeDialog()));
    el.querySelector("[data-act=temp]")?.addEventListener("click", () => this._hass.callService("climate", "set_temperature", { entity_id: entityId, temperature: Number(el.querySelector("[data-temp]").value) }).then(() => this._closeDialog()));
    el.querySelector("[data-act=val]")?.addEventListener("click", () => {
      this._sim.set(entityId, el.querySelector("[data-val]").value, {}, st);
      done();
    });
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  /** Liste aller Hinweise mit „Zeigen“ und „Ausblenden“. */
  _alertsPopup() {
    this._closePopup();
    const list = this._visibleAlerts ?? [];
    const el = document.createElement("div");
    el.className = "popup statuspop alertpop";
    el.innerHTML = `<div class="head">Hinweise (${list.length})</div><div class="scroll">${list.map((a, i) => `<div class="item ${a.level}"><ha-icon icon="${esc(a.icon)}"></ha-icon><span></span>${a.roomId ? `<button data-show="${i}">Zeigen</button>` : ""}<button data-ack="${i}">Ausblenden</button></div>`).join("") || `<div class="item"><span>Keine Hinweise.</span></div>`}</div>`;
    el.querySelectorAll(".item span").forEach((sp, i) => list[i] && (sp.textContent = list[i].text));
    el.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => this._showAlert(list[Number(b.dataset.show)])));
    el.querySelectorAll("[data-ack]").forEach((b) => b.addEventListener("click", () => this._ackAlert(list[Number(b.dataset.ack)])));
    el.addEventListener("click", (ev) => ev.stopPropagation());
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  /** Liste zu einem Chip: nach Etage, Tipp springt zum Raum; bei Lichtern „Alle Lichter aus“. */
  _statusPopup(key) {
    this._closePopup();
    const st = this._status;
    if (!st) return;
    const hass = this._hass;
    const list = key === "lights" ? st.lights : key === "open" ? st.open.filter((o) => o.kind !== "garage") : key === "garage" ? st.open.filter((o) => o.kind === "garage") : key === "locks" ? st.unlocked : key === "alarm" && st.alarm ? [st.alarm] : [];
    const title = { lights: "Licht an", open: "Offen", garage: "Tore offen", locks: "Schlösser offen", alarm: "Alarmanlage", ok: "Alles zu" }[key];
    const el = document.createElement("div");
    el.className = "popup statuspop";
    const floors = [...(this._building.floors ?? [])].sort((a, b) => b.elevation - a.elevation);
    let html = `<div class="head">${esc(title)} (${list.length})</div><div class="scroll">`;
    for (const f of floors) {
      const items = list.filter((x) => x.floorId === f.id);
      if (!items.length) continue;
      html += `<div class="sub">${esc(f.name)}</div>`;
      for (const it of items) {
        const room = placesOf(f).find((r) => r.id === it.roomId);
        const name = hass.states[it.entity_id]?.attributes?.friendly_name ?? it.entity_id;
        html += `<button data-floor="${esc(f.id)}" data-room="${esc(it.roomId ?? "")}" data-entity="${esc(it.entity_id)}"><span>${esc(room?.name ?? "")} · ${esc(name)}${it.state === "tilted" ? " (gekippt)" : ""}</span></button>`;
      }
    }
    if (!list.length) html += `<div class="item"><span>Alle Fenster, Türen und Schlösser sind zu.</span></div>`;
    html += `</div>`;
    if (key === "lights" && list.length) html += `<div class="foot"><button class="alloff"><ha-icon icon="mdi:lightbulb-off-outline"></ha-icon><span>Alle Lichter aus</span></button></div>`;
    el.innerHTML = html;
    el.querySelectorAll("[data-entity]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._closePopup();
      if (b.dataset.room) {
        this._setFilter(b.dataset.floor);
        this._selectRoom({ floorId: b.dataset.floor, roomId: b.dataset.room });
      } else this._moreInfo(b.dataset.entity);
    }));
    el.querySelector(".alloff")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._closePopup();
      hass.callService("light", "turn_off", { entity_id: list.map((x) => x.entity_id) }).then(() => this._toast(`${list.length} Lichter aus`)).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
    });
    el.addEventListener("click", (ev) => ev.stopPropagation());
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  _openSettings() {
    this._closePopup();
    this._closeDialog();
    const st = this._settings;
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `
      <div class="dialog" role="dialog" aria-label="Einstellungen">
        <div class="dialog-head"><span>Einstellungen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <h4>Darstellung</h4>
          <div class="seg" data-key="style">
            <button data-value="auto">Auto</button><button data-value="day">Tag</button><button data-value="night">Nacht</button><button data-value="cyber">Cyberpunk</button>
          </div>
          <h4>Qualität</h4>
          <div class="seg" data-key="quality">${QUALITY_CHOICES.map(([k, n]) => `<button data-value="${k}">${n}</button>`).join("")}</div>
          <label class="chkrow"><input type="checkbox" data-perfhud${st.perfHud ? " checked" : ""}> Leistungsanzeige (Bilder/s)</label>
          <p class="hint">Automatisch: am Tablet ausgewogen, die Auflösung passt sich der Rechenleistung an. „Akku“ zeichnet am sparsamsten.</p>
          <h4>Geräte anzeigen als</h4>
          <div class="seg" data-key="deviceMode">
            <button data-value="icons">Symbole</button><button data-value="3d">3D-Objekte</button>
          </div>
          <h4>Einblenden</h4>
          <div class="toggles">
            ${LAYERS.map(([k, name]) => `<label><input type="checkbox" data-layer="${k}"${st.layers[k] !== false ? " checked" : ""}><span>${name}</span></label>`).join("")}
          </div>
          <p class="hint">Darstellung und Einblenden gelten für dieses Gerät/diesen Browser.</p>
          <h4>Simulation</h4>
          <p class="hint">Zum Ausprobieren: Schalten, Wetter, Tag/Nacht und Solarleistung werden nur simuliert, nichts geht an echte Geräte, der Grundriss wird nicht gespeichert.</p>
          <div class="btns"><button class="simtoggle${this._sim ? "" : " primary"}">${this._sim ? "Simulation beenden" : "Simulation starten"}</button></div>
          ${this._hass?.user?.is_admin ? `<h4>Haus & Wetter (für alle)</h4><div class="house-cfg"></div><h4>Hinweise (für alle)</h4><div class="alerts-cfg"></div><h4>Energie-Anzeige (für alle)</h4><div class="energy-cfg"></div>` : ""}
        </div>
      </div>`;
    const syncSeg = () => {
      for (const seg of el.querySelectorAll(".seg")) for (const b of seg.querySelectorAll("button")) b.classList.toggle("sel", st[seg.dataset.key] === b.dataset.value);
    };
    syncSeg();
    for (const seg of el.querySelectorAll(".seg")) {
      seg.addEventListener("click", (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        st[seg.dataset.key] = b.dataset.value;
        syncSeg();
        this._saveSettings();
        if (seg.dataset.key === "style") this._applyStyle();
        else if (seg.dataset.key === "quality") this._applyQuality();
        else this._refreshEntities();
      });
    }
    for (const box of el.querySelectorAll("input[data-layer]")) {
      box.addEventListener("change", () => {
        st.layers[box.dataset.layer] = box.checked;
        this._saveSettings();
        this._scene?.setLayers(st.layers);
        this._applyOverlayLayers();
      });
    }
    el.querySelector("[data-perfhud]").addEventListener("change", (ev) => {
      st.perfHud = ev.target.checked;
      this._saveSettings();
      this._applyQuality();
    });
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    el.querySelector(".simtoggle").addEventListener("click", () => {
      this._closeDialog();
      this._setSim(!this._sim);
    });
    const cfg = el.querySelector(".energy-cfg");
    if (cfg) this._renderEnergyConfig(cfg);
    const house = el.querySelector(".house-cfg");
    if (house) this._renderHouseConfig(house);
    const al = el.querySelector(".alerts-cfg");
    if (al) this._renderAlertsConfig(al);
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  /** Dach (Form, Neigung, Überstand, Firstrichtung) und Wetter-Entität. */
  _renderHouseConfig(box) {
    const hass = this._hass;
    const roof = roofSettings(this._building?.settings);
    const weather = this._building?.settings?.weather ?? "";
    const weathers = Object.keys(hass.states).filter((id) => id.startsWith("weather.")).sort();
    const pvItems = (roof.items ?? []).some((it) => it?.type === "pv");
    box.innerHTML = `
      <label class="en-row"><span>Dach</span><select data-r="type">${ROOF_TYPES.map(([k, n]) => `<option value="${k}"${k === roof.type ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="en-row"><span>Neigung (°)</span><input data-r="pitch" type="number" min="5" max="60" step="1" value="${roof.pitch}"></label>
      <label class="en-row"><span>Überstand (m)</span><input data-r="overhang" type="number" min="0" max="1.5" step="0.05" value="${roof.overhang}"></label>
      <label class="en-row"><span>Dachfarbe</span><input type="color" data-rc value="${/^#[0-9a-f]{6}$/i.test(roof.color ?? "") ? roof.color : "#9a4a36"}"><button class="rc-reset" title="Standardfarbe">Standard</button></label>
      <div class="swatches">${["#9a4a36", "#b5523b", "#6e2f25", "#4a3b32", "#3a3d42", "#23262b", "#5f6670", "#8c8f94", "#2f4f3f", "#3f5a78"].map((c) => `<button data-rcs="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div>
      <label class="en-row"><span>Flügel-Ende</span><select data-r="wing_end"><option value="gable"${roof.wing_end !== "hip" ? " selected" : ""}>Giebel</option><option value="hip"${roof.wing_end === "hip" ? " selected" : ""}>Walm (abgeschrägt)</option></select></label>
      <label class="en-row"><span>First</span><select data-r="direction">${[["auto", "lange Seite"], ["x", "Ost–West im Plan"], ["z", "Nord–Süd im Plan"]].map(([k, n]) => `<option value="${k}"${k === roof.direction ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="en-row" title="Ab dieser Luftfeuchte warnt Haus 3D (Raumfenster, Bodenfarbe, Hinweise)"><span>Feuchte-Warnung ab (%)</span><input data-hummax type="number" min="40" max="90" step="1" value="${Number(this._building?.settings?.climate?.humidity_max) || 65}"></label>
      <label class="en-row" title="Haustür aufschließen, Garagentor öffnen/schließen, Sirene einschalten"><span>Nachfragen</span><span class="chk"><input type="checkbox" data-safety${this._building?.settings?.safety?.confirm === false ? "" : " checked"}> bei Schloss, Garagentor, Sirene</span></label>
      <label class="en-row"><span>Wetter</span><select data-w>
        <option value=""${weather === "" ? " selected" : ""}>automatisch${weathers[0] ? ` (${esc(weathers[0])})` : ""}</option>
        <option value="none"${weather === "none" ? " selected" : ""}>kein Wetter</option>
        ${weathers.map((id) => `<option value="${esc(id)}"${id === weather ? " selected" : ""}>${esc(hass.states[id].attributes.friendly_name ?? id)}</option>`).join("")}
      </select></label>
      ${pvItems ? `<p class="hint">PV, Kamin und Dachfenster sitzen frei verschiebbar auf dem Dach: Bearbeiten → Ebene „Dach“.</p>` : `<p class="hint">Genauer und verschiebbar: Bearbeiten → Ebene „Dach“ (dort lässt sich diese PV übernehmen).</p>`}
      <div class="pvlegacy"${pvItems ? " hidden" : ""}>
      <h4>PV auf dem Dach (Anzahl Module je Richtung)</h4>
      <div class="pvrow">${[["E", "Ost"], ["S", "Süd"], ["W", "West"], ["N", "Nord"]].map(([k, n]) => `<label><span>${n}</span><input type="number" min="0" max="60" step="1" data-pv="${k}" value="${Number(roof.solar?.[k]) || 0}"></label>`).join("")}</div>
      <h4>PV-Felder (genaue Anordnung, ersetzt die Anzahl oben)</h4>
      <div class="pvarrays"></div>
      <div class="btns"><button class="pvadd">+ PV-Feld</button></div>
      </div>
      <label class="en-row"><span>Norden</span><select data-north>${[[0, "oben im Plan"], [90, "rechts im Plan"], [180, "unten im Plan"], [270, "links im Plan"]].map(([v, n]) => `<option value="${v}"${Number(this._building?.settings?.north ?? 0) === v ? " selected" : ""}>${n}</option>`).join("")}${[0, 90, 180, 270].includes(Number(this._building?.settings?.north ?? 0)) ? "" : `<option value="${this._building.settings.north}" selected>${this._building.settings.north}°</option>`}</select></label>
      <p class="hint">Das Dach erscheint nur in der Ansicht „Alle“. Wählt man eine Etage, schaut man hinein. Module liegen auf den Dachflächen, die in die Richtung zeigen (L-Dach: Hauptdach und Flügel).</p>
      <div class="btns"><button class="house-save primary">Speichern</button></div>`;
    // PV-Felder: Richtung, Spalten × Reihen, hoch/quer, Abstand von links (von außen gesehen), ab Reihe
    const arrays = structuredClone(roof.solar_arrays ?? []);
    const arrBox = box.querySelector(".pvarrays");
    const dirs = [["S", "Süd"], ["E", "Ost"], ["W", "West"], ["N", "Nord"]];
    const drawArrays = () => {
      arrBox.innerHTML = (arrays.length ? `<div class="pvarr head"><span>Richtung</span><span>Spalten</span><span>Reihen</span><span>Lage</span><span>von links (m)</span><span>ab Reihe</span><span></span></div>` : `<p class="hint">Keine Felder: Module werden nach der Anzahl je Richtung verteilt.</p>`) +
        arrays.map((a, i) => `<div class="pvarr" data-i="${i}"><select data-k="dir">${dirs.map(([k, n]) => `<option value="${k}"${k === a.dir ? " selected" : ""}>${n}</option>`).join("")}</select><input type="number" min="1" max="20" data-k="cols" value="${a.cols ?? 2}"><input type="number" min="1" max="10" data-k="rows" value="${a.rows ?? 1}"><select data-k="orient"><option value="portrait"${a.orient !== "landscape" ? " selected" : ""}>hoch</option><option value="landscape"${a.orient === "landscape" ? " selected" : ""}>quer</option></select><input type="number" min="0" step="0.1" data-k="left" value="${a.left ?? 0.3}"><input type="number" min="0" max="10" data-k="row" value="${a.row ?? 0}"><button class="icon" data-rm="${i}" title="Feld entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("");
      arrBox.querySelectorAll(".pvarr[data-i] [data-k]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const a = arrays[Number(inp.closest(".pvarr").dataset.i)];
          a[inp.dataset.k] = inp.tagName === "SELECT" ? inp.value : Number(inp.value);
        }),
      );
      arrBox.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        arrays.splice(Number(b.dataset.rm), 1);
        drawArrays();
      }));
    };
    drawArrays();
    box.querySelector(".pvadd").addEventListener("click", () => {
      arrays.push({ dir: "S", cols: 3, rows: 2, orient: "portrait", left: 0.3, row: 0 });
      drawArrays();
    });
    let roofColor = roof.color ?? null;
    const colorInput = box.querySelector("[data-rc]");
    colorInput.addEventListener("input", () => (roofColor = colorInput.value));
    box.querySelector(".rc-reset").addEventListener("click", () => (roofColor = null));
    box.querySelectorAll("[data-rcs]").forEach((b) =>
      b.addEventListener("click", () => {
        roofColor = b.dataset.rcs;
        colorInput.value = roofColor;
      }),
    );
    box.querySelector(".house-save").addEventListener("click", () => {
      const next = { ...(this._building?.settings?.roof ?? {}) };
      if (roofColor) next.color = roofColor;
      else delete next.color;
      if (!pvItems) next.solar = Object.fromEntries([...box.querySelectorAll("[data-pv]")].map((i) => [i.dataset.pv, Math.max(0, Math.round(Number(i.value) || 0))]));
      if (!pvItems) next.solar_arrays = arrays.map((a) => ({ dir: a.dir ?? "S", cols: Math.max(1, Math.round(a.cols ?? 1)), rows: Math.max(1, Math.round(a.rows ?? 1)), orient: a.orient === "landscape" ? "landscape" : "portrait", left: Math.max(0, Number(a.left) || 0), row: Math.max(0, Math.round(a.row ?? 0)) }));
      for (const inp of box.querySelectorAll("[data-r]")) next[inp.dataset.r] = inp.type === "number" ? Number(inp.value) : inp.value;
      const w = box.querySelector("[data-w]").value;
      const r = roofSettings({ roof: next }); // begrenzt Neigung und Überstand
      const roof = { ...next, type: r.type, pitch: r.pitch, overhang: r.overhang, direction: r.direction };
      const safety = { ...(this._building?.settings?.safety ?? {}), confirm: box.querySelector("[data-safety]").checked };
      const hm = Math.round(Number(box.querySelector("[data-hummax]").value));
      const climate = { ...(this._building?.settings?.climate ?? {}), humidity_max: Number.isFinite(hm) ? Math.min(90, Math.max(40, hm)) : 65 };
      this._saveBuildingSettings({ roof, weather: w || null, north: Number(box.querySelector("[data-north]").value) || 0, safety, climate }, "Dach und Wetter gespeichert.");
    });
  },

  /** Hinweise einstellen (für alle). */
  _renderAlertsConfig(box) {
    const c = normalizeAlerts(this._building?.settings?.alerts);
    const chk = (k, text) => `<label class="chkrow"><input type="checkbox" data-ab="${k}"${c[k] ? " checked" : ""}> ${text}</label>`;
    const numf = (k, text) => `<label class="en-row"><span>${text}</span><input type="number" min="0" max="1440" step="1" data-an="${k}" value="${c[k]}"></label>`;
    box.innerHTML = `${chk("rain_open", "Regen/Schnee und offene Fenster")}${chk("rain_tilted", "… auch gekippte Fenster")}${chk("safety", "Rauch-, Wasser- und Gasmelder")}${chk("heat_open", "Heizung bei offenem Fenster")}${chk("humidity", "Hohe Luftfeuchte (Grenze bei Haus & Wetter)")}
      ${numf("door_open_min", "Haustür offen länger als (min)")}${numf("garage_open_min", "Garage offen länger als (min)")}${numf("heating_open_min", "Heizung + offenes Fenster nach (min)")}${numf("akku_min", "Akku unter (%)")}
      <p class="hint">0 schaltet eine Regel aus. Hinweise erscheinen nur, solange Haus 3D geöffnet ist – für Nachrichten aufs Handy HA-Automationen nutzen.</p>
      <div class="btns"><button class="alerts-save primary">Speichern</button></div>`;
    box.querySelector(".alerts-save").addEventListener("click", () => {
      const next = {};
      box.querySelectorAll("[data-ab]").forEach((i) => (next[i.dataset.ab] = i.checked));
      box.querySelectorAll("[data-an]").forEach((i) => (next[i.dataset.an] = Number(i.value)));
      this._saveBuildingSettings({ alerts: normalizeAlerts(next) }, "Hinweise gespeichert.");
    });
  },

  /** Energie-Anzeige einstellen: feste Werte des Balkonkraftwerks und zusätzliche Entitäten. */
  _renderEnergyConfig(box) {
    const hass = this._hass;
    const energy = structuredClone(this._building?.settings?.energy ?? {});
    energy.extra = [...(energy.extra ?? [])].map((x) => (typeof x === "string" ? { entity: x } : x));
    const opts = `<datalist id="en-all">${Object.keys(hass.states).filter((id) => /^(sensor|binary_sensor|input_number|number)\./.test(id)).sort().map((id) => `<option value="${esc(id)}">${esc(hass.states[id].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>`;
    const render = () => {
      box.innerHTML = `${ENERGY_CORE.map(([k, , name]) => `<label class="en-row"><span>${name}</span><input list="en-all" data-core="${k}" value="${esc(energy[k] ?? "")}" placeholder="– keine –"></label>`).join("")}
        ${energy.extra.map((x, i) => `<div class="en-row"><input data-extra-name="${i}" value="${esc(x.name ?? "")}" placeholder="Name"><input list="en-all" data-extra="${i}" value="${esc(x.entity ?? "")}"><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
        ${opts}
        <div class="btns"><button class="en-add">+ Wert hinzufügen</button><button class="en-save primary">Speichern</button></div>`;
      box.querySelectorAll("[data-core]").forEach((i) => i.addEventListener("change", () => (energy[i.dataset.core] = i.value.trim() || null)));
      box.querySelectorAll("[data-extra]").forEach((i) => i.addEventListener("change", () => (energy.extra[Number(i.dataset.extra)].entity = i.value.trim())));
      box.querySelectorAll("[data-extra-name]").forEach((i) => i.addEventListener("change", () => (energy.extra[Number(i.dataset.extraName)].name = i.value.trim() || undefined)));
      box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        energy.extra.splice(Number(b.dataset.rm), 1);
        render();
      }));
      box.querySelector(".en-add").addEventListener("click", () => {
        energy.extra.push({ entity: "" });
        render();
      });
      box.querySelector(".en-save").addEventListener("click", async () => {
        const building = structuredClone(this._building);
        building.settings.energy = { ...energy, extra: energy.extra.filter((x) => x.entity) };
        try {
          const res = await hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
          this._setBuilding(res.building, res.revision, { keepCamera: true });
          this._toast("Energie-Anzeige gespeichert.");
        } catch (err) {
          this._toast(`Speichern fehlgeschlagen: ${err.message ?? err.code}`);
        }
      });
    };
    render();
  },

  /** Geräte eines Raums anpassen: Bereichsgeräte ein-/ausblenden, beliebige Entitäten hinzufügen. */
  _customizeRoom(p, room) {
    const hass = this._hass;
    p.editing = true;
    p.rows = null; // danach neu aufbauen
    const areaIds = room.area_id ? this._byArea.get(room.area_id) ?? [] : [];
    const hidden = new Set(room.hidden_entities ?? []);
    const extra = [...(room.panel ?? [])];
    const name = (id) => hass.states[id]?.attributes.friendly_name ?? id;
    const render = () => {
      p.el.innerHTML = `<div class="rp-head"><ha-icon class="grip" icon="mdi:drag"></ha-icon><b>Geräte: ${esc(room.name)}</b></div>
        <div class="rp-sub">Haken = im Modell und im Raumfenster anzeigen.</div>
        <div class="rp-list">
          ${areaIds.map((id) => `<label class="rp-check"><input type="checkbox" data-id="${esc(id)}"${hidden.has(id) ? "" : " checked"}><span>${esc(name(id))}<small>${esc(id)}</small></span></label>`).join("") || `<div class="rp-empty">Kein Bereich zugeordnet.</div>`}
          ${extra.map((id, i) => `<div class="rp-check"><ha-icon icon="mdi:plus-circle-outline"></ha-icon><span>${esc(name(id))}<small>${esc(id)}</small></span><button class="icon rm" data-i="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
        </div>
        <div class="rp-add"><input list="rp-all" placeholder="Entität hinzufügen …"><datalist id="rp-all">${Object.keys(hass.states).sort().map((id) => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("")}</datalist><button class="add">+</button></div>
        <div class="rp-btns"><button class="cancel">Abbrechen</button><button class="save primary">Speichern</button></div>`;
      p.el.querySelectorAll("input[type=checkbox]").forEach((c) => c.addEventListener("change", () => (c.checked ? hidden.delete(c.dataset.id) : hidden.add(c.dataset.id))));
      p.el.querySelectorAll(".rm").forEach((b) => b.addEventListener("click", () => {
        extra.splice(Number(b.dataset.i), 1);
        render();
      }));
      const input = p.el.querySelector(".rp-add input");
      const add = () => {
        const id = input.value.trim();
        if (!hass.states[id]) {
          this._toast("Diese Entität gibt es nicht.");
          return;
        }
        if (areaIds.includes(id)) hidden.delete(id);
        else if (!extra.includes(id)) extra.push(id);
        render();
      };
      p.el.querySelector(".add").addEventListener("click", add);
      input.addEventListener("keydown", (ev) => ev.key === "Enter" && add());
      p.el.querySelector(".cancel").addEventListener("click", () => {
        p.editing = false;
        this._renderRoomPanel();
      });
      p.el.querySelector(".save").addEventListener("click", async () => {
        const building = structuredClone(this._building);
        for (const f of building.floors) {
          for (const r of [...f.rooms, ...(f.outdoor ?? [])]) {
            if (r.id !== room.id) continue;
            r.hidden_entities = [...hidden];
            r.panel = extra;
          }
        }
        try {
          const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
          p.editing = false;
          this._setBuilding(res.building, res.revision, { keepCamera: true });
          this._toast("Geräte gespeichert.");
        } catch (err) {
          this._toast(err.code === "conflict" ? "Der Stand wurde inzwischen geändert. Seite neu laden." : `Speichern fehlgeschlagen: ${err.message ?? err.code}`);
        }
      });
    };
    render();
  },

  /** Karte anlegen oder anpassen: Titel, Symbol, Werte (Entität + Name). id = null: neue Karte. */
  _cardDialog(id) {
    this._closeDialog();
    const hass = this._hass;
    const all = normalizeCards(this._building?.settings?.cards);
    const card = structuredClone(all.find((c) => c.id === id) ?? { id: `karte_${Date.now().toString(36)}`, title: "Neue Karte", icon: "mdi:card-text-outline", entities: [] });
    const icons = ["mdi:card-text-outline", "mdi:fire", "mdi:radiator", "mdi:water-boiler", "mdi:thermometer", "mdi:washing-machine", "mdi:server", "mdi:pool", "mdi:car-electric", "mdi:battery-charging", "mdi:weather-partly-cloudy", "mdi:home-automation"];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const render = () => {
      el.innerHTML = `<div class="dialog qedit" role="dialog" aria-label="Karte">
        <div class="dialog-head"><span>${id ? "Karte anpassen" : "Neue Karte"}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <h4>Titel</h4><div class="qrow"><input class="ttl" value="${esc(card.title)}"></div>
          <h4>Symbol</h4><div class="qrow" style="flex-wrap:wrap">${icons.map((ic) => `<button class="icon ${ic === card.icon ? "on" : ""}" data-icon="${ic}" title="${ic}" style="${ic === card.icon ? "background:var(--primary-color,#03a9f4);color:#fff" : ""}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}</div>
          <h4>Werte</h4>
          ${card.entities.map((e, i) => `<div class="qrow"><input class="nm" data-name="${i}" value="${esc(e.name ?? "")}" placeholder="Name"><input list="card-ents" data-ent="${i}" value="${esc(e.entity)}" placeholder="Entität"><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
          <datalist id="card-ents">${Object.keys(hass.states).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
          <div class="btns"><button class="addv">+ Wert</button></div>
          <div class="btns">${id ? `<button class="del">Karte löschen</button>` : ""}<button class="save primary">Speichern</button></div>
        </div></div>`;
      const sync = () => {
        card.title = el.querySelector(".ttl").value.trim() || card.title;
        el.querySelectorAll("[data-ent]").forEach((i) => (card.entities[Number(i.dataset.ent)].entity = i.value.trim()));
        el.querySelectorAll("[data-name]").forEach((i) => (card.entities[Number(i.dataset.name)].name = i.value.trim() || undefined));
      };
      el.querySelectorAll("[data-icon]").forEach((b) => b.addEventListener("click", () => {
        sync();
        card.icon = b.dataset.icon;
        render();
      }));
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        card.entities.splice(Number(b.dataset.rm), 1);
        render();
      }));
      el.querySelector(".addv").addEventListener("click", () => {
        sync();
        card.entities.push({ entity: "" });
        render();
      });
      el.querySelector(".del")?.addEventListener("click", () => {
        this._closeDialog();
        this._saveBuildingSettings({ cards: all.filter((c) => c.id !== id) }, "Karte gelöscht.");
      });
      el.querySelector(".save").addEventListener("click", () => {
        sync();
        card.entities = card.entities.filter((e) => e.entity.includes("."));
        const next = id ? all.map((c) => (c.id === id ? card : c)) : [...all, card];
        this._closeDialog();
        this._saveBuildingSettings({ cards: next.slice(0, MAX_CARDS) }, "Karte gespeichert.");
      });
      el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    };
    render();
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  /** Funktionsrad anpassen: eingebaute Umschalter ein-/ausblenden, sortieren, eigene Einträge (Entitäten) hinzufügen. */
  _functionDialog() {
    this._closeDialog();
    const hass = this._hass;
    const builtin = this._builtinFunctions();
    let list = normalizeFunctions(this._building?.settings?.functions, this._building?.settings?.functions_seen ?? LEGACY_FUNCTION_KEYS);
    const domains = ["automation", "script", "scene", "button", "input_button", "switch", "light", "input_boolean", "cover", "lock", "fan"];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const render = () => {
      const missing = FUNCTION_KEYS.filter((k) => !list.some((f) => f.key === k));
      el.innerHTML = `<div class="dialog qedit" role="dialog" aria-label="Funktionen">
        <div class="dialog-head"><span>Funktionen anpassen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <p class="hint">Im Rad sind ${WHEEL_VISIBLE} Einträge zu sehen, weitere werden durchgedreht. Eigene Einträge: Automation auslösen, Skript/Szene starten, sonst umschalten.</p>
          ${list.map((f, i) => `<div class="qrow">${f.key
            ? `<ha-icon icon="${esc(builtin[f.key].icon)}"></ha-icon><span class="fixed">${esc(builtin[f.key].name)}</span>`
            : `<input class="nm" data-name="${i}" value="${esc(f.name ?? "")}" placeholder="Name"><input list="fn-ents" data-ent="${i}" value="${esc(f.entity ?? "")}" placeholder="script.…"><label class="qc" title="Vor dem Ausführen nachfragen"><input type="checkbox" data-cf="${i}"${f.confirm ? " checked" : ""}>Nachfragen</label>`}
            <button class="icon" data-up="${i}" title="nach oben"><ha-icon icon="mdi:arrow-up"></ha-icon></button><button class="icon" data-rm="${i}" title="Ausblenden/Entfernen"><ha-icon icon="mdi:${f.key ? "eye-off-outline" : "delete-outline"}"></ha-icon></button></div>`).join("") || `<p class="hint">Keine Einträge.</p>`}
          <datalist id="fn-ents">${Object.keys(hass.states).filter((x) => domains.includes(x.split(".")[0])).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
          ${missing.length ? `<div class="qrow"><select class="addkey"><option value="">Ausgeblendete wieder zeigen …</option>${missing.map((k) => `<option value="${k}">${esc(builtin[k].name)}</option>`).join("")}</select></div>` : ""}
          <div class="btns"><button class="reset">Standard</button><button class="addq">+ Eigener Eintrag</button><button class="save primary">Speichern</button></div>
        </div></div>`;
      const sync = () => {
        el.querySelectorAll("[data-ent]").forEach((i) => (list[Number(i.dataset.ent)].entity = i.value.trim()));
        el.querySelectorAll("[data-name]").forEach((i) => (list[Number(i.dataset.name)].name = i.value.trim() || undefined));
        el.querySelectorAll("[data-cf]").forEach((i) => (list[Number(i.dataset.cf)].confirm = i.checked || undefined));
      };
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        list.splice(Number(b.dataset.rm), 1);
        render();
      }));
      el.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => {
        sync();
        const i = Number(b.dataset.up);
        if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        render();
      }));
      el.querySelector(".addkey")?.addEventListener("change", (ev) => {
        sync();
        if (ev.target.value) list.push({ key: ev.target.value });
        render();
      });
      el.querySelector(".addq").addEventListener("click", () => {
        sync();
        list.push({ entity: "" });
        render();
      });
      el.querySelector(".reset").addEventListener("click", () => {
        list = normalizeFunctions(null);
        render();
      });
      el.querySelector(".save").addEventListener("click", () => {
        sync();
        this._closeDialog();
        this._saveBuildingSettings({ functions: list.filter((f) => f.key || f.entity?.includes(".")), functions_seen: [...FUNCTION_KEYS] }, "Funktionen gespeichert.");
      });
      el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    };
    render();
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  /** Kurzwahl bearbeiten: Automationen, Skripte, Szenen, Taster, Schalter. */
  _quickDialog() {
    this._closeDialog();
    const hass = this._hass;
    const list = structuredClone(this._building?.settings?.quick ?? []);
    const domains = ["automation", "script", "scene", "button", "input_button", "switch", "light", "input_boolean", "cover", "lock", "fan"];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    const render = () => {
      el.innerHTML = `<div class="dialog qedit" role="dialog" aria-label="Kurzwahl">
        <div class="dialog-head"><span>Kurzwahl</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
        <div class="dialog-body">
          <p class="hint">Antippen löst aus: Automation (trigger), Skript/Szene (starten), Taster (drücken), sonst umschalten. Lange drücken öffnet die Details. Im Rad sind ${WHEEL_VISIBLE} zu sehen, weitere werden durchgedreht.</p>
          ${list.map((q, i) => `<div class="qrow"><input class="nm" data-name="${i}" value="${esc(q.name ?? "")}" placeholder="Name"><input list="quick-ents" data-ent="${i}" value="${esc(q.entity ?? "")}" placeholder="automation.…"><label class="qc" title="Vor dem Ausführen nachfragen"><input type="checkbox" data-cf="${i}"${q.confirm ? " checked" : ""}>Nachfragen</label><button class="icon" data-up="${i}" title="nach oben"><ha-icon icon="mdi:arrow-up"></ha-icon></button><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("") || `<p class="hint">Noch keine Einträge.</p>`}
          <datalist id="quick-ents">${Object.keys(hass.states).filter((x) => domains.includes(x.split(".")[0])).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
          <div class="btns"><button class="addq">+ Eintrag</button><button class="save primary">Speichern</button></div>
        </div></div>`;
      const sync = () => {
        el.querySelectorAll("[data-ent]").forEach((i) => (list[Number(i.dataset.ent)].entity = i.value.trim()));
        el.querySelectorAll("[data-name]").forEach((i) => (list[Number(i.dataset.name)].name = i.value.trim() || undefined));
        el.querySelectorAll("[data-cf]").forEach((i) => (list[Number(i.dataset.cf)].confirm = i.checked || undefined));
      };
      el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        list.splice(Number(b.dataset.rm), 1);
        render();
      }));
      el.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => {
        sync();
        const i = Number(b.dataset.up);
        if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        render();
      }));
      el.querySelector(".addq").addEventListener("click", () => {
        sync();
        list.push({ entity: "" });
        render();
      });
      el.querySelector(".save").addEventListener("click", () => {
        sync();
        this._closeDialog();
        this._saveBuildingSettings({ quick: list.filter((q) => q.entity?.includes(".")) }, "Kurzwahl gespeichert.");
      });
      el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    };
    render();
    el.addEventListener("click", (ev) => {
      if (ev.target === el) this._closeDialog();
    });
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  _toggleMenu() {
    if (this._popup) {
      this._closePopup();
      return;
    }
    const el = document.createElement("div");
    el.className = "popup";
    const entries = [
      ["mdi:download", "Exportieren (JSON)", () => this._export()],
      ["mdi:upload", "Importieren (JSON) …", () => this._els.file.click()],
      ["mdi:content-save-outline", "Stand sichern", () => this._snapshot()],
      ["mdi:history", "Verlauf …", () => this._showHistory()],
    ];
    for (const [icon, text, fn] of entries) {
      const b = document.createElement("button");
      b.innerHTML = `<ha-icon icon="${icon}"></ha-icon><span></span>`;
      b.querySelector("span").textContent = text;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._closePopup();
        fn();
      });
      el.appendChild(b);
    }
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  _export() {
    const blob = new Blob([JSON.stringify(exportFile(this._building), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `haus3d-${new Date().toISOString().slice(0, 10)}.json`;
    this.shadowRoot.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async _importFile() {
    const file = this._els.file.files?.[0];
    this._els.file.value = "";
    if (!file) return;
    let building;
    try {
      building = parseImport(await file.text());
    } catch (err) {
      this._toast(err.message);
      return;
    }
    // Räume mit Spalt dazwischen (Innenmaße statt Wandmitten) ergeben doppelte Außenwände: anbieten zu schließen
    const closed = building.floors.map((f) => closeGaps(f.rooms));
    const gapCount = closed.reduce((n, c) => n + c.gaps.length, 0);
    if (gapCount && (await this._confirm(`Zwischen den Räumen gibt es ${plural(gapCount, "Lücke", "Lücken")} (bis 45 cm). Schließen, damit daraus Innenwände werden?`, "Schließen", { sub: "Wie „Lücken schließen“ in NeonPlan." }))) {
      building.floors.forEach((f, i) => (f.rooms = closed[i].rooms));
    }
    const rooms = building.floors.reduce((n, f) => n + f.rooms.length, 0);
    if (!(await this._confirm(`Grundriss mit ${plural(building.floors.length, "Etage", "Etagen")} und ${plural(rooms, "Raum", "Räumen")} importieren?`, "Importieren", { sub: "Der aktuelle Stand wird vorher im Verlauf gesichert." }))) return;
    try {
      const res = await this._hass.callWS({ type: "haus3d/building/save", building, revision: this._revision });
      this._setBuilding(res.building, res.revision);
      this._toast("Grundriss importiert.");
    } catch (err) {
      if (err.code === "conflict") this._toast("Der Stand wurde inzwischen geändert. Seite neu laden und erneut versuchen.");
      else this._toast(`Import fehlgeschlagen: ${err.message ?? err.code}`);
    }
  },

  async _snapshot() {
    try {
      await this._hass.callWS({ type: "haus3d/history/snapshot" });
      this._toast("Stand gesichert.");
    } catch (err) {
      this._toast(`Sichern fehlgeschlagen: ${err.message ?? err.code}`);
    }
  },

  async _showHistory() {
    let items;
    try {
      ({ items } = await this._hass.callWS({ type: "haus3d/history/list" }));
    } catch (err) {
      this._toast(`Verlauf nicht verfügbar: ${err.message ?? err.code}`);
      return;
    }
    const el = document.createElement("div");
    el.className = "popup";
    const reasons = { save: "vor Speichern", restore: "vor Wiederherstellen", manual: "gesichert" };
    el.innerHTML = `<div class="head">Verlauf (letzte 20 Stände)</div><div class="scroll"></div>`;
    const list = el.querySelector(".scroll");
    if (!items.length) list.innerHTML = `<div class="item"><span>Noch keine Stände gesichert.</span></div>`;
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "item";
      const when = new Date(item.created).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
      row.innerHTML = `<span></span><button>Wiederherstellen</button>`;
      row.querySelector("span").textContent = `${when} · ${reasons[item.reason] ?? item.reason} · ${plural(item.floors, "Etage", "Etagen")}`;
      row.querySelector("button").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        this._closePopup();
        if (!(await this._confirm(`Stand vom ${when} wiederherstellen?`, "Wiederherstellen", { sub: "Der aktuelle Stand wird vorher gesichert." }))) return;
        try {
          const res = await this._hass.callWS({ type: "haus3d/history/restore", history_id: item.id });
          this._setBuilding(res.building, res.revision);
          this._toast("Stand wiederhergestellt.");
        } catch (err) {
          this._toast(`Wiederherstellen fehlgeschlagen: ${err.message ?? err.code}`);
        }
      });
      list.appendChild(row);
    }
    this._closePopup();
    this._els.stage.appendChild(el);
    this._popup = el;
  },
};
