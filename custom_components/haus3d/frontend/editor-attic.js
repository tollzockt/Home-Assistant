// Dachgeschoss im Editor (Mixin für FloorEditor): Das Dachgeschoss ist eine normale Etage mit Räumen;
// ist in den Einstellungen ein Dach an, sitzt es auf dem Kniestock darüber und die Etagen-Auswahl bietet
// zusätzlich „Dach“ (Kamin, Dachfenster, PV). Ohne Dach legt „Dachgeschoss“ die Etage an.

import { allIds, newId } from "./edit-ops.js";
import { DEFAULT_KNEE, atticKnee, roofSettings } from "./exterior.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Ist in den Einstellungen ein Hausdach an? */
export const roofOn = (building) => roofSettings(building?.settings).type !== "none";

/** Neue Dachgeschoss-Etage über der obersten. */
export function newAttic(building) {
  const top = [...(building.floors ?? [])].sort((a, b) => b.elevation - a.elevation)[0];
  return {
    id: newId("dg", allIds(building)),
    name: "Dachgeschoss",
    elevation: top ? r3(top.elevation + top.height + 0.25) : 0,
    height: 2.4,
    cut_height: 1.15,
    attic: true,
    knee: DEFAULT_KNEE,
    rooms: [],
    openings: [],
    furniture: [],
    placements: [],
    background: null,
    outdoor: [],
    walls: [],
    pipes: [],
    nodes: [],
    ha_floor: null,
  };
}

export const AtticMethods = {
  /** Zusatz-Einträge der Etagen-Auswahl: „Dach“ (nur mit Dach) bzw. „+ Dachgeschoss“ (wenn keins da ist). */
  _atticOptions() {
    const hasAttic = this.b.floors.some((f) => f.attic);
    return `${roofOn(this.b) ? `<option value="__roof"${this.roofMode ? " selected" : ""}>Dach</option>` : ""}${hasAttic ? "" : `<option value="__attic">+ Dachgeschoss</option>`}`;
  },

  /** Dachgeschoss anlegen und dorthin wechseln. */
  _addAttic() {
    const floor = newAttic(this.b);
    this.changeBuilding((b) => {
      b.floors.push(floor);
      this.floorId = floor.id;
    }, { fit: true });
    this._toast(roofOn(this.b) ? "Dachgeschoss angelegt: Räume zeichnen – das Dach sitzt darauf (Kniestock in den Etagen-Eigenschaften)." : "Dachgeschoss angelegt: Räume wie auf jeder Etage zeichnen. Mit Dach in den Einstellungen sitzt es darauf.");
  },

  /** Felder in den Etagen-Eigenschaften. */
  _atticFields(f) {
    return `<label class="chk"><input type="checkbox" data-attic${f.attic ? " checked" : ""}> Dachgeschoss (Räume unter den Dachschrägen)</label>
      ${f.attic ? `<div class="row2"><div><label>Kniestock (m)</label><input type="number" step="0.05" min="0" max="${esc(f.height ?? 2.5)}" data-knee value="${atticKnee(f)}"></div><div></div></div>
      <p class="muted">${roofOn(this.b) ? "Das Dach setzt auf dem Kniestock an; Innenwände enden unter der Schräge." : "In den Einstellungen ist kein Dach an – das Dachgeschoss ist eine normale Etage."}</p>` : ""}`;
  },

  _bindAtticFields(el) {
    el.querySelector("[data-attic]")?.addEventListener("change", (ev) => {
      this.change((fl) => {
        fl.attic = ev.target.checked;
        if (fl.attic && fl.knee == null) fl.knee = DEFAULT_KNEE;
      });
      this.renderProps();
    });
    el.querySelector("[data-knee]")?.addEventListener("change", (ev) => {
      const v = Number(ev.target.value);
      if (!Number.isFinite(v)) return;
      this.change((fl) => {
        fl.knee = r3(Math.max(0, Math.min(fl.height ?? 2.5, v)));
      });
      this.renderProps();
    });
  },
};
