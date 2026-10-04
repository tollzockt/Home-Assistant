// 2D-Editor für eine Etage (SVG): Räume zeichnen und zuordnen, Fenster/Türen setzen und
// verknüpfen, Möbel und Geräte platzieren, Gartenflächen. Arbeitet auf einer Kopie des Gebäudes;
// Speichern übergibt sie an onSave.

import { buildingIcons, entitiesByArea, iconKind } from "./devices.js";
import {
  alignToFloor,
  allIds,
  clampOffset,
  cleanFloor,
  floorVertices,
  insertVertex,
  moveEdge,
  moveRoom,
  moveVertex,
  nearestEdge,
  nearestWall,
  newId,
  newOpening,
  openingGeometry,
  projectOnSegment,
  pushOutOfWalls,
  rectRoom,
  removeRoom,
  removeVertex,
  removeWall,
  snapPoint,
  snapWallEnd,
  snapToWall,
  validPolygon,
  wallFaces,
} from "./edit-ops.js";
import { FURNITURE, FURNITURE_CATEGORIES } from "./furniture.js";
import { COLOR_SWATCHES, FLOOR_MATERIALS, floorColor, normalize } from "./model.js";
import { ROOF_TYPES, autoHeights, roofFloor, roofSettings } from "./exterior.js";
import { ROOF_HINTS, ROOF_TOOLS, roofMoveDrag, roofProps, roofStartDrag, roofSvg, textureField } from "./editor-roof.js";
import { HouseScene } from "./scene.js";
import { furnitureThumb, renderThumbs } from "./thumbs.js";
import { closeGaps, computeWalls, labelPoint, pieceFootprint, signedArea } from "./walls.js";

const SVGNS = "http://www.w3.org/2000/svg";
const OUTDOOR_TYPES = [
  ["lawn", "Rasen", "#6aa84f"],
  ["terrace", "Terrasse", "#c2b39b"],
  ["path", "Weg", "#bcb4a6"],
  ["driveway", "Einfahrt", "#8c8c8c"],
  ["pool", "Pool", "#2f9fe0"],
  ["bed", "Beet", "#6b4a2f"],
  ["hedge", "Hecke", "#2f6b2a"],
  ["fence", "Zaun", "#8a6f52"],
  ["balcony", "Balkon", "#b5ada3"],
  ["gravel", "Kies", "#c4beb2"],
  ["paving", "Pflaster", "#a39a8e"],
  ["rockery", "Steingarten", "#8a8378"],
];
const RAILINGS = [
  ["", "Standard (Balkon: Glas, sonst keins)"],
  ["none", "kein Geländer"],
  ["glass", "Glas"],
  ["bars", "Stäbe"],
  ["wood", "Holzzaun"],
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
  ["wall", "mdi:wall", "Wand"],
  ["window", "mdi:window-closed-variant", "Fenster"],
  ["door", "mdi:door", "Tür"],
  ["garage", "mdi:garage", "Garagentor"],
  ["furniture", "mdi:sofa-outline", "Möbel"],
  ["device", "mdi:lightbulb-on-outline", "Gerät"],
  ["outdoor", "mdi:tree-outline", "Garten"],
];
const HINTS = {
  select: "Antippen zum Auswählen, Ziehen zum Verschieben. Raum gewählt: blaue Wand ziehen verschiebt die Wand (Nachbarräume gehen mit, Alt = nur dieser Raum) (Möbel rasten mit dem Magnet an Wänden ein, Alt = frei). Pfeiltasten schieben (Umschalt = 1 cm), R dreht. Leere Fläche ziehen = Ansicht verschieben.",
  rect: "Ziehen: Rechteck-Raum von Ecke zu Ecke.",
  poly: "Punkte antippen, ersten Punkt erneut antippen (oder Doppelklick) zum Abschließen. Esc bricht ab.",
  wall: "Anfang antippen, Ende antippen: gerade Wand (rastet bei 0/45/90° und an Ecken ein, Umschalt = frei). Weiter tippen setzt die nächste Wand an, Esc oder Doppelklick beendet.",
  window: "Auf eine Wand tippen: Fenster einsetzen.",
  door: "Auf eine Wand tippen: Tür einsetzen.",
  garage: "Auf eine Wand tippen: Garagentor einsetzen.",
  furniture: "Rechts ein Möbel wählen (Suche oder Kategorie), dann in den Plan tippen.",
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
.ed-3d { flex: 1; min-width: 0; position: relative; border-left: 1px solid var(--divider-color, rgba(127,127,127,.25)); touch-action: none; }
.ed-3d .ed-3d-hint { position: absolute; left: 8px; bottom: 8px; font-size: 11px; padding: 3px 8px; border-radius: 10px; background: rgba(0,0,0,.45); color: #fff; pointer-events: none; }
.ed[data-view="2d"] .ed-3d { display: none; }
.ed[data-view="3d"] .ed-svg { display: none; }
.ed[data-view="3d"] .ed-3d { border-left: none; }
.ed-bar .seg { display: inline-flex; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); border-radius: 8px; overflow: hidden; }
.ed-bar .seg button { border-radius: 0; min-height: 32px; padding: 4px 9px; white-space: nowrap; }
.ed-props .search { margin: 6px 0 4px; }
.ed-props .cat { margin: 12px 0 4px; font-size: 12px; font-weight: 600; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
.ed-props .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 6px; }
.ed-props .tile { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px 6px; border: 1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius: 10px; background: none; color: inherit; font: inherit; font-size: 11px; line-height: 1.15; cursor: pointer; text-align: center; min-height: 92px; }
.ed-props .tile img, .ed-props .tile .ph { width: 64px; height: 64px; object-fit: contain; }
.ed-props .tile .ph { border-radius: 8px; background: rgba(127,127,127,.12); }
.ed-props .tile.sel { border-color: var(--primary-color, #03a9f4); background: rgba(3,169,244,.12); }
.ed-props .swatches { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.ed-props .swatches button { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); padding: 0; cursor: pointer; }
.ed-props .swatches button.sel { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 1px; }
.ed-props .colorrow { display: flex; gap: 6px; align-items: center; }
.ed-props .colorrow input[type=color] { width: 44px; height: 32px; padding: 2px; }
.ed-props .colorrow button { border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
.ed-props .pad { display: grid; grid-template-columns: repeat(3, 44px) 1fr; grid-template-rows: repeat(2, 40px); gap: 4px; margin-top: 10px; align-items: center; }
.ed-props .pad button { border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; border-radius: 8px; height: 40px; cursor: pointer; font-size: 18px; --mdc-icon-size: 20px; }
.ed-props .pad select { grid-column: 4; grid-row: 1; margin-left: 6px; }
.ed-props .pad .rot { grid-column: 4; grid-row: 2; display: flex; gap: 4px; margin-left: 6px; }
.ed-props .pad .rot button { flex: 1; }
.ed-hint { padding: 6px 12px; font-size: 12px; color: var(--secondary-text-color); border-top: 1px solid var(--divider-color, rgba(127,127,127,.25)); background: var(--card-background-color, #fff); }
.ed text { font-family: inherit; pointer-events: none; }
@media (max-width: 900px) {
  .ed[data-view="split"] .ed-main { flex-wrap: wrap; }
  .ed[data-view="split"] .ed-svg, .ed[data-view="split"] .ed-3d { flex: 1 1 45%; min-height: 0; }
}
@media (max-width: 700px) {
  .ed-main { flex-direction: column; }
  .ed[data-view="split"] .ed-3d { border-left: none; border-top: 1px solid var(--divider-color, rgba(127,127,127,.25)); }
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
  constructor({ container, building, hass, floorId, onSave, onClose, onPreview = () => {}, sceneStyle = "standard", dark = false }) {
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
    this.sceneStyle = sceneStyle;
    this.dark = dark;
    this.magnet = true;
    this.nudgeStep = 0.05;
    this.furnSearch = "";
    this.roofMode = false; // Dach-Ebene: Kamin, Dachfenster, PV-Felder
    this.viewMode = "2d";
    try {
      const saved = localStorage.getItem("haus3d.editorView");
      if (["2d", "split", "3d"].includes(saved)) this.viewMode = saved;
      else if (window.innerWidth >= 1100) this.viewMode = "split";
    } catch {
      /* ohne Speicher: 2D */
    }

    this.root = document.createElement("div");
    this.root.className = "ed";
    this.root.dataset.view = this.viewMode;
    this.root.innerHTML = `<div class="ed-bar"></div><div class="ed-main"><svg class="ed-svg"></svg><div class="ed-3d"><span class="ed-3d-hint">3D: Möbel ziehen · Leere Fläche ziehen dreht · Rad zoomt</span></div><div class="ed-props"></div></div><div class="ed-hint"></div>`;
    container.appendChild(this.root);
    this.box3d = this.root.querySelector(".ed-3d");
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
    this._sync3d();
  }

  destroy() {
    window.removeEventListener("keydown", this._keys);
    this._resizeObs.disconnect();
    clearTimeout(this._3dTimer);
    this.scene3d?.dispose();
    this.scene3d = null;
    this.root.remove();
  }

  // ------------------------------------------------------------------ 3D-Ansicht im Editor

  setViewMode(mode) {
    this.viewMode = mode;
    this.root.dataset.view = mode;
    try {
      localStorage.setItem("haus3d.editorView", mode);
    } catch {
      /* egal */
    }
    this.renderBar();
    this._fitPending = true;
    requestAnimationFrame(() => {
      this.render();
      this.scene3d?.resize();
      this._sync3d(true);
    });
  }

  /** 3D-Ansicht nachziehen (gebündelt, damit Ziehen flüssig bleibt). */
  _sync3d(now = false) {
    if (this.viewMode === "2d") return;
    clearTimeout(this._3dTimer);
    const run = () => {
      if (!this.root.isConnected || this.viewMode === "2d") return;
      if (!this.scene3d) this._create3d();
      const first = !this._3dShown;
      // Dach-Ebene: ganzes Haus mit Dach
      const view = this.roofMode ? "all" : this.floorId;
      this.scene3d.setLayers({ ...(this.scene3d.layers ?? {}), roof: this.roofMode, weather: false });
      this.scene3d.filter = view;
      this.scene3d.setBuilding(normalize(structuredClone(this.b)), { keepCamera: !first || this._3dFloor === view });
      if (first || this._3dFloor !== view) this.scene3d.setFilter(view, { fit: true });
      this._3dShown = true;
      this._3dFloor = view;
      this._mark3d();
    };
    if (now) run();
    else this._3dTimer = setTimeout(run, 120);
  }

  _mark3d() {
    if (!this.scene3d) return;
    this.scene3d.markFurniture(this.sel?.kind === "furniture" ? this.sel.id : null);
    this.scene3d.selectRooms(this.sel?.kind === "room" ? [{ floorId: this.floorId, roomId: this.sel.id }] : [], { focus: false });
  }

  _create3d() {
    const sc = new HouseScene(this.box3d, { dark: this.dark });
    sc.setStyle(this.sceneStyle === "cyber" ? "cyber" : this.sceneStyle === "night" ? "night" : "standard");
    sc.setLayers({ roof: false, weather: false });
    sc.start();
    this.scene3d = sc;
    // Klick wählt, Ziehen auf einem Möbelstück verschiebt es auf dem Boden, sonst dreht die Kamera
    const canvas = sc.renderer.domElement;
    let drag = null;
    canvas.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || this.roofMode) return;
      const hit = sc.pick(ev.clientX, ev.clientY, { furniture: true });
      drag = { x: ev.clientX, y: ev.clientY, hit, moved: false };
      if (hit?.furniture) {
        const m = (this.floor.furniture ?? []).find((x) => x.id === hit.furniture);
        if (!m) return;
        const elev = this.floor.elevation ?? 0;
        const p = sc.planPoint(ev.clientX, ev.clientY, elev) ?? [m.x, m.z];
        drag.furn = { mode: "furniture", id: m.id, off: [p[0] - m.x, p[1] - m.z], first: true, faces: this._faces() };
        sc.controls.enabled = false;
        canvas.setPointerCapture(ev.pointerId);
        this.sel = { kind: "furniture", id: m.id };
        this.renderProps();
        this.render();
        this._mark3d();
      }
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 4) drag.moved = true;
      if (!drag.furn || !drag.moved) return;
      const p = sc.planPoint(ev.clientX, ev.clientY, this.floor.elevation ?? 0);
      if (p) this._moveDrag(drag.furn, ev, p);
    });
    const up = (ev) => {
      if (!drag) return;
      sc.controls.enabled = true;
      if (!drag.moved && !drag.furn) {
        // Klick ohne Ziehen: Raum wählen (oder Auswahl aufheben)
        const hit = drag.hit;
        this.sel = hit?.roomId && hit.floorId === this.floorId ? { kind: "room", id: hit.roomId } : null;
        this.renderProps();
        this.render();
        this._mark3d();
      } else if (drag.furn) this.renderProps();
      drag = null;
      ev.target.releasePointerCapture?.(ev.pointerId);
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  /** Wandflächen der Etage zum Einrasten. */
  _faces() {
    return wallFaces(computeWalls(this.floor, this.b.settings ?? {}).segments);
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
    this._sync3d();
  }

  /** Änderung am Hausdach (settings.roof) mit Rückgängig-Schritt. */
  changeRoof(fn, { merge = false } = {}) {
    if (!merge) {
      this.undoStack.push(JSON.stringify(this.b));
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    const roof = structuredClone(this.b.settings.roof ?? {});
    fn(roof);
    this.b.settings.roof = roof;
    this.dirty = true;
    this.render();
    this.renderBar();
    this._sync3d();
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
    this._sync3d();
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
    } else if (this.sel && ev.key.startsWith("Arrow")) {
      ev.preventDefault();
      const k = ev.shiftKey ? 0.01 : this.nudgeStep;
      const d = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[ev.key];
      this.nudge(d[0], d[1]);
    } else if (this.sel?.kind === "furniture" && (ev.key === "r" || ev.key === "R")) {
      ev.preventDefault();
      this.rotateSel(ev.shiftKey ? -15 : 90);
    }
  }

  /** Auswahl um (dx, dz) Meter schieben; schnelle Folgen ergeben einen Rückgängig-Schritt. */
  nudge(dx, dz) {
    const sel = this.sel;
    if (!sel) return;
    const merge = performance.now() - (this._lastNudge ?? 0) < 700 && this._nudgeSel === `${sel.kind}:${sel.id}`;
    this._lastNudge = performance.now();
    this._nudgeSel = `${sel.kind}:${sel.id}`;
    if (sel.kind === "roofitem") {
      this.changeRoof((roof) => {
        const it = roof.items.find((x) => x.id === sel.id);
        it.x = r3(it.x + dx);
        it.z = r3(it.z + dz);
      }, { merge });
      this.renderProps();
      return;
    }
    this.change((fl) => {
      if (sel.kind === "furniture") {
        const m = fl.furniture.find((x) => x.id === sel.id);
        m.x = r3(m.x + dx);
        m.z = r3(m.z + dz);
      } else if (sel.kind === "room") {
        fl.rooms = fl.rooms.map((r) => (r.id === sel.id ? moveRoom(r, dx, dz) : r));
      } else if (sel.kind === "outdoor") {
        fl.outdoor = fl.outdoor.map((o) => (o.id === sel.id ? { ...o, points: o.points.map(([x, z]) => [r3(x + dx), r3(z + dz)]) } : o));
      } else if (sel.kind === "wall") {
        const w = fl.walls.find((x) => x.id === sel.id);
        w.a = [r3(w.a[0] + dx), r3(w.a[1] + dz)];
        w.b = [r3(w.b[0] + dx), r3(w.b[1] + dz)];
      } else if (sel.kind === "device") {
        const pl = fl.placements.find((x) => x.entity_id === sel.id);
        if (pl) Object.assign(pl, { x: r3(pl.x + dx), z: r3(pl.z + dz) });
      } else if (sel.kind === "opening") {
        // entlang der Wand: Anteil der Bewegung in Kantenrichtung
        const o = fl.openings.find((x) => x.id === sel.id);
        const g = openingGeometry(fl, o);
        if (g) o.offset = clampOffset(o.offset + dx * g.u[0] + dz * g.u[1], o.width, g.len);
      }
    }, { merge });
    this.renderProps();
  }

  /** Gewähltes Möbelstück drehen (Grad, im Uhrzeigersinn wie NeonPlan). */
  rotateSel(deg) {
    if (this.sel?.kind !== "furniture") return;
    const id = this.sel.id;
    this.change((fl) => {
      const m = fl.furniture.find((x) => x.id === id);
      m.rotation = (((m.rotation || 0) + deg) % 360 + 360) % 360;
    });
    this.renderProps();
  }

  /** Gewähltes Möbelstück an die nächste Wand stellen (größerer Suchradius als beim Ziehen). */
  snapSelToWall() {
    const m = this.sel?.kind === "furniture" ? this.floor.furniture.find((x) => x.id === this.sel.id) : null;
    if (!m) return;
    const s = snapToWall({ ...m, type: "wardrobe" }, this._faces(), { tol: 1.2 });
    if (!s) return this._toast("Keine Wand in der Nähe (bis 1,2 m).");
    this.change((fl) => Object.assign(fl.furniture.find((x) => x.id === m.id), s));
    this.renderProps();
  }

  // ------------------------------------------------------------------ Werkzeugleiste

  renderBar() {
    const bar = this.root.querySelector(".ed-bar");
    const floors = [...this.b.floors].sort((a, b) => a.elevation - b.elevation);
    bar.innerHTML = `
      <select class="floorsel" title="Etage">${floors.map((f) => `<option value="${esc(f.id)}"${!this.roofMode && f.id === this.floorId ? " selected" : ""}>${esc(f.name)}</option>`).join("")}<option value="__roof"${this.roofMode ? " selected" : ""}>Dach</option></select>
      <span class="sep"></span>
      ${(this.roofMode ? ROOF_TOOLS : TOOLS).map(([k, icon, name]) => `<button data-tool="${k}" class="${this.tool === k ? "sel" : ""}" title="${name}"><ha-icon icon="${icon}"></ha-icon><span>${name}</span></button>`).join("")}
      <span class="sep"></span>
      <button data-act="undo" title="Rückgängig (Strg+Z)"${this.undoStack.length ? "" : " disabled"}><ha-icon icon="mdi:undo"></ha-icon></button>
      <button data-act="redo" title="Wiederholen"${this.redoStack.length ? "" : " disabled"}><ha-icon icon="mdi:redo"></ha-icon></button>
      ${this.roofMode ? "" : `<button data-act="gaps" title="Lücken zwischen Räumen schließen"><ha-icon icon="mdi:vector-combine"></ha-icon><span>Lücken schließen</span></button>
      <button data-act="clean" title="Räume aufräumen: doppelte Punkte und Spitzen entfernen"><ha-icon icon="mdi:broom"></ha-icon><span>Aufräumen</span></button>
      <button data-act="magnet" class="${this.magnet ? "sel" : ""}" title="Magnet: Möbel rasten an Wänden ein (Alt beim Ziehen = frei)"><ha-icon icon="mdi:magnet"></ha-icon></button>`}
      <span class="grow"></span>
      <span class="seg" title="Ansicht">${[["2d", "2D"], ["split", "2D + 3D"], ["3d", "3D"]].map(([k, n]) => `<button data-view="${k}" class="${this.viewMode === k ? "sel" : ""}">${n}</button>`).join("")}</span>
      <button data-act="cancel"><ha-icon icon="mdi:close"></ha-icon><span>Abbrechen</span></button>
      <button data-act="save" class="primary"><ha-icon icon="mdi:content-save"></ha-icon><span>Speichern</span></button>`;
    bar.querySelector(".floorsel").addEventListener("change", (ev) => {
      this.roofMode = ev.target.value === "__roof";
      // Dach-Ebene: Grundriss der Etage unter dem Dach
      this.floorId = this.roofMode ? (roofFloor(this.b, roofSettings(this.b.settings))?.id ?? this.floorId) : ev.target.value;
      this.tool = "select";
      this.sel = null;
      this.draft = null;
      this.fit();
      this.render();
      this.renderProps();
      this._sync3d(true);
    });
    this.hint.textContent = this._hintText();
  }

  _hintText() {
    return (this.roofMode ? ROOF_HINTS : HINTS)[this.tool] ?? "";
  }

  async _onBar(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.view) {
      this.setViewMode(b.dataset.view);
      return;
    }
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
    } else if (act === "clean") {
      const { floor, fixed } = cleanFloor(this.floor);
      // danach Möbel, die in Wände ragen, bündig davor stellen
      const faces = wallFaces(computeWalls(floor, this.b.settings ?? {}).segments);
      let pushed = 0;
      const furniture = (floor.furniture ?? []).map((m) => {
        const q = pushOutOfWalls(m, faces);
        if (!q) return m;
        pushed++;
        return { ...m, ...q };
      });
      if (!fixed && !pushed) this._toast("Nichts aufzuräumen: keine doppelten Punkte, Spitzen oder Möbel in Wänden.");
      else {
        this.change(() => ({ ...floor, furniture }));
        this._toast(`${fixed} überflüssige Eckpunkte entfernt, ${pushed} Möbel aus Wänden gerückt.`);
      }
    } else if (act === "magnet") {
      this.magnet = !this.magnet;
      this._toast(this.magnet ? "Magnet an: Möbel rasten an Wänden ein." : "Magnet aus: Möbel frei verschieben.");
    } else if (act === "cancel") {
      if (this.dirty && !confirm("Änderungen verwerfen?")) return;
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

  _toast(text) {
    this.hint.textContent = text;
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => (this.hint.textContent = this._hintText()), 4000);
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

  /** Wandende: gerade (0/45/90°) und an Ecken/Wandenden einrasten. */
  _wallSnap(a, p, free = false) {
    const vertices = [...floorVertices(this.floor), ...(this.floor.walls ?? []).flatMap((w) => [w.a, w.b])];
    return snapWallEnd(a, p, { grid: this.b.settings?.grid ?? 0.05, vertices, tol: 10 / this.scale, free });
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
    if (this.roofMode) {
      parts.push(roofSvg(this, px));
      this.svg.classList.toggle("select", this.tool === "select");
      this.svg.innerHTML = `<g transform="translate(${this.tx} ${this.tz}) scale(${s})" color="var(--primary-text-color, #222)">${parts.join("")}</g>`;
      return;
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
      parts.push(`<polygon data-kind="room" data-id="${esc(r.id)}" points="${r.points.map(P).join(" ")}" fill="${floorColor(r)}" fill-opacity="${sel ? 0.75 : 0.5}" stroke="${sel ? "#03a9f4" : "currentColor"}" stroke-opacity="${sel ? 1 : 0.5}" stroke-width="${px(sel ? 3 : 1)}"/>`);
    }
    // Wände (berechnet)
    const { segments, openings } = computeWalls(f, this.b.settings ?? {});
    parts.push(`<g fill="currentColor" fill-opacity=".55" pointer-events="none">${segments.map((seg) => `<polygon points="${pieceFootprint(seg, 0, seg.length).map(P).join(" ")}"/>`).join("")}</g>`);
    // freistehende Wände: anklickbar, die gewählte mit Endpunkten
    for (const w of f.walls ?? []) {
      const sel = this.sel?.kind === "wall" && this.sel.id === w.id;
      const t = Math.max(w.thickness ?? this.b.settings?.wall_interior ?? 0.12, px(10));
      parts.push(`<line data-kind="wall" data-id="${esc(w.id)}" x1="${r3(w.a[0])}" y1="${r3(w.a[1])}" x2="${r3(w.b[0])}" y2="${r3(w.b[1])}" stroke="${sel ? "#03a9f4" : "transparent"}" stroke-opacity="${sel ? 0.6 : 0}" stroke-width="${t}" style="cursor:move"/>`);
      if (sel) {
        [w.a, w.b].forEach((q, i) => parts.push(`<circle data-kind="wend" data-i="${i}" cx="${r3(q[0])}" cy="${r3(q[1])}" r="${px(7)}" fill="#03a9f4" stroke="#fff" stroke-width="${px(2)}"/>`));
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        parts.push(`<text x="${r3((w.a[0] + w.b[0]) / 2)}" y="${r3((w.a[1] + w.b[1]) / 2 - px(12))}" text-anchor="middle" font-size="${px(12)}" fill="#03a9f4">${len.toFixed(2)} m</text>`);
      }
    }
    // Wand in Arbeit
    if (this.draft?.wall) {
      const a = this.draft.wall;
      const b = this.draft.hover ?? a;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      parts.push(`<line x1="${r3(a[0])}" y1="${r3(a[1])}" x2="${r3(b[0])}" y2="${r3(b[1])}" stroke="#03a9f4" stroke-width="${Math.max(this.b.settings?.wall_interior ?? 0.12, px(4))}" stroke-opacity=".7"/>`);
      parts.push(`<circle cx="${r3(a[0])}" cy="${r3(a[1])}" r="${px(5)}" fill="#03a9f4"/>`);
      if (len > 0.01) parts.push(`<text x="${r3((a[0] + b[0]) / 2)}" y="${r3((a[1] + b[1]) / 2 - px(10))}" text-anchor="middle" font-size="${px(12)}" fill="#03a9f4">${len.toFixed(2)} m</text>`);
    }
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
        const inside = g.room ? (signedArea(g.room.points) > 0 ? 1 : -1) : 1;
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
      const name = m.name || (FURNITURE[m.type]?.[0] ?? m.type);
      const fill = sel ? "#03a9f4" : /^#[0-9a-f]{6}$/i.test(m.color ?? "") ? m.color : "#795548";
      const round = m.type === "custom_cylinder" || m.type === "column" || m.type === "water_tank" || m.type.startsWith("tree") || m.type === "bush" || m.type === "flowers";
      const shape = round
        ? `<ellipse rx="${fw / 2}" ry="${fd / 2}" fill="${fill}" fill-opacity="${sel ? 0.45 : 0.35}" stroke="${sel ? "#03a9f4" : "#5d4037"}" stroke-width="${px(sel ? 2.5 : 1)}"/>`
        : `<rect x="${-fw / 2}" y="${-fd / 2}" width="${fw}" height="${fd}" fill="${fill}" fill-opacity="${sel ? 0.45 : 0.3}" stroke="${sel ? "#03a9f4" : "#5d4037"}" stroke-width="${px(sel ? 2.5 : 1)}"/>`;
      parts.push(
        `<g data-kind="furniture" data-id="${esc(m.id)}" transform="translate(${r3(m.x)} ${r3(m.z)}) rotate(${m.rotation || 0})">` +
          shape +
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
      // Wände des gewählten Raums: ziehen verschiebt die ganze Wand (Nachbarräume gehen mit)
      if (this.sel.kind === "room") {
        poly.points.forEach((p, i) => {
          const q = poly.points[(i + 1) % poly.points.length];
          parts.push(`<line data-kind="edge" data-i="${i}" x1="${r3(p[0])}" y1="${r3(p[1])}" x2="${r3(q[0])}" y2="${r3(q[1])}" stroke="#03a9f4" stroke-opacity=".25" stroke-width="${px(12)}" style="cursor:move"/>`);
        });
      }
      // Hang: Höhe je Ecke anzeigen
      if (this.sel.kind === "outdoor" && Array.isArray(poly.heights)) {
        poly.points.forEach((p, i) => parts.push(`<text x="${r3(p[0] + px(10))}" y="${r3(p[1] - px(10))}" font-size="${px(11)}" font-weight="600" fill="#e65100">${(Number(poly.heights[i]) || 0).toFixed(2)} m</text>`));
      }
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
      if (this.draft?.wall) {
        this.draft = null;
        this.render();
      }
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
        } else if (this.draft?.wall && this.tool === "wall") {
          this.draft.hover = this._wallSnap(this.draft.wall, p, ev.shiftKey);
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
    if (this.roofMode) return roofStartDrag(this, ev, p);
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
    if (tool === "wall") {
      const start = this.draft?.wall;
      if (!start) {
        const vertices = [...floorVertices(f), ...(f.walls ?? []).flatMap((w) => [w.a, w.b])];
        this.draft = { wall: snapPoint(p, { grid: this.b.settings?.grid ?? 0.05, vertices, tol: 10 / this.scale }) };
        this.render();
        return null;
      }
      const end = this._wallSnap(start, p, ev.shiftKey);
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.05) {
        this.draft = null; // gleicher Punkt: Kette beenden
        this.render();
        return null;
      }
      const w = { id: newId("wand", allIds(this.b)), a: [r3(start[0]), r3(start[1])], b: [r3(end[0]), r3(end[1])], thickness: this.b.settings?.wall_interior ?? 0.12, height: null };
      this.change((fl) => {
        fl.walls = [...(fl.walls ?? []), w];
      });
      this.sel = { kind: "wall", id: w.id };
      this.draft = { wall: w.b };
      this.renderProps();
      this.render();
      return null;
    }
    if (tool === "window" || tool === "door" || tool === "garage") {
      const reach = 24 / this.scale + 0.15;
      const edgeHit = nearestEdge(f, p, reach);
      const wallHit = nearestWall(f, p, reach);
      if (!edgeHit && !wallHit) {
        this._toast("Dort ist keine Wand – näher an eine Raumkante oder Wand tippen.");
        return null;
      }
      const onWall = wallHit && (!edgeHit || wallHit.dist < edgeHit.dist);
      const hit = onWall ? { room: { id: wallHit.wall.id }, edge: 0, offset: wallHit.offset, len: wallHit.len } : edgeHit;
      const o = newOpening(tool, hit, newId(tool, allIds(this.b)));
      if (onWall) o.wall = wallHit.wall.id;
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
        else
          this.change((fl) => ({
            ...fl,
            outdoor: fl.outdoor.map((o) => {
              if (o.id !== poly.id) return o;
              const out = { ...o, points: [...o.points.slice(0, i + 1), mid, ...o.points.slice(i + 1)] };
              // Hang: neue Ecke bekommt die mittlere Höhe ihrer Nachbarn
              if (Array.isArray(o.heights)) {
                const hm = r3(((Number(o.heights[i]) || 0) + (Number(o.heights[(i + 1) % o.points.length]) || 0)) / 2);
                out.heights = [...o.heights.slice(0, i + 1), hm, ...o.heights.slice(i + 1)];
              }
              return out;
            }),
          }));
        return { mode: "vertex", i: i + 1, merge: true };
      }
      return { mode: "vertex", i, first: true };
    }
    if (kind === "rotate") return { mode: "rotate", id };
    if (kind === "wall") {
      this.sel = { kind: "wall", id };
      this.renderProps();
      this.render();
      return { mode: "wallmove", id, start: p, first: true };
    }
    if (kind === "wend" && this.sel?.kind === "wall") return { mode: "wend", id: this.sel.id, i: Number(t.dataset.i), first: true };
    if (kind === "edge" && this.sel?.kind === "room") {
      const room = f.rooms.find((r) => r.id === this.sel.id);
      const i = Number(t.dataset.i);
      const a = room.points[i];
      const b = room.points[(i + 1) % room.points.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return { mode: "edge", id: room.id, i, start: p, n: [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], applied: 0, first: true };
    }
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
        // beim Raum: gemeinsame Ecken der Nachbarräume nicht als Einrastziel, sie wandern mit
        if (this.sel.kind === "room") {
          const old = poly.points[drag.i];
          const vertices = floorVertices(this.floor, poly.id).filter((v) => Math.hypot(v[0] - old[0], v[1] - old[1]) > 0.02);
          const q = snapPoint(p, { grid: this.b.settings?.grid ?? 0.05, vertices, tol: 10 / this.scale });
          if (Math.hypot(q[0] - old[0], q[1] - old[1]) < 1e-9) break;
          this._dragChange(drag, (fl) => moveVertex(fl, poly.id, drag.i, q, { linked: !ev.altKey }));
          this._lastVertex = drag.i;
          break;
        }
        const q = this._snap(p);
        this._dragChange(drag, (fl) => {
          fl.outdoor.find((x) => x.id === poly.id).points[drag.i] = q; // Höhe der Ecke bleibt
        });
        this._lastVertex = drag.i;
        break;
      }
      case "wallmove": {
        const grid = this.b.settings?.grid ?? 0.05;
        const dx = r3(Math.round((p[0] - drag.start[0]) / grid) * grid);
        const dz = r3(Math.round((p[1] - drag.start[1]) / grid) * grid);
        if (!dx && !dz) break;
        drag.start = [drag.start[0] + dx, drag.start[1] + dz];
        this._dragChange(drag, (fl) => {
          const w = fl.walls.find((x) => x.id === drag.id);
          w.a = [r3(w.a[0] + dx), r3(w.a[1] + dz)];
          w.b = [r3(w.b[0] + dx), r3(w.b[1] + dz)];
        });
        break;
      }
      case "wend": {
        const w = f.walls.find((x) => x.id === drag.id);
        const other = drag.i === 0 ? w.b : w.a;
        const q = this._wallSnap(other, p, ev.shiftKey);
        if (Math.hypot(q[0] - other[0], q[1] - other[1]) < 0.05) break;
        this._dragChange(drag, (fl) => {
          fl.walls.find((x) => x.id === drag.id)[drag.i === 0 ? "a" : "b"] = q;
        });
        this.renderProps();
        break;
      }
      case "edge": {
        // senkrecht zur Wand, aufs Raster gerundet
        const grid = this.b.settings?.grid ?? 0.05;
        const raw = (p[0] - drag.start[0]) * drag.n[0] + (p[1] - drag.start[1]) * drag.n[1];
        const d = r3(Math.round(raw / grid) * grid);
        const delta = r3(d - drag.applied);
        if (Math.abs(delta) < 1e-9) break;
        drag.applied = d;
        this._dragChange(drag, (fl) => moveEdge(fl, drag.id, drag.i, delta, { linked: !ev.altKey }));
        this._toast(`Wand verschoben: ${d >= 0 ? "+" : ""}${d.toFixed(2)} m (Alt = nur dieser Raum)`);
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
        const pr = projectOnSegment(p, g.a, g.b);
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
        const cur = f.furniture.find((x) => x.id === drag.id);
        // Magnet: an der nächsten Wand ausrichten und entlang schieben (Alt = frei)
        let target = { x: q[0], z: q[1] };
        if (this.magnet && !ev.altKey && cur) {
          drag.faces ??= this._faces();
          const s = snapToWall({ ...cur, x: q[0], z: q[1] }, drag.faces, { tol: Math.max(0.15, 14 / this.scale) });
          if (s) target = s;
        }
        this._dragChange(drag, (fl) => {
          Object.assign(fl.furniture.find((x) => x.id === drag.id), target);
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
      case "roofitem":
        roofMoveDrag(this, drag, p);
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
    if (drag.mode === "furniture" || drag.mode === "rotate" || drag.mode === "opening" || drag.mode === "roofitem") this.renderProps();
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
    if (sel.kind === "roofitem") this.changeRoof((roof) => (roof.items = (roof.items ?? []).filter((x) => x.id !== sel.id)));
    else if (sel.kind === "room") this.change((fl) => removeRoom(fl, sel.id));
    else if (sel.kind === "opening") this.change((fl) => ({ ...fl, openings: fl.openings.filter((o) => o.id !== sel.id) }));
    else if (sel.kind === "furniture") this.change((fl) => ({ ...fl, furniture: fl.furniture.filter((m) => m.id !== sel.id) }));
    else if (sel.kind === "outdoor") this.change((fl) => ({ ...fl, outdoor: fl.outdoor.filter((o) => o.id !== sel.id) }));
    else if (sel.kind === "wall") this.change((fl) => removeWall(fl, sel.id));
    else if (sel.kind === "device") this.change((fl) => ({ ...fl, placements: fl.placements.filter((x) => x.entity_id !== sel.id) }));
    this.sel = null;
    this.renderProps();
  }

  // ------------------------------------------------------------------ Eigenschaften

  renderProps() {
    this._mark3d();
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
    // Farbfeld: Vorschläge, eigene Farbe, zurück auf Standard
    const colorField = (key, label, value) => {
      const v = /^#[0-9a-f]{6}$/i.test(value ?? "") ? value.toLowerCase() : "";
      return `<label>${label}</label><div class="colorrow"><input type="color" data-color="${key}" value="${v || "#cccccc"}"><button data-color-reset="${key}">Standard</button><span class="muted">${v ? esc(v) : "Standard"}</span></div>
        <div class="swatches">${COLOR_SWATCHES.map((c) => `<button data-swatch="${key}" data-c="${c}" style="background:${c}" class="${c === v ? "sel" : ""}" title="${c}"></button>`).join("")}</div>`;
    };
    const bindColors = (apply) => {
      const set = (key, v) => {
        this.change((fl) => apply(fl, key, v));
        this.renderProps();
      };
      el.querySelectorAll("[data-color]").forEach((inp) => inp.addEventListener("change", () => set(inp.dataset.color, inp.value)));
      el.querySelectorAll("[data-color-reset]").forEach((b) => b.addEventListener("click", () => set(b.dataset.colorReset, null)));
      el.querySelectorAll("[data-swatch]").forEach((b) => b.addEventListener("click", () => set(b.dataset.swatch, b.dataset.c)));
    };
    // Steuerkreuz (Tablet): schieben, Schrittweite, drehen
    const pad = (rotate = false) => `<div class="pad">
        <span></span><button data-nudge="0,-1" title="hoch">▲</button><span></span>
        <select data-step title="Schrittweite">${[[0.01, "1 cm"], [0.05, "5 cm"], [0.1, "10 cm"], [0.5, "50 cm"]].map(([v, n]) => `<option value="${v}"${v === this.nudgeStep ? " selected" : ""}>${n}</option>`).join("")}</select>
        <button data-nudge="-1,0" title="links">◀</button><button data-nudge="0,1" title="runter">▼</button><button data-nudge="1,0" title="rechts">▶</button>
        ${rotate ? `<span class="rot"><button data-rot="-15" title="15° zurück">⟲</button><button data-rot="90" title="90° drehen">⟳</button><button data-act="wall" title="An die nächste Wand stellen"><ha-icon icon="mdi:wall"></ha-icon></button></span>` : ""}
      </div>`;
    const bindPad = () => {
      el.querySelectorAll("[data-nudge]").forEach((b) =>
        b.addEventListener("click", () => {
          const [x, z] = b.dataset.nudge.split(",").map(Number);
          this.nudge(x * this.nudgeStep, z * this.nudgeStep);
        }),
      );
      el.querySelector("[data-step]")?.addEventListener("change", (ev) => (this.nudgeStep = Number(ev.target.value)));
      el.querySelectorAll("[data-rot]").forEach((b) => b.addEventListener("click", () => this.rotateSel(Number(b.dataset.rot))));
      el.querySelector("[data-act=wall]")?.addEventListener("click", () => this.snapSelToWall());
    };
    if (this.roofMode) return roofProps(this, el, pad, bindPad);
    // Textur-Auswahl neben den Farben (Wert "" = Standard, "none" = glatt)
    const bindTextures = (apply) =>
      el.querySelectorAll("[data-tex]").forEach((inp) =>
        inp.addEventListener("change", () => {
          this.change((fl) => apply(fl, inp.dataset.tex, inp.value || null));
          this.renderProps();
        }),
      );

    if (this.tool === "furniture") {
      el.innerHTML = `<h3>Möbel einfügen</h3><p class="muted">Möbel wählen, dann in den Plan tippen.</p>
        <input class="search" type="search" placeholder="Suchen …" value="${esc(this.furnSearch)}"><div class="cats"></div>`;
      const cats = el.querySelector(".cats");
      const style = this.sceneStyle === "cyber" ? "cyber" : "standard";
      const draw = () => {
        const q = this.furnSearch.trim().toLowerCase();
        cats.innerHTML = FURNITURE_CATEGORIES.map(([cat, types]) => {
          const list = types.filter((t) => !q || FURNITURE[t][0].toLowerCase().includes(q) || cat.toLowerCase().includes(q));
          if (!list.length) return "";
          return `<div class="cat">${esc(cat)}</div><div class="tiles">${list
            .map((t) => {
              const img = furnitureThumb(t, style);
              return `<button class="tile${t === this.furnType ? " sel" : ""}" data-furn="${t}" title="${esc(FURNITURE[t][0])}">${img ? `<img alt="" src="${img}">` : `<span class="ph" data-thumb="${t}"></span>`}<span>${esc(FURNITURE[t][0])}</span></button>`;
            })
            .join("")}</div>`;
        }).join("") || `<p class="muted">Nichts gefunden.</p>`;
      };
      draw();
      el.querySelector(".search").addEventListener("input", (ev) => {
        this.furnSearch = ev.target.value;
        draw();
      });
      cats.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-furn]");
        if (!b) return;
        this.furnType = b.dataset.furn;
        cats.querySelectorAll(".tile").forEach((t) => t.classList.toggle("sel", t === b));
      });
      // Vorschaubilder nach und nach einsetzen
      renderThumbs((type, url) => {
        const ph = cats.querySelector(`[data-thumb="${type}"]`);
        if (ph) ph.outerHTML = `<img alt="" src="${url}">`;
      }, style);
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
      const below = [...this.b.floors].filter((x) => x.elevation < f.elevation && (x.rooms ?? []).length).sort((a, b) => b.elevation - a.elevation)[0];
      el.innerHTML = `<h3>Etage ${esc(f.name)}</h3>
        <label>Name</label><input data-floor="name" value="${esc(f.name)}">
        <div class="row2">${num("elevation", "Höhe über Boden (m)", f.elevation)}${num("height", "Raumhöhe (m)", f.height)}</div>
        ${haFloors.length ? `<label>Etage in Home Assistant</label><select data-floor="ha_floor"><option value="">–</option>${haFloors.map((x) => `<option value="${esc(x.floor_id)}"${x.floor_id === f.ha_floor ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
        <div class="row2">${num("wall_exterior", "Außenwand (m)", this.b.settings.wall_exterior ?? 0.24, 0.01)}${num("wall_interior", "Innenwand (m)", this.b.settings.wall_interior ?? 0.12, 0.01)}</div>
        ${colorField("exterior", "Außenwände (Farbe außen)", this.b.settings.wall_colors?.exterior)}
        ${textureField("exterior", "Außenwände: Textur", this.b.settings.wall_textures?.exterior, "w")}
        ${colorField("interior", "Innenwände (Standard für alle Räume)", this.b.settings.wall_colors?.interior)}
        ${textureField("interior", "Innenwände: Textur", this.b.settings.wall_textures?.interior, "w")}
        <p class="muted">${f.rooms.length} Räume · ${f.openings.length} Fenster/Türen · ${(f.furniture ?? []).length} Möbel</p>
        ${below ? `<div class="btns"><button data-act="alignbelow" title="Außenwände, die bis 15 cm neben denen von ${esc(below.name)} liegen, genau darüber setzen">Außenwände bündig auf ${esc(below.name)}</button></div>` : ""}
        <div class="btns"><button data-act="addfloor">+ Etage</button><button data-act="delfloor" class="danger">Etage löschen</button></div>`;
      el.querySelector("[data-act=alignbelow]")?.addEventListener("click", () => {
        const { floor, moved } = alignToFloor(this.floor, below, this.b.settings ?? {});
        if (!moved.length) return this._toast(`Außenwände liegen schon bündig auf ${below.name} (oder weiter als 15 cm daneben).`);
        this.change(() => floor);
        this._toast(`Bündig gesetzt: ${moved.join(", ")}`);
      });
      bindColors((fl, key, v) => {
        const wc = { ...(this.b.settings.wall_colors ?? {}) };
        if (v) wc[key] = v;
        else delete wc[key];
        this.b.settings.wall_colors = wc;
      });
      bindTextures((fl, key, v) => {
        const wt = { ...(this.b.settings.wall_textures ?? {}) };
        if (v) wt[key] = v;
        else delete wt[key];
        this.b.settings.wall_textures = wt;
      });
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
        <label>Bodenbelag</label><select data-room="floor_material">${FLOOR_MATERIALS.map(([k, n]) => `<option value="${k}"${k === r.floor_material ? " selected" : ""}>${n}</option>`).join("")}</select>
        ${textureField("floor_texture", "Boden: Textur (Standard nach Belag)", r.floor_texture, "f")}
        ${colorField("floor_color", "Bodenfarbe (statt Belag)", r.floor_color)}
        ${colorField("wall_color", "Wandfarbe innen", r.wall_color)}
        ${textureField("wall_texture", "Wand innen: Textur", r.wall_texture, "w")}
        ${colorField("exterior_color", "Wandfarbe außen (z. B. Holzschuppen)", r.exterior_color)}
        ${textureField("exterior_texture", "Wand außen: Textur", r.exterior_texture, "w")}
        <label>Eigenes Dach (Schuppen, Carport, Anbau)</label><select data-roof="type">${ROOF_TYPES.map(([k, n]) => `<option value="${k}"${k === (r.roof?.type ?? "none") ? " selected" : ""}>${n}</option>`).join("")}</select>
        ${r.roof && r.roof.type !== "none" ? `<div class="row2"><div><label>Neigung (°)</label><input type="number" min="5" max="60" step="1" data-roof="pitch" value="${r.roof.pitch ?? 35}"></div><div><label>Überstand (m)</label><input type="number" min="0" max="1.5" step="0.05" data-roof="overhang" value="${r.roof.overhang ?? 0.4}"></div></div>
          ${colorField("roof_color", "Dachfarbe", r.roof.color)}` : ""}
        ${r.area_id === "balkonkraftwerk" || /schuppen/i.test(r.name) ? `<label>Solarmodule auf dem Dach (Anzahl)</label><input type="number" min="0" max="12" step="1" data-solar value="${r.solar_panels ?? 4}">` : ""}
        <p class="muted">${Math.abs(signedArea(r.points)).toFixed(2)} m² · ${r.points.length} Ecken. Ecken ziehen, „+“ fügt eine Ecke ein, Entf löscht den Raum.</p>
        ${pad()}
        <div class="btns"><button data-act="delvertex">Letzte gewählte Ecke löschen</button><button data-act="del" class="danger">Raum löschen</button></div>`;
      bindColors((fl, key, v) => {
        const room = fl.rooms.find((x) => x.id === r.id);
        if (key === "roof_color") {
          room.roof = { ...(room.roof ?? {}) };
          if (v) room.roof.color = v;
          else delete room.roof.color;
          return;
        }
        if (v) room[key] = v;
        else delete room[key];
      });
      bindTextures((fl, key, v) => {
        const room = fl.rooms.find((x) => x.id === r.id);
        if (v) room[key] = v;
        else delete room[key];
      });
      el.querySelectorAll("[data-roof]").forEach((inp) =>
        inp.addEventListener("change", () => {
          this.change((fl) => {
            const room = fl.rooms.find((x) => x.id === r.id);
            const k = inp.dataset.roof;
            if (k === "type" && inp.value === "none") delete room.roof;
            else room.roof = { pitch: 25, overhang: 0.3, ...(room.roof ?? {}), [k]: k === "type" ? inp.value : Number(inp.value) };
          });
          this.renderProps();
        }),
      );
      el.querySelector("[data-solar]")?.addEventListener("change", (ev) =>
        this.change((fl) => {
          fl.rooms.find((x) => x.id === r.id).solar_panels = Math.max(0, Math.round(Number(ev.target.value) || 0));
        }),
      );
      bindPad();
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
        <p class="muted">Im Plan entlang der Wand ziehen oder mit den Pfeilen schieben.</p>
        ${pad()}
        <div class="btns"><button data-act="del" class="danger">Löschen</button></div>`;
      bindPad();
      el.querySelectorAll("[data-o]").forEach((inp) =>
        inp.addEventListener("change", () => {
          this.change((fl) => {
            const x = fl.openings.find((y) => y.id === o.id);
            const k = inp.dataset.o;
            x[k] = k === "leaves" ? Number(inp.value) : k === "style" ? inp.value || null : inp.value;
            if (k === "type") {
              const wall = x.wall;
              Object.assign(x, newOpening(inp.value, { room: fl.rooms.find((r) => r.id === x.room_id) ?? { id: x.room_id }, edge: x.edge, offset: x.offset, len: openingGeometry(fl, x)?.len ?? 2 }, x.id), { contact: x.contact, cover: x.cover });
              if (wall) x.wall = wall;
            }
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
      const custom = m.type.startsWith("custom_");
      el.innerHTML = `<h3>${esc(m.name || (FURNITURE[m.type]?.[0] ?? m.type))}</h3>
        <label>Typ</label><select data-m="type">${FURNITURE_CATEGORIES.map(([cat, types]) => `<optgroup label="${esc(cat)}">${types.map((k) => `<option value="${k}"${k === m.type ? " selected" : ""}>${esc(FURNITURE[k][0])}</option>`).join("")}</optgroup>`).join("")}</select>
        <label>Name ${custom ? "" : "(optional)"}</label><input data-m="name" value="${esc(m.name ?? "")}" placeholder="${esc(FURNITURE[m.type]?.[0] ?? "")}">
        <div class="row3">${num("w", custom && m.type === "custom_cylinder" ? "Ø Breite" : "Breite", m.w)}${num("d", custom && m.type === "custom_cylinder" ? "Ø Tiefe" : "Tiefe", m.d)}${num("h", ["column", "pillar"].includes(m.type) ? "Höhe (0 = Decke)" : "Höhe", m.h)}</div>
        <div class="row2">${num("rotation", "Drehung (°)", m.rotation, 15)}${num("mount_y", "Höhe über Boden", m.mount_y ?? "", 0.05)}</div>
        ${colorField("color", custom ? "Farbe" : "Farbe (statt Standard)", m.color)}
        ${pad(true)}
        <label>${lamp ? "Licht (Entität)" : "Verknüpfte Entität (optional)"}</label><input data-m="entity" list="dl_furn" value="${esc(m.entity && m.entity !== "none" ? m.entity : "")}" placeholder="${lamp ? "light.…" : "z. B. media_player.…"}">${entityList("dl_furn", lamp ? ["light", "switch"] : ["light", "switch", "media_player", "fan", "climate", "vacuum", "sensor"])}
        <p class="muted">Ziehen verschiebt (Magnet: rastet an Wänden ein), der orange Punkt dreht (Umschalt = frei). Pfeiltasten schieben, R dreht.</p>
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
      el.querySelector("[data-m=name]").addEventListener("change", (ev) => {
        this.change((fl) => {
          const x = fl.furniture.find((y) => y.id === m.id);
          if (ev.target.value.trim()) x.name = ev.target.value.trim();
          else delete x.name;
        });
        this.renderProps();
      });
      bindColors((fl, key, v) => {
        const x = fl.furniture.find((y) => y.id === m.id);
        if (v) x.color = v;
        else delete x.color;
      });
      bindPad();
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
    if (sel.kind === "wall") {
      const w = (f.walls ?? []).find((x) => x.id === sel.id);
      if (!w) return this._clearSel();
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const n = (f.openings ?? []).filter((o) => o.wall === w.id).length;
      el.innerHTML = `<h3>Wand</h3>
        <div class="row3">${num("len", "Länge (m)", r3(len))}${num("thickness", "Dicke (m)", w.thickness ?? this.b.settings?.wall_interior ?? 0.12, 0.01)}${num("height", "Höhe (m)", w.height ?? "", 0.05)}</div>
        <p class="muted">Höhe leer = Raumhöhe der Etage. ${n ? `${n} Fenster/Türen in dieser Wand.` : "Fenster und Türen: Werkzeug wählen und auf die Wand tippen."} Enden ziehen, Wand ziehen verschiebt sie.</p>
        ${colorField("color", "Farbe", w.color)}
        ${textureField("texture", "Textur", w.texture, "w")}
        ${pad()}
        <div class="btns"><button data-act="del" class="danger">Wand löschen</button></div>`;
      bindTextures((fl, key, v) => {
        const x = fl.walls.find((y) => y.id === w.id);
        if (v) x.texture = v;
        else delete x.texture;
      });
      bindNums((fl, k, v) => {
        const x = fl.walls.find((y) => y.id === w.id);
        if (k === "len") {
          // Länge: Ende b in gleicher Richtung verschieben
          const l = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) || 1;
          if (v > 0.05) x.b = [r3(x.a[0] + ((x.b[0] - x.a[0]) / l) * v), r3(x.a[1] + ((x.b[1] - x.a[1]) / l) * v)];
        } else if (k === "height") x.height = v;
        else if (v > 0) x[k] = v;
      });
      bindColors((fl, key, v) => {
        const x = fl.walls.find((y) => y.id === w.id);
        if (v) x.color = v;
        else delete x.color;
      });
      bindPad();
      bindDelete();
      return;
    }
    if (sel.kind === "device") {
      const st = hass.states[sel.id];
      const pl = f.placements.find((x) => x.entity_id === sel.id);
      el.innerHTML = `<h3>${esc(st?.attributes.friendly_name ?? sel.id)}</h3><p class="muted">${esc(sel.id)}</p>
        ${pl ? `<div class="row3">${num("x", "x", pl.x)}${num("z", "z", pl.z)}${num("y", "Höhe", pl.y ?? "")}</div><p class="muted">Höhe leer = Standard (Lampen unter der Decke).</p>` : `<p class="muted">Automatisch im Raum verteilt. Ziehen legt die Position fest.</p>`}
        ${pl ? pad() : ""}
        <div class="btns">${pl ? `<button data-act="del">Automatisch platzieren</button>` : ""}</div>`;
      bindPad();
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
        ${textureField("texture", "Textur", o.texture, "g")}
        <label>Bereich (für Gartenlicht, Sensoren)</label><select data-g="area_id">${areaOptions(o.area_id)}</select>
        <label>Geländer / Zaun am Rand (nicht an Hauswänden)</label><select data-g="railing">${RAILINGS.map(([k, n]) => `<option value="${k}"${k === (o.railing ?? "") ? " selected" : ""}>${n}</option>`).join("")}</select>
        <label>Geländerhöhe (m)</label><input data-g="railing_height" type="number" step="0.05" min="0.3" max="2.5" value="${o.railing_height ?? ""}" placeholder="1,0">
        <label>Hang: Höhe je Ecke (m über der Etage ${esc(f.name)})</label>
        ${Array.isArray(o.heights) ? `<div class="row3">${o.points.map((_, i) => `<div><label>Ecke ${i + 1}</label><input type="number" step="0.05" data-h="${i}" value="${Number(o.heights[i]) || 0}"></div>`).join("")}</div>` : `<p class="muted">Eben. „Höhen automatisch“ verbindet die Fläche mit den Gartenflächen anderer Etagen (z. B. Böschung von unten nach oben).</p>`}
        <div class="btns"><button data-act="autoh">Höhen automatisch</button>${Array.isArray(o.heights) ? `<button data-act="flat">Eben machen</button>` : `<button data-act="hmanual">Höhen von Hand</button>`}</div>
        ${pad()}
        <div class="btns"><button data-act="del" class="danger">Löschen</button></div>`;
      bindPad();
      bindTextures((fl, key, v) => {
        const x = fl.outdoor.find((y) => y.id === o.id);
        if (v) x.texture = v;
        else delete x.texture;
      });
      el.querySelectorAll("[data-h]").forEach((inp) =>
        inp.addEventListener("change", () => {
          this.change((fl) => {
            const x = fl.outdoor.find((y) => y.id === o.id);
            const hs = [...(x.heights ?? x.points.map(() => 0))];
            hs[Number(inp.dataset.h)] = r3(Number(inp.value) || 0);
            x.heights = hs;
          });
        }),
      );
      el.querySelector("[data-act=autoh]").addEventListener("click", () => {
        const hs = autoHeights(this.b, this.floorId, o.id);
        if (!hs) return this._toast("Keine Gartenfläche einer anderen Etage in der Nähe (bis 50 cm). Ecken an die obere Fläche ziehen oder Höhen von Hand eintragen.");
        this.change((fl) => {
          fl.outdoor.find((y) => y.id === o.id).heights = hs;
        });
        this._toast(`Hang gesetzt: ${hs.map((h) => h.toFixed(2)).join(" / ")} m`);
        this.renderProps();
      });
      el.querySelector("[data-act=flat]")?.addEventListener("click", () => {
        this.change((fl) => {
          delete fl.outdoor.find((y) => y.id === o.id).heights;
        });
        this.renderProps();
      });
      el.querySelector("[data-act=hmanual]")?.addEventListener("click", () => {
        this.change((fl) => {
          const x = fl.outdoor.find((y) => y.id === o.id);
          x.heights = x.points.map(() => 0);
        });
        this.renderProps();
      });
      el.querySelectorAll("[data-g]").forEach((inp) =>
        inp.addEventListener("change", () => this.change((fl) => {
          const x = fl.outdoor.find((y) => y.id === o.id);
          let v = inp.value || null;
          if (v !== null && inp.type === "number") v = Number(v);
          if (v === null || Number.isNaN(v)) delete x[inp.dataset.g];
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
