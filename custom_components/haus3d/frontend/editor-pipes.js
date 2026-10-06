// Leitungen im Editor (Mixin für FloorEditor): Werkzeug „Leitung“ – Strom, Wasser kalt/warm am Boden
// bzw. an der Wand verlegen. Punkte rasten an Raumkanten (Wand) und Ecken ein; die Höhe gilt je Punkt,
// ein Höhenwechsel wird an der Wand senkrecht geführt.

import { allIds, newId } from "./edit-ops.js";
import { PIPE_HEIGHTS, PIPE_TYPES, pipeColor } from "./pipes.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const de = (v, d = 2) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const WALL_GAP = 0.06; // Abstand Rohrmitte zur Wandoberfläche

export const PIPE_HINT = "Leitung: Punkte antippen – rastet an Wänden und Ecken ein, an bestehenden Leitungen und Verteilern als Abzweig (Ring). Höhe rechts wählen, ein Wechsel geht an der Wand senkrecht. „Fertig“ beendet. Gewählte Leitung: Punkte ziehen, Strecke antippen fügt einen Punkt ein.";
const JUNCTION_PX = 14; // Fangradius für Abzweige (Bildschirm)

export const PipeMethods = {
  _pipeOpts() {
    this.pipeOpts ??= { type: "strom", height: 0.03 };
    return this.pipeOpts;
  },

  /** Wandoberflächen der Etage (zwischengespeichert, solange sich die Etage nicht ändert). */
  _pipeFaces() {
    const f = this.floor;
    if (this._pfCache?.floor !== f) this._pfCache = { floor: f, faces: this._faces() };
    return this._pfCache.faces;
  },

  /**
   * Punkt an der nächsten Wandoberfläche (knapp davor, im Raum), in Ecken an beiden Wänden;
   * sonst 0/45/90° zum letzten Punkt bzw. Raster.
   */
  _pipeSnap(ev, p, last, { exclude = null, type = this._pipeOpts().type, skipNode = null } = {}) {
    // Abzweig: an Verteiler oder bestehender Leitung desselben Mediums einrasten (Vorrang vor der Wand)
    const j = this._pipeJunction(p, { exclude, type, skipNode });
    this._snapJunction = !!j;
    if (j) return j;
    const tol = Math.max(0.25, this._snapTol() * 1.5);
    const hits = [];
    for (const f of this._pipeFaces()) {
      const rel = [p[0] - f.p[0], p[1] - f.p[1]];
      const along = rel[0] * f.u[0] + rel[1] * f.u[1];
      const dist = rel[0] * f.n[0] + rel[1] * f.n[1];
      if (along < f.t0 - tol || along > f.t1 + tol || dist < -0.05 || dist > tol) continue;
      hits.push({ f, along: Math.min(f.t1, Math.max(f.t0, along)), dist });
    }
    hits.sort((a, b) => a.dist - b.dist);
    const best = hits[0];
    if (best) {
      const { f } = best;
      // Linie der Leitung vor dieser Wand: o + u·t
      const o = [f.p[0] + f.n[0] * WALL_GAP, f.p[1] + f.n[1] * WALL_GAP];
      // Ecke: zweite, nicht parallele Wand ebenfalls nah → Schnittpunkt beider Linien
      const other = hits.find((h) => h !== best && Math.abs(h.f.u[0] * f.u[1] - h.f.u[1] * f.u[0]) > 0.3);
      if (other) {
        const g = other.f;
        const o2 = [g.p[0] + g.n[0] * WALL_GAP, g.p[1] + g.n[1] * WALL_GAP];
        const den = f.u[0] * g.u[1] - f.u[1] * g.u[0];
        const t = ((o2[0] - o[0]) * g.u[1] - (o2[1] - o[1]) * g.u[0]) / den;
        const q = [o[0] + f.u[0] * t, o[1] + f.u[1] * t];
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < tol * 1.5) return [r3(q[0]), r3(q[1])];
      }
      const along = (p[0] - o[0]) * f.u[0] + (p[1] - o[1]) * f.u[1];
      return [r3(o[0] + f.u[0] * along), r3(o[1] + f.u[1] * along)];
    }
    return last ? this._wallSnap(last, p, this._free(ev)) : this._snap(p);
  },

  /** Punkt auf einer Leitung bzw. an einem Verteiler in Fangweite (oder null). */
  _pipeJunction(p, { exclude = null, type = null, skipNode = null } = {}) {
    if (this._free?.()) return null;
    const tol = Math.max(0.12, JUNCTION_PX / (this.scale || 40));
    let best = null;
    for (const n of this.floor.nodes ?? []) {
      if (n.id === skipNode) continue;
      const d = Math.hypot(p[0] - n.x, p[1] - n.z);
      if (d < tol && (!best || d < best.d)) best = { d, q: [n.x, n.z] };
    }
    if (best) return best.q;
    for (const l of this.floor.pipes ?? []) {
      if (l.id === exclude || (type && l.type !== type)) continue;
      for (let i = 0; i < l.points.length - 1; i++) {
        const a = l.points[i];
        const b = l.points[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
        const q = [a[0] + dx * t, a[1] + dz * t];
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < tol && (!best || d < best.d)) best = { d, q: [r3(q[0]), r3(q[1])] };
      }
    }
    return best?.q ?? null;
  },

  _pipeTap(ev, p) {
    const o = this._pipeOpts();
    const d = this.draft;
    if (!d?.pipe) {
      this.draft = { pipe: true, line: [this._pipeSnap(ev, p, null)], heights: [o.height] };
    } else {
      const last = d.line.at(-1);
      const q = this._pipeSnap(ev, p, last);
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.05 && Math.abs(d.heights.at(-1) - o.height) < 1e-6) return this._finishPipe();
      d.line.push(q);
      d.heights.push(o.height);
    }
    this.render();
  },

  /** Vorhandene Leitungen und der Entwurf im Plan. */
  _pipeParts(px, P) {
    const parts = [];
    for (const l of this.floor.pipes ?? []) {
      const sel = this.sel?.kind === "pipe" && this.sel.id === l.id;
      const c = pipeColor(l.type);
      parts.push(`<polyline data-kind="pipe" data-id="${esc(l.id)}" points="${l.points.map(P).join(" ")}" fill="none" stroke="${c}" stroke-width="${px(sel ? 6 : 4)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${sel ? 1 : 0.85}" style="cursor:pointer"/>`);
      // Höhenwechsel: kleiner Kreis
      l.points.forEach((q, i) => {
        if (i && Math.abs((l.heights?.[i] ?? l.height) - (l.heights?.[i - 1] ?? l.height)) > 1e-6) parts.push(`<circle cx="${r3(l.points[i - 1][0])}" cy="${r3(l.points[i - 1][1])}" r="${px(5)}" fill="#fff" stroke="${c}" stroke-width="${px(2)}" pointer-events="none"/>`);
      });
      if (sel) {
        const s = l.points[0];
        parts.push(`<text x="${r3(s[0])}" y="${r3(s[1] - px(12))}" text-anchor="middle" font-size="${px(11)}" fill="${c}" font-weight="600" pointer-events="none">Anfang</text>`);
        // Punkte als Griffe (ziehen = verschieben, antippen = Höhe dieses Punkts)
        l.points.forEach((q, i) => {
          const on = this.pipePt?.id === l.id && this.pipePt.i === i;
          parts.push(`<circle data-kind="pipept" data-id="${esc(l.id)}" data-i="${i}" cx="${r3(q[0])}" cy="${r3(q[1])}" r="${px(this.coarse ? 11 : 7)}" fill="${on ? c : "#fff"}" stroke="${c}" stroke-width="${px(2.5)}" style="cursor:move"/>`);
        });
      }
    }
    const d = this.draft;
    if (d?.pipe) {
      const pts = [...d.line, ...(d.hover ? [d.hover] : [])];
      const c = pipeColor(this._pipeOpts().type);
      parts.push(`<polyline points="${pts.map(P).join(" ")}" fill="none" stroke="${c}" stroke-width="${px(4)}" stroke-dasharray="${px(8)} ${px(4)}" stroke-linecap="round"/>`);
      for (const q of d.line) parts.push(`<circle cx="${r3(q[0])}" cy="${r3(q[1])}" r="${px(4)}" fill="${c}"/>`);
      if (d.hover && this._snapJunction) parts.push(`<circle cx="${r3(d.hover[0])}" cy="${r3(d.hover[1])}" r="${px(9)}" fill="none" stroke="${c}" stroke-width="${px(2.5)}" pointer-events="none"/><text x="${r3(d.hover[0])}" y="${r3(d.hover[1] - px(13))}" text-anchor="middle" font-size="${px(11)}" fill="${c}" font-weight="600" pointer-events="none">Abzweig</text>`);
    }
    return parts.join("");
  },

  _finishPipe() {
    const d = this.draft;
    this.draft = null;
    if (!d?.pipe || d.line.length < 2) return this.render();
    const o = this._pipeOpts();
    const pipe = { id: newId("leitung", new Set([...allIds(this.b), ...this.b.floors.flatMap((f) => (f.pipes ?? []).map((x) => x.id))])), type: o.type, points: d.line.map((q) => [r3(q[0]), r3(q[1])]), heights: d.heights.map(r3), height: o.height, entity: null, room: null };
    this.change((fl) => {
      fl.pipes = [...(fl.pipes ?? []), pipe];
    });
    this.sel = { kind: "pipe", id: pipe.id };
    this.tool = "select";
    this.renderBar();
    this.render();
    this.renderProps();
    this._toast(`${PIPE_TYPES.find((t) => t[0] === pipe.type)[1]}: ${pipe.points.length} Punkte – rechts Sensor oder Zielraum wählen.`);
  },

  /** Eigenschaften, solange das Werkzeug „Leitung“ aktiv ist. */
  _pipeToolProps(el) {
    const o = this._pipeOpts();
    el.innerHTML = `<h3>Leitung legen</h3>
      <div class="seg wide" data-ptype>${PIPE_TYPES.map(([k, n]) => `<button data-k="${k}" class="${o.type === k ? "sel" : ""}">${n}</button>`).join("")}</div>
      <label>Höhe der nächsten Punkte</label>
      <div class="seg wide" data-pheight>${PIPE_HEIGHTS.map(([h, n]) => `<button data-h="${h}" class="${Math.abs(o.height - h) < 1e-6 ? "sel" : ""}">${n}</button>`).join("")}</div>
      <p class="muted">${PIPE_HINT}</p>
      <p class="muted">Vom Anfang (z. B. Zählerschrank, Hauswasser) zum Verbraucher zeichnen – so fließt es in die richtige Richtung.</p>`;
    el.querySelectorAll("[data-ptype] [data-k]").forEach((b) => b.addEventListener("click", () => {
      o.type = b.dataset.k;
      this.renderProps();
      this.render();
    }));
    el.querySelectorAll("[data-pheight] [data-h]").forEach((b) => b.addEventListener("click", () => {
      o.height = Number(b.dataset.h);
      this.renderProps();
    }));
  },

  /** Eigenschaften einer gewählten Leitung: Art, Name, Ende (Raum/Gerät/Sensor), Punkte und Höhen. */
  _pipeProps(el, l) {
    const hass = this.hass;
    const rooms = this.b.floors.flatMap((f) => f.rooms.map((r) => [r.id, `${r.name} (${f.name})`]));
    const list = (re) => Object.keys(hass.states).filter((e) => re.test(e)).sort();
    const sensorRe = l.type === "strom" ? /^sensor\./ : l.type === "netzwerk" ? /^sensor\./ : /^(sensor|binary_sensor|switch|valve|input_boolean)\./;
    const devRe = l.type === "netzwerk" ? /^device_tracker\./ : l.type === "strom" ? /^(switch|light|fan|climate|media_player|vacuum|water_heater|sensor)\./ : /^(valve|switch)\./;
    const dl = (id, ids) => `<datalist id="${id}">${ids.map((e) => `<option value="${esc(e)}">${esc(hass.states[e].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>`;
    const len = l.points.reduce((s2, q, i) => (i ? s2 + Math.hypot(q[0] - l.points[i - 1][0], q[1] - l.points[i - 1][1]) : 0), 0);
    const hs = l.points.map((_, i) => Number(l.heights?.[i] ?? l.height ?? 0.03));
    const pt = this.pipePt?.id === l.id && this.pipePt.i < l.points.length ? this.pipePt.i : null;
    const hSeg = (attr, cur) => `<div class="seg wide" ${attr}>${PIPE_HEIGHTS.map(([h, n]) => `<button data-h="${h}" class="${cur != null && Math.abs(cur - h) < 1e-6 ? "sel" : ""}">${n}</button>`).join("")}</div>`;
    const sensorLabel = l.type === "strom" ? "Leistungs-Sensor (W) dieser Leitung" : l.type === "netzwerk" ? "Datenrate-Sensor (z. B. UniFi rx/tx)" : "Durchfluss-Sensor oder Ventil";
    el.innerHTML = `<h3>Leitung</h3>
      <div class="seg wide" data-ptype>${PIPE_TYPES.map(([k, n]) => `<button data-k="${k}" class="${l.type === k ? "sel" : ""}">${n}</button>`).join("")}</div>
      <label>Name</label><input data-pf="name" value="${esc(l.name ?? "")}" placeholder="z. B. Büro Steckdosen">
      <h4>Endet an</h4>
      ${l.type === "strom" ? `<label>Raum (Verbrauch des Raums)</label><select data-pf="room"><option value="">– keiner –</option>${rooms.map(([id, n]) => `<option value="${esc(id)}"${l.room === id ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      <label>${l.type === "netzwerk" ? "Netzwerkgerät" : "Gerät"}</label><input data-pf="device" list="dl_pdev" value="${esc(l.device ?? "")}" placeholder="– keins –">${dl("dl_pdev", list(devRe))}
      <label>${sensorLabel}</label><input data-pf="entity" list="dl_pipe" value="${esc(l.entity ?? "")}" placeholder="– keiner –">${dl("dl_pipe", list(sensorRe))}
      <p class="muted">Ohne Ende fließt durch diese Leitung, was an ihr hängt (Abzweige, weitere Leitungen).</p>
      <h4>Punkte</h4>
      ${pt != null ? `<div class="ptbox"><b>Punkt ${pt + 1} von ${l.points.length}</b> · Höhe ${de(hs[pt])} m
        ${hSeg("data-pth", hs[pt])}
        <div class="row2"><div><label>eigene Höhe (m)</label><input type="number" step="0.05" min="0" max="5" data-pthn value="${hs[pt]}"></div><div><label>&nbsp;</label><button data-act="ptdel" class="danger"${l.points.length <= 2 ? " disabled" : ""}>Punkt löschen</button></div></div></div>` : `<p class="muted">Punkt antippen, um seine Höhe zu ändern; ziehen verschiebt ihn. Strecke antippen fügt einen Punkt ein.</p>`}
      <label>Alle Punkte auf Höhe</label>${hSeg("data-allh", hs.every((h) => Math.abs(h - hs[0]) < 1e-6) ? hs[0] : null)}
      <p class="muted">${l.points.length} Punkte · ${de(len)} m. Gezeichnet vom Anfang zum Ende.</p>
      <div class="btns"><button data-act="pipeflip">Richtung umdrehen</button><button data-act="pipedel" class="danger">Löschen</button></div>`;
    const upd = (fn) => {
      this.change((fl) => {
        const x = fl.pipes.find((y) => y.id === l.id);
        x.heights = x.points.map((_, i) => Number(x.heights?.[i] ?? x.height ?? 0.03));
        fn(x);
      });
      this.renderProps();
      this.render();
    };
    el.querySelectorAll("[data-ptype] [data-k]").forEach((b) => b.addEventListener("click", () => upd((x) => (x.type = b.dataset.k))));
    el.querySelectorAll("[data-pf]").forEach((i) => i.addEventListener("change", () => upd((x) => (x[i.dataset.pf] = i.value.trim() || null))));
    el.querySelectorAll("[data-pth] [data-h]").forEach((b) => b.addEventListener("click", () => upd((x) => (x.heights[pt] = Number(b.dataset.h)))));
    el.querySelector("[data-pthn]")?.addEventListener("change", (ev) => {
      const v = Number(ev.target.value);
      if (Number.isFinite(v) && v >= 0) upd((x) => (x.heights[pt] = r3(v)));
    });
    el.querySelector("[data-act=ptdel]")?.addEventListener("click", () => {
      this.pipePt = null;
      upd((x) => {
        x.points.splice(pt, 1);
        x.heights.splice(pt, 1);
      });
    });
    el.querySelectorAll("[data-allh] [data-h]").forEach((b) => b.addEventListener("click", () => upd((x) => {
      x.heights = x.points.map(() => Number(b.dataset.h));
      x.height = Number(b.dataset.h);
    })));
    el.querySelector("[data-act=pipeflip]").addEventListener("click", () => upd((x) => {
      x.points.reverse();
      x.heights.reverse();
      this.pipePt = null;
    }));
    el.querySelector("[data-act=pipedel]").addEventListener("click", () => {
      this.change((fl) => {
        fl.pipes = fl.pipes.filter((x) => x.id !== l.id);
      });
      this.sel = null;
      this.pipePt = null;
      this.renderProps();
      this.render();
    });
  },

  /** Ziehen/Antippen von Leitungen, Punkten und Verteilern; undefined = nicht zuständig. */
  _pipeStartDrag(ev, p, kind, t) {
    const id = t?.dataset.id;
    if (kind === "pipept") {
      this.sel = { kind: "pipe", id };
      this.pipePt = { id, i: Number(t.dataset.i) };
      this.renderProps();
      this.render();
      return { mode: "pipept", id, i: Number(t.dataset.i), first: true };
    }
    if (kind === "pipe") {
      const l = (this.floor.pipes ?? []).find((x) => x.id === id);
      if (l && this.sel?.kind === "pipe" && this.sel.id === id) {
        // gewählte Leitung erneut angetippt: Punkt auf der nächsten Strecke einfügen
        let best = null;
        for (let i = 0; i < l.points.length - 1; i++) {
          const a = l.points[i];
          const b = l.points[i + 1];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const tt = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1e-9)));
          const q = [a[0] + dx * tt, a[1] + dz * tt];
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (tt > 0.02 && tt < 0.98 && (!best || d < best.d)) best = { d, i, q };
        }
        if (best) {
          this.change((fl) => {
            const x = fl.pipes.find((y) => y.id === id);
            x.heights = x.points.map((_, k) => Number(x.heights?.[k] ?? x.height ?? 0.03));
            x.points.splice(best.i + 1, 0, [r3(best.q[0]), r3(best.q[1])]);
            x.heights.splice(best.i + 1, 0, x.heights[best.i + 1]);
          });
          this.pipePt = { id, i: best.i + 1 };
          this.renderProps();
          this.render();
          return { mode: "pipept", id, i: best.i + 1, first: false };
        }
      }
      this.sel = { kind: "pipe", id };
      this.pipePt = null;
      this.renderProps();
      this.render();
      return null;
    }
    if (kind === "pnode") {
      this.sel = { kind: "pnode", id };
      this.renderProps();
      this.render();
      return { mode: "pnode", id, first: true };
    }
    return undefined;
  },

  /** Ziehen eines Leitungspunkts bzw. Verteilers; true = erledigt. */
  _pipeMoveDrag(drag, ev, p) {
    if (drag.mode === "pipept") {
      const l = (this.floor.pipes ?? []).find((x) => x.id === drag.id);
      if (!l) return true;
      const q = this._pipeSnap(ev, p, null, { exclude: drag.id, type: l.type });
      this._dragChange(drag, (fl) => {
        fl.pipes.find((x) => x.id === drag.id).points[drag.i] = [r3(q[0]), r3(q[1])];
      });
      this.render();
      return true;
    }
    if (drag.mode === "pnode") {
      const q = this._pipeSnap(ev, p, null, { type: "__none__", skipNode: drag.id });
      this._dragChange(drag, (fl) => {
        const n = fl.nodes.find((x) => x.id === drag.id);
        n.x = r3(q[0]);
        n.z = r3(q[1]);
      });
      this.render();
      return true;
    }
    return false;
  },
};
