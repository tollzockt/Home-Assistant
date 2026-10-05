// Bauplan-Werkzeuge im Editor (Mixin für FloorEditor): Bauplan-Foto unter dem Grundriss (laden,
// verschieben, Maßstab aus zwei Punkten), Fang-Hilfen (Fluchtlinien, Länge/Winkel eintippen),
// Mehrfachauswahl (Schalter „Mehrfach“ bzw. Umschalt, Rahmen aufziehen) mit Kopieren/Einfügen,
// Duplizieren und Vorlagen (settings.templates, auf allen Etagen nutzbar).

import { allIds, newId } from "./edit-ops.js";
import {
  MULTI_KINDS,
  alignGuides,
  clipSummary,
  copyRefs,
  defaultBackground,
  fitSize,
  moveRefs,
  pasteClip,
  pointAt,
  refsBounds,
  refsInRect,
  removeRefs,
  scaleBackground,
  segmentInfo,
  toggleRef,
} from "./plan-tools.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const de = (v, d = 2) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MAX_TEMPLATES = 30;

export const PLAN_HINTS = {
  bgmove: "Bauplan-Foto: ziehen verschiebt das Bild. Fertig: „Auswählen“ oder Esc.",
  bgscale: "Maßstab: zwei Punkte auf dem Foto antippen, deren Abstand du kennst (z. B. eine bemaßte Wand).",
};

export const PlanMethods = {
  // ------------------------------------------------------------------ Fang-Hilfen

  /** Fluchtlinien an einen bereits eingerasteten Punkt anlegen (axes: welche Achsen übernommen werden). */
  _align(q, vertices, axes = "xz") {
    this._guides = null;
    if (this.mods?.free || !axes || vertices.some((v) => Math.abs(v[0] - q[0]) < 1e-9 && Math.abs(v[1] - q[1]) < 1e-9)) return q;
    const r = alignGuides(q, vertices, this._snapTol());
    const guides = r.guides.filter((g) => axes.includes(g.axis));
    if (!guides.length) return q;
    const out = [q[0], q[1]];
    for (const g of guides) out[g.axis === "x" ? 0 : 1] = g.v;
    this._guides = { at: out, list: guides };
    return out;
  },

  /** Beim Wandzeichnen: waagerecht nur x übernehmen, senkrecht nur z (Winkel bleibt). */
  _alignWall(a, q, vertices) {
    const axes = Math.abs(q[1] - a[1]) < 1e-9 ? "x" : Math.abs(q[0] - a[0]) < 1e-9 ? "z" : "";
    return this._align(q, vertices, axes);
  },

  /** Länge/Winkel aus der Zeichen-Leiste: nächsten Punkt genau setzen. */
  _draftLen() {
    const d = this.draft;
    const bar = this._touchEl?.querySelector(".ed-draftbar");
    if (!d || !bar) return;
    const last = d.wall ?? d.points?.at(-1) ?? d.line?.at(-1);
    if (!last) return;
    const lenInp = bar.querySelector("[data-dlen]");
    const degInp = bar.querySelector("[data-ddeg]");
    const len = Number(String(lenInp.value).replace(",", "."));
    if (!(len > 0.01)) return this._toast("Länge in Metern eingeben, z. B. 3,65.");
    const raw = String(degInp.value).replace(",", ".").trim();
    const deg = raw === "" ? (d.hover ? segmentInfo(last, d.hover).deg : 0) : Number(raw);
    if (!Number.isFinite(deg)) return this._toast("Winkel in Grad: 0 = rechts, 90 = nach oben.");
    const q = pointAt(last, len, deg);
    if (d.wall) {
      const w = { id: newId("wand", allIds(this.b)), a: [r3(last[0]), r3(last[1])], b: q, thickness: this.b.settings?.wall_interior ?? 0.12, height: null };
      this.change((fl) => {
        fl.walls = [...(fl.walls ?? []), w];
      });
      this.sel = { kind: "wall", id: w.id };
      this.draft = { wall: w.b };
      this.renderProps();
    } else if (d.line) d.line.push(q);
    else d.points.push(q);
    d.hover = null;
    lenInp.value = "";
    degInp.value = "";
    this.render();
    this._toast(`${de(len)} m · ${de(deg, 0)}° gesetzt`);
  },

  /** Platzhalter der Längenfelder: aktuelle Länge/Winkel zum Zeiger. */
  _updateDraftLen(bar) {
    const d = this.draft;
    const last = d?.wall ?? d?.points?.at(-1) ?? d?.line?.at(-1);
    const info = last && d.hover ? segmentInfo(last, d.hover) : null;
    bar.querySelector("[data-dlen]").placeholder = info ? `${de(info.len)} m` : "Länge m";
    bar.querySelector("[data-ddeg]").placeholder = info ? `${de(info.deg, 0)}°` : "Winkel°";
  },

  // ------------------------------------------------------------------ Zeichnen

  /** Bauplan-Foto unter allem (nur im Grundriss, nicht in der Dach-Ebene). */
  _bgParts() {
    const bg = this.floor?.background;
    if (this.roofMode || !bg || bg.visible === false) return "";
    const url = this._bgUrl(this.floorId);
    if (!url) return "";
    const h = bg.width * (bg.aspect || 0.75);
    const cx = bg.x + bg.width / 2;
    const cz = bg.z + h / 2;
    return `<image data-bg href="${url}" x="${r3(bg.x)}" y="${r3(bg.z)}" width="${r3(bg.width)}" height="${r3(h)}" preserveAspectRatio="none" opacity="${Math.max(0.05, Math.min(1, bg.opacity ?? 0.5))}" transform="rotate(${Number(bg.rotation) || 0} ${r3(cx)} ${r3(cz)})" pointer-events="none"/>`;
  },

  /** Fluchtlinien, Mehrfachauswahl, Rahmen und Maßstab-Punkte. */
  _planParts(px, P) {
    const parts = [];
    const g = this._guides;
    if (g && (this.draft || this._dragging)) {
      for (const x of g.list) parts.push(`<line x1="${r3(x.from[0])}" y1="${r3(x.from[1])}" x2="${r3(x.axis === "x" ? x.from[0] : g.at[0])}" y2="${r3(x.axis === "x" ? g.at[1] : x.from[1])}" stroke="#ff4081" stroke-width="${px(1)}" stroke-dasharray="${px(4)} ${px(3)}" pointer-events="none" data-guide="${x.axis}"/>`);
    }
    const f = this.floor;
    for (const r of this.multi ?? []) {
      const list = { room: f.rooms, furniture: f.furniture, outdoor: f.outdoor, wall: f.walls }[r.kind] ?? [];
      const x = list.find((y) => y.id === r.id);
      if (!x) continue;
      const st = `fill="none" stroke="#ff9800" stroke-width="${px(3)}" stroke-dasharray="${px(6)} ${px(3)}" pointer-events="none" data-multi`;
      if (r.kind === "furniture") parts.push(`<circle cx="${r3(x.x)}" cy="${r3(x.z)}" r="${r3(Math.max(x.w || 0.6, x.d || 0.6) / 2 + px(4))}" ${st}/>`);
      else if (r.kind === "wall") parts.push(`<line x1="${r3(x.a[0])}" y1="${r3(x.a[1])}" x2="${r3(x.b[0])}" y2="${r3(x.b[1])}" ${st}/>`);
      else parts.push(`<polygon points="${x.points.map(P).join(" ")}" ${st}/>`);
    }
    if (this._lasso) {
      const [a, b] = this._lasso;
      parts.push(`<rect x="${r3(Math.min(a[0], b[0]))}" y="${r3(Math.min(a[1], b[1]))}" width="${r3(Math.abs(b[0] - a[0]))}" height="${r3(Math.abs(b[1] - a[1]))}" fill="#ff9800" fill-opacity=".08" stroke="#ff9800" stroke-width="${px(1.5)}" stroke-dasharray="${px(5)} ${px(3)}" pointer-events="none"/>`);
    }
    if (this.tool === "bgscale") for (const q of this._bgPts ?? []) parts.push(`<circle cx="${r3(q[0])}" cy="${r3(q[1])}" r="${px(6)}" fill="#e91e63" stroke="#fff" stroke-width="${px(2)}"/>`);
    if (this.tool === "bgscale" && this._bgPts?.length === 2) {
      const [a, b] = this._bgPts;
      parts.push(`<line x1="${r3(a[0])}" y1="${r3(a[1])}" x2="${r3(b[0])}" y2="${r3(b[1])}" stroke="#e91e63" stroke-width="${px(2)}"/>`);
    }
    return parts.join("");
  },

  // ------------------------------------------------------------------ Zeiger

  /** Vor dem normalen Auswählen: Foto-Werkzeuge und Mehrfachauswahl. undefined = normal weiter. */
  _planStart(ev, p, kind, id) {
    this._lastP = p;
    if (this.tool === "bgmove") return this.floor.background ? { mode: "bgmove", start: p, first: true } : null;
    if (this.tool === "bgscale") {
      this._bgPts = this._bgPts?.length === 1 ? [...this._bgPts, p] : [p];
      this.render();
      this.renderProps();
      if (this._bgPts.length === 2) this.props.querySelector("[data-bgreal]")?.focus();
      return null;
    }
    if (this.tool !== "select") return undefined;
    const isMulti = MULTI_KINDS.includes(kind);
    const has = (r) => r.kind === kind && r.id === id;
    const adding = !!(this.mods?.multi || ev.shiftKey);
    if (isMulti && !adding && this.multi?.length > 1 && this.multi.some(has)) return { mode: "multimove", start: p, first: true };
    if (adding) {
      // Tippen schaltet ein Teil um; Ziehen verschiebt die gewählten bzw. zieht (auch über Rasen) einen Rahmen auf
      if (isMulti && this.multi?.some(has)) return { mode: "multimove", start: p, a: p, first: true, tap: { kind, id } };
      if (isMulti || !kind) return { mode: "lasso", a: p, tap: isMulti ? { kind, id } : null };
      return undefined;
    }
    if (this.multi?.length) {
      this.multi = [];
      if (!kind) {
        this.renderProps();
        this.render();
      }
    }
    return undefined;
  },

  /** true, wenn der Zug hier behandelt wurde. */
  _planMove(drag, p) {
    if (drag.mode === "bgmove") {
      const dx = p[0] - drag.start[0];
      const dz = p[1] - drag.start[1];
      drag.start = p;
      this._dragChange(drag, (fl) => {
        fl.background = { ...fl.background, x: r3(fl.background.x + dx), z: r3(fl.background.z + dz) };
      });
      return true;
    }
    if (drag.mode === "multimove") {
      if (drag.tap && !drag.moved && Math.hypot(p[0] - drag.a[0], p[1] - drag.a[1]) * this.scale < 6) return true;
      drag.moved = true;
      const grid = this.b.settings?.grid ?? 0.05;
      const dx = r3(Math.round((p[0] - drag.start[0]) / grid) * grid);
      const dz = r3(Math.round((p[1] - drag.start[1]) / grid) * grid);
      if (!dx && !dz) return true;
      drag.start = [drag.start[0] + dx, drag.start[1] + dz];
      this._dragChange(drag, (fl) => moveRefs(fl, this.multi, dx, dz));
      return true;
    }
    if (drag.mode === "lasso") {
      if (!drag.moved && Math.hypot(p[0] - drag.a[0], p[1] - drag.a[1]) * this.scale < 6) return true;
      drag.moved = true;
      this._lasso = [drag.a, p];
      this.render();
      return true;
    }
    return false;
  },

  _planEnd(drag) {
    this._guides = null;
    if ((drag.mode === "lasso" || drag.mode === "multimove") && drag.tap && !drag.moved) {
      let refs = this.multi ?? [];
      if (!refs.length && this.sel && MULTI_KINDS.includes(this.sel.kind)) refs = [{ kind: this.sel.kind, id: this.sel.id }];
      this.multi = toggleRef(refs, drag.tap);
      this.sel = null;
      this._lasso = null;
      this.render();
      this.renderProps();
      return true;
    }
    if (drag.mode === "lasso" && this._lasso) {
      const found = refsInRect(this.floor, ...this._lasso);
      this._lasso = null;
      let refs = this.multi ?? [];
      for (const r of found) if (!refs.some((x) => x.kind === r.kind && x.id === r.id)) refs = [...refs, r];
      this.multi = refs;
      this.sel = null;
      this.render();
      this.renderProps();
      if (found.length) this._toast(`${found.length} Teile im Rahmen gewählt.`);
      return true;
    }
    return drag.mode === "bgmove" || drag.mode === "multimove";
  },

  // ------------------------------------------------------------------ Tasten

  /** Strg+C/V/D/A, Entf und Pfeile für die Mehrfachauswahl; Ziffern beim Zeichnen → Längenfeld. */
  _planKey(ev) {
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (ev.key === "Escape" && this.tool.startsWith("bg")) {
      this._setPlanTool("select");
      return true;
    }
    if (this.draft && !ctrl && /^[0-9]$/.test(ev.key)) {
      const inp = this._touchEl?.querySelector("[data-dlen]");
      if (inp && !inp.closest("[hidden]")) {
        inp.value = "";
        inp.focus();
        return false; // Taste landet im Feld
      }
    }
    if (this.roofMode) return false;
    if (ctrl && k === "c") return this._copySel() || false;
    if (ctrl && k === "v" && this._clip) {
      ev.preventDefault();
      this._paste(this._clip, this._pastePoint());
      return true;
    }
    if (ctrl && k === "d" && this._selRefs().length) {
      ev.preventDefault();
      this._duplicate();
      return true;
    }
    if (ctrl && k === "a") {
      ev.preventDefault();
      this.multi = refsInRect(this.floor, [-1e6, -1e6], [1e6, 1e6]);
      this.sel = null;
      this.render();
      this.renderProps();
      return true;
    }
    if (!this.multi?.length) return false;
    if (ev.key === "Escape") {
      this.multi = [];
      this.render();
      this.renderProps();
      return true;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      this._deleteMulti();
      return true;
    }
    if (ev.key.startsWith("Arrow")) {
      ev.preventDefault();
      const s = ev.shiftKey ? 0.01 : this.nudgeStep;
      const [dx, dz] = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[k];
      this.change((fl) => moveRefs(fl, this.multi, dx, dz));
      return true;
    }
    return false;
  },

  // ------------------------------------------------------------------ Kopieren, Vorlagen

  /** Mehrfachauswahl oder einzelne Auswahl als Liste. */
  _selRefs() {
    if (this.multi?.length) return this.multi;
    return this.sel && MULTI_KINDS.includes(this.sel.kind) ? [{ kind: this.sel.kind, id: this.sel.id }] : [];
  },

  _copySel() {
    const refs = this._selRefs();
    if (!refs.length) return false;
    this._clip = copyRefs(this.floor, refs);
    this._toast(`Kopiert: ${clipSummary(this._clip)}. Einfügen mit Strg+V oder „Einfügen“.`);
    return true;
  },

  /** Wo eingefügt wird: zuletzt angetippt (wenn sichtbar), sonst Mitte der Ansicht. */
  _pastePoint() {
    const rect = this.svg.getBoundingClientRect();
    const c = this.toPlan(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const p = this._lastP;
    if (!p) return c;
    const s = [p[0] * this.scale + this.tx, p[1] * this.scale + this.tz];
    return s[0] >= 0 && s[1] >= 0 && s[0] <= rect.width && s[1] <= rect.height ? p : c;
  },

  _paste(clip, at) {
    if (!clip) return;
    const grid = this.b.settings?.grid ?? 0.05;
    const q = [r3(Math.round(at[0] / grid) * grid), r3(Math.round(at[1] / grid) * grid)];
    let added = [];
    this.change((fl) => {
      const r = pasteClip(fl, clip, q, allIds(this.b));
      added = r.added;
      return r.floor;
    });
    this.multi = added;
    this.sel = null;
    this.render();
    this.renderProps();
    this._toast(`Eingefügt: ${clipSummary(clip)} – ziehen zum Verschieben.`);
  },

  _duplicate() {
    const refs = this._selRefs();
    const b = refsBounds(this.floor, refs);
    if (!b) return;
    this._paste(copyRefs(this.floor, refs), [(b.x0 + b.x1) / 2 + 0.5, (b.z0 + b.z1) / 2 + 0.5]);
  },

  _deleteMulti() {
    const n = this.multi.length;
    this.change((fl) => removeRefs(fl, this.multi));
    this.multi = [];
    this.render();
    this.renderProps();
    this._toast(`${n} Teile gelöscht (Strg+Z holt sie zurück).`);
  },

  _templates() {
    return Array.isArray(this.b.settings?.templates) ? this.b.settings.templates : [];
  },

  /** Eigenschaften bei Mehrfachauswahl. */
  _multiProps(el) {
    const refs = this.multi;
    const clip = copyRefs(this.floor, refs);
    el.innerHTML = `<h3>${refs.length} Teile gewählt</h3>
      <p class="muted">${esc(clipSummary(clip))}. Ziehen verschiebt alle, Pfeiltasten schieben.</p>
      <div class="btns"><button data-m="dup">Duplizieren</button><button data-m="copy">Kopieren</button><button data-m="del" class="danger">Löschen</button></div>
      <label>Als Vorlage speichern</label>
      <div class="colorrow"><input data-tplname placeholder="Name, z. B. Bad Standard" maxlength="40"><button data-m="tpl">Speichern</button></div>
      <div class="btns"><button data-m="none">Auswahl aufheben</button></div>`;
    el.querySelector('[data-m="dup"]').addEventListener("click", () => this._duplicate());
    el.querySelector('[data-m="copy"]').addEventListener("click", () => this._copySel());
    el.querySelector('[data-m="del"]').addEventListener("click", () => this._deleteMulti());
    el.querySelector('[data-m="none"]').addEventListener("click", () => {
      this.multi = [];
      this.render();
      this.renderProps();
    });
    el.querySelector('[data-m="tpl"]').addEventListener("click", () => {
      const name = el.querySelector("[data-tplname]").value.trim() || `Vorlage ${this._templates().length + 1}`;
      if (this._templates().length >= MAX_TEMPLATES) return this._toast(`Höchstens ${MAX_TEMPLATES} Vorlagen – erst eine löschen.`);
      const tpl = { id: newId("vorlage", new Set(this._templates().map((t) => t.id))), name, clip: copyRefs(this.floor, refs) };
      this.changeBuilding((b) => (b.settings.templates = [...(Array.isArray(b.settings.templates) ? b.settings.templates : []), tpl]));
      this._toast(`Vorlage „${name}“ gespeichert – unter „Etage“ einfügen.`);
    });
  },

  // ------------------------------------------------------------------ Etage: Foto und Vorlagen

  /** Abschnitte im Etagen-Fenster (nichts gewählt). */
  _planFloorProps() {
    const f = this.floor;
    const bg = f.background;
    const tpls = this._templates();
    const scale = this.tool === "bgscale";
    const bgHtml = bg
      ? `<label class="chk"><input type="checkbox" data-bgk="visible"${bg.visible === false ? "" : " checked"}> anzeigen</label>
        <div class="row2"><div><label>Deckkraft</label><input type="range" min="0.1" max="1" step="0.05" data-bgk="opacity" value="${bg.opacity ?? 0.5}"></div><div><label>Drehen (°)</label><input type="number" step="0.5" data-bgk="rotation" value="${bg.rotation ?? 0}"></div></div>
        <div class="row2"><div><label>Breite (m)</label><input type="number" min="0.5" step="0.1" data-bgk="width" value="${bg.width}"></div><div></div></div>
        <div class="btns"><button data-bg="move" class="${this.tool === "bgmove" ? "sel" : ""}">Verschieben</button><button data-bg="scale" class="${scale ? "sel" : ""}">Maßstab (2 Punkte)</button></div>
        ${scale ? `<p class="muted">${this._bgPts?.length === 2 ? `Strecke im Bild: ${de(Math.hypot(this._bgPts[1][0] - this._bgPts[0][0], this._bgPts[1][1] - this._bgPts[0][1]))} m` : `Punkt ${(this._bgPts?.length ?? 0) + 1} von 2 antippen.`}</p>
          ${this._bgPts?.length === 2 ? `<div class="colorrow"><input type="number" min="0.1" step="0.01" data-bgreal placeholder="echte Länge (m)" inputmode="decimal"><button data-bg="apply" class="primary">Übernehmen</button></div>` : ""}` : ""}
        <div class="btns"><button data-bg="load">Anderes Bild…</button><button data-bg="remove" class="danger">Entfernen</button></div>`
      : `<p class="muted">Foto vom Bauplan oder Luftbild unterlegen und Räume darauf nachzeichnen.</p><div class="btns"><button data-bg="load">Bild laden…</button></div>`;
    return `<h3>Bauplan-Foto</h3>${bgHtml}<input type="file" accept="image/*" data-bgfile hidden>
      <h3>Vorlagen</h3>${tpls.length ? `<div class="ed-tpls">${tpls.map((t) => `<div><button data-tpl="${esc(t.id)}" title="In die Mitte der Ansicht einfügen">${esc(t.name)}<small>${esc(clipSummary(t.clip))}</small></button><button data-tpldel="${esc(t.id)}" title="Vorlage löschen">×</button></div>`).join("")}</div>` : `<p class="muted">Mehrere Teile wählen („Mehrfach“ oder Umschalt), dann „Als Vorlage speichern“.</p>`}
      ${this._clip ? `<div class="btns"><button data-m="paste">Einfügen (${esc(clipSummary(this._clip))})</button></div>` : ""}`;
  },

  _bindPlanFloorProps(el) {
    const setBg = (fn, merge = false) => this.change((fl) => {
      fl.background = { ...fl.background };
      fn(fl.background);
    }, { merge });
    el.querySelectorAll("[data-bgk]").forEach((inp) => inp.addEventListener(inp.type === "range" ? "input" : "change", () => {
      const k = inp.dataset.bgk;
      if (k === "visible") setBg((bg) => (bg.visible = inp.checked));
      else {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || (k === "width" && !(v > 0.4))) return;
        setBg((bg) => (bg[k] = v), inp.type === "range" && this._bgSlid);
        this._bgSlid = inp.type === "range";
      }
    }));
    el.querySelectorAll("[data-bgk]").forEach((inp) => inp.addEventListener("change", () => (this._bgSlid = false)));
    const file = el.querySelector("[data-bgfile]");
    file?.addEventListener("change", () => file.files?.[0] && this._loadBackground(file.files[0]));
    el.querySelectorAll("[data-bg]").forEach((b) => b.addEventListener("click", () => {
      const a = b.dataset.bg;
      if (a === "load") file.click();
      else if (a === "remove") this._removeBackground();
      else if (a === "move" || a === "scale") this._setPlanTool(this.tool === `bg${a}` ? "select" : `bg${a}`);
      else if (a === "apply") {
        const real = Number(String(el.querySelector("[data-bgreal]").value).replace(",", "."));
        if (!(real > 0)) return this._toast("Echte Länge in Metern eingeben.");
        const [p, q] = this._bgPts;
        setBg((bg) => Object.assign(bg, scaleBackground(bg, p, q, real)));
        this._toast(`Maßstab übernommen: Strecke = ${de(real)} m.`);
        this._setPlanTool("select");
      }
    }));
    el.querySelector("[data-bgreal]")?.addEventListener("keydown", (ev) => ev.key === "Enter" && el.querySelector('[data-bg="apply"]').click());
    el.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => {
      const t = this._templates().find((x) => x.id === b.dataset.tpl);
      const rect = this.svg.getBoundingClientRect();
      if (t) this._paste(t.clip, this.toPlan(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }));
    el.querySelectorAll("[data-tpldel]").forEach((b) => b.addEventListener("click", async () => {
      const t = this._templates().find((x) => x.id === b.dataset.tpldel);
      if (!t || !(await this._ask(`Vorlage „${t.name}“ löschen?`))) return;
      this.changeBuilding((bb) => (bb.settings.templates = this._templates().filter((x) => x.id !== t.id)));
      this.renderProps();
    }));
    el.querySelector('[data-m="paste"]')?.addEventListener("click", () => this._paste(this._clip, this._pastePoint()));
  },

  /** Rückfrage über den Dialog des Panels, sonst Browser. */
  async _ask(text) {
    return this.confirm ? this.confirm(text, "Löschen", { danger: true }) : window.confirm(text);
  },

  _setPlanTool(tool) {
    this.tool = tool;
    this._bgPts = [];
    this.draft = null;
    this.sel = null;
    this.renderBar();
    if (PLAN_HINTS[tool]) this.hint.textContent = PLAN_HINTS[tool];
    this.render();
    this.renderProps();
  },

  // ------------------------------------------------------------------ Bild laden/speichern

  /** Objekt-URL des Bilds einer Etage (lädt beim ersten Mal nach). */
  _bgUrl(floorId) {
    this._bgCache ??= new Map();
    const c = this._bgCache.get(floorId);
    if (c) return c.url;
    this._bgCache.set(floorId, { url: null });
    this.hass
      ?.callWS({ type: "haus3d/background/get", floor_id: floorId })
      .then((res) => {
        if (!res?.image) return;
        this._bgCache.set(floorId, { url: dataUrlToObjectUrl(res.image) });
        this.render();
      })
      .catch(() => {
        /* ohne Bild weiter */
      });
    return null;
  },

  async _loadBackground(file) {
    try {
      const bmp = await createImageBitmap(file);
      const [w, h] = fitSize(bmp.width, bmp.height, 1600);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, w, h);
      g.drawImage(bmp, 0, 0, w, h);
      const image = c.toDataURL("image/jpeg", 0.82);
      await this.hass.callWS({ type: "haus3d/background/set", floor_id: this.floorId, image });
      this._bgCache ??= new Map();
      const old = this._bgCache.get(this.floorId)?.url;
      if (old) URL.revokeObjectURL(old);
      this._bgCache.set(this.floorId, { url: dataUrlToObjectUrl(image) });
      const rooms = this.floor.rooms.flatMap((r) => r.points);
      const bounds = rooms.length ? { x0: Math.min(...rooms.map((p) => p[0])), x1: Math.max(...rooms.map((p) => p[0])), z0: Math.min(...rooms.map((p) => p[1])), z1: Math.max(...rooms.map((p) => p[1])) } : null;
      const keep = this.floor.background;
      this.change((fl) => {
        fl.background = keep ? { ...keep, aspect: r3(h / w) } : defaultBackground(bounds, h / w);
      });
      this._toast(`Bild geladen (${w} × ${h}). Jetzt „Maßstab (2 Punkte)“ an einer bekannten Strecke.`);
      this.renderProps();
    } catch (err) {
      this._toast(`Bild ließ sich nicht laden: ${err.message ?? err.code ?? err}`);
    }
  },

  async _removeBackground() {
    if (!(await this._ask("Bauplan-Foto dieser Etage entfernen?"))) return;
    try {
      await this.hass.callWS({ type: "haus3d/background/set", floor_id: this.floorId, image: null });
    } catch {
      /* Feld trotzdem entfernen */
    }
    const old = this._bgCache?.get(this.floorId)?.url;
    if (old) URL.revokeObjectURL(old);
    this._bgCache?.delete(this.floorId);
    this.change((fl) => {
      delete fl.background;
    });
    if (this.tool.startsWith("bg")) this.tool = "select";
    this.renderBar();
    this.renderProps();
  },
};

/** Daten-URL → kurze Objekt-URL (das SVG wird bei jeder Bewegung neu geschrieben). */
function dataUrlToObjectUrl(data) {
  const [head, body] = data.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export const PLAN_STYLE = `
.ed-props label.chk { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--primary-text-color); cursor: pointer; }
.ed-props label.chk input { width: auto; margin: 0; }
@media (pointer: coarse) { .ed-props label.chk input { width: 22px; height: 22px; } }
.ed-tpls { display: grid; gap: 4px; }
.ed-tpls div { display: flex; gap: 4px; }
.ed-tpls button { font: inherit; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 8px; cursor: pointer; padding: 6px 10px; min-height: 36px; }
.ed-tpls button[data-tpl] { flex: 1; text-align: left; display: flex; flex-direction: column; }
.ed-tpls small { color: var(--secondary-text-color); font-size: 11px; }
.ed-draftbar { flex-wrap: wrap; justify-content: center; max-width: calc(100% - 16px); }
.ed-draftbar .ed-len { display: flex; gap: 4px; align-items: center; }
.ed-draftbar input { width: 84px; min-height: 36px; box-sizing: border-box; border-radius: 18px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); padding: 0 10px; font: inherit; font-size: 13px; background: var(--card-background-color, #fff); color: var(--primary-text-color); }
@media (pointer: coarse) { .ed-draftbar input { min-height: 44px; } }
`;
