// Verteiler im Editor (Mixin für FloorEditor): Werkzeug „Verteiler“ – Hauptverteilung, Unterverteilungen,
// Einspeisung, Router/Switch, Wasser-Hausanschluss, Warmwasser und Durchführungen (Etage) setzen. Leitungen
// rasten an Verteilern ein; eine Durchführung bekommt auf der Zieletage ein Gegenstück an gleicher Stelle.

import { allIds, newId } from "./edit-ops.js";
import { NODE_KINDS } from "./pipenet.js";
import { pipeColor } from "./pipes.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LETTER = { hv: "H", uv: "U", einspeisung: "E", router: "R", switch: "S", wasser_in: "W", warm_in: "B", durch: "D" };

export const NODE_HINT = "Verteiler: Art rechts wählen, dann an die Stelle tippen (rastet an Wänden ein). Leitungen, die an einem Verteiler beginnen oder enden, hängen daran.";

const color = (kind) => {
  const medium = NODE_KINDS.find((k) => k[0] === kind)?.[3];
  return medium ? pipeColor(medium) : "#757575";
};

export const NodeMethods = {
  _nodeOpts() {
    this.nodeOpts ??= { kind: "hv" };
    return this.nodeOpts;
  },

  _allNodeIds() {
    return new Set([...allIds(this.b), ...this.b.floors.flatMap((f) => [...(f.nodes ?? []), ...(f.pipes ?? [])].map((x) => x.id))]);
  },

  _nodeTap(ev, p) {
    const kind = this._nodeOpts().kind;
    const q = this._pipeSnap(ev, p, null, { type: "__none__" });
    const node = { id: newId(`vt_${kind}`, this._allNodeIds()), kind, x: r3(q[0]), z: r3(q[1]), y: null, name: null, entity: null, link: null };
    this.change((fl) => {
      fl.nodes = [...(fl.nodes ?? []), node];
    });
    this.sel = { kind: "pnode", id: node.id };
    this.tool = "select";
    this.renderBar();
    this.render();
    this.renderProps();
    this._toast(`${NODE_KINDS.find((k) => k[0] === kind)[1]} gesetzt – rechts Name und Zähler wählen.`);
  },

  /** Verteiler im Plan (Kreis mit Buchstabe). */
  _nodeParts(px) {
    return (this.floor.nodes ?? [])
      .map((n) => {
        const sel = this.sel?.kind === "pnode" && this.sel.id === n.id;
        const c = color(n.kind);
        const r = px(this.coarse ? 13 : 10);
        return `<g data-kind="pnode" data-id="${esc(n.id)}" style="cursor:move"><circle cx="${r3(n.x)}" cy="${r3(n.z)}" r="${r}" fill="${sel ? c : "#fff"}" stroke="${c}" stroke-width="${px(sel ? 3.5 : 2.5)}"/><text x="${r3(n.x)}" y="${r3(n.z + px(4))}" text-anchor="middle" font-size="${px(11)}" font-weight="700" fill="${sel ? "#fff" : c}" pointer-events="none">${LETTER[n.kind] ?? "?"}</text></g>`;
      })
      .join("");
  },

  _nodeToolProps(el) {
    const o = this._nodeOpts();
    el.innerHTML = `<h3>Verteiler setzen</h3>
      <div class="kinds">${NODE_KINDS.map(([k, n, icon]) => `<button data-nk="${k}" class="${o.kind === k ? "sel" : ""}"><ha-icon icon="${icon}"></ha-icon><span>${n}</span></button>`).join("")}</div>
      <p class="muted">${NODE_HINT}</p>
      <p class="muted">Hauptverteilung, Router und Hausanschluss sind der Anfang ihres Netzes: von dort fließt es zu den Verbrauchern. Unterverteilungen mit eigenem Zähler zeigen, was unterwegs nicht zugeordnet ist.</p>`;
    el.querySelectorAll("[data-nk]").forEach((b) => b.addEventListener("click", () => {
      o.kind = b.dataset.nk;
      this.renderProps();
    }));
  },

  _nodeProps(el, n) {
    const hass = this.hass;
    const kind = NODE_KINDS.find((k) => k[0] === n.kind);
    const ents = Object.keys(hass.states).filter((e) => e.startsWith("sensor.")).sort();
    const others = this.b.floors.filter((f) => f.id !== this.floorId);
    const linked = n.link ? this.b.floors.find((f) => (f.nodes ?? []).some((x) => x.id === n.link)) : null;
    const meterLabel = n.kind === "einspeisung" ? "Erzeugung (W) – fließt von hier ins Haus" : kind[3] === "netzwerk" ? "Datenrate (Mbit/s, optional)" : kind[3] === "strom" ? "Zähler: Leistung (W, optional)" : "Durchfluss (l/min, optional)";
    el.innerHTML = `<h3><ha-icon icon="${kind[2]}"></ha-icon> ${esc(kind[1])}</h3>
      <label>Art</label><select data-nf="kind">${NODE_KINDS.map(([k, name]) => `<option value="${k}"${k === n.kind ? " selected" : ""}>${name}</option>`).join("")}</select>
      <label>Name</label><input data-nf="name" value="${esc(n.name ?? "")}" placeholder="z. B. UV Obergeschoss">
      ${n.kind !== "durch" ? `<label>${meterLabel}</label><input data-nf="entity" list="dl_node" value="${esc(n.entity ?? "")}" placeholder="– keiner –"><datalist id="dl_node">${ents.map((e) => `<option value="${esc(e)}">${esc(hass.states[e].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>` : `<label>Verbunden mit Etage</label><select data-link><option value="">– keine –</option>${others.map((f) => `<option value="${esc(f.id)}"${linked?.id === f.id ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select><p class="muted">Auf der gewählten Etage entsteht an gleicher Stelle das Gegenstück; Leitungen dort und hier sind verbunden.</p>`}
      <label>Höhe über Boden (m, leer = Standard)</label><input type="number" step="0.05" min="0" max="5" data-ny value="${n.y ?? ""}">
      <div class="btns"><button data-act="nodedel" class="danger">Löschen</button></div>`;
    const upd = (fn) => {
      this.change((fl) => fn(fl.nodes.find((x) => x.id === n.id)));
      this.renderProps();
      this.render();
    };
    el.querySelectorAll("[data-nf]").forEach((i) => i.addEventListener("change", () => upd((x) => {
      x[i.dataset.nf] = i.value.trim() || null;
    })));
    el.querySelector("[data-ny]").addEventListener("change", (ev) => upd((x) => {
      const v = ev.target.value === "" ? null : Number(ev.target.value);
      x.y = Number.isFinite(v) ? r3(v) : null;
    }));
    el.querySelector("[data-link]")?.addEventListener("change", (ev) => this._linkThrough(n, ev.target.value || null));
    el.querySelector("[data-act=nodedel]").addEventListener("click", () => {
      this._linkThrough(n, null);
      this.change((fl) => {
        fl.nodes = fl.nodes.filter((x) => x.id !== n.id);
      });
      this.sel = null;
      this.renderProps();
      this.render();
    });
  },

  /** Durchführung mit einer anderen Etage verbinden (Gegenstück anlegen/entfernen). */
  _linkThrough(n, floorId) {
    this._pushUndo();
    for (const f of this.b.floors) if (f.id !== this.floorId) f.nodes = (f.nodes ?? []).filter((x) => x.id !== n.link);
    let link = null;
    if (floorId) {
      const target = this.b.floors.find((f) => f.id === floorId);
      link = newId("vt_durch", this._allNodeIds());
      target.nodes = [...(target.nodes ?? []), { id: link, kind: "durch", x: n.x, z: n.z, y: null, name: n.name, entity: null, link: n.id }];
    }
    this.change((fl) => {
      fl.nodes.find((x) => x.id === n.id).link = link;
    }, { merge: true });
    this.renderProps();
    this.render();
  },
};

export const NODE_STYLE = `
.ed-props .kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
.ed-props .kinds button { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 4px 8px; border-radius: 10px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.ed-props .kinds button.sel { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
.ed-props .ptbox { padding: 8px; border-radius: 10px; background: rgba(127,127,127,.08); margin-bottom: 8px; }
`;
