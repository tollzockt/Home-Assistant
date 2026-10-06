// Einstellungen (Mixin für Haus3DPanel):
// - Zahnrad: schlicht – Stil, Qualität, Geräte, Anzeige-Kacheln, Simulation, dazu die zwei Felder
//   „Bearbeiten“ (PIN, wird zu „Beenden“) und „Admin-Einstellungen“ (PIN).
// - Admin-Fenster: Kategorien; antippen zeigt die Einstellungen dieses Bereichs.
// - Karten als Tabs (Energie, eigene Karten, „+“), unten „Entfernen“ bzw. „Ausblenden“.

import { ADMIN_KEYS, canAdmin, canEdit, newPinError, withToken } from "./access.js";
import { MAX_CARDS, normalizeCards } from "./hud.js";
import { QUALITY_CHOICES } from "./perf.js";
import { ENERGY_CORE, LAYERS, energyRowList, esc } from "./panel-util.js";

/** Anzeige-Kacheln im Zahnrad (Ebenen) – alles andere unter Admin → Anzeige. */
const QUICK_LAYERS = [
  ["grid", "mdi:grid", "Raster"],
  ["labels", "mdi:label-outline", "Raumnamen"],
  ["roof", "mdi:home-roof", "Dach"],
  ["shadows", "mdi:box-shadow", "Schatten"],
  ["weather", "mdi:weather-pouring", "Wetter"],
  ["devices", "mdi:lightbulb-group-outline", "Geräte"],
  ["furniture", "mdi:sofa-outline", "Möbel"],
  ["presence", "mdi:motion-sensor", "Anwesenheit"],
  ["pipes", "mdi:pipe", "Leitungen"],
];

const CATEGORIES = [
  ["house", "mdi:home-roof", "Haus & Wetter", "Dach, PV, Norden, Wetter, Jahreszeit"],
  ["energy", "mdi:lightning-bolt", "Energie", "Entitäten, Akku, Netz"],
  ["cards", "mdi:card-text-outline", "Karten", "Energie-Karte und eigene Karten"],
  ["alerts", "mdi:alert-outline", "Hinweise", "Regen, Melder, Türen …"],
  ["routines", "mdi:shield-home-outline", "Abläufe & Sicherheit", "Gute Nacht, Schlösser"],
  ["quick", "mdi:gesture-tap", "Kurzwahl & Funktionsrad", "Einträge der beiden Räder"],
  ["display", "mdi:layers-outline", "Anzeige", "weitere Ebenen, Leistungsanzeige"],
  ["kiosk", "mdi:tablet", "Wandtablet", "dieses Gerät"],
  ["data", "mdi:database-outline", "Daten & Verlauf", "Export, Import, Stände"],
  ["pin", "mdi:key-variant", "PIN & Zugang", "PINs für Bearbeiten, Admin und Türen"],
];

const CARD_ICONS = ["mdi:card-text-outline", "mdi:lightning-bolt-circle", "mdi:solar-power", "mdi:fire", "mdi:radiator", "mdi:water-boiler", "mdi:thermometer", "mdi:washing-machine", "mdi:server", "mdi:pool", "mdi:car-electric", "mdi:battery-charging", "mdi:weather-partly-cloudy", "mdi:home-automation"];

export const AdminMethods = {
  // ------------------------------------------------------------------ Zahnrad (schlicht)

  _openSettings() {
    this._closePopup();
    this._closeDialog();
    const st = this._settings;
    const el = document.createElement("div");
    el.className = "dialog-backdrop sheet-backdrop";
    const seg = (key, list) => `<div class="seg" data-key="${key}">${list.map(([v, n]) => `<button data-value="${v}" class="${st[key] === v ? "sel" : ""}">${n}</button>`).join("")}</div>`;
    const tile = (attr, icon, name, on) => `<button class="qtile${on ? " on" : ""}" ${attr}><ha-icon icon="${icon}"></ha-icon><span>${name}</span></button>`;
    const editing = this._editing();
    el.innerHTML = `<div class="dialog sheet basics" role="dialog" aria-label="Einstellungen">
      <div class="dialog-head"><span>Einstellungen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body">
        <div class="brow"><span>Stil</span>${seg("style", [["auto", "Auto"], ["day", "Tag"], ["night", "Nacht"], ["cyber", "Cyber"]])}</div>
        <div class="brow"><span>Qualität</span>${seg("quality", QUALITY_CHOICES)}</div>
        <div class="brow"><span>Geräte</span>${seg("deviceMode", [["icons", "Symbole"], ["3d", "3D"]])}</div>
        <div class="qtiles">
          ${QUICK_LAYERS.map(([k, icon, name]) => tile(`data-layer="${k}"`, icon, name, st.layers[k] !== false)).join("")}
          ${tile('data-act="fullscreen"', document.fullscreenElement ? "mdi:fullscreen-exit" : "mdi:fullscreen", "Vollbild", !!document.fullscreenElement)}
          ${tile('data-act="sim"', "mdi:test-tube", "Simulation", !!this._sim)}
        </div>
        <div class="bigtiles">
          <button class="bigtile edit${editing ? " active" : ""}"><ha-icon icon="${editing ? "mdi:check" : "mdi:pencil"}"></ha-icon><span>${editing ? "Beenden" : "Bearbeiten"}</span>${editing ? "" : '<ha-icon class="lk" icon="mdi:lock"></ha-icon>'}</button>
          ${this._adminMode ? `<div class="bigtile admin active"><button class="aopen"><ha-icon icon="mdi:cog"></ha-icon><span>Admin-Einstellungen</span></button><button class="aend">Beenden</button></div>` : `<button class="bigtile admin"><ha-icon icon="mdi:cog"></ha-icon><span>Admin-Einstellungen</span><ha-icon class="lk" icon="mdi:lock"></ha-icon></button>`}
        </div>
      </div></div>`;
    for (const s of el.querySelectorAll(".seg")) {
      s.addEventListener("click", (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        st[s.dataset.key] = b.dataset.value;
        s.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
        this._saveSettings();
        if (s.dataset.key === "style") this._applyStyle();
        else if (s.dataset.key === "quality") this._applyQuality();
        else this._refreshEntities();
      });
    }
    el.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.layer;
      st.layers[k] = st.layers[k] === false;
      b.classList.toggle("on", st.layers[k] !== false);
      this._saveSettings();
      this._scene?.setLayers(st.layers);
      this._applyOverlayLayers();
      this._renderWheels?.();
    }));
    el.querySelector('[data-act="fullscreen"]').addEventListener("click", () => {
      this._toggleFullscreen();
      setTimeout(() => this._dialog === el && this._openSettings(), 300);
    });
    el.querySelector('[data-act="sim"]').addEventListener("click", () => {
      this._closeDialog();
      this._setSim(!this._sim);
    });
    el.querySelector(".bigtile.edit").addEventListener("click", async () => {
      if (this._editing()) {
        this._endEdit();
        this._closeDialog();
        return;
      }
      if (await this._startEdit()) this._closeDialog();
    });
    if (this._adminMode) {
      el.querySelector(".aopen").addEventListener("click", () => this._openAdmin());
      el.querySelector(".aend").addEventListener("click", () => {
        this._endAdmin();
        this._openSettings();
      });
    } else el.querySelector(".bigtile.admin").addEventListener("click", () => this._openAdmin());
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  // ------------------------------------------------------------------ Admin-Fenster

  /**
   * Admin-Einstellungen öffnen (Admin-PIN). cat: gleich einen Bereich zeigen. Karten darf auch der
   * Bearbeiten-Modus ohne Admin-PIN (Stift an einer Karte).
   */
  async _openAdmin(cat = null, arg = null) {
    const viaEdit = cat === "cards" && this._editing() && !this._adminMode;
    if (!viaEdit) {
      if (!(await this._pinPad("admin"))) return;
      this._startAdminMode();
    }
    this._closePopup();
    this._closeDialog();
    this._adminOpen = true;
    const el = document.createElement("div");
    el.className = "dialog-backdrop sheet-backdrop";
    el.innerHTML = `<div class="dialog sheet admin" role="dialog" aria-label="Admin-Einstellungen"><div class="dialog-head"><button class="icon back" title="Zurück" hidden><ha-icon icon="mdi:chevron-left"></ha-icon></button><span class="ttl">Admin-Einstellungen</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dialog-body"></div></div>`;
    const body = el.querySelector(".dialog-body");
    const head = el.querySelector(".ttl");
    const back = el.querySelector(".back");
    const showGrid = () => {
      head.textContent = "Admin-Einstellungen";
      back.hidden = true;
      body.innerHTML = `<div class="cats">${CATEGORIES.map(([k, icon, name, sub]) => `<button class="cat" data-cat="${k}"><ha-icon icon="${icon}"></ha-icon><b>${name}</b><small>${sub}</small></button>`).join("")}</div>`;
      body.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", async () => {
        if (!canAdmin() && !(await this._pinPad("admin"))) return;
        showCat(b.dataset.cat);
      }));
    };
    const showCat = (k, a = null) => {
      const c = CATEGORIES.find((x) => x[0] === k);
      head.textContent = c[2];
      back.hidden = viaEdit && !canAdmin();
      body.innerHTML = `<div class="catbox"></div>`;
      const box = body.querySelector(".catbox");
      el.dataset.cat = k;
      ({
        house: () => this._renderHouseConfig(box),
        energy: () => this._renderEnergyConfig(box),
        cards: () => this._renderCardsConfig(box, a),
        alerts: () => this._renderAlertsConfig(box),
        routines: () => this._renderRoutinesConfig(box),
        quick: () => this._renderQuickConfig(box),
        display: () => this._renderDisplayConfig(box),
        kiosk: () => this._renderKioskConfig(box),
        data: () => this._renderDataConfig(box),
        pin: () => this._renderPinConfig(box),
      })[k]();
    };
    this._adminShow = showCat;
    back.addEventListener("click", showGrid);
    const close = () => {
      this._adminOpen = false;
      this._adminShow = null;
      this._closeDialog();
      // Admin bleibt aktiv, bis „Beenden“ gedrückt wird (oben bzw. im Zahnrad)
    };
    el.querySelector(".close").addEventListener("click", close);
    el.addEventListener("click", (ev) => ev.target === el && close());
    this._els.stage.appendChild(el);
    this._dialog = el;
    if (cat) showCat(cat, arg);
    else showGrid();
  },

  // ------------------------------------------------------------------ Bereiche

  _renderQuickConfig(box) {
    box.innerHTML = `<p class="hint">Kurzwahl = Rad unten links (Automationen, Skripte, Szenen …). Funktionsrad = unten rechts.</p>
      <div class="btns"><button class="q primary"><ha-icon icon="mdi:gesture-tap"></ha-icon> Kurzwahl bearbeiten</button><button class="f"><ha-icon icon="mdi:tune-variant"></ha-icon> Funktionsrad anpassen</button></div>`;
    box.querySelector(".q").addEventListener("click", () => this._quickDialog());
    box.querySelector(".f").addEventListener("click", () => this._functionDialog());
  },

  _renderDisplayConfig(box) {
    const st = this._settings;
    const quick = new Set(QUICK_LAYERS.map(([k]) => k));
    box.innerHTML = `<div class="toggles">${LAYERS.filter(([k]) => !quick.has(k)).map(([k, name]) => `<label><input type="checkbox" data-layer="${k}"${st.layers[k] !== false ? " checked" : ""}><span>${name}</span></label>`).join("")}</div>
      <label class="chkrow"><input type="checkbox" data-perfhud${st.perfHud ? " checked" : ""}> Leistungsanzeige (Bilder/s)</label>
      <p class="hint">Gilt für dieses Gerät. Raster, Dach, Schatten, Wetter, Geräte, Möbel, Anwesenheit und Raumnamen stehen direkt im Zahnrad.</p>`;
    box.querySelectorAll("input[data-layer]").forEach((i) => i.addEventListener("change", () => {
      st.layers[i.dataset.layer] = i.checked;
      this._saveSettings();
      this._scene?.setLayers(st.layers);
      this._applyOverlayLayers();
      if (i.dataset.layer === "sun") this._applySun();
      if (i.dataset.layer === "lightcolor" || i.dataset.layer === "energy") this._refreshEntities();
    }));
    box.querySelector("[data-perfhud]").addEventListener("change", (ev) => {
      st.perfHud = ev.target.checked;
      this._saveSettings();
      this._applyQuality();
    });
  },

  _renderDataConfig(box) {
    box.innerHTML = `<div class="btns col">
      <button data-d="export"><ha-icon icon="mdi:download"></ha-icon> Exportieren (JSON)</button>
      <button data-d="import"><ha-icon icon="mdi:upload"></ha-icon> Importieren (JSON) …</button>
      <button data-d="snap"><ha-icon icon="mdi:content-save-outline"></ha-icon> Stand sichern</button>
      <button data-d="history"><ha-icon icon="mdi:history"></ha-icon> Verlauf …</button></div>`;
    const act = { export: () => this._export(), import: () => this._els.file.click(), snap: () => this._snapshot(), history: () => this._showHistory() };
    box.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => act[b.dataset.d]()));
  },

  async _renderPinConfig(box) {
    let st = {};
    try {
      st = await this._hass.callWS({ type: "haus3d/pin/status" });
    } catch {
      /* ältere Version */
    }
    const part = (scope, name) => `<div class="pinset" data-scope="${scope}"><h4>${name}</h4>
      ${st[`${scope}_default`] ? `<p class="hint warn">Noch die Standard-PIN 0000 – bitte ändern.</p>` : ""}
      <div class="prow"><input type="password" inputmode="numeric" maxlength="8" class="p1" placeholder="neue PIN (4–8 Ziffern)"><input type="password" inputmode="numeric" maxlength="8" class="p2" placeholder="wiederholen"><button class="set primary">Ändern</button></div>
      <p class="pmsg hint"></p></div>`;
    box.innerHTML = `${part("edit", "PIN für „Bearbeiten“")}${part("admin", "PIN für „Admin-Einstellungen“")}${part("door", "PIN für Türen (Schlösser entriegeln/öffnen)")}
      <p class="hint">Türen: Abschließen geht immer ohne PIN. Entriegeln und Öffnen über Haus 3D (Symbol, Raumfenster, Kurzwahl, Karten) fragen jedes Mal nach der Tür-PIN; Home Assistant schließt erst nach richtiger PIN auf.</p>
      <p class="hint">Jeder, der eine PIN kennt, darf den Bereich nutzen – auch ohne Admin-Konto in Home Assistant. Freigaben enden mit „Beenden“, beim Schließen bzw. nach 10 min ohne Bedienung.</p>`;
    box.querySelectorAll(".pinset").forEach((p) => p.querySelector(".set").addEventListener("click", async () => {
      const a = p.querySelector(".p1").value.trim();
      const b = p.querySelector(".p2").value.trim();
      const msg = p.querySelector(".pmsg");
      const err = newPinError(a, b);
      if (err) {
        msg.textContent = err;
        return;
      }
      try {
        await this._callLocked({ type: "haus3d/pin/set", scope: p.dataset.scope, pin: a }, "admin");
        this._toast("PIN geändert.");
        this._renderPinConfig(box);
      } catch (e) {
        msg.textContent = `Fehlgeschlagen: ${e.message ?? e.code ?? e}`;
      }
    }));
  },

  // ------------------------------------------------------------------ Karten als Tabs

  /** Karten: Tabs Energie, eigene Karten, „+“; Formular darunter, unten Entfernen/Ausblenden. */
  _renderCardsConfig(box, active = null) {
    const s = this._building?.settings ?? {};
    const cards = normalizeCards(s.cards);
    const ecard = s.energy_card ?? {};
    let sel = active ?? "energie";
    if (sel !== "energie" && sel !== "+" && !cards.some((c) => c.id === sel)) sel = "energie";
    const tabs = [["energie", ecard.title || "Energie", !!ecard.hidden], ...cards.map((c) => [c.id, c.title, false])];
    box.innerHTML = `<div class="ctabs">${tabs.map(([id, t, hid]) => `<button data-tab="${esc(id)}" class="${id === sel ? "sel" : ""}${hid ? " hid" : ""}">${esc(t)}</button>`).join("")}<button data-tab="+" class="${sel === "+" ? "sel" : ""}" title="Karte hinzufügen">+</button></div><div class="cform"></div>`;
    box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => this._renderCardsConfig(box, b.dataset.tab)));
    const form = box.querySelector(".cform");
    if (sel === "energie") this._energyCardForm(form, box);
    else if (sel === "+") this._newCardForm(form, box, cards, ecard);
    else this._cardForm(form, box, cards, sel);
  },

  _iconPicker(current) {
    return `<div class="qrow iconrow">${CARD_ICONS.map((ic) => `<button class="icon${ic === current ? " on" : ""}" data-icon="${ic}" title="${ic}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}</div>`;
  },

  _bindIconPicker(form, set) {
    form.querySelectorAll("[data-icon]").forEach((b) => b.addEventListener("click", () => {
      form.querySelectorAll("[data-icon]").forEach((x) => x.classList.toggle("on", x === b));
      set(b.dataset.icon);
    }));
  },

  _energyCardForm(form, box) {
    const s = this._building.settings ?? {};
    const card = structuredClone(s.energy_card ?? {});
    let rows = energyRowList(s.energy ?? {}, this._hass, card);
    const draw = () => {
      form.innerHTML = `<label class="lbl">Titel</label><div class="qrow"><input class="ttl" value="${esc(card.title ?? "Energie")}"></div>
        <label class="lbl">Symbol</label>${this._iconPicker(card.icon ?? "mdi:lightning-bolt-circle")}
        <label class="lbl">Zeilen <small>(Haken = anzeigen, ▲▼ = Reihenfolge)</small></label>
        ${rows.length ? rows.map((r, i) => `<div class="qrow erow"><input type="checkbox" data-vis="${i}"${r.hidden ? "" : " checked"}><ha-icon icon="${r.icon}"></ha-icon><input class="nm" data-nm="${i}" value="${esc(r.custom ?? "")}" placeholder="${esc(r.base)}"><button class="icon" data-up="${i}"${i ? "" : " disabled"}>▲</button><button class="icon" data-dn="${i}"${i < rows.length - 1 ? "" : " disabled"}>▼</button></div>`).join("") : `<p class="hint">Noch keine Energie-Werte – unter Admin → Energie die Entitäten wählen.</p>`}
        <label class="chkrow"><input type="checkbox" class="sdot"${card.sdot === false ? "" : " checked"}> Überschuss-Ampel im Kopf</label>
        <label class="chkrow"><input type="checkbox" class="chart"${card.chart === false ? "" : " checked"}> Knopf „Tagesverlauf“</label>
        <div class="btns"><button class="ents">Entitäten (Admin → Energie)</button><button class="save primary">Speichern</button></div>
        <div class="btns danger-row"><button class="hide ${card.hidden ? "" : "danger"}">${card.hidden ? "Wieder anzeigen" : "Ausblenden"}</button></div>`;
      const sync = () => {
        card.title = form.querySelector(".ttl").value.trim() || undefined;
        form.querySelectorAll("[data-vis]").forEach((c) => (rows[Number(c.dataset.vis)].hidden = !c.checked));
        form.querySelectorAll("[data-nm]").forEach((c) => (rows[Number(c.dataset.nm)].custom = c.value.trim() || undefined));
        card.sdot = form.querySelector(".sdot").checked;
        card.chart = form.querySelector(".chart").checked;
      };
      this._bindIconPicker(form, (ic) => (card.icon = ic));
      const move = (i, d) => {
        sync();
        const [r] = rows.splice(i, 1);
        rows.splice(i + d, 0, r);
        draw();
      };
      form.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => move(Number(b.dataset.up), -1)));
      form.querySelectorAll("[data-dn]").forEach((b) => b.addEventListener("click", () => move(Number(b.dataset.dn), 1)));
      const save = async (msg) => {
        sync();
        card.rows = rows.map((r) => ({ key: r.id, ...(r.custom ? { name: r.custom } : {}), ...(r.hidden ? { hidden: true } : {}) }));
        await this._saveBuildingSettings({ energy_card: card }, msg);
        this._renderCardsConfig(box, "energie");
      };
      form.querySelector(".save").addEventListener("click", () => save("Energie-Karte gespeichert."));
      form.querySelector(".hide").addEventListener("click", () => {
        card.hidden = !card.hidden;
        save(card.hidden ? "Energie-Karte ausgeblendet." : "Energie-Karte wird wieder angezeigt.");
      });
      form.querySelector(".ents").addEventListener("click", async () => {
        if (!canAdmin() && !(await this._pinPad("admin"))) return;
        this._adminShow?.("energy");
      });
    };
    draw();
  },

  _cardForm(form, box, cards, id) {
    const card = structuredClone(cards.find((c) => c.id === id));
    const hass = this._hass;
    const draw = () => {
      form.innerHTML = `<label class="lbl">Titel</label><div class="qrow"><input class="ttl" value="${esc(card.title)}"></div>
        <label class="lbl">Symbol</label>${this._iconPicker(card.icon)}
        <label class="lbl">Werte <small>(▲▼ = Reihenfolge)</small></label>
        ${card.entities.map((e, i) => `<div class="qrow"><input class="nm" data-name="${i}" value="${esc(e.name ?? "")}" placeholder="Name"><input list="card-ents" data-ent="${i}" value="${esc(e.entity)}" placeholder="Entität"><button class="icon" data-up="${i}"${i ? "" : " disabled"}>▲</button><button class="icon" data-dn="${i}"${i < card.entities.length - 1 ? "" : " disabled"}>▼</button><button class="icon" data-rm="${i}" title="Wert entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
        <datalist id="card-ents">${Object.keys(hass.states).sort().map((x) => `<option value="${esc(x)}">${esc(hass.states[x].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>
        <div class="btns"><button class="addv">+ Wert</button><button class="save primary">Speichern</button></div>
        <div class="btns danger-row"><button class="del danger">Entfernen</button></div>`;
      const sync = () => {
        card.title = form.querySelector(".ttl").value.trim() || card.title;
        form.querySelectorAll("[data-ent]").forEach((i) => (card.entities[Number(i.dataset.ent)].entity = i.value.trim()));
        form.querySelectorAll("[data-name]").forEach((i) => (card.entities[Number(i.dataset.name)].name = i.value.trim() || undefined));
      };
      this._bindIconPicker(form, (ic) => (card.icon = ic));
      const move = (i, d) => {
        sync();
        const [x] = card.entities.splice(i, 1);
        card.entities.splice(i + d, 0, x);
        draw();
      };
      form.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => move(Number(b.dataset.up), -1)));
      form.querySelectorAll("[data-dn]").forEach((b) => b.addEventListener("click", () => move(Number(b.dataset.dn), 1)));
      form.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        sync();
        card.entities.splice(Number(b.dataset.rm), 1);
        draw();
      }));
      form.querySelector(".addv").addEventListener("click", () => {
        sync();
        card.entities.push({ entity: "" });
        draw();
      });
      form.querySelector(".save").addEventListener("click", async () => {
        sync();
        card.entities = card.entities.filter((e) => e.entity.includes("."));
        await this._saveBuildingSettings({ cards: cards.map((c) => (c.id === id ? card : c)) }, "Karte gespeichert.");
        this._renderCardsConfig(box, id);
      });
      form.querySelector(".del").addEventListener("click", async () => {
        if (!(await this._confirm(`Karte „${card.title}“ entfernen?`, "Entfernen", { danger: true }))) return;
        await this._saveBuildingSettings({ cards: cards.filter((c) => c.id !== id) }, "Karte entfernt.");
        this._renderCardsConfig(box, "energie");
      });
    };
    draw();
  },

  _newCardForm(form, box, cards, ecard) {
    const full = cards.length >= MAX_CARDS;
    form.innerHTML = `${ecard.hidden ? `<div class="btns"><button class="showe">Energie-Karte wieder anzeigen</button></div>` : ""}
      ${full ? `<p class="hint">Höchstens ${MAX_CARDS} eigene Karten – erst eine entfernen.</p>` : `<label class="lbl">Neue Karte</label><div class="qrow"><input class="ttl" placeholder="Titel, z. B. Heizung"><button class="add primary">Anlegen</button></div>`}`;
    form.querySelector(".showe")?.addEventListener("click", async () => {
      await this._saveBuildingSettings({ energy_card: { ...ecard, hidden: false } }, "Energie-Karte wird wieder angezeigt.");
      this._renderCardsConfig(box, "energie");
    });
    form.querySelector(".add")?.addEventListener("click", async () => {
      const id = `karte_${Date.now().toString(36)}`;
      const title = form.querySelector(".ttl").value.trim() || "Neue Karte";
      await this._saveBuildingSettings({ cards: [...cards, { id, title, icon: "mdi:card-text-outline", entities: [] }] }, `Karte „${title}“ angelegt.`);
      this._renderCardsConfig(box, id);
    });
  },

  /** Einstellungen speichern; die Admin-PIN wird nur für geschützte Bereiche verlangt. */
  async _saveBuildingSettings(patch, message) {
    const building = structuredClone(this._building);
    building.settings = { ...(building.settings ?? {}), ...patch };
    const scope = Object.keys(patch).some((k) => ADMIN_KEYS.includes(k)) ? "admin" : "edit";
    try {
      const res = await this._callLocked({ type: "haus3d/building/save", building, revision: this._revision }, scope);
      this._setBuilding(res.building, res.revision, { keepCamera: true });
      this._toast(message);
    } catch (err) {
      this._toast(err?.code === "locked" ? "Gesperrt – nicht gespeichert." : `Speichern fehlgeschlagen: ${err.message ?? err.code}`);
    }
  },
};

export const ADMIN_STYLE = `
.basics .brow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.basics .brow > span { width: 70px; flex: none; color: var(--secondary-text-color); font-size: 13px; }
.basics .brow .seg { flex: 1; }
.qtiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; margin: 12px 0 16px; }
.qtile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 72px; border-radius: 14px; border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent; color: var(--secondary-text-color); font: inherit; font-size: 12px; cursor: pointer; }
.qtile.on { background: var(--primary-color, #03a9f4); border-color: transparent; color: #fff; }
.bigtiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bigtile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 104px; border-radius: 18px; border: 2px solid var(--divider-color, rgba(127,127,127,.35)); background: var(--secondary-background-color, rgba(127,127,127,.06)); color: var(--primary-text-color); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; --mdc-icon-size: 30px; }
.bigtile .lk { position: absolute; right: 10px; top: 10px; --mdc-icon-size: 16px; color: var(--secondary-text-color); }
.bigtile.edit.active { background: #2e7d32; border-color: #2e7d32; color: #fff; }
.bigtile.admin.active { background: #e65100; border-color: #e65100; color: #fff; padding: 8px; gap: 8px; cursor: default; }
.bigtile.admin.active button { font: inherit; border: 0; cursor: pointer; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; }
.bigtile.admin.active .aopen { background: transparent; color: #fff; flex: 1; font-size: 14px; }
.bigtile.admin.active .aend { background: #fff; color: #e65100; min-height: 40px; }
.dialog.admin { width: min(820px, calc(100vw - 24px)); height: min(86vh, 760px); max-height: min(86vh, 760px); display: flex; flex-direction: column; }
.dialog.admin .dialog-body { flex: 1; overflow-y: auto; }
.dialog.admin .dialog-head .back { margin-right: 4px; }
.cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.cat { display: grid; grid-template-columns: 36px 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; text-align: left; padding: 12px; min-height: 72px; border-radius: 14px; border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.cat ha-icon { grid-row: span 2; --mdc-icon-size: 28px; color: var(--primary-color, #03a9f4); }
.cat small { color: var(--secondary-text-color); font-size: 12px; }
.ctabs { display: flex; gap: 6px; overflow-x: auto; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.3)); margin-bottom: 12px; }
.ctabs button { flex: none; font: inherit; border: 0; border-bottom: 3px solid transparent; background: transparent; color: var(--secondary-text-color); padding: 10px 14px; cursor: pointer; white-space: nowrap; }
.ctabs button.sel { color: var(--primary-text-color); border-bottom-color: var(--primary-color, #03a9f4); font-weight: 600; }
.ctabs button.hid { text-decoration: line-through; }
.cform .lbl { display: block; margin: 12px 0 4px; font-size: 13px; color: var(--secondary-text-color); }
.cform .iconrow { flex-wrap: wrap; }
.cform .iconrow .icon.on { background: var(--primary-color, #03a9f4); color: #fff; }
.cform .qrow { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.cform .qrow input:not([type=checkbox]) { flex: 1; min-width: 0; font: inherit; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: transparent; color: var(--primary-text-color); }
.cform .qrow .icon { flex: none; }
.cform .erow { align-items: center; }
.cform .erow ha-icon { flex: none; color: var(--secondary-text-color); }
.cform .erow input[type=checkbox] { width: 20px; height: 20px; flex: none; }
.danger-row { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--divider-color, rgba(127,127,127,.3)); }
.btns.col { flex-direction: column; align-items: stretch; }
.pinset .hint.warn { color: var(--warning-color, #ff9800); }
.pinset .prow { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; }
.pinset .prow input { width: 100%; min-width: 0; box-sizing: border-box; font: inherit; padding: 10px; border-radius: 10px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: transparent; color: var(--primary-text-color); }
.pinset .prow button { min-height: 42px; }
@media (max-width: 520px) { .pinset .prow { grid-template-columns: 1fr 1fr; } .pinset .prow button { grid-column: span 2; } }
`;
