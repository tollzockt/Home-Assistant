// 2D-Editor für eine Etage (SVG): Räume zeichnen und zuordnen, Fenster/Türen setzen und
// verknüpfen, Möbel und Geräte platzieren, Gartenflächen. Arbeitet auf einer Kopie des Gebäudes;
// Speichern übergibt sie an onSave.

import { buildingIcons, entitiesByArea, iconKind } from "./devices.js";
import {
  allIds,
  clampOffset,
  floorVertices,
  insertVertex,
  moveRoom,
  nearestEdge,
  newId,
  newOpening,
  openingGeometry,
  projectOnSegment,
  rectRoom,
  removeRoom,
  removeVertex,
  snapPoint,
  validPolygon,
} from "./edit-ops.js";
import { FURNITURE } from "./furniture.js";
import { closeGaps, computeWalls, labelPoint, pieceFootprint, signedArea } from "./walls.js";

const SVGNS = "http://www.w3.org/2000/svg";
const MATERIALS = [
  ["wood", "Holz"],
  ["oak", "Eiche"],
  ["tiles", "Fliesen"],
  ["carpet", "Teppich"],
  ["stone", "Stein"],
  ["concrete", "Beton"],
];
const MAT_COLORS = { wood: "#c89f6a", oak: "#a8743f", tiles: "#d8d3ca", carpet: "#8f9cb0", stone: "#b3aea5", concrete: "#9e9e9e" };
const OUTDOOR_TYPES = [
  ["lawn", "Rasen", "#6aa84f"],
  ["terrace", "Terrasse", "#c2b39b"],
  ["path", "Weg", "#bcb4a6"],
  ["driveway", "Einfahrt", "#8c8c8c"],
  ["pool", "Pool", "#2f9fe0"],
  ["bed", "Beet", "#6b4a2f"],
  ["hedge", "Hecke", "#2f6b2a"],
  ["fence", "Zaun", "#8a6f52"],
];
const STYLES = [
  ["", "automatisch"],
  ["interior", "Zimmertür"],
  ["front", "Haustür"],
  ["front_glass", "Haustür mit Glas"],
  ["glass", "Glastür"],
  ["sliding", "Schiebetür"],
  ["passage", "Durchgang (offen)"],
  ["standard", "Fenster normal"],
];
const TOOLS = [
  ["select", "mdi:cursor-default-outline", "Auswählen"],
  ["rect", "mdi:vector-square", "Raum (Rechteck)"],
  ["poly", "mdi:vector-polygon", "Raum (frei)"],
  ["window", "mdi:window-closed-variant", "Fenster"],
  ["door", "mdi:door", "Tür"],
  ["garage", "mdi:garage", "Garagentor"],
  ["furniture", "mdi:sofa-outline", "Möbel"],
  ["device", "mdi:lightbulb-on-outline", "Gerät"],
  ["outdoor", "mdi:tree-outline", "Garten"],
];
const HINTS = {
  select: "Antippen zum Auswählen, Ziehen zum Verschieben. Leere Fläche ziehen = Ansicht verschieben, Mausrad/zwei Finger = Zoom.",
  rect: "Ziehen: Rechteck-Raum von Ecke zu Ecke.",
  poly: "Punkte antippen, ersten Punkt erneut antippen (oder Doppelklick) zum Abschließen. Esc bricht ab.",
  window: "Auf eine Wand tippen: Fenster einsetzen.",
  door: "Auf eine Wand tippen: Tür einsetzen.",
  garage: "Auf eine Wand tippen: Garagentor einsetzen.",
  furniture: "Rechts ein Möbel wählen, dann in den Plan tippen.",
  device: "Rechts ein Gerät wählen, dann an seine Stelle tippen. Ziehen im Auswahl-Modus verschiebt es.",
  outdoor: "Punkte der Gartenfläche antippen, ersten Punkt erneut antippen zum Abschließen.",
};

const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const EDITOR_STYLE = `
.ed { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--primary-background-color, #fafafa); z-index: 8; }
.ed-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.25)); background: var(--card-background-color, #fff); --mdc-icon-size: 20px; }
.ed-bar .sep { width: 1px; height: 28px; background: var(--divider-color, rgba(127,127,127,.3)); margin: 0 4px; }
.ed-bar button { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; color: inherit; font: inherit; font-size: 13px; padding: 6px 9px; border-radius: 8px; cursor: pointer; min-height: 36px; }
.ed-bar button:hover { background: rgba(127,127,127,.12); }
.ed-bar button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.ed-bar button.primary { background: var(--primary-color, #03a9f4); color: #fff; }
.ed-bar button:disabled { opacity: .4; cursor: default; }
.ed-bar select { font: inherit; font-size: 13px; padding: 6px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--card-background-color, #fff); color: inherit; }
.ed-bar .grow { flex: 1; }
.ed-main { flex: 1; display: flex; min-height: 0; }
.ed-svg { flex: 1; min-width: 0; touch-action: none; user-select: none; background: var(--primary-background-color, #fafafa); cursor: crosshair; }
.ed-svg.select { cursor: default; }
.ed-props { width: 300px; overflow-y: auto; border-left: 1px solid var(--divider-color, rgba(127,127,127,.25)); background: var(--card-background-color, #fff); padding: 10px 14px 20px; font-size: 14px; }
.ed-props h3 { margin: 4px 0 10px; font-size: 16px; font-weight: 500; }
.ed-props label { display: block; margin: 8px 0 3px; font-size: 12px; color: var(--secondary-text-color); }
.ed-props input, .ed-props select { width: 100%; box-sizing: border-box; font: inherit; padding: 7px 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.ed-props .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
.ed-props .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 8px; }
.ed-props .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.ed-props .btns button { flex: 1; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; font: inherit; padding: 8px; border-radius: 8px; cursor: pointer; }
.ed-props .btns button.danger { color: var(--error-color, #db4437); border-color: currentColor; }
.ed-props .list { display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow: auto; margin-top: 6px; }
.ed-props .list button { text-align: left; border: none; background: none; color: inherit; font: inherit; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
.ed-props .list button:hover { background: rgba(127,127,127,.12); }
.ed-props .list button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.ed-props .muted { color: var(--secondary-text-color); font-size: 12px; }
.ed-hint { padding: 6px 12px; font-size: 12px; color: var(--secondary-text-color); border-top: 1px solid var(--divider-color, rgba(127,127,127,.25)); background: var(--card-background-color, #fff); }
.ed text { font-family: inherit; pointer-events: none; }
@media (max-width: 700px) {
  .ed-main { flex-direction: column; }
  .ed-props { width: auto; max-height: 42%; border-left: none; border-top: 1px solid var(--divider-color, rgba(127,127,127,.25)); }
  .ed-bar button span { display: none; }
}
`;

export class FloorEditor {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container
   * @param {object} o.building Gebäude (wird kopiert)
   * @param {object} o.hass
   * @param {string} o.floorId
   * @param {(b: object) => Promise<void>} o.onSave
   * @param {() => void} o.onClose
   * @param {(b: object|null) => void} o.onPreview Vorschau in 3D (null = Vorschau beenden)
   */
  constructor({ container, building, hass, floorId, onSave, onClose, onPreview }) {
    this.b = structuredClone(building);
    this.hass = hass;
    this.floorId = this.b.floors.some((f) => f.id === floorId) ? floorId : this.b.floors[0]?.id;
    this.onSave = onSave;
    this.onClose = onClose;
    this.onPreview = onPreview;
    this.tool = "select";
    this.sel = null;
    this.undoStack = [];
    this.redoStack = [];
    this.draft = null; // Polygon in Arbeit
    this.furnType = "sofa";
    this.deviceEntity = null;
    this.dirty = false;
    this.view = null;

    this.root = document.createElement("div");
    this.root.className = "ed";
    this.root.innerHTML = `<div class="ed-bar"></div><div class="ed-main"><svg class="ed-svg"></svg><div class="ed-props"></div></div><div class="ed-hint"></div>`;
    container.appendChild(this.root);
    this.svg = this.root.querySelector("svg");
    this.props = this.root.querySelector(".ed-props");
    this.hint = this.root.querySelector(".ed-hint");
    this._bindSvg();
    // ein einziger Listener für die Leiste (ihr Inhalt wird bei jedem renderBar neu gebaut)
    this.root.querySelector(".ed-bar").addEventListener("click", (ev) => this._onBar(ev));
    this._keys = (ev) => this._onKey(ev);
    window.addEventListener("keydown", this._keys);
    this._resizeObs = new ResizeObserver(() => this.render());
    this._resizeObs.observe(this.svg);
    this.renderBar();
    this.fit();
    this.render();
    this.renderProps();
  }

  destroy() {
    window.removeEventListener("keydown", this._keys);
    this._resizeObs.disconnect();
    this.root.remove();
  }

  get floor() {
    return this.b.floors.find((f) => f.id === this.floorId);
  }

  set floor(next) {
    this.b.floors = this.b.floors.map((f) => (f.id === this.floorId ? next : f));
  }

  // ------------------------------------------------------------------ Änderungen

  /** Änderung mit Rückgängig-Schritt. fn bekommt die Etage und gibt die neue zurück (oder ändert sie). */
  change(fn, { merge = false } = {}) {
    if (!merge) {
      this.undoStack.push(JSON.stringify(this.b));
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    const f = structuredClone(this.floor);
    const out = fn(f);
    this.floor = out ?? f;
    this.dirty = true;
    this.render();
    this.renderBar();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.b));
    this.b = JSON.parse(this.undoStack.pop());
    this._afterHistory();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.b));
    this.b = JSON.parse(this.redoStack.pop());
    this._afterHistory();
  }

  _afterHistory() {
    if (!this.b.floors.some((f) => f.id === this.floorId)) this.floorId = this.b.floors[0]?.id;
    this.sel = null;
    this.dirty = true;
    this.render();
    this.renderBar();
    this.renderProps();
  }

  _onKey(ev) {
    if (ev.target?.closest?.("input, select, textarea")) return;
    if (ev.key === "Escape") {
      this.draft = null;
      this.sel = null;
      this.render();
      this.renderProps();
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && this.sel) {
      ev.preventDefault();
      this.deleteSelection();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      this.redo();
    }
  }

  // ------------------------------------------------------------------ Werkzeugleiste

  renderBar() {
    const bar = this.root.querySelector(".ed-bar");
    const floors = [...this.b.floors].sort((a, b) => a.elevation - b.elevation);
    bar.innerHTML = `
      <select class="floorsel" title="Etage">${floors.map((f) => `<option value="${esc(f.id)}"${f.id === this.floorId ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <span class="sep"></span>
      ${TOOLS.map(([k, icon, name]) => `<button data-tool="${k}" class="${this.tool === k ? "sel" : ""}" title="${name}"><ha-icon icon="${icon}"></ha-icon><span>${name}</span></button>`).join("")}
      <span class="sep"></span>
      <button data-act="undo" title="Rückgängig (Strg+Z)"${this.undoStack.length ? "" : " disabled"}><ha-icon icon="mdi:undo"></ha-icon></button>
      <button data-act="redo" title="Wiederholen"${this.redoStack.length ? "" : " disabled"}><ha-icon icon="mdi:redo"></ha-icon></button>
      <button data-act="gaps" title="Lücken zwischen Räumen schließen"><ha-icon icon="mdi:vector-combine"></ha-icon><span>Lücken schließen</span></button>
      <span class="grow"></span>
      <button data-act="preview" title="3D-Vorschau"><ha-icon icon="mdi:cube-outline"></ha-icon><span>3D-Vorschau</span></button>
      <button data-act="cancel"><ha-icon icon="mdi:close"></ha-icon><span>Abbrechen</span></button>
      <button data-act="save" class="primary"><ha-icon icon="mdi:content-save"></ha-icon><span>Speichern</span></button>`;
    bar.querySelector(".floorsel").addEventListener("change", (ev) => {
      this.floorId = ev.target.value;
      this.sel = null;
      this.draft = null;
      this.fit();
      this.render();
      this.renderProps();
    });
    this.hint.textContent = HINTS[this.tool];
  }

  async _onBar(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.tool) {
      this.tool = b.dataset.tool;
      this.draft = null;
      if (this.tool !== "select") this.sel = null;
      this.renderBar();
      this.render();
      this.renderProps();
      return;
    }
    const act = b.dataset.act;
    if (act === "undo") this.undo();
    else if (act === "redo") this.redo();
    else if (act === "gaps") {
      const { rooms, gaps } = closeGaps(this.floor.rooms);
      if (!gaps.length) this._toast("Keine Lücken gefunden.");
      else {
        this.change((f) => ({ ...f, rooms }));
        this._toast(`${gaps.length} Lücken geschlossen.`);
      }
    } else if (act === "preview") {
      this.onPreview(this.b);
      this.root.hidden = true;
      this._previewBack();
    } else if (act === "cancel") {
      if (this.dirty && !confirm("Änderungen verwerfen?")) return;
      this.onPreview(null);
      this.onClose();
    } else if (act === "save") {
      b.disabled = true;
      try {
        await this.onSave(this.b);
        this.dirty = false;
        this.onClose();
        return;
      } catch (err) {
        this._toast(`Speichern fehlgeschlagen: ${err.message ?? err.code ?? err}`);
      }
    }
    this.renderBar();
  }

  /** Während der 3D-Vorschau: schwebender Knopf zurück zum Editor. */
  _previewBack() {
    const btn = document.createElement("button");
    btn.className = "ed-back";
    btn.textContent = "← Zurück zum Editor";
    btn.style.cssText = "position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:9;padding:10px 16px;border-radius:20px;border:none;background:var(--primary-color,#03a9f4);color:#fff;font:inherit;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)";
    btn.addEventListener("click", () => {
      btn.remove();
      this.root.hidden = false;
      this.render();
    });
    this.root.parentElement.appendChild(btn);
  }

  _toast(text) {
    this.hint.textContent = text;
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => (this.hint.textContent = HINTS[this.tool]), 4000);
  }

  // ------------------------------------------------------------------ Ansicht

  fit() {
    const f = this.floor;
    const pts = [...(f?.rooms ?? []).flatMap((r) => r.points), ...(f?.outdoor ?? []).flatMap((o) => o.points)];
    if (!pts.length) pts.push([0, 0], [10, 10]);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    this.view = { x0: Math.min(...xs) - 1, z0: Math.min(...zs) - 1, x1: Math.max(...xs) + 1, z1: Math.max(...zs) + 1 };
    this._fitPending = true;
  }

  _transform() {
    const w = this.svg.clientWidth || 800;
    const h = this.svg.clientHeight || 600;
    if (this._fitPending || !this.scale) {
      const v = this.view;
      this.scale = Math.min(w / (v.x1 - v.x0), h / (v.z1 - v.z0));
      this.tx = (w - (v.x1 - v.x0) * this.scale) / 2 - v.x0 * this.scale;
      this.tz = (h - (v.z1 - v.z0) * this.scale) / 2 - v.z0 * this.scale;
      this._fitPending = false;
    }
    return { w, h };
  }

  toPlan(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return [(clientX - rect.left - this.tx) / this.scale, (clientY - rect.top - this.tz) / this.scale];
  }

  _snap(p, exceptRoom = null) {
    return snapPoint(p, { grid: this.b.settings?.grid ?? 0.05, vertices: floorVertices(this.floor, exceptRoom), tol: 10 / this.scale });
  }

  // ------------------------------------------------------------------ Zeichnen

  render() {
    if (!this.floor || this.root.hidden) return;
    const { w, h } = this._transform();
    const s = this.scale;
    const f = this.floor;
    const px = (v) => v / s; // Bildschirmpixel in Meter
    const P = ([x, z]) => `${r3(x)},${r3(z)}`;
    const parts = [];
    // Raster (1 m, alle 5 m kräftiger)
    const x0 = Math.floor(-this.tx / s) - 1;
    const x1 = Math.ceil((w - this.tx) / s) + 1;
    const z0 = Math.floor(-this.tz / s) - 1;
    const z1 = Math.ceil((h - this.tz) / s) + 1;
    if (s > 6) {
      let grid = "";
      for (let x = x0; x <= x1; x++) grid += `<line x1="${x}" y1="${z0}" x2="${x}" y2="${z1}" stroke-opacity="${x % 5 === 0 ? 0.28 : 0.12}"/>`;
      for (let z = z0; z <= z1; z++) grid += `<line x1="${x0}" y1="${z}" x2="${x1}" y2="${z}" stroke-opacity="${z % 5 === 0 ? 0.28 : 0.12}"/>`;
      parts.push(`<g stroke="currentColor" stroke-width="${px(1)}">${grid}</g>`);
    }
    // Etage darunter als Orientierung
    const below = [...this.b.floors].filter((x) => x.elevation < f.elevation).sort((a, b) => b.elevation - a.elevation)[0];
    if (below) parts.push(`<g fill="none" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="${px(4)} ${px(4)}" stroke-width="${px(1)}">${below.rooms.map((r) => `<polygon points="${r.points.map(P).join(" ")}"/>`).join("")}</g>`);
    // Garten
    for (const o of f.outdoor ?? []) {
      const col = (OUTDOOR_TYPES.find((t) => t[0] === o.type) ?? OUTDOOR_TYPES[0])[2];
      const sel = this.sel?.kind === "outdoor" && this.sel.id === o.id;
      parts.push(`<polygon data-kind="outdoor" data-id="${esc(o.id)}" points="${o.points.map(P).join(" ")}" fill="${col}" fill-opacity=".35" stroke="${sel ? "#03a9f4" : col}" stroke-width="${px(sel ? 3 : 1)}"/>`);
    }
    // Räume
    for (const r of f.rooms) {
      const sel = this.sel?.kind === "room" && this.sel.id === r.id;
      parts.push(`<polygon data-kind="room" data-id="${esc(r.id)}" points="${r.points.map(P).join(" ")}" fill="${MAT_COLORS[r.floor_material] ?? MAT_COLORS.wood}" fill-opacity="${sel ? 0.75 : 0.5}" stroke="${sel ? "#03a9f4" : "currentColor"}" stroke-opacity="${sel ? 1 : 0.5}" stroke-width="${px(sel ? 3 : 1)}"/>`);
    }
    // Wände (berechnet)
    const { segments, openings } = computeWalls(f, this.b.settings ?? {});
    parts.push(`<g fill="currentColor" fill-opacity=".55" pointer-events="none">${segments.map((seg) => `<polygon points="${pieceFootprint(seg, 0, seg.length).map(P).join(" ")}"/>`).join("")}</g>`);
    // Öffnungen
    for (const p of openings) {
      const o = p.opening;
      const g = openingGeometry(f, o);
      if (!g) continue;
      const col = o.type === "window" ? "#29b6f6" : o.type === "garage" ? "#9e9e9e" : "#8d6e63";
      const sel = this.sel?.kind === "opening" && this.sel.id === o.id;
      parts.push(`<line data-kind="opening" data-id="${esc(o.id)}" x1="${r3(g.p0[0])}" y1="${r3(g.p0[1])}" x2="${r3(g.p1[0])}" y2="${r3(g.p1[1])}" stroke="${sel ? "#03a9f4" : col}" stroke-width="${px(sel ? 10 : 7)}" stroke-linecap="butt"/>`);
      if (o.type === "door" && o.style !== "passage" && o.style !== "sliding") {
        // Aufschlagbogen zur Raumseite (rein) bzw. andere Seite (raus)
        const n = [-g.u[1], g.u[0]];
        const inside = signedArea(g.room.points) > 0 ? 1 : -1;
        const side = inside * (o.swing === "out" ? -1 : 1);
        const hingeAtEnd = (o.hinge === "right") === (inside > 0);
        const hp = hingeAtEnd ? g.p1 : g.p0;
        const free = hingeAtEnd ? g.p0 : g.p1;
        const tip = [hp[0] + n[0] * side * o.width, hp[1] + n[1] * side * o.width];
        parts.push(`<path d="M${P(tip)} A${o.width} ${o.width} 0 0 ${side * (hingeAtEnd ? -1 : 1) > 0 ? 1 : 0} ${P(free)} M${P(hp)} L${P(tip)}" fill="none" stroke="${col}" stroke-width="${px(1.2)}" pointer-events="none"/>`);
      }
    }
    // Möbel
    for (const m of f.furniture ?? []) {
      const sel = this.sel?.kind === "furniture" && this.sel.id === m.id;
      const fw = m.w || FURNITURE[m.type]?.[1] || 0.6;
      const fd = m.d || FURNITURE[m.type]?.[2] || 0.6;
      const name = FURNITURE[m.type]?.[0] ?? m.type;
      parts.push(
        `<g data-kind="furniture" data-id="${esc(m.id)}" transform="translate(${r3(m.x)} ${r3(m.z)}) rotate(${m.rotation || 0})">` +
          `<rect x="${-fw / 2}" y="${-fd / 2}" width="${fw}" height="${fd}" fill="${sel ? "#03a9f4" : "#795548"}" fill-opacity="${sel ? 0.45 : 0.3}" stroke="${sel ? "#03a9f4" : "#5d4037"}" stroke-width="${px(sel ? 2.5 : 1)}"/>` +
          `<line x1="${-fw / 2}" y1="${fd / 2}" x2="${fw / 2}" y2="${fd / 2}" stroke="#5d4037" stroke-width="${px(3)}"/>` +
          (s * Math.min(fw, fd) > 26 ? `<text x="0" y="${px(4)}" text-anchor="middle" font-size="${px(10)}" fill="currentColor">${esc(name)}</text>` : "") +
          `</g>`,
      );
      if (sel) {
        // Drehgriff vor der Vorderseite: lokales +z zeigt bei Drehung r nach (-sin r, cos r) (wie NeonPlan)
        const a = ((m.rotation || 0) * Math.PI) / 180;
        const off = fd / 2 + px(22);
        const dirX = -Math.sin(a);
        const dirZ = Math.cos(a);
        const gx = m.x + dirX * off;
        const gz = m.z + dirZ * off;
        parts.push(`<circle data-kind="rotate" data-id="${esc(m.id)}" cx="${r3(gx)}" cy="${r3(gz)}" r="${px(8)}" fill="#ff9800" stroke="#fff" stroke-width="${px(2)}"/>`);
      }
    }
    // Geräte: platzierte (gefüllt) und automatisch verteilte (hohl)
    const byArea = entitiesByArea(this.hass);
    const icons = buildingIcons(this.b, this.hass, byArea).get(f.id) ?? [];
    for (const ic of icons) {
      const sel = this.sel?.kind === "device" && this.sel.id === ic.entity_id;
      const letter = ic.kind === "light" ? "L" : ic.kind === "switch" ? "S" : ic.kind === "fan" ? "V" : ic.kind === "cover" ? "R" : ic.kind === "climate" ? "K" : "F";
      parts.push(
        `<g data-kind="device" data-id="${esc(ic.entity_id)}" transform="translate(${r3(ic.x)} ${r3(ic.z)})">` +
          `<circle r="${px(11)}" fill="${ic.manual ? "#ffc107" : "transparent"}" stroke="${sel ? "#03a9f4" : "#ff9800"}" stroke-width="${px(sel ? 3.5 : 2)}"/>` +
          `<text y="${px(4)}" text-anchor="middle" font-size="${px(11)}" font-weight="600" fill="currentColor">${letter}</text></g>`,
      );
    }
    // Raumnamen
    for (const r of f.rooms) {
      const c = labelPoint(r.points);
      const area = r.area_id ? (this.hass.areas?.[r.area_id]?.name ?? r.area_id) : "kein Bereich";
      parts.push(`<text x="${r3(c[0])}" y="${r3(c[1])}" text-anchor="middle" font-size="${px(13)}" font-weight="600" fill="currentColor">${esc(r.name)}</text>`);
      parts.push(`<text x="${r3(c[0])}" y="${r3(c[1] + px(15))}" text-anchor="middle" font-size="${px(10)}" fill="currentColor" fill-opacity=".6">${esc(area)} · ${Math.abs(signedArea(r.points)).toFixed(1)} m²</text>`);
    }
    // Griffe des gewählten Raums / der Gartenfläche: Eckpunkte und Einfügepunkte
    const poly = this.sel?.kind === "room" ? f.rooms.find((r) => r.id === this.sel.id) : this.sel?.kind === "outdoor" ? (f.outdoor ?? []).find((o) => o.id === this.sel.id) : null;
    if (poly) {
      poly.points.forEach((p, i) => {
        const q = poly.points[(i + 1) % poly.points.length];
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        parts.push(`<circle data-kind="insert" data-i="${i}" cx="${r3(mid[0])}" cy="${r3(mid[1])}" r="${px(6)}" fill="#fff" stroke="#03a9f4" stroke-width="${px(1.5)}"/><text x="${r3(mid[0])}" y="${r3(mid[1] + px(3.5))}" text-anchor="middle" font-size="${px(10)}" fill="#03a9f4">+</text>`);
      });
      poly.points.forEach((p, i) => parts.push(`<circle data-kind="vertex" data-i="${i}" cx="${r3(p[0])}" cy="${r3(p[1])}" r="${px(7)}" fill="#03a9f4" stroke="#fff" stroke-width="${px(2)}"/>`));
    }
    // Entwurf (Polygon / Rechteck)
    if (this.draft?.points?.length) {
      const pts = [...this.draft.points, ...(this.draft.hover ? [this.draft.hover] : [])];
      parts.push(`<polyline points="${pts.map(P).join(" ")}" fill="#03a9f4" fill-opacity=".15" stroke="#03a9f4" stroke-width="${px(2)}" stroke-dasharray="${px(6)} ${px(4)}"/>`);
      for (const p of this.draft.points) parts.push(`<circle cx="${r3(p[0])}" cy="${r3(p[1])}" r="${px(5)}" fill="#03a9f4"/>`);
    }
    if (this.draft?.rect) {
      const [a, b] = this.draft.rect;
      parts.push(`<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="#03a9f4" fill-opacity=".2" stroke="#03a9f4" stroke-width="${px(2)}"/>`);
      parts.push(`<text x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2}" text-anchor="middle" font-size="${px(12)}" fill="#03a9f4">${Math.abs(b[0] - a[0]).toFixed(2)} × ${Math.abs(b[1] - a[1]).toFixed(2)} m</text>`);
    }
    this.svg.classList.toggle("select", this.tool === "select");
    this.svg.innerHTML = `<g transform="translate(${this.tx} ${this.tz}) scale(${s})" color="var(--primary-text-color, #222)">${parts.join("")}</g>`;
  }

  // ------------------------------------------------------------------ Zeiger

  _bindSvg() {
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    this.svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this._zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0015));
    }, { passive: false });
    this.svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.svg.addEventListener("dblclick", () => {
      if (this.draft?.points?.length >= 3) this._finishPolygon();
    });
    this.svg.addEventListener("pointerdown", (ev) => {
      this.svg.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        drag = null;
        return;
      }
      const p = this.toPlan(ev.clientX, ev.clientY);
      // Mitte/rechts: immer Ansicht verschieben
      if (ev.button === 1 || ev.button === 2) {
        drag = { mode: "pan", sx: ev.clientX, sz: ev.clientY, tx: this.tx, tz: this.tz };
        return;
      }
      drag = this._startDrag(ev, p);
    });
    this.svg.addEventListener("pointermove", (ev) => {
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.tx += c[0] - pinch.c[0];
        this.tz += c[1] - pinch.c[1];
        this._zoomAt(c[0], c[1], d / pinch.d);
        pinch = { d, c };
        return;
      }
      const p = this.toPlan(ev.clientX, ev.clientY);
      if (!drag) {
        if (this.draft?.points && (this.tool === "poly" || this.tool === "outdoor")) {
          this.draft.hover = this._snap(p);
          this.render();
        }
        return;
      }
      this._moveDrag(drag, ev, p);
    });
    const end = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag) this._endDrag(drag, ev, this.toPlan(ev.clientX, ev.clientY));
      drag = null;
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
  }

  _zoomAt(cx, cy, k) {
    const rect = this.svg.getBoundingClientRect();
    const sx = cx - rect.left;
    const sy = cy - rect.top;
    const next = Math.min(400, Math.max(4, this.scale * k));
    k = next / this.scale;
    this.tx = sx - (sx - this.tx) * k;
    this.tz = sy - (sy - this.tz) * k;
    this.scale = next;
    this.render();
  }

  _startDrag(ev, p) {
    const t = ev.target.closest("[data-kind]");
    const kind = t?.dataset.kind;
    const id = t?.dataset.id;
    const f = this.floor;
    const tool = this.tool;
    if (tool === "rect") return { mode: "rect", a: this._snap(p) };
    if (tool === "poly" || tool === "outdoor") {
      const q = this._snap(p);
      if (!this.draft?.points) this.draft = { points: [q], kind: tool };
      else {
        const first = this.draft.points[0];
        if (this.draft.points.length >= 3 && Math.hypot(q[0] - first[0], q[1] - first[1]) < 12 / this.scale) {
          this._finishPolygon();
          return null;
        }
        this.draft.points.push(q);
      }
      this.render();
      return null;
    }
    if (tool === "window" || tool === "door" || tool === "garage") {
      const hit = nearestEdge(f, p, 24 / this.scale + 0.15);
      if (!hit) {
        this._toast("Dort ist keine Wand – näher an eine Raumkante tippen.");
        return null;
      }
      const o = newOpening(tool, hit, newId(tool, allIds(this.b)));
      this.change((fl) => {
        fl.openings.push(o);
      });
      this.sel = { kind: "opening", id: o.id };
      this.tool = "select";
      this.renderBar();
      this.render();
      this.renderProps();
      return null;
    }
    if (tool === "furniture") {
      const def = FURNITURE[this.furnType];
      const m = { id: newId("m", allIds(this.b)), type: this.furnType, x: r3(this._snap(p)[0]), z: r3(this._snap(p)[1]), rotation: 0, w: def[1], d: def[2], h: def[3], variant: null, entity: null };
      this.change((fl) => {
        fl.furniture = [...(fl.furniture ?? []), m];
      });
      this.sel = { kind: "furniture", id: m.id };
      // gleich bearbeiten (drehen, Größe): zurück in den Auswahl-Modus
      this.tool = "select";
      this.renderBar();
      this.renderProps();
      this.render();
      return { mode: "furniture", id: m.id, off: [0, 0] };
    }
    if (tool === "device") {
      if (!this.deviceEntity) {
        this._toast("Erst rechts ein Gerät auswählen.");
        return null;
      }
      this._placeDevice(this.deviceEntity, p);
      this.sel = { kind: "device", id: this.deviceEntity };
      this.renderProps();
      return null;
    }
    // Auswählen
    if (kind === "vertex" || kind === "insert") {
      const poly = this._selectedPoly();
      if (!poly) return null;
      const i = Number(t.dataset.i);
      if (kind === "insert") {
        const a = poly.points[i];
        const b = poly.points[(i + 1) % poly.points.length];
        const mid = this._snap([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        if (this.sel.kind === "room") this.change((fl) => insertVertex(fl, poly.id, i, mid));
        else this.change((fl) => ({ ...fl, outdoor: fl.outdoor.map((o) => (o.id === poly.id ? { ...o, points: [...o.points.slice(0, i + 1), mid, ...o.points.slice(i + 1)], heights: undefined } : o)) }));
        return { mode: "vertex", i: i + 1, merge: true };
      }
      return { mode: "vertex", i, first: true };
    }
    if (kind === "rotate") return { mode: "rotate", id };
    if (kind === "device") {
      this.sel = { kind: "device", id };
      this.renderProps();
      this.render();
      return { mode: "device", id, first: true };
    }
    if (kind === "opening") {
      this.sel = { kind: "opening", id };
      this.renderProps();
      this.render();
      return { mode: "opening", id, first: true };
    }
    if (kind === "furniture") {
      const m = f.furniture.find((x) => x.id === id);
      this.sel = { kind: "furniture", id };
      this.renderProps();
      this.render();
      return { mode: "furniture", id, off: [p[0] - m.x, p[1] - m.z], first: true };
    }
    if (kind === "room") {
      this.sel = { kind: "room", id };
      this.renderProps();
      this.render();
      return { mode: "room", id, start: p, moved: false, first: true };
    }
    if (kind === "outdoor") {
      this.sel = { kind: "outdoor", id };
      this.renderProps();
      this.render();
      return { mode: "outdoor", id, start: p, first: true };
    }
    // leere Fläche: Auswahl aufheben, Ansicht verschieben
    if (this.sel) {
      this.sel = null;
      this.renderProps();
      this.render();
    }
    return { mode: "pan", sx: ev.clientX, sz: ev.clientY, tx: this.tx, tz: this.tz };
  }

  /** Erste Bewegung eines Ziehvorgangs legt einen Rückgängig-Schritt an, weitere werden zusammengefasst. */
  _dragChange(drag, fn) {
    this.change(fn, { merge: !drag.first });
    drag.first = false;
  }

  _moveDrag(drag, ev, p) {
    const f = this.floor;
    switch (drag.mode) {
      case "pan":
        this.tx = drag.tx + ev.clientX - drag.sx;
        this.tz = drag.tz + ev.clientY - drag.sz;
        this.render();
        break;
      case "rect":
        this.draft = { rect: [drag.a, this._snap(p)] };
        this.render();
        break;
      case "vertex": {
        const poly = this._selectedPoly();
        const q = this._snap(p, this.sel.kind === "room" ? poly.id : null);
        this._dragChange(drag, (fl) => {
          const list = this.sel.kind === "room" ? fl.rooms : fl.outdoor;
          const target = list.find((x) => x.id === poly.id);
          target.points[drag.i] = q;
          if (this.sel.kind === "outdoor") delete target.heights;
        });
        break;
      }
      case "room": {
        const room = f.rooms.find((r) => r.id === drag.id);
        const snapped = this._snap([room.points[0][0] + p[0] - drag.start[0], room.points[0][1] + p[1] - drag.start[1]], room.id);
        const dx = snapped[0] - room.points[0][0];
        const dz = snapped[1] - room.points[0][1];
        if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) break;
        drag.start = [drag.start[0] + dx, drag.start[1] + dz];
        this._dragChange(drag, (fl) => {
          fl.rooms = fl.rooms.map((r) => (r.id === drag.id ? moveRoom(r, dx, dz) : r));
        });
        break;
      }
      case "outdoor": {
        const dx = r3(p[0] - drag.start[0]);
        const dz = r3(p[1] - drag.start[1]);
        drag.start = p;
        this._dragChange(drag, (fl) => {
          fl.outdoor = fl.outdoor.map((o) => (o.id === drag.id ? { ...o, points: o.points.map(([x, z]) => [r3(x + dx), r3(z + dz)]) } : o));
        });
        break;
      }
      case "opening": {
        const o = f.openings.find((x) => x.id === drag.id);
        const g = openingGeometry(f, o);
        if (!g) break;
        const a = g.room.points[o.edge];
        const b = g.room.points[(o.edge + 1) % g.room.points.length];
        const pr = projectOnSegment(p, a, b);
        const grid = this.b.settings?.grid ?? 0.05;
        const off = clampOffset(Math.round(pr.t / grid) * grid, o.width, pr.len);
        this._dragChange(drag, (fl) => {
          fl.openings.find((x) => x.id === drag.id).offset = off;
        });
        this.renderProps();
        break;
      }
      case "furniture": {
        const q = snapPoint([p[0] - drag.off[0], p[1] - drag.off[1]], { grid: this.b.settings?.grid ?? 0.05 });
        this._dragChange(drag, (fl) => {
          const m = fl.furniture.find((x) => x.id === drag.id);
          m.x = q[0];
          m.z = q[1];
        });
        break;
      }
      case "rotate": {
        const m = f.furniture.find((x) => x.id === drag.id);
        // Vorderseite zeigt zum Zeiger; in 15°-Schritten
        let deg = (Math.atan2(-(p[0] - m.x), p[1] - m.z) * 180) / Math.PI;
        if (!ev.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((deg % 360) + 360) % 360;
        this._dragChange(drag, (fl) => {
          fl.furniture.find((x) => x.id === drag.id).rotation = deg;
        });
        this.renderProps();
        break;
      }
      case "device":
        this._placeDevice(drag.id, p, !drag.first);
        drag.first = false;
        break;
    }
  }

  _endDrag(drag, ev, p) {
    if (drag.mode === "rect" && this.draft?.rect) {
      const [a, b] = this.draft.rect;
      this.draft = null;
      if (Math.abs(b[0] - a[0]) < 0.3 || Math.abs(b[1] - a[1]) < 0.3) {
        this.render();
        return;
      }
      const room = rectRoom(a, b, newId("room", allIds(this.b)), `Raum ${this.floor.rooms.length + 1}`);
      this.change((fl) => {
        fl.rooms.push(room);
      });
      this.sel = { kind: "room", id: room.id };
      this.tool = "select";
      this.renderBar();
      this.render();
      this.renderProps();
    }
    if (drag.mode === "furniture" || drag.mode === "rotate" || drag.mode === "opening") this.renderProps();
  }

  _finishPolygon() {
    const d = this.draft;
    this.draft = null;
    if (!d?.points || !validPolygon(d.points)) {
      this.render();
      return;
    }
    if (d.kind === "outdoor") {
      const o = { id: newId("aussen", allIds(this.b)), type: "lawn", name: "Garten", points: d.points };
      this.change((fl) => {
        fl.outdoor = [...(fl.outdoor ?? []), o];
      });
      this.sel = { kind: "outdoor", id: o.id };
    } else {
      const room = { id: newId("room", allIds(this.b)), name: `Raum ${this.floor.rooms.length + 1}`, area_id: null, floor_material: "wood", points: d.points };
      this.change((fl) => {
        fl.rooms.push(room);
      });
      this.sel = { kind: "room", id: room.id };
    }
    this.tool = "select";
    this.renderBar();
    this.render();
    this.renderProps();
  }

  _selectedPoly() {
    if (this.sel?.kind === "room") return this.floor.rooms.find((r) => r.id === this.sel.id);
    if (this.sel?.kind === "outdoor") return (this.floor.outdoor ?? []).find((o) => o.id === this.sel.id);
    return null;
  }

  /** Gerät an einen Punkt setzen (placements[] dieser Etage; aus anderen Etagen entfernt). */
  _placeDevice(entityId, p, merge = false) {
    const q = snapPoint(p, { grid: this.b.settings?.grid ?? 0.05 });
    this.undoStack.push(JSON.stringify(this.b));
    if (merge) this.undoStack.pop();
    else this.redoStack = [];
    for (const fl of this.b.floors) fl.placements = (fl.placements ?? []).filter((x) => x.entity_id !== entityId || fl.id === this.floorId);
    const f = this.floor;
    const existing = f.placements.find((x) => x.entity_id === entityId);
    if (existing) Object.assign(existing, { x: q[0], z: q[1] });
    else f.placements.push({ entity_id: entityId, x: q[0], z: q[1], y: null });
    this.dirty = true;
    this.render();
    this.renderBar();
  }

  deleteSelection() {
    const sel = this.sel;
    if (!sel) return;
    if (sel.kind === "room") this.change((fl) => removeRoom(fl, sel.id));
    else if (sel.kind === "opening") this.change((fl) => ({ ...fl, openings: fl.openings.filter((o) => o.id !== sel.id) }));
    else if (sel.kind === "furniture") this.change((fl) => ({ ...fl, furniture: fl.furniture.filter((m) => m.id !== sel.id) }));
    else if (sel.kind === "outdoor") this.change((fl) => ({ ...fl, outdoor: fl.outdoor.filter((o) => o.id !== sel.id) }));
    else if (sel.kind === "device") this.change((fl) => ({ ...fl, placements: fl.placements.filter((x) => x.entity_id !== sel.id) }));
    this.sel = null;
    this.renderProps();
  }

  // ------------------------------------------------------------------ Eigenschaften

  renderProps() {
    const el = this.props;
    const f = this.floor;
    const sel = this.sel;
    const hass = this.hass;
    const areas = Object.values(hass.areas ?? {}).sort((a, b) => a.name.localeCompare(b.name, "de"));
    const areaOptions = (current) =>
      `<option value="">– kein Bereich –</option>` + areas.map((a) => `<option value="${esc(a.area_id)}"${a.area_id === current ? " selected" : ""}>${esc(a.name)}</option>`).join("");
    const entityList = (id, domains, filter = () => true) =>
      `<datalist id="${id}">${Object.keys(hass.states)
        .filter((e) => domains.includes(e.split(".")[0]) && filter(hass.states[e]))
        .sort()
        .map((e) => `<option value="${esc(e)}">${esc(hass.states[e].attributes.friendly_name ?? "")}</option>`)
        .join("")}</datalist>`;
    const num = (key, label, value, step = 0.05) => `<div><label>${label}</label><input type="number" step="${step}" data-num="${key}" value="${value ?? ""}"></div>`;

    if (this.tool === "furniture") {
      el.innerHTML = `<h3>Möbel einfügen</h3><p class="muted">Möbel wählen, dann in den Plan tippen.</p><div class="list">${Object.entries(FURNITURE)
        .map(([k, v]) => `<button data-furn="${k}" class="${k === this.furnType ? "sel" : ""}">${esc(v[0])}</button>`)
        .join("")}</div>`;
      el.querySelector(".list").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-furn]");
        if (!b) return;
        this.furnType = b.dataset.furn;
        this.renderProps();
      });
      return;
    }
    if (this.tool === "device") {
      const icons = buildingIcons(this.b, hass, entitiesByArea(hass)).get(f.id) ?? [];
      const byArea = entitiesByArea(hass);
      const all = [...new Set([...icons.map((i) => i.entity_id), ...f.rooms.flatMap((r) => (byArea.get(r.area_id) ?? []).filter((id) => iconKind(hass.states[id])))])];
      el.innerHTML = `<h3>Gerät platzieren</h3><p class="muted">Gerät wählen, dann an seine Stelle tippen. Gefüllte Kreise sind schon platziert.</p><div class="list">${all
        .map((e) => {
          const placed = f.placements.some((x) => x.entity_id === e);
          return `<button data-dev="${esc(e)}" class="${e === this.deviceEntity ? "sel" : ""}">${placed ? "● " : "○ "}${esc(hass.states[e]?.attributes.friendly_name ?? e)}</button>`;
        })
        .join("") || `<span class="muted">Keine Geräte in den Bereichen dieser Etage.</span>`}</div>`;
      el.querySelector(".list").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-dev]");
        if (!b) return;
        this.deviceEntity = b.dataset.dev;
        this.renderProps();
      });
      return;
    }

    if (!sel) {
      const haFloors = Object.values(hass.floors ?? {});
      el.innerHTML = `<h3>Etage ${esc(f.name)}</h3>
        <label>Name</label><input data-floor="name" value="${esc(f.name)}">
        <div class="row2">${num("elevation", "Höhe über Boden (m)", f.elevation)}${num("height", "Raumhöhe (m)", f.height)}</div>
        ${haFloors.length ? `<label>Etage in Home Assistant</label><select data-floor="ha_floor"><option value="">–</option>${haFloors.map((x) => `<option value="${esc(x.floor_id)}"${x.floor_id === f.ha_floor ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
        <div class="row2">${num("wall_exterior", "Außenwand (m)", this.b.settings.wall_exterior ?? 0.24, 0.01)}${num("wall_interior", "Innenwand (m)", this.b.settings.wall_interior ?? 0.12, 0.01)}</div>
        <p class="muted">${f.rooms.length} Räume · ${f.openings.length} Fenster/Türen · ${(f.furniture ?? []).length} Möbel</p>
        <div class="btns"><button data-act="addfloor">+ Etage</button><button data-act="delfloor" class="danger">Etage löschen</button></div>`;
      el.querySelectorAll("[data-floor]").forEach((inp) =>
        inp.addEventListener("change", () => this.change((fl) => {
          fl[inp.dataset.floor] = inp.value || (inp.dataset.floor === "ha_floor" ? null : fl[inp.dataset.floor]);
        })),
      );
      el.querySelectorAll("[data-num]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const v = Number(inp.value);
          if (!Number.isFinite(v)) return;
          if (inp.dataset.num.startsWith("wall_")) {
            this.undoStack.push(JSON.stringify(this.b));
            this.b.settings[inp.dataset.num] = v;
            this.dirty = true;
            this.render();
          } else this.change((fl) => {
            fl[inp.dataset.num] = v;
          });
        }),
      );
      el.querySelector("[data-act=addfloor]").addEventListener("click", () => {
        const top = [...this.b.floors].sort((a, b) => b.elevation - a.elevation)[0];
        const id = newId("floor", allIds(this.b));
        this.undoStack.push(JSON.stringify(this.b));
        this.b.floors.push({ id, name: "Neue Etage", elevation: top ? r3(top.elevation + top.height + 0.25) : 0, height: 2.5, cut_height: 1.15, rooms: [], openings: [], furniture: [], placements: [], background: null, outdoor: [], walls: [], ha_floor: null });
        this.floorId = id;
        this.dirty = true;
        this.fit();
        this.renderBar();
        this.render();
        this.renderProps();
      });
      el.querySelector("[data-act=delfloor]").addEventListener("click", () => {
        if (this.b.floors.length < 2 || !confirm(`Etage „${f.name}“ mit allen Räumen löschen?`)) return;
        this.undoStack.push(JSON.stringify(this.b));
        this.b.floors = this.b.floors.filter((x) => x.id !== f.id);
        this.floorId = this.b.floors[0].id;
        this.dirty = true;
        this.fit();
        this.renderBar();
        this.render();
        this.renderProps();
      });
      return;
    }

    const bindNums = (apply) =>
      el.querySelectorAll("[data-num]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const v = inp.value === "" ? null : Number(inp.value);
          if (v !== null && !Number.isFinite(v)) return;
          this.change((fl) => apply(fl, inp.dataset.num, v));
          this.renderProps();
        }),
      );
    const bindDelete = () => el.querySelector("[data-act=del]")?.addEventListener("click", () => this.deleteSelection());

    if (sel.kind === "room") {
      const r = f.rooms.find((x) => x.id === sel.id);
      if (!r) return this._clearSel();
      el.innerHTML = `<h3>Raum</h3>
        <label>Name</label><input data-room="name" value="${esc(r.name)}">
        <label>Bereich in Home Assistant</label><select data-room="area_id">${areaOptions(r.area_id)}</select>
        <label>Bodenbelag</label><select data-room="floor_material">${MATERIALS.map(([k, n]) => `<option value="${k}"${k === r.floor_material ? " selected" : ""}>${n}</option>`).join("")}</select>
        <p class="muted">${Math.abs(signedArea(r.points)).toFixed(2)} m² · ${r.points.length} Ecken. Ecken ziehen, „+“ fügt eine Ecke ein, Entf löscht den Raum.</p>
        <div class="btns"><button data-act="delvertex">Letzte gewählte Ecke löschen</button><button data-act="del" class="danger">Raum löschen</button></div>`;
      el.querySelectorAll("[data-room]").forEach((inp) =>
        inp.addEventListener("change", () => this.change((fl) => {
          const room = fl.rooms.find((x) => x.id === r.id);
          room[inp.dataset.room] = inp.value || (inp.dataset.room === "area_id" ? null : room[inp.dataset.room]);
          if (inp.dataset.room === "area_id" && inp.value && /^Raum \d+$/.test(room.name)) room.name = hass.areas?.[inp.value]?.name ?? room.name;
          this.renderProps();
        })),
      );
      el.querySelector("[data-act=delvertex]").addEventListener("click", () => {
        const i = this._lastVertex ?? r.points.length - 1;
        this.change((fl) => removeVertex(fl, r.id, Math.min(i, r.points.length - 1)));
        this.renderProps();
      });
      bindDelete();
      return;
    }
    if (sel.kind === "opening") {
      const o = f.openings.find((x) => x.id === sel.id);
      if (!o) return this._clearSel();
      const typeName = { window: "Fenster", door: "Tür", garage: "Garagentor" }[o.type];
      const linkField = (key, label, domains, filter) => {
        const v = o[key];
        const mode = v === "none" ? "none" : v ? "fix" : "auto";
        return `<label>${label}</label><select data-linkmode="${key}"><option value="auto"${mode === "auto" ? " selected" : ""}>automatisch (Bereich)</option><option value="none"${mode === "none" ? " selected" : ""}>keiner</option><option value="fix"${mode === "fix" ? " selected" : ""}>bestimmter …</option></select>
          ${mode === "fix" ? `<input data-link="${key}" list="dl_${key}" value="${esc(v)}" placeholder="Entität">${entityList(`dl_${key}`, domains, filter)}` : ""}`;
      };
      el.innerHTML = `<h3>${typeName}</h3>
        <label>Art</label><select data-o="type">${[["window", "Fenster"], ["door", "Tür"], ["garage", "Garagentor"]].map(([k, n]) => `<option value="${k}"${k === o.type ? " selected" : ""}>${n}</option>`).join("")}</select>
        ${o.type === "door" ? `<label>Aussehen</label><select data-o="style">${STYLES.map(([k, n]) => `<option value="${k}"${(o.style ?? "") === k ? " selected" : ""}>${n}</option>`).join("")}</select>` : ""}
        <div class="row3">${num("width", "Breite", o.width)}${num("height", "Höhe", o.height)}${num("sill", "Brüstung", o.sill)}</div>
        ${num("offset", "Mitte ab Kantenanfang (m)", o.offset)}
        ${o.type !== "garage" ? `<div class="row3">
          <div><label>Anschlag</label><select data-o="hinge"><option value="left"${o.hinge !== "right" ? " selected" : ""}>links</option><option value="right"${o.hinge === "right" ? " selected" : ""}>rechts</option></select></div>
          <div><label>Öffnet</label><select data-o="swing"><option value="in"${o.swing !== "out" ? " selected" : ""}>nach innen</option><option value="out"${o.swing === "out" ? " selected" : ""}>nach außen</option></select></div>
          <div><label>Flügel</label><select data-o="leaves"><option value="1"${o.leaves !== 2 ? " selected" : ""}>1</option><option value="2"${o.leaves === 2 ? " selected" : ""}>2</option></select></div></div>` : ""}
        ${linkField("contact", "Kontakt (offen/zu)", ["binary_sensor", "sensor"], (s) => ["window", "door", "opening", "garage_door", undefined].includes(s.attributes.device_class))}
        ${linkField("cover", o.type === "garage" ? "Tor-Antrieb" : "Rollladen", ["cover"])}
        <p class="muted">Im Plan entlang der Wand ziehen zum Verschieben.</p>
        <div class="btns"><button data-act="del" class="danger">Löschen</button></div>`;
      el.querySelectorAll("[data-o]").forEach((inp) =>
        inp.addEventListener("change", () => {
          this.change((fl) => {
            const x = fl.openings.find((y) => y.id === o.id);
            const k = inp.dataset.o;
            x[k] = k === "leaves" ? Number(inp.value) : k === "style" ? inp.value || null : inp.value;
            if (k === "type") Object.assign(x, newOpening(inp.value, { room: fl.rooms.find((r) => r.id === x.room_id), edge: x.edge, offset: x.offset, len: openingGeometry(fl, x)?.len ?? 2 }, x.id), { contact: x.contact, cover: x.cover });
          });
          this.renderProps();
        }),
      );
      el.querySelectorAll("[data-linkmode]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const k = inp.dataset.linkmode;
          this.change((fl) => {
            fl.openings.find((y) => y.id === o.id)[k] = inp.value === "auto" ? null : inp.value === "none" ? "none" : o[k] && o[k] !== "none" ? o[k] : "";
          });
          this.renderProps();
        }),
      );
      el.querySelectorAll("[data-link]").forEach((inp) =>
        inp.addEventListener("change", () => this.change((fl) => {
          fl.openings.find((y) => y.id === o.id)[inp.dataset.link] = inp.value.trim() || null;
        })),
      );
      bindNums((fl, k, v) => {
        const x = fl.openings.find((y) => y.id === o.id);
        if (v === null) return;
        x[k] = k === "offset" ? clampOffset(v, x.width, openingGeometry(fl, x)?.len ?? v * 2) : v;
      });
      bindDelete();
      return;
    }
    if (sel.kind === "furniture") {
      const m = (f.furniture ?? []).find((x) => x.id === sel.id);
      if (!m) return this._clearSel();
      const lamp = m.type.startsWith("lamp_") || m.type === "led_strip";
      el.innerHTML = `<h3>${esc(FURNITURE[m.type]?.[0] ?? m.type)}</h3>
        <label>Typ</label><select data-m="type">${Object.entries(FURNITURE).map(([k, v]) => `<option value="${k}"${k === m.type ? " selected" : ""}>${esc(v[0])}</option>`).join("")}</select>
        <div class="row3">${num("w", "Breite", m.w)}${num("d", "Tiefe", m.d)}${num("h", "Höhe", m.h)}</div>
        <div class="row2">${num("rotation", "Drehung (°)", m.rotation, 15)}${num("mount_y", "Höhe über Boden", m.mount_y ?? "", 0.05)}</div>
        <label>${lamp ? "Licht (Entität)" : "Verknüpfte Entität (optional)"}</label><input data-m="entity" list="dl_furn" value="${esc(m.entity && m.entity !== "none" ? m.entity : "")}" placeholder="${lamp ? "light.…" : "z. B. media_player.…"}">${entityList("dl_furn", lamp ? ["light", "switch"] : ["light", "switch", "media_player", "fan", "climate", "vacuum", "sensor"])}
        <p class="muted">Ziehen verschiebt, der orange Punkt dreht (Umschalt = frei).</p>
        <div class="btns"><button data-act="dup">Duplizieren</button><button data-act="del" class="danger">Löschen</button></div>`;
      el.querySelector("[data-m=type]").addEventListener("change", (ev) =>
        this.change((fl) => {
          const x = fl.furniture.find((y) => y.id === m.id);
          const def = FURNITURE[ev.target.value];
          Object.assign(x, { type: ev.target.value, w: def[1], d: def[2], h: def[3] });
          this.renderProps();
        }),
      );
      el.querySelector("[data-m=entity]").addEventListener("change", (ev) =>
        this.change((fl) => {
          fl.furniture.find((y) => y.id === m.id).entity = ev.target.value.trim() || null;
        }),
      );
      bindNums((fl, k, v) => {
        fl.furniture.find((y) => y.id === m.id)[k] = k === "mount_y" ? v : v ?? 0;
      });
      el.querySelector("[data-act=dup]").addEventListener("click", () => {
        const copy = { ...structuredClone(m), id: newId("m", allIds(this.b)), x: r3(m.x + 0.3), z: r3(m.z + 0.3) };
        this.change((fl) => {
          fl.furniture.push(copy);
        });
        this.sel = { kind: "furniture", id: copy.id };
        this.renderProps();
      });
      bindDelete();
      return;
    }
    if (sel.kind === "device") {
      const st = hass.states[sel.id];
      const pl = f.placements.find((x) => x.entity_id === sel.id);
      el.innerHTML = `<h3>${esc(st?.attributes.friendly_name ?? sel.id)}</h3><p class="muted">${esc(sel.id)}</p>
        ${pl ? `<div class="row3">${num("x", "x", pl.x)}${num("z", "z", pl.z)}${num("y", "Höhe", pl.y ?? "")}</div><p class="muted">Höhe leer = Standard (Lampen unter der Decke).</p>` : `<p class="muted">Automatisch im Raum verteilt. Ziehen legt die Position fest.</p>`}
        <div class="btns">${pl ? `<button data-act="del">Automatisch platzieren</button>` : ""}</div>`;
      bindNums((fl, k, v) => {
        const x = fl.placements.find((y) => y.entity_id === sel.id);
        x[k] = k === "y" ? v : v ?? x[k];
      });
      bindDelete();
      return;
    }
    if (sel.kind === "outdoor") {
      const o = (f.outdoor ?? []).find((x) => x.id === sel.id);
      if (!o) return this._clearSel();
      el.innerHTML = `<h3>Gartenfläche</h3>
        <label>Name</label><input data-g="name" value="${esc(o.name ?? "")}">
        <label>Art</label><select data-g="type">${OUTDOOR_TYPES.map(([k, n]) => `<option value="${k}"${k === o.type ? " selected" : ""}>${n}</option>`).join("")}</select>
        <label>Bereich (für Gartenlicht, Sensoren)</label><select data-g="area_id">${areaOptions(o.area_id)}</select>
        ${o.heights ? `<p class="muted">Schräge Fläche (Hang). Beim Verschieben einer Ecke wird sie wieder eben.</p>` : ""}
        <div class="btns"><button data-act="del" class="danger">Löschen</button></div>`;
      el.querySelectorAll("[data-g]").forEach((inp) =>
        inp.addEventListener("change", () => this.change((fl) => {
          const x = fl.outdoor.find((y) => y.id === o.id);
          const v = inp.value || null;
          if (v === null) delete x[inp.dataset.g];
          else x[inp.dataset.g] = v;
        })),
      );
      bindDelete();
    }
  }

  _clearSel() {
    this.sel = null;
    this.renderProps();
  }
}
