// Garten-Linien im Editor (Mixin für FloorEditor): Weg, Hecke, Zaun und Mauer als Linie zeichnen.
// Weg/Hecke/Zaun werden Gartenflächen mit Mittellinie (line), die Mauer wird eine Kette freistehender
// Wände.

import { allIds, newId, offsetPolyline, polylineLength } from "./edit-ops.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const de = (v, d = 2) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

export const LINE_KINDS = [
  ["path", "Weg", 1.0, 0],
  ["hedge", "Hecke", 0.6, 1.2],
  ["fence", "Zaun", 0.05, 1.0],
  ["wall", "Mauer", 0.25, 1.0],
];
export const FENCE_STYLES = [["wood", "Holz"], ["bars", "Doppelstabmatte"], ["slats", "Lamellen"]];
export const WALL_LINE_TEXTURES = [["stone", "Naturstein"], ["concrete", "Beton"], ["brick", "Klinker"]];

export const LineMethods = {
  _lineOpts() {
    if (!this.lineOpts) {
      this.lineOpts = { kind: "path", width: 1.0, height: 0, fence_style: "wood", texture: "stone" };
    }
    return this.lineOpts;
  },

  /** Tipp mit dem Werkzeug „Linie“: Punkt anhängen (0/45/90° wie bei Wänden, „Frei“ ohne). */
  _lineTap(ev, p) {
    const d = this.draft;
    if (!d?.line) {
      this.draft = { line: [this._snap(p)] };
    } else {
      const last = d.line.at(-1);
      const q = this._wallSnap(last, p, this._free(ev));
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.05) return this._finishLine();
      d.line.push(q);
    }
    this.render();
  },

  /** Entwurf: Band in der gewählten Breite und Gesamtlänge. */
  _lineDraftParts(px, P) {
    const d = this.draft;
    if (!d?.line || d.pipe) return "";
    const pts = [...d.line, ...(d.hover ? [d.hover] : [])];
    const o = this._lineOpts();
    const poly = pts.length > 1 ? offsetPolyline(pts, Math.max(o.width, px(4))) : [];
    const len = polylineLength(pts);
    const last = pts.at(-1);
    return `${poly.length ? `<polygon points="${poly.map(P).join(" ")}" fill="#4caf50" fill-opacity=".35" stroke="#2e7d32" stroke-width="${px(1.5)}" stroke-dasharray="${px(5)} ${px(3)}"/>` : ""}
      <polyline points="${pts.map(P).join(" ")}" fill="none" stroke="#2e7d32" stroke-width="${px(2)}"/>
      ${d.line.map((q) => `<circle cx="${r3(q[0])}" cy="${r3(q[1])}" r="${px(4)}" fill="#2e7d32"/>`).join("")}
      ${len > 0.01 ? `<text data-linelen x="${r3(last[0])}" y="${r3(last[1] - px(10))}" text-anchor="middle" font-size="${px(13)}" stroke-width="${px(3)}" class="ed-dim">${de(len)} m</text>` : ""}`;
  },

  /** Linie fertig: Gartenfläche mit Mittellinie bzw. Mauer aus freistehenden Wänden. */
  _finishLine() {
    const pts = this.draft?.line ?? [];
    this.draft = null;
    if (pts.length < 2) return this.render();
    const o = this._lineOpts();
    const ids = allIds(this.b);
    if (o.kind === "wall") {
      const walls = [];
      for (let i = 1; i < pts.length; i++) {
        const id = newId("mauer", ids);
        ids.add(id);
        walls.push({ id, a: [r3(pts[i - 1][0]), r3(pts[i - 1][1])], b: [r3(pts[i][0]), r3(pts[i][1])], thickness: o.width, height: o.height || 1.0, texture: o.texture, color: { stone: "#b3aea5", concrete: "#9e9e9e", brick: "#a5543d" }[o.texture] });
      }
      this.change((fl) => {
        fl.walls = [...(fl.walls ?? []), ...walls];
      });
      this.sel = { kind: "wall", id: walls.at(-1).id };
    } else {
      const area = { id: newId(o.kind, ids), type: o.kind, points: offsetPolyline(pts, o.width), line: { points: pts.map((q) => [r3(q[0]), r3(q[1])]), width: o.width } };
      if (o.kind !== "path") area.height = o.height || (o.kind === "hedge" ? 1.2 : 1.0);
      if (o.kind === "fence") area.fence_style = o.fence_style;
      if (area.points.length < 3) return this.render();
      this.change((fl) => {
        fl.outdoor = [...(fl.outdoor ?? []), area];
      });
      this.sel = { kind: "outdoor", id: area.id };
    }
    this._toast(`${LINE_KINDS.find((k) => k[0] === o.kind)[1]}: ${de(polylineLength(pts))} m`);
    // danach das Ergebnis bearbeiten (Breite, Höhe …)
    this.tool = "select";
    this.renderBar();
    this.render();
    this.renderProps();
  },

  /** Eigenschaften, solange das Werkzeug „Linie“ aktiv ist. */
  _lineToolProps(el) {
    const o = this._lineOpts();
    el.innerHTML = `<h3>Linie</h3>
      <div class="seg wide" data-linekind>${LINE_KINDS.map(([k, n]) => `<button data-k="${k}" class="${o.kind === k ? "sel" : ""}">${n}</button>`).join("")}</div>
      <div class="row2"><div><label>Breite (m)</label><input type="number" min="0.02" max="10" step="0.05" data-lo="width" value="${o.width}"></div>
      ${o.kind === "path" ? "" : `<div><label>Höhe (m)</label><input type="number" min="0.1" max="6" step="0.05" data-lo="height" value="${o.height}"></div>`}</div>
      ${o.kind === "fence" ? `<label>Zaunart</label><select data-lo="fence_style">${FENCE_STYLES.map(([k, n]) => `<option value="${k}"${o.fence_style === k ? " selected" : ""}>${n}</option>`).join("")}</select>` : ""}
      ${o.kind === "wall" ? `<label>Mauer</label><select data-lo="texture">${WALL_LINE_TEXTURES.map(([k, n]) => `<option value="${k}"${o.texture === k ? " selected" : ""}>${n}</option>`).join("")}</select>` : ""}
      <p class="muted">Punkte antippen (rastet bei 0/45/90° ein, „Frei“ ohne), „Fertig“ oder denselben Punkt nochmal antippen. ${o.kind === "wall" ? "Stützmauer auf der unteren Etage zeichnen, Höhe = Geländesprung." : ""}</p>`;
    el.querySelectorAll("[data-linekind] [data-k]").forEach((b) => b.addEventListener("click", () => {
      const k = LINE_KINDS.find((x) => x[0] === b.dataset.k);
      Object.assign(o, { kind: k[0], width: k[2], height: k[3] });
      this.renderProps();
      this.render();
    }));
    el.querySelectorAll("[data-lo]").forEach((inp) => inp.addEventListener("change", () => {
      const k = inp.dataset.lo;
      o[k] = inp.tagName === "SELECT" ? inp.value : Math.max(0.02, Number(inp.value) || o[k]);
      this.render();
    }));
  },

  /** Gartenfläche mit Mittellinie: Breite/Höhe/Zaunart ändern baut die Fläche neu. */
  _lineAreaFields(a) {
    if (!a.line) return "";
    return `<div class="row2"><div><label>Breite (Linie, m)</label><input type="number" min="0.02" step="0.05" data-la="width" value="${a.line.width}"></div>
      ${a.type === "path" ? "" : `<div><label>Höhe (m)</label><input type="number" min="0.1" step="0.05" data-la="height" value="${a.height ?? ""}"></div>`}</div>
      ${a.type === "fence" ? `<label>Zaunart</label><select data-la="fence_style">${FENCE_STYLES.map(([k, n]) => `<option value="${k}"${(a.fence_style ?? "wood") === k ? " selected" : ""}>${n}</option>`).join("")}</select>` : ""}
      <p class="muted">Als Linie gezeichnet (${de(polylineLength(a.line.points))} m). Ecken direkt ziehen macht eine normale Fläche daraus.</p>
      <div class="btns"><button data-act="unline">In normale Fläche umwandeln</button></div>`;
  },

  _bindLineArea(el, a) {
    if (!a.line) return;
    const upd = (fn) => {
      this.change((fl) => {
        const x = fl.outdoor.find((y) => y.id === a.id);
        fn(x);
        if (x.line) x.points = offsetPolyline(x.line.points, x.line.width);
      });
      this.renderProps();
    };
    el.querySelectorAll("[data-la]").forEach((inp) => inp.addEventListener("change", () => {
      const k = inp.dataset.la;
      const v = inp.tagName === "SELECT" ? inp.value : Number(inp.value);
      if (inp.tagName !== "SELECT" && !(v > 0)) return;
      upd((x) => {
        if (k === "width") x.line.width = v;
        else x[k] = v;
      });
    }));
    el.querySelector("[data-act=unline]")?.addEventListener("click", () => upd((x) => delete x.line));
  },
};
