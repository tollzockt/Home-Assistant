// Alltag (Mixin für Haus3DPanel): Waschmaschine & Co. (läuft/fertig), Termine und Müllabfuhr, Lüften-Timer
// je Raum, Schimmel-Risiko, Stromkosten und günstige Stunden, „Heizung pausieren“ bei offenem Fenster.
// Einstellungen in settings.daily (Admin → Alltag). Logik in smart.js.

import { placesOf, roomClimate, roomEnergySensors, roomPower } from "./devices.js";
import { energyEntities } from "./energymodel.js";
import { weatherEntity } from "./exterior.js";
import { esc, fmt } from "./panel-util.js";
import { APPLIANCE_KINDS, applianceKind, applianceStep, cheapestWindow, costPerHour, currentPrice, dayLabel, fmtCost, fmtMinutes, guessAppliances, moldRisk, priceSeries, remainingMinutes, upcomingEvents, ventTimers, wasteReminders, watts } from "./smart.js";

const VENT_KEY = "haus3d.vent";
const hhmm = (t) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Einstellungen „Alltag“ mit Standardwerten. */
export function normalizeDaily(d) {
  const x = d && typeof d === "object" ? d : {};
  const ids = (l) => (Array.isArray(l) ? l.filter((v) => typeof v === "string" && /^[a-z_]+\.[\w-]+$/.test(v)) : []);
  return {
    appliances: (Array.isArray(x.appliances) ? x.appliances : []).filter((a) => a && typeof a.power === "string").map((a, i) => ({ id: a.id || `geraet_${i + 1}`, name: a.name || applianceKind(a.kind)[1], kind: APPLIANCE_KINDS.some((k) => k[0] === a.kind) ? a.kind : "other", power: a.power, remaining: typeof a.remaining === "string" ? a.remaining : null })),
    calendars: ids(x.calendars),
    price: Number.isFinite(Number(x.price)) && Number(x.price) > 0 ? Number(x.price) : null,
    price_entity: typeof x.price_entity === "string" && x.price_entity ? x.price_entity : null,
    vent_min: Math.min(60, Math.max(1, Number(x.vent_min) || 10)),
    mold: x.mold !== false,
    waste_hour: Math.min(23, Math.max(0, Number.isFinite(Number(x.waste_hour)) && x.waste_hour !== null && x.waste_hour !== "" ? Number(x.waste_hour) : 16)),
    kwp: Number.isFinite(Number(x.kwp)) && Number(x.kwp) > 0 ? Math.min(100, Number(x.kwp)) : null,
    window_heat: { auto: !!x.window_heat?.auto, minutes: Math.min(60, Math.max(1, Number(x.window_heat?.minutes) || 3)) },
  };
}

export const SmartMethods = {
  _daily() {
    return normalizeDaily(this._building?.settings?.daily);
  },

  /** Zusätzlich beobachtete Entitäten (Leistung, Restzeit, Kalender, Preis). */
  _smartIds() {
    const d = this._daily();
    return [...d.appliances.flatMap((a) => [a.power, a.remaining]), ...d.calendars, d.price_entity].filter(Boolean);
  },

  /** Ort einer Entität (Raum) für Hinweise und Chips. */
  _smartPlace(id) {
    const p = this._places?.get(id);
    return p ? { floorId: p.floorId, roomId: p.roomId } : {};
  },

  _roomName(floorId, roomId) {
    const f = this._building?.floors.find((x) => x.id === floorId);
    return (f && placesOf(f).find((r) => r.id === roomId)?.name) || "";
  },

  /** Geräte-Erkennung weiterzählen; Meldung beim Wechsel auf „fertig“. Braucht den Takt, solange etwas läuft. */
  _smartStep() {
    const d = this._daily();
    this._appl ??= new Map();
    const now = Date.now();
    let busy = false;
    for (const a of d.appliances) {
      const prev = this._appl.get(a.id);
      const next = applianceStep(prev, watts(this._hass?.states?.[a.power]), now, a.kind);
      if (next.phase === "done" && prev?.phase === "running") {
        this._toast(`${a.name} ist fertig.`);
        navigator.vibrate?.(30);
      }
      this._appl.set(a.id, next);
      if (next.phase === "running") busy = true;
    }
    const vent = ventTimers(this._ventTimers());
    this._needTick("smart", busy || vent.running.length > 0);
    if (this._view === "energy" && !this._kwhLoading && now - (this._kwhAt ?? 0) > 10 * 60000) this._loadRoomEnergy();
  },

  /** Bodenfarbe „Energie heute“: Verbrauch je Raum seit Mitternacht aus der HA-Statistik (alle 10 min). */
  async _loadRoomEnergy() {
    const hass = this._realHass ?? this._hass;
    if (!hass?.callWS || !this._building) return;
    this._kwhLoading = true;
    this._kwhAt = Date.now();
    const exclude = new Set(energyEntities(this._building.settings?.energy));
    const perRoom = new Map();
    for (const floor of this._building.floors) for (const room of placesOf(floor)) perRoom.set(`${floor.id}:${room.id}`, roomEnergySensors(room, hass, this._byArea, exclude));
    const ids = [...new Set([...perRoom.values()].flat())];
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const res = ids.length ? await hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), period: "day", statistic_ids: ids, types: ["change"], units: { energy: "kWh" } }) : {};
      const change = (id) => (res?.[id] ?? []).reduce((s, r) => s + (Number(r.change) || 0), 0);
      this._roomKwh = new Map([...perRoom].filter(([, list]) => list.length).map(([key, list]) => [key, list.reduce((s, id) => s + change(id), 0)]));
    } catch {
      this._roomKwh = new Map();
    } finally {
      this._kwhLoading = false;
    }
    this._updateStates();
  },

  _ventTimers(next) {
    try {
      if (next) localStorage.setItem(VENT_KEY, JSON.stringify(next));
      return JSON.parse(localStorage.getItem(VENT_KEY) ?? "{}") ?? {};
    } catch {
      return next ?? {};
    }
  },

  /** Lüften-Timer für einen Raum starten bzw. beenden (null). */
  _ventStart(floorId, roomId, minutes) {
    const t = this._ventTimers();
    const key = `${floorId}:${roomId}`;
    if (minutes) t[key] = Date.now() + minutes * 60000;
    else delete t[key];
    this._ventTimers(t);
    this._toast(minutes ? `Lüften: Erinnerung in ${minutes} min.` : "Lüften beendet.");
    this._alertSig = null;
    this._smartStep();
    this._updateStates();
  },

  /** Termine der eingestellten Kalender/Abfall-Sensoren. */
  _events() {
    return upcomingEvents(this._hass, this._daily().calendars, Date.now());
  },

  /** Chips in der Statusleiste: Geräte, nächster Termin (heute/morgen), Lüften. */
  _smartChips() {
    const out = [];
    const d = this._daily();
    const now = Date.now();
    for (const a of d.appliances) {
      const s = this._appl?.get(a.id);
      const icon = applianceKind(a.kind)[2];
      if (s?.phase === "running") {
        const rest = remainingMinutes(this._hass?.states?.[a.remaining], now);
        out.push({ key: `ap:${a.id}`, icon, text: `${a.name} ${rest !== null ? `noch ${fmtMinutes(rest)}` : `läuft ${fmtMinutes((now - s.startedAt) / 60000)}`}`, level: "info" });
      } else if (s?.phase === "done") out.push({ key: `ap:${a.id}`, icon, text: `${a.name} fertig`, level: "ok" });
    }
    const ev = this._events().find((e) => e.days <= 1);
    if (ev) out.push({ key: "cal", icon: ev.waste ? "mdi:trash-can-outline" : "mdi:calendar", text: `${dayLabel(ev.days, ev.start)}${ev.allDay ? "" : ` ${hhmm(ev.start)}`}: ${ev.title}`, level: "info" });
    for (const v of ventTimers(this._ventTimers(), now).running) {
      const [f, r] = v.key.split(":");
      out.push({ key: `vent:${v.key}`, icon: "mdi:window-open-variant", text: `${this._roomName(f, r) || "Lüften"} ${v.left} min`, level: "info" });
    }
    return out;
  },

  /** Tipp auf einen Alltag-Chip; true, wenn er erkannt wurde. */
  _smartChipTap(key) {
    if (key === "cal") {
      this._eventsPopup();
      return true;
    }
    if (key.startsWith("ap:")) {
      const id = key.slice(3);
      const a = this._daily().appliances.find((x) => x.id === id);
      if (this._appl?.get(id)?.phase === "done") this._applianceAck(id);
      else if (a) this._moreInfo(a.power);
      return true;
    }
    if (key.startsWith("vent:")) {
      const [f, r] = key.slice(5).split(":");
      this._ventStart(f, r, null);
      return true;
    }
    return false;
  },

  _applianceAck(id) {
    this._appl?.set(id, { phase: "idle", startedAt: null, lowSince: null, doneAt: null });
    this._alertSig = null;
    this._chipKeys = null;
    this._updateStates();
  },

  /** Termine der nächsten 7 Tage. */
  _eventsPopup() {
    this._closePopup?.();
    const list = this._events();
    const el = document.createElement("div");
    el.className = "popup evpop";
    el.innerHTML = `<div class="head"><ha-icon icon="mdi:calendar"></ha-icon><span>Termine</span><button class="icon x" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="pbody">${list.length ? list.map((e) => `<div class="prow"><span><ha-icon icon="${e.waste ? "mdi:trash-can-outline" : "mdi:calendar"}"></ha-icon> ${esc(e.title)}</span><b>${esc(dayLabel(e.days, e.start))}${e.allDay ? "" : ` ${hhmm(e.start)}`}</b></div>`).join("") : `<p class="muted">Keine Termine in den nächsten 7 Tagen.</p>`}</div>`;
    el.querySelector(".x").addEventListener("click", () => this._closePopup());
    el.addEventListener("click", (ev) => ev.stopPropagation());
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  /** Zusätzliche Hinweise: Gerät fertig, Müll rausstellen, Lüften vorbei, Schimmelgefahr; Aktionen an Hinweisen. */
  _smartAlerts(list) {
    const d = this._daily();
    const now = Date.now();
    const out = [];
    for (const a of d.appliances) {
      const s = this._appl?.get(a.id);
      if (s?.phase === "done") out.push({ key: `appl:${a.id}:${s.doneAt}`, rule: "appliance", level: "info", icon: applianceKind(a.kind)[2], text: `${a.name} ist fertig`, ...this._smartPlace(a.power), entities: [a.power], action: { label: "Erledigt", act: `appl:${a.id}` } });
    }
    for (const w of wasteReminders(this._events(), now, d.waste_hour)) out.push({ key: w.key, rule: "waste", level: "info", icon: "mdi:trash-can-outline", text: `${w.when === "heute" ? "Heute" : "Morgen"}: ${w.title} rausstellen`, floorId: null, roomId: null, entities: [w.entity] });
    for (const v of ventTimers(this._ventTimers(), now).due) {
      const [f, r] = v.key.split(":");
      out.push({ key: `vent:${v.key}:${v.end}`, rule: "vent", level: "warn", icon: "mdi:window-closed-variant", text: `${this._roomName(f, r)}: genug gelüftet – Fenster schließen`, floorId: f, roomId: r, entities: [], action: { label: "Erledigt", act: `vent:${v.key}` } });
    }
    if (d.mold) {
      const outside = this._outsideTemp();
      for (const floor of this._building?.floors ?? []) {
        for (const room of placesOf(floor)) {
          const c = roomClimate(room, this._hass, this._byArea);
          const risk = moldRisk(c.temperature, c.humidity, outside);
          if (risk?.level === "hoch") out.push({ key: `mold:${floor.id}:${room.id}:${Math.round(risk.wallRh / 5)}`, rule: "mold", level: "warn", icon: "mdi:water-alert-outline", text: `Schimmelgefahr ${room.name} (an der Wand ~${risk.wallRh} %) – lüften`, floorId: floor.id, roomId: room.id, entities: [] });
        }
      }
    }
    // Heizung bei offenem Fenster: Knopf „Heizung pausieren“ (zurück, sobald das Fenster zu ist – im Backend)
    for (const a of list) {
      if (a.rule !== "heat_open" || a.action) continue;
      const climate = a.entities.find((id) => id.startsWith("climate."));
      if (climate) a.action = { label: "Heizung pausieren", act: `heat:${climate}:${a.entities.filter((id) => !id.startsWith("climate.")).join(",")}` };
    }
    return out;
  },

  _outsideTemp() {
    const wId = weatherEntity(this._hass, this._building?.settings);
    const t = Number(wId ? this._hass?.states?.[wId]?.attributes?.temperature : NaN);
    return Number.isFinite(t) ? t : null;
  },

  /** Aktion eines Hinweises ausführen. */
  async _alertAction(a) {
    const act = a.action?.act ?? "";
    if (act.startsWith("appl:")) return this._applianceAck(act.slice(5));
    if (act.startsWith("vent:")) {
      const [f, r] = act.slice(5).split(":");
      return this._ventStart(f, r, null);
    }
    if (act.startsWith("heat:")) {
      const [, climate, contacts] = act.split(":");
      try {
        await this._hass.callWS({ type: "haus3d/climate/pause", entity_id: climate, contacts: contacts ? contacts.split(",") : [] });
        this._toast("Heizung pausiert – sie läuft wieder, sobald das Fenster zu ist.");
        this._ackAlert(a);
      } catch (err) {
        this._toast(`Fehlgeschlagen: ${err.message ?? err.code ?? err}`);
      }
    }
  },

  /** Raumfenster: Knopf „Lüften“ (Timer) und eigene Raum-Szenen. */
  _roomExtras(p, floor, room, bar) {
    const key = `${floor.id}:${room.id}`;
    const d = this._daily();
    bar.insertAdjacentHTML("beforeend", `<button class="act-vent" title="Lüften: Erinnerung zum Schließen"><ha-icon icon="mdi:window-open-variant"></ha-icon><span>Lüften</span></button>`);
    bar.querySelector(".act-vent").addEventListener("click", () => {
      const running = this._ventTimers()[key];
      this._ventStart(floor.id, room.id, running ? null : d.vent_min);
    });
    this._roomScenes?.(p, floor, room, bar);
    bar.hidden = false;
  },

  /** Raumfenster aktualisieren: Lüften-Restzeit, Schimmel-Risiko, Kosten des Raums. */
  _roomExtrasUpdate(p, floor, room, climate) {
    const key = `${floor.id}:${room.id}`;
    const end = this._ventTimers()[key];
    const btn = p.el.querySelector(".act-vent");
    if (btn) {
      const left = end ? Math.max(0, Math.ceil((end - Date.now()) / 60000)) : null;
      btn.classList.toggle("on", !!end);
      btn.querySelector("span").textContent = end ? `Lüften ${left} min` : "Lüften";
    }
    const extra = [];
    const risk = this._daily().mold ? moldRisk(climate.temperature, climate.humidity, this._outsideTemp()) : null;
    if (risk && risk.level !== "ok") extra.push(`Schimmel: ${risk.level} (Wand ~${risk.wallRh} %)`);
    const price = currentPrice(this._daily(), this._hass);
    const w = price === null ? null : roomPower(room, this._hass, this._byArea, new Set(energyEntities(this._building.settings?.energy)));
    if (price !== null && Number.isFinite(w) && w > 0) extra.push(`kostet ${fmtCost(costPerHour(w, price))}`);
    const el = p.el.querySelector(".rp-clim");
    if (!el) return;
    let x = el.querySelector(".cx");
    if (!x) {
      x = document.createElement("span");
      x.className = "cx";
      el.appendChild(x);
    }
    x.textContent = extra.join(" · ");
    x.classList.toggle("warn", risk?.level === "hoch");
    if (extra.length) el.hidden = false;
  },

  /** Energie-Karte: Kosten jetzt und günstigste Stunden (bei dynamischem Preis). */
  _smartEnergy(tot) {
    const el = this._energyEl;
    if (!el) return;
    const d = this._daily();
    const price = currentPrice(d, this._hass);
    let row = el.querySelector(".row.cost");
    if (price === null) {
      row?.remove();
      return;
    }
    if (!row) {
      row = document.createElement("div");
      row.className = "row cost";
      row.innerHTML = `<ha-icon icon="mdi:currency-eur"></ha-icon><span>Kosten jetzt</span><b></b>`;
      el.appendChild(row);
    }
    const w = tot.hasGrid ? tot.bezug : tot.verbrauch;
    const series = d.price_entity ? priceSeries(this._hass?.states?.[d.price_entity]) : [];
    const win = series.length ? cheapestWindow(series, 3) : null;
    const txt = `${fmtCost(costPerHour(w ?? 0, price))} · ${fmt(price * 100, 1)} ct/kWh`;
    row.querySelector("b").textContent = txt;
    row.title = win ? `Günstigste 3 Stunden: ${hhmm(win.start)}–${hhmm(win.end)} Uhr, Ø ${fmt(win.avg * 100, 1)} ct/kWh` : "";
    let cheap = el.querySelector(".row.cheap");
    if (win && win.start > Date.now() - 3600000) {
      if (!cheap) {
        cheap = document.createElement("div");
        cheap.className = "row cheap";
        cheap.innerHTML = `<ha-icon icon="mdi:clock-check-outline"></ha-icon><span>Günstig</span><b></b>`;
        el.appendChild(cheap);
      }
      cheap.querySelector("b").textContent = `${win.start <= Date.now() ? "jetzt" : `ab ${hhmm(win.start)}`} · Ø ${fmt(win.avg * 100, 0)} ct`;
    } else cheap?.remove();
  },

  // ------------------------------------------------------------------ Einstellungen (Admin → Alltag)

  _renderDailyConfig(box) {
    const hass = this._hass;
    const d = this._daily();
    const sensors = Object.keys(hass.states).filter((id) => id.startsWith("sensor.")).sort();
    const nameOf = (id) => hass.states[id]?.attributes?.friendly_name ?? "";
    const dl = (id, list) => `<datalist id="${id}">${list.map((e) => `<option value="${esc(e)}">${esc(nameOf(e))}</option>`).join("")}</datalist>`;
    const cals = Object.keys(hass.states).filter((id) => id.startsWith("calendar.") || /abfall|müll|muell|tonne|waste|garbage/i.test(`${id} ${nameOf(id)}`)).sort();
    const sugg = guessAppliances(hass, d.appliances.map((a) => a.power));
    const applRow = (a, i) => `<div class="drow" data-i="${i}">
        <select data-af="kind">${APPLIANCE_KINDS.map(([k, n]) => `<option value="${k}"${k === a.kind ? " selected" : ""}>${n}</option>`).join("")}</select>
        <input data-af="name" value="${esc(a.name)}" placeholder="Name">
        <input data-af="power" list="dl_pow" value="${esc(a.power)}" placeholder="sensor.…_leistung">
        <input data-af="remaining" list="dl_pow" value="${esc(a.remaining ?? "")}" placeholder="Restzeit (optional)">
        <button class="icon rm" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`;
    const appl = [...d.appliances];
    const render = () => {
      box.innerHTML = `<h4>Waschmaschine & Co.</h4>
        <p class="hint">Läuft, sobald der Leistungssensor über ${10} W geht; „fertig“, wenn es danach eine Weile unter 4 W bleibt (Spülmaschine 15 min wegen Trocknen). Mit Restzeit-Sensor steht die Restzeit oben.</p>
        <div class="dlist">${appl.map(applRow).join("") || `<p class="muted">Noch keine Geräte.</p>`}</div>
        <div class="btns left">${sugg.map((s, i) => `<button data-sugg="${i}"><ha-icon icon="mdi:plus"></ha-icon> ${esc(s.name)}: ${esc(nameOf(s.power) || s.power)}</button>`).join("")}<button data-add>+ Gerät</button></div>
        ${dl("dl_pow", sensors)}
        <h4>Termine & Müllabfuhr</h4>
        <label class="en-row"><span>Kalender / Abfall-Sensoren (Komma)</span><input data-cal list="dl_cal" value="${esc(d.calendars.join(", "))}" placeholder="calendar.abfall, sensor.restmuell"></label>${dl("dl_cal", cals)}
        <label class="en-row"><span>Müll-Erinnerung am Vorabend ab (Uhr)</span><input type="number" min="0" max="23" data-wh value="${d.waste_hour}"></label>
        <h4>Strompreis</h4>
        <label class="en-row"><span>Fester Preis (ct/kWh)</span><input type="number" step="0.1" min="0" data-price value="${d.price ?? ""}" placeholder="z. B. 32"></label>
        <label class="en-row"><span>oder dynamischer Preis (Sensor)</span><input data-pe list="dl_pow" value="${esc(d.price_entity ?? "")}" placeholder="Tibber, Nordpool, EPEX …"></label>
        <label class="en-row"><span>PV-Leistung (kWp, für die Vorhersage im Zeitstrahl)</span><input type="number" step="0.1" min="0" data-kwp value="${d.kwp ?? ""}" placeholder="z. B. 9,8"></label>
        <h4>Lüften & Heizen</h4>
        <label class="en-row"><span>Lüften-Timer (min)</span><input type="number" min="1" max="60" data-vent value="${d.vent_min}"></label>
        <label class="chkrow"><input type="checkbox" data-mold${d.mold ? " checked" : ""}> Schimmelgefahr melden (Feuchte an der kalten Wand)</label>
        <label class="chkrow"><input type="checkbox" data-wauto${d.window_heat.auto ? " checked" : ""}> Fenster auf → Heizung im Raum automatisch pausieren (läuft im Hintergrund, auch ohne Tablet)</label>
        <label class="en-row"><span>… nach (min)</span><input type="number" min="1" max="60" data-wmin value="${d.window_heat.minutes}"></label>
        <div class="btns"><button class="daily-save primary">Speichern</button></div>`;
      const read = () => {
        box.querySelectorAll(".drow").forEach((r) => {
          const a = appl[Number(r.dataset.i)];
          r.querySelectorAll("[data-af]").forEach((i) => (a[i.dataset.af] = i.value.trim() || (i.dataset.af === "remaining" ? null : a[i.dataset.af])));
        });
      };
      box.querySelectorAll(".drow .rm").forEach((b) => b.addEventListener("click", () => {
        read();
        appl.splice(Number(b.closest(".drow").dataset.i), 1);
        render();
      }));
      box.querySelectorAll("[data-sugg]").forEach((b) => b.addEventListener("click", () => {
        read();
        const s = sugg.splice(Number(b.dataset.sugg), 1)[0];
        appl.push({ id: `geraet_${Date.now().toString(36)}`, ...s, remaining: null });
        render();
      }));
      box.querySelector("[data-add]").addEventListener("click", () => {
        read();
        appl.push({ id: `geraet_${Date.now().toString(36)}`, name: "Waschmaschine", kind: "washer", power: "", remaining: null });
        render();
      });
      box.querySelector(".daily-save").addEventListener("click", () => {
        read();
        const v = (sel) => box.querySelector(sel).value;
        const next = normalizeDaily({
          appliances: appl.filter((a) => a.power),
          calendars: v("[data-cal]").split(/[,\s]+/).filter(Boolean),
          price: v("[data-price]"),
          price_entity: v("[data-pe]").trim() || null,
          vent_min: v("[data-vent]"),
          kwp: v("[data-kwp]"),
          waste_hour: v("[data-wh]"),
          mold: box.querySelector("[data-mold]").checked,
          window_heat: { auto: box.querySelector("[data-wauto]").checked, minutes: v("[data-wmin]") },
        });
        this._saveBuildingSettings({ daily: next }, "Alltag gespeichert.");
      });
    };
    render();
  },
};

export const SMART_STYLE = `
.popup.evpop { left: 50%; top: 64px; right: auto; transform: translateX(-50%); width: min(360px, calc(100% - 32px)); padding: 0; }
.evpop .head { display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px 14px; font-weight: 600; }
.evpop .head span { flex: 1; }
.evpop .head .x { width: auto; flex: none; padding: 8px; }
.evpop .pbody { padding: 2px 14px 14px; display: grid; gap: 6px; }
.evpop .prow { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.evpop .prow span { display: flex; align-items: center; gap: 6px; --mdc-icon-size: 18px; }
.rp-actions .act-vent.on { background: #0288d1; color: #fff; border-color: transparent; }
.rp-clim .cx { display: block; color: var(--secondary-text-color); font-size: 12px; }
.rp-clim .cx.warn { color: #e65100; font-weight: 600; }
.energy .row.cost b, .energy .row.cheap b { font-size: 13px; }
.alertbar button.act { background: #fff; color: #333; }
.catbox .drow { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px; border-radius: 10px; background: rgba(127,127,127,.08); margin-bottom: 8px; }
.catbox .drow .rm { justify-self: end; }
.catbox .dlist { margin: 6px 0; }
`;
