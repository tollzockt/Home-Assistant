// Raum-Szenen und Favoriten-Leiste (Mixin für Haus3DPanel).
// - Raum-Szenen: im Bearbeiten-Modus „+ Szene“ im Raumfenster – speichert den aktuellen Zustand der Geräte im
//   Raum als echte HA-Szene (Einstellungen → Szenen), danach ein Knopf im Raumfenster (Kino, Lesen …).
// - Favoriten: die am häufigsten angetippten Geräte (dieses Gerät, lernt mit) als Leiste unten.

import { displayKind } from "./devices.js";
import { esc, iconFor, isActive } from "./panel-util.js";

export const SCENE_ICONS = [["mdi:movie-open", "Kino"], ["mdi:book-open-variant", "Lesen"], ["mdi:broom", "Putzen"], ["mdi:silverware-fork-knife", "Essen"], ["mdi:sofa", "Gemütlich"], ["mdi:white-balance-sunny", "Hell"], ["mdi:weather-night", "Nacht"], ["mdi:party-popper", "Party"]];
const SCENE_DOMAINS = ["light", "switch", "cover", "fan", "media_player", "climate"];
const FAV_KEY = "haus3d.favs";
export const FAV_MAX = 6;
export const FAV_MIN_USES = 3;

/** Kurzname einer Szene als Kennung: „wohnzimmer_kino“. */
export const sceneSlug = (s) => String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "szene";

/** Zustand eines Geräts für eine Szene (nur, was zum Wiederherstellen zählt). */
export function sceneState(st) {
  const d = st.entity_id.split(".")[0];
  const a = st.attributes ?? {};
  const pick = (...keys) => Object.fromEntries(keys.filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, a[k]]));
  if (d === "light") return st.state === "on" ? { state: "on", ...pick("brightness", "color_mode", "color_temp_kelvin", "rgb_color", "hs_color", "effect") } : { state: "off" };
  if (d === "cover") return { state: st.state, ...pick("current_position", "current_tilt_position") };
  if (d === "climate") return { state: st.state, ...pick("temperature", "preset_mode") };
  if (d === "media_player") return { state: st.state, ...pick("volume_level", "source") };
  if (d === "fan") return { state: st.state, ...pick("percentage", "preset_mode") };
  return { state: st.state };
}

/** Szenen-Entität zu einer gespeicherten Raum-Szene (über die Kennung der Szene). */
export function sceneEntity(hass, id) {
  return Object.keys(hass?.states ?? {}).find((e) => e.startsWith("scene.") && hass.states[e].attributes?.id === id) ?? null;
}

/**
 * Favoriten: Nutzung {id: {n, t}} → die meistgenutzten (Gewicht halbiert sich alle 14 Tage), mind. 3 Tipps,
 * ausgeblendete (n < 0) nie.
 */
export function topFavorites(uses, now = Date.now(), max = FAV_MAX) {
  return Object.entries(uses ?? {})
    .filter(([, u]) => u && u.n >= FAV_MIN_USES)
    .map(([id, u]) => [id, u.n * Math.pow(0.5, Math.max(0, now - (u.t ?? now)) / (14 * 86400000))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id]) => id);
}

export const SceneMethods = {
  // ------------------------------------------------------------------ Raum-Szenen

  _roomScenes(p, floor, room, bar) {
    const hass = this._hass;
    const edit = this._editing();
    for (const sc of room.scenes ?? []) {
      const eid = sceneEntity(hass, sc.id);
      bar.insertAdjacentHTML("beforeend", `<button class="chip act-rscene${eid ? "" : " missing"}" data-sid="${esc(sc.id)}" title="${eid ? esc(sc.name) : "Szene fehlt in Home Assistant"}"><ha-icon icon="${esc(sc.icon || "mdi:palette")}"></ha-icon><span>${esc(sc.name)}</span>${edit ? `<ha-icon class="rm" icon="mdi:close-circle"></ha-icon>` : ""}</button>`);
    }
    if (edit) bar.insertAdjacentHTML("beforeend", `<button class="chip act-addscene" title="Aktuellen Zustand der Geräte als Szene speichern"><ha-icon icon="mdi:plus"></ha-icon><span>Szene</span></button>`);
    bar.querySelectorAll(".act-rscene").forEach((b) => b.addEventListener("click", (ev) => {
      const sc = (room.scenes ?? []).find((x) => x.id === b.dataset.sid);
      if (!sc) return;
      if (ev.target.closest(".rm")) return this._deleteRoomScene(floor, room, sc);
      const eid = sceneEntity(this._hass, sc.id);
      if (!eid) return this._toast(`Szene „${sc.name}“ gibt es in Home Assistant nicht (mehr).`);
      this._hass.callService("scene", "turn_on", { entity_id: eid }).then(() => this._toast(`${sc.name}`)).catch((err) => this._toast(`Fehlgeschlagen: ${err.message ?? err}`));
    }));
    bar.querySelector(".act-addscene")?.addEventListener("click", () => this._sceneDialog(floor, room));
  },

  /** Dialog: Name, Symbol, Geräte – speichert die Szene in HA und am Raum. */
  _sceneDialog(floor, room) {
    if (this._sim) return this._toast("In der Simulation werden keine Szenen gespeichert.");
    const hass = this._hass;
    const ids = this._panelEntities(room).filter((id) => SCENE_DOMAINS.includes(id.split(".")[0]) && hass.states[id]);
    if (!ids.length) return this._toast("Im Raum gibt es keine Lichter, Rollläden oder Geräte für eine Szene.");
    let icon = SCENE_ICONS[0][0];
    const el = document.createElement("div");
    el.className = "dialog-backdrop";
    el.innerHTML = `<div class="dialog scenedlg" role="dialog" aria-label="Szene speichern">
      <div class="dialog-head"><span>Szene für ${esc(room.name)}</span><button class="icon close" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="dialog-body">
        <p class="hint">Stell die Geräte erst so ein, wie die Szene sein soll – gespeichert wird der jetzige Zustand.</p>
        <label class="lbl">Name</label><input class="sname" value="${esc(SCENE_ICONS[0][1])}" maxlength="30">
        <div class="sicons">${SCENE_ICONS.map(([ic, n]) => `<button data-ic="${ic}" data-n="${esc(n)}" class="${ic === icon ? "sel" : ""}" title="${esc(n)}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}</div>
        <label class="lbl">Geräte</label>
        <div class="sents">${ids.map((id) => `<label class="chkrow"><input type="checkbox" data-id="${esc(id)}" checked> ${esc(hass.states[id].attributes.friendly_name ?? id)} <small>${esc(hass.formatEntityState ? hass.formatEntityState(hass.states[id]) : hass.states[id].state)}</small></label>`).join("")}</div>
        <div class="btns"><button class="cancel">Abbrechen</button><button class="save primary">Szene speichern</button></div>
      </div></div>`;
    const name = el.querySelector(".sname");
    el.querySelectorAll("[data-ic]").forEach((b) => b.addEventListener("click", () => {
      if (SCENE_ICONS.some(([, n]) => n === name.value) || !name.value.trim()) name.value = b.dataset.n;
      icon = b.dataset.ic;
      el.querySelectorAll("[data-ic]").forEach((x) => x.classList.toggle("sel", x === b));
    }));
    el.querySelector(".close").addEventListener("click", () => this._closeDialog());
    el.querySelector(".cancel").addEventListener("click", () => this._closeDialog());
    el.querySelector(".save").addEventListener("click", async () => {
      const chosen = [...el.querySelectorAll(".sents input:checked")].map((c) => c.dataset.id);
      const label = name.value.trim() || "Szene";
      if (!chosen.length) return this._toast("Mindestens ein Gerät wählen.");
      const id = `haus3d_${sceneSlug(room.name)}_${sceneSlug(label)}_${Date.now().toString(36)}`;
      const entities = Object.fromEntries(chosen.map((e) => [e, sceneState(this._hass.states[e])]));
      try {
        await this._hass.callApi("POST", `config/scene/config/${id}`, { id, name: `${room.name}: ${label}`, icon, entities });
      } catch (err) {
        return this._toast(`Szene nicht gespeichert (nur HA-Administratoren dürfen Szenen anlegen): ${err.message ?? err.body?.message ?? err}`);
      }
      await this._saveRoomScenes(floor, room, [...(room.scenes ?? []), { id, name: label, icon }], `Szene „${label}“ gespeichert.`);
      this._closeDialog();
    });
    el.addEventListener("click", (ev) => ev.target === el && this._closeDialog());
    this._els.stage.appendChild(el);
    this._dialog = el;
  },

  async _deleteRoomScene(floor, room, sc) {
    if (!(await this._confirm(`Szene „${sc.name}“ löschen?`, "Löschen", { danger: true }))) return;
    await this._hass.callApi("DELETE", `config/scene/config/${sc.id}`).catch(() => {}); // fehlt sie schon, egal
    await this._saveRoomScenes(floor, room, (room.scenes ?? []).filter((x) => x.id !== sc.id), "Szene gelöscht.");
  },

  async _saveRoomScenes(floor, room, scenes, message) {
    const building = structuredClone(this._building);
    for (const f of building.floors) if (f.id === floor.id) for (const r of [...f.rooms, ...(f.outdoor ?? [])]) if (r.id === room.id) r.scenes = scenes;
    try {
      const res = await this._callLocked({ type: "haus3d/building/save", building, revision: this._revision }, "edit");
      this._setBuilding(res.building, res.revision, { keepCamera: true });
      this._toast(message);
    } catch (err) {
      this._toast(`Speichern fehlgeschlagen: ${err.message ?? err.code}`);
    }
  },

  // ------------------------------------------------------------------ Favoriten-Leiste

  _favUses(next) {
    try {
      if (next) localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return JSON.parse(localStorage.getItem(FAV_KEY) ?? "{}") ?? {};
    } catch {
      return next ?? {};
    }
  },

  /** Ein Tipp auf ein Gerät zählt für die Favoriten. */
  _favCount(id) {
    if (!id || id.startsWith("camera.")) return;
    const uses = this._favUses();
    const u = uses[id] ?? { n: 0, t: 0 };
    if (u.n < 0) return; // ausgeblendet
    uses[id] = { n: u.n + 1, t: Date.now() };
    this._favUses(uses);
    this._renderFavs();
  },

  _favHide(id) {
    const uses = this._favUses();
    uses[id] = { n: -1, t: Date.now() };
    this._favUses(uses);
    this._renderFavs();
    this._toast("Aus den Favoriten genommen.");
  },

  /** Leiste unten (Ebene „Favoriten“): baut nur neu, wenn sich die Auswahl ändert; sonst nur Zustände. */
  _renderFavs() {
    const stage = this._els?.stage;
    if (!stage) return;
    const hass = this._hass;
    const on = this._settings.layers.favorites !== false && !this._sim && !this._tl;
    const ids = on ? topFavorites(this._favUses()).filter((id) => hass?.states?.[id]) : [];
    const sig = `${ids.join(",")}|${this._editing()}`;
    if (sig !== this._favSig) {
      this._favSig = sig;
      this._favBar?.remove();
      this._favBar = null;
      stage.classList.toggle("has-favbar", ids.length > 0);
      if (!ids.length) return;
      const el = document.createElement("div");
      el.className = "favbar";
      el.innerHTML = ids.map((id) => `<button class="fav" data-id="${esc(id)}"><ha-icon></ha-icon><span></span>${this._editing() ? `<ha-icon class="rm" icon="mdi:close-circle" title="Aus den Favoriten nehmen"></ha-icon>` : ""}</button>`).join("");
      el.querySelectorAll(".fav").forEach((b) => {
        b.querySelector(".rm")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._favHide(b.dataset.id);
        });
        this._bindIcon(b, b.dataset.id);
      });
      el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      stage.appendChild(el);
      this._favBar = el;
    }
    for (const b of this._favBar?.querySelectorAll(".fav") ?? []) {
      const st = hass.states[b.dataset.id];
      const kind = displayKind(st);
      b.querySelector("ha-icon").setAttribute("icon", iconFor(kind, st));
      b.classList.toggle("on", !!kind && isActive(kind, st));
      const name = String(st.attributes?.friendly_name ?? b.dataset.id);
      b.querySelector("span").textContent = name.length > 14 ? `${name.slice(0, 13)}…` : name;
      b.title = `${name}: ${hass.formatEntityState ? hass.formatEntityState(st) : st.state}`;
    }
  },
};

export const SCENES_STYLE = `
.rp-actions .act-rscene.missing { opacity: .5; }
.rp-actions .act-rscene .rm, .favbar .fav .rm { --mdc-icon-size: 16px; color: #e53935; margin-left: 2px; }
.rp-actions .act-addscene { border-style: dashed; }
.scenedlg .sname { width: 100%; box-sizing: border-box; font: inherit; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.scenedlg .sicons { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.scenedlg .sicons button { width: 42px; height: 42px; border-radius: 10px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: transparent; color: inherit; cursor: pointer; }
.scenedlg .sicons button.sel { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
.scenedlg .sents { max-height: 40vh; overflow-y: auto; }
.scenedlg .sents small { color: var(--secondary-text-color); margin-left: auto; }
.favbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 5; display: flex; gap: 6px; padding: 6px; border-radius: 16px; background: var(--card-background-color, #fff); box-shadow: 0 2px 10px rgba(0,0,0,.3); max-width: calc(100% - 170px); overflow-x: auto; scrollbar-width: none; }
.favbar .fav { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 64px; height: 56px; padding: 2px 6px; border: 0; border-radius: 12px; background: var(--secondary-background-color, rgba(127,127,127,.1)); color: var(--primary-text-color); font: inherit; font-size: 11px; cursor: pointer; position: relative; }
.favbar .fav.on { background: #fbc02d; color: #1b1b1b; }
.favbar .fav span { white-space: nowrap; }
.favbar .fav .rm { position: absolute; top: 0; right: 0; }
.stage.has-favbar .toast { bottom: 84px; }
.stage.has-simbar .favbar, .stage.has-tlbar .favbar { display: none; }
`;
