// Maße im Editor (Mixin für FloorEditor): Kantenlängen am Plan, Schalter „Maße“ für alle Räume,
// Werkzeug „Messen“ (bis zu 3 Strecken, nicht gespeichert), Länge/Breite/Tiefe eintippen, Flächenliste.

import { edgeDimensions, floorVertices, isAxisRect, nearestEdge, projectOnSegment, setEdgeLength, setRectSize, snapPoint } from "./edit-ops.js";
import { signedArea } from "./walls.js";
import { RAILINGS_STAIR, STAIR_SHAPES, runWidth, slabOpenings, stairLayout } from "./stairs.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const de = (v, d = 2) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

export const MeasureMethods = {
  /** Kantenlängen: gewählter Raum, mit „Maße“ alle Räume der Etage. Unter 40 px Kante kein Schild. */
  _dimParts(px) {
    const f = this.floor;
    const rooms = this.showDims ? f.rooms : f.rooms.filter((r) => this.sel?.kind === "room" && this.sel.id === r.id);
    const parts = [];
    for (const r of rooms) {
      for (const e of edgeDimensions(r.points)) {
        if (e.len * this.scale < 40) continue;
        const q = [e.mid[0] + e.nOut[0] * px(14), e.mid[1] + e.nOut[1] * px(14)];
        parts.push(`<text data-dim="${e.i}" x="${r3(q[0])}" y="${r3(q[1] + px(4))}" text-anchor="middle" font-size="${px(12)}" stroke-width="${px(3)}" class="ed-dim">${de(e.len)} m</text>`);
      }
    }
    // Messungen
    for (const m of this.measures ?? []) {
      const [a, b] = m;
      if (!b) {
        parts.push(`<circle cx="${r3(a[0])}" cy="${r3(a[1])}" r="${px(5)}" fill="#e91e63"/>`);
        continue;
      }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const deg = Math.round(((Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI + 360) % 180);
      parts.push(`<line x1="${r3(a[0])}" y1="${r3(a[1])}" x2="${r3(b[0])}" y2="${r3(b[1])}" stroke="#e91e63" stroke-width="${px(2)}" stroke-dasharray="${px(6)} ${px(4)}"/>`);
      for (const q of m) parts.push(`<circle cx="${r3(q[0])}" cy="${r3(q[1])}" r="${px(4)}" fill="#e91e63"/>`);
      parts.push(`<text data-measure x="${r3((a[0] + b[0]) / 2)}" y="${r3((a[1] + b[1]) / 2 - px(8))}" text-anchor="middle" font-size="${px(13)}" stroke-width="${px(3)}" class="ed-dim measure">${de(len)} m · ${deg}°</text>`);
    }
    return parts.join("");
  },

  /** Messen: Punkt rastet an Ecken, dann an Kanten, sonst am Raster. */
  _measureTap(p) {
    const tol = this._snapTol();
    let q = snapPoint(p, { grid: 0, vertices: floorVertices(this.floor), tol });
    if (q[0] === p[0] && q[1] === p[1]) {
      const e = nearestEdge(this.floor, p, tol);
      if (e) {
        const pts = e.room.points;
        q = projectOnSegment(p, pts[e.edge], pts[(e.edge + 1) % pts.length]).point;
      } else q = snapPoint(p, { grid: this.b.settings?.grid ?? 0.05, vertices: [], tol: 0 });
    }
    this.measures = this.measures ?? [];
    const last = this.measures.at(-1);
    if (last && last.length === 1) last.push(q);
    else {
      this.measures.push([q]);
      while (this.measures.length > 3) this.measures.shift();
    }
    this.render();
  },

  /** Feld „Länge (m)“ der gewählten Kante. */
  _edgeLengthField(r, ei) {
    const e = edgeDimensions(r.points)[ei];
    return `<label>Länge (m)</label><input type="number" min="0.1" step="0.01" data-edgelen value="${r3(e.len)}">`;
  },

  /** Breite/Tiefe für achsparallele Rechtecke. */
  _rectFields(r) {
    if (!isAxisRect(r.points)) return "";
    const xs = r.points.map((p) => p[0]);
    const zs = r.points.map((p) => p[1]);
    return `<div class="row2"><div><label>Breite (m)</label><input type="number" min="0.1" step="0.01" data-rectsize="w" value="${r3(Math.max(...xs) - Math.min(...xs))}"></div><div><label>Tiefe (m)</label><input type="number" min="0.1" step="0.01" data-rectsize="d" value="${r3(Math.max(...zs) - Math.min(...zs))}"></div></div>`;
  },

  _bindMeasureFields(el, r, ei) {
    const opts = { linked: !this.mods?.solo };
    const moved = (before, after) => {
      const names = after.rooms.filter((x) => x.id !== r.id && JSON.stringify(x.points) !== JSON.stringify(before.rooms.find((y) => y.id === x.id)?.points)).map((x) => x.name);
      if (names.length) this._toast(`Mitgezogen: ${names.join(", ")}`);
    };
    el.querySelector("[data-edgelen]")?.addEventListener("change", (ev) => {
      const v = Number(ev.target.value);
      if (!(v > 0.05)) return;
      const before = this.floor;
      this.change((fl) => setEdgeLength(fl, r.id, ei, v, opts));
      moved(before, this.floor);
      this.renderProps();
    });
    el.querySelectorAll("[data-rectsize]").forEach((inp) => inp.addEventListener("change", () => {
      const v = Number(inp.value);
      if (!(v > 0.05)) return;
      const before = this.floor;
      this.change((fl) => setRectSize(fl, r.id, { [inp.dataset.rectsize]: v }, opts));
      moved(before, this.floor);
      this.renderProps();
    }));
  },

  /** Treppe: Form, Geländer, Deckenöffnung, „Bis zur nächsten Etage“, Stufen und Steigung. */
  _stairFields(m) {
    if (m.type !== "stairs") return "";
    const lay = stairLayout({ shape: m.stair_shape, w: Number(m.w) || 1, d: Number(m.d) || 3, h: Number(m.h) || 2.6 });
    const sel = (key, list, v) => `<select data-stair="${key}">${list.map(([k, n]) => `<option value="${k}"${k === v ? " selected" : ""}>${n}</option>`).join("")}</select>`;
    return `<div class="row2"><div><label>Treppenform</label>${sel("stair_shape", STAIR_SHAPES, m.stair_shape ?? "straight")}</div><div><label>Geländer</label>${sel("railing", RAILINGS_STAIR, m.railing ?? "none")}</div></div>
      ${/^(l|lw|u)_/.test(m.stair_shape ?? "") ? `<label>Laufbreite (m)</label><input type="number" min="0.5" max="2" step="0.05" data-stairnum="run_width" value="${de(runWidth({ shape: m.stair_shape, w: Number(m.w) || 1, d: Number(m.d) || 3, run: m.run_width }), 2).replace(",", ".")}">` : ""}
      <p class="muted">Breite und Tiefe oben sind die Grundfläche der ganzen Treppe; „Kehre links/rechts“ ist die Richtung, in die die Treppe nach oben abbiegt.</p>
      <label class="chk"><input type="checkbox" data-stair="cut"${m.cut === false ? "" : " checked"}> Deckenöffnung in der Etage darüber</label>
      <div class="btns"><button data-act="stairnext">Bis zur nächsten Etage</button></div>
      <p class="muted">${lay.count} Stufen · Steigung ${de(lay.rise * 100, 1)} cm</p>`;
  },

  _bindStairFields(el, m) {
    if (m.type !== "stairs") return;
    const upd = (fn) => {
      this.change((fl) => {
        fn(fl.furniture.find((y) => y.id === m.id));
      });
      this.renderProps();
    };
    el.querySelectorAll("select[data-stair]").forEach((s) => s.addEventListener("change", () => upd((x) => (x[s.dataset.stair] = s.value === "none" && s.dataset.stair === "railing" ? undefined : s.value))));
    el.querySelector('[data-stairnum="run_width"]')?.addEventListener("change", (ev) => {
      const v = Number(ev.target.value);
      if (v > 0.3) upd((x) => (x.run_width = v));
    });
    el.querySelector('input[data-stair="cut"]')?.addEventListener("change", (ev) => upd((x) => {
      if (ev.target.checked) delete x.cut;
      else x.cut = false;
    }));
    el.querySelector("[data-act=stairnext]")?.addEventListener("click", () => {
      const f = this.floor;
      const next = [...this.b.floors].filter((x) => (x.elevation ?? 0) > (f.elevation ?? 0)).sort((a, b) => a.elevation - b.elevation)[0];
      if (!next) return this._toast("Keine Etage darüber.");
      const h = Math.round(((next.elevation ?? 0) - (f.elevation ?? 0) - (Number(m.mount_y) || 0)) * 100) / 100;
      upd((x) => (x.h = h));
      this._toast(`Höhe ${de(h)} m – reicht bis ${next.name}.`);
    });
  },

  /** Treppe im Plan (im Möbel-System, die Gruppe ist schon verschoben/gedreht): Stufen und Lauflinie. */
  _stairPlan(m, fw, fd, px) {
    if (m.type !== "stairs") return "";
    const lay = stairLayout({ shape: m.stair_shape, w: fw, d: fd, h: Number(m.h) || 2.6, run: m.run_width });
    const pts = (t) => t.poly ?? [[t.x0, t.z0], [t.x1, t.z0], [t.x1, t.z1], [t.x0, t.z1]];
    const steps = lay.treads.map((t) => `<polygon points="${pts(t).map((p) => `${r3(p[0])},${r3(p[1])}`).join(" ")}" fill="${t.landing ? "rgba(255,255,255,.18)" : "none"}" stroke="#5d4037" stroke-opacity=".7" stroke-width="${px(0.8)}"/>`).join("");
    const path = lay.path.map((p) => `${r3(p[0])},${r3(p[1])}`).join(" ");
    const end = lay.path.at(-1);
    return `<g pointer-events="none">${steps}<polyline points="${path}" fill="none" stroke="#e91e63" stroke-width="${px(1.5)}"/><circle cx="${r3(lay.path[0][0])}" cy="${r3(lay.path[0][1])}" r="${px(3.5)}" fill="#e91e63"/><circle cx="${r3(end[0])}" cy="${r3(end[1])}" r="${px(5)}" fill="none" stroke="#e91e63" stroke-width="${px(1.5)}"/></g>`;
  },

  /** Deckenöffnungen dieser Etage (Treppe von unten) gestrichelt. */
  _openingParts(px, P) {
    return slabOpenings(this.b, this.floorId).map((o) => {
      const c = [o.poly.reduce((t, q) => t + q[0], 0) / o.poly.length, o.poly.reduce((t, q) => t + q[1], 0) / o.poly.length];
      return `<g pointer-events="none" data-slabhole><polygon points="${o.poly.map(P).join(" ")}" fill="none" stroke="#e91e63" stroke-width="${px(1.5)}" stroke-dasharray="${px(5)} ${px(4)}"/><text x="${r3(c[0])}" y="${r3(c[1])}" text-anchor="middle" font-size="${px(11)}" fill="#e91e63">Treppe von ${String(o.from).replace(/[&<>"']/g, "")}</text></g>`;
    }).join("");
  },

  /** Flächen der Etage mit Summe. */
  _areaList(f) {
    if (!f.rooms.length) return "";
    const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const rows = f.rooms.map((r) => [r.name || r.id, Math.abs(signedArea(r.points))]);
    const sum = rows.reduce((t, [, a]) => t + a, 0);
    return `<h3>Flächen</h3><div class="ed-areas">${rows.map(([n, a]) => `<div><span>${esc(n)}</span><b>${de(a, 1)} m²</b></div>`).join("")}<div class="sum"><span>Fläche gesamt</span><b>${de(sum, 1)} m²</b></div></div>`;
  },
};

export const MEASURE_STYLE = `
.ed-svg .ed-dim { fill: #03a9f4; paint-order: stroke; stroke: var(--card-background-color, #fff); stroke-linejoin: round; pointer-events: none; font-weight: 500; }
.ed-svg .ed-dim.measure { fill: #e91e63; }
.ed-areas { font-size: 13px; }
.ed-areas div { display: flex; justify-content: space-between; padding: 2px 0; }
.ed-areas span { color: var(--secondary-text-color); }
.ed-areas .sum { border-top: 1px solid var(--divider-color, rgba(127,127,127,.3)); margin-top: 4px; padding-top: 4px; font-weight: 600; }
`;
