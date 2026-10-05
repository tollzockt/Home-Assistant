// Editor am Tablet (Mixin für FloorEditor): Schalter „Frei“/„Einzeln“ statt Umschalt/Alt, Leiste beim
// Zeichnen (Fertig, Punkt zurück, Abbrechen), Langdruck-Menü, Entwurf automatisch sichern und
// fortsetzen, Zwischenspeichern, zur Auswahl zoomen.

import { draftState, selectionBounds } from "./edit-ops.js";

export const DRAFT_KEY = "haus3d.editorDraft";
const LONG_MS = 500;

export const GRID_CHOICES = [[0.01, "1 cm"], [0.05, "5 cm"], [0.1, "10 cm"], [0.25, "25 cm"], [0.5, "50 cm"]];

export const TouchMethods = {
  /** Umschalt gedrückt oder Schalter „Frei“: ohne Einrasten. */
  _free(ev) {
    return !!ev?.shiftKey || this.mods.free;
  },

  /** Alt gedrückt oder Schalter „Einzeln“: Nachbarn bleiben stehen, Magnet aus. */
  _solo(ev) {
    return !!ev?.altKey || this.mods.solo;
  },

  /** Fangradius in Metern (am Finger größer). */
  _snapTol() {
    return (this.coarse ? 16 : 10) / this.scale;
  },

  _initTouch() {
    this.mods = { free: false, solo: false, multi: false };
    this.coarse = !!window.matchMedia?.("(pointer: coarse)").matches;
    const main = this.root.querySelector(".ed-main");
    const el = document.createElement("div");
    el.className = "ed-touch";
    el.innerHTML = `<div class="ed-mods"><button data-mod="free" title="Ohne Einrasten (wie Umschalt)">Frei</button><button data-mod="solo" title="Nur dieses Teil, Magnet aus (wie Alt)">Einzeln</button><button data-mod="multi" title="Mehrere Teile wählen (wie Umschalt-Klick); auf leerer Fläche ziehen = Rahmen">Mehrfach</button></div>
      <div class="ed-draftbar" hidden><span class="ed-len"><input data-dlen inputmode="decimal" placeholder="Länge m" title="Länge in Metern, Enter setzt den Punkt"><input data-ddeg inputmode="decimal" placeholder="Winkel°" title="Winkel in Grad: 0 = rechts, 90 = nach oben; leer = Richtung zum Zeiger"><button data-d="len">Setzen</button></span><button data-d="done" class="primary">Fertig</button><button data-d="back">Punkt zurück</button><button data-d="cancel">Abbrechen</button></div>`;
    main.appendChild(el);
    this._touchEl = el;
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    el.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.mod;
      this.mods[k] = !this.mods[k];
      this._updateTouch();
      if (k === "multi") return this._toast(this.mods.multi ? "Mehrfach an: Teile antippen oder auf leerer Fläche einen Rahmen aufziehen." : "Mehrfach aus.");
      this._toast(k === "free" ? (this.mods.free ? "Frei an: nächster Zug ohne Einrasten." : "Frei aus.") : this.mods.solo ? "Einzeln an: Nachbarräume bleiben stehen, Magnet aus." : "Einzeln aus.");
    }));
    el.querySelectorAll(".ed-len input").forEach((inp) => inp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this._draftLen();
      } else if (ev.key === "Escape") inp.blur();
    }));
    el.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => this._draftAction(b.dataset.d)));
    this._checkDraft();
  },

  /** Schalter und Zeichen-Leiste nachführen (nach jedem Zeichnen). */
  _updateTouch() {
    const el = this._touchEl;
    if (!el) return;
    el.querySelectorAll("[data-mod]").forEach((b) => b.classList.toggle("sel", !!this.mods[b.dataset.mod]));
    const d = this.draft;
    const active = !!(d && (d.wall || d.points?.length || d.line?.length));
    const bar = el.querySelector(".ed-draftbar");
    bar.hidden = !active;
    if (active) {
      bar.querySelector('[data-d="done"]').disabled = d.line ? d.line.length < 2 : !d.wall && (d.points?.length ?? 0) < 3;
      bar.querySelector('[data-d="back"]').textContent = d.wall ? "Kette beenden" : "Punkt zurück";
      this._updateDraftLen(bar);
    }
  },

  _draftAction(kind) {
    const d = this.draft;
    if (!d) return;
    if (kind === "len") return this._draftLen();
    if (kind === "done") {
      if (d.line) return this._finishLine();
      if (d.points?.length >= 3) return this._finishPolygon();
      this.draft = null;
    } else if (kind === "back") {
      if (d.line) {
        d.line.pop();
        if (!d.line.length) this.draft = null;
      } else if (d.wall) this.draft = null;
      else {
        d.points.pop();
        if (!d.points.length) this.draft = null;
      }
    } else this.draft = null;
    this.render();
  },

  /** Langdruck auf ein Teil (nur Auswahl-Werkzeug, nie auf „+“-Punkten). */
  _longPressStart(ev) {
    clearTimeout(this._lpTimer);
    this._lpFired = false;
    if (this.tool !== "select" || this.roofMode) return;
    const t = ev.target.closest?.("[data-kind]");
    if (!t || t.dataset.kind === "insert") return;
    const at = [ev.clientX, ev.clientY];
    this._lpAt = at;
    this._lpTimer = setTimeout(() => {
      if (!this.sel) return;
      this._lpFired = true;
      navigator.vibrate?.(15);
      this._ctxMenu(at);
    }, LONG_MS);
  },

  _longPressMove(ev) {
    if (this._lpAt && Math.hypot(ev.clientX - this._lpAt[0], ev.clientY - this._lpAt[1]) > 6) clearTimeout(this._lpTimer);
  },

  _longPressCancel() {
    clearTimeout(this._lpTimer);
    this._lpAt = null;
  },

  /** Kleines Menü am Finger: Duplizieren, Drehen 90°, An die Wand, Löschen, Eigenschaften. */
  _ctxMenu([x, y]) {
    this._closeCtx();
    const sel = this.sel;
    const items = [];
    if (this.props.querySelector('[data-act="dup"]')) items.push(["dup", "Duplizieren"]);
    if (sel.kind === "furniture") items.push(["rot", "Drehen 90°"], ["wall", "An die Wand stellen"]);
    items.push(["del", "Löschen"], ["props", "Eigenschaften"]);
    const el = document.createElement("div");
    el.className = "ed-ctx";
    el.innerHTML = items.map(([k, n]) => `<button data-c="${k}"${k === "del" ? ' class="danger"' : ""}>${n}</button>`).join("");
    const r = this.root.getBoundingClientRect();
    el.style.left = `${Math.min(r.width - 200, Math.max(4, x - r.left))}px`;
    el.style.top = `${Math.min(r.height - 44 * items.length - 8, Math.max(4, y - r.top))}px`;
    el.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    el.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.c;
      this._closeCtx();
      if (k === "dup") this.props.querySelector('[data-act="dup"]')?.click();
      else if (k === "rot") this.rotateSel(90);
      else if (k === "wall") this.snapSelToWall();
      else if (k === "del") this.deleteSelection();
      else this.props.scrollIntoView?.({ block: "nearest" });
    }));
    this.root.appendChild(el);
    this._ctxEl = el;
    this._ctxClose = (ev) => {
      if (!ev.composedPath().includes(el)) this._closeCtx();
    };
    setTimeout(() => this.root.addEventListener("pointerdown", this._ctxClose, true), 0);
  },

  _closeCtx() {
    this._ctxEl?.remove();
    this._ctxEl = null;
    if (this._ctxClose) this.root.removeEventListener("pointerdown", this._ctxClose, true);
    this._ctxClose = null;
  },

  /** Ansicht auf die Auswahl (1 m Rand). */
  zoomToSelection() {
    const b = selectionBounds(this.floor, this.sel);
    if (!b) return this._toast("Erst etwas auswählen.");
    this.view = { x0: b[0][0] - 1, z0: b[0][1] - 1, x1: b[1][0] + 1, z1: b[1][1] + 1 };
    this._fitPending = true;
    this.render();
  },

  // ---------------------------------------------------------------- Entwurf sichern

  /** Entwurf 1,5 s nach der letzten Änderung in diesem Browser sichern. */
  _queueDraft() {
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => this._writeDraft(), 1500);
  },

  _writeDraft() {
    if (!this.dirty) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, base_revision: this.revision ?? null, floorId: this.floorId, saved_at: Date.now(), building: this.b }));
      const t = new Date();
      this._draftNote = `Entwurf gesichert ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      if (!this._hintTimer) this.hint.textContent = `${this._hintText()} · ${this._draftNote}`;
    } catch {
      if (!this._quotaWarned) this._toast("Entwurf konnte nicht gesichert werden (Speicher voll).");
      this._quotaWarned = true;
    }
  },

  clearDraft() {
    clearTimeout(this._draftTimer);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* egal */
    }
  },

  /** Beim Öffnen: ungespeicherten Entwurf anbieten (Fortsetzen / Verwerfen). */
  _checkDraft() {
    let raw = null;
    try {
      raw = localStorage.getItem(DRAFT_KEY);
    } catch {
      return;
    }
    const state = draftState(raw, this.b, this.revision ?? null);
    if (state === "none") return;
    const d = JSON.parse(raw);
    const when = new Date(d.saved_at || Date.now());
    const el = document.createElement("div");
    el.className = "ed-banner";
    el.innerHTML = `<span></span><button data-b="go" class="primary">Fortsetzen</button><button data-b="drop">Verwerfen</button>`;
    el.querySelector("span").textContent = `Ungespeicherter Entwurf vom ${when.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}, ${when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} gefunden.${state === "stale" ? " Inzwischen wurde ein neuerer Stand gespeichert – beim Speichern würde er ersetzt." : ""}`;
    el.classList.toggle("stale", state === "stale");
    el.querySelector('[data-b="go"]').addEventListener("click", () => {
      this._pushUndo();
      this.b = d.building;
      if (this.b.floors.some((f) => f.id === d.floorId)) this.floorId = d.floorId;
      this.dirty = true;
      el.remove();
      this.fit();
      this.render();
      this.renderBar();
      this.renderProps();
      this._sync3d(true);
    });
    el.querySelector('[data-b="drop"]').addEventListener("click", () => {
      this.clearDraft();
      el.remove();
    });
    this.root.querySelector(".ed-main").appendChild(el);
    this._bannerEl = el;
  },

  /** Zwischenspeichern: speichern, Editor bleibt offen. */
  async interimSave() {
    const rev = await this.onSave(this.b, { keepOpen: true });
    if (rev !== undefined) this.revision = rev;
    this.dirty = false;
    this.clearDraft();
    this._bannerEl?.remove();
    this._toast("Zwischengespeichert.");
  },
};

export const TOUCH_STYLE = `
.ed-touch { position: absolute; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 3; }
.ed-mods { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 6px; pointer-events: auto; }
.ed-mods button, .ed-draftbar button, .ed-ctx button, .ed-banner button { font: inherit; font-size: 13px; min-height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--card-background-color, #fff); color: var(--primary-text-color); cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
.ed-mods button.sel { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
.ed-draftbar { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); display: flex; gap: 6px; pointer-events: auto; }
.ed-draftbar[hidden] { display: none; }
.ed-draftbar .primary, .ed-banner .primary { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
.ed-draftbar button:disabled { opacity: .45; }
.ed-ctx { position: absolute; z-index: 20; display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 12px; background: var(--card-background-color, #fff); box-shadow: 0 4px 16px rgba(0,0,0,.35); min-width: 180px; }
.ed-ctx button { box-shadow: none; text-align: left; border-radius: 8px; border: none; }
.ed-ctx button:hover { background: rgba(127,127,127,.15); }
.ed-ctx .danger { color: var(--error-color, #db4437); }
.ed-banner { position: absolute; left: 8px; right: 8px; top: 8px; z-index: 4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-radius: 10px; background: var(--card-background-color, #fff); box-shadow: 0 2px 10px rgba(0,0,0,.3); font-size: 13px; }
.ed-banner span { flex: 1; min-width: 200px; }
.ed-banner.stale { border-left: 4px solid var(--warning-color, #ff9800); }
.ed-bar .gridsel { font: inherit; font-size: 13px; padding: 4px; border-radius: 8px; }
.ed-bar.compact { flex-wrap: nowrap; position: relative; overflow: visible; }
.ed.noprops .ed-props { display: none; }
.ed-bar.compact > button span:not(.always) { display: none; }
.ed-bar.compact .menubtn { gap: 4px; }
.ed-bar.compact .menubtn .always { display: inline; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-bar .ed-menu { position: absolute; top: 100%; left: 8px; right: 8px; z-index: 30; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px; padding: 8px; border-radius: 12px; background: var(--card-background-color, #fff); box-shadow: 0 6px 20px rgba(0,0,0,.35); }
.ed-bar .ed-menu[hidden] { display: none; }
.ed-bar .ed-menu button { justify-content: flex-start; min-height: 44px; }
.ed-bar .ed-menu button span { display: inline; }
.ed-bar .ed-menu select { min-height: 44px; }
@media (pointer: coarse) {
  .ed-bar button { min-height: 44px; min-width: 44px; }
  .ed-mods button, .ed-draftbar button, .ed-ctx button, .ed-banner button { min-height: 44px; }
  .ed-props .pad button { min-width: 48px; min-height: 48px; }
  .ed-props .swatches button { width: 32px; height: 32px; }
}
`;
