// Leitungsnetz im Panel (Mixin für Haus3DPanel): Mengen aus Home Assistant lesen, Netz berechnen
// (pipenet.js), Fluss an die 3D-Szene geben; Antippen einer Leitung bzw. eines Verteilers zeigt Details.

import { roomPower } from "./devices.js";
import { energyEntities, watt } from "./energymodel.js";
import { NODE_KINDS, computeNet, fmtFlow } from "./pipenet.js";
import { PIPE_TYPES } from "./pipes.js";
import { esc } from "./panel-util.js";

const OFF = ["unavailable", "unknown"];
const num = (st) => {
  if (!st || OFF.includes(st.state)) return null;
  const v = Number(st.state);
  return Number.isFinite(v) ? v : null;
};

/** Datenrate in Mbit/s (bit/s, kbit/s, Mbit/s, Gbit/s sowie B/s, kB/s, MB/s, KiB/s …). */
export function mbit(st) {
  const v = num(st);
  if (v === null) return null;
  const u = String(st.attributes?.unit_of_measurement ?? "Mbit/s").trim();
  const m = /^([kKmMgG]?)i?(bit|B)\/s$/.exec(u);
  if (!m) return Math.abs(v); // unbekannt: als Mbit/s nehmen
  const scale = { "": 1e-6, k: 1e-3, K: 1e-3, m: 1, M: 1, g: 1000, G: 1000 }[m[1]];
  return Math.abs(v) * scale * (m[2] === "B" ? 8 : 1);
}

/** Last am Ende einer Leitung (W, l/min, Mbit/s) aus Sensor, Gerät oder Zielraum. */
export function pipeEndLoad(pipe, hass, roomW = null) {
  const st = (id) => (id ? hass?.states?.[id] : null);
  if (pipe.type === "strom") {
    if (pipe.entity) return watt(st(pipe.entity));
    if (pipe.device) {
      const d = st(pipe.device);
      const a = d?.attributes ?? {};
      const p = Number(a.current_power_w ?? a.power ?? a.current_power);
      if (Number.isFinite(p)) return p;
      if (d?.attributes?.unit_of_measurement) return watt(d);
      return d && ["on", "playing", "home", "heat", "cool", "cleaning"].includes(d.state) ? 30 : d ? 0 : null;
    }
    return Number.isFinite(roomW) ? roomW : null;
  }
  if (pipe.type === "netzwerk") {
    const id = pipe.entity || pipe.device;
    const s = st(id);
    if (!s) return null;
    if (s.attributes?.unit_of_measurement) return mbit(s);
    return ["home", "on", "connected"].includes(s.state) ? 0.5 : 0; // online: kleiner Grundwert
  }
  // Wasser: Durchfluss (l/min) oder Ventil/Pumpe an
  const s = st(pipe.entity || pipe.device);
  if (!s) return null;
  if (["on", "open", "opening"].includes(s.state)) return 6;
  const v = num(s);
  return v === null ? 0 : Math.max(0, v);
}

export const PipeNetMethods = {
  /** Netz neu berechnen und an die Szene geben (bei jeder Zustandsänderung). */
  _updatePipes() {
    if (!this._scene?.setPipeFlow || !this._building) return;
    const hass = this._hass;
    const exclude = new Set(energyEntities(this._building.settings?.energy ?? {}));
    const rooms = new Map(this._building.floors.flatMap((f) => (f.rooms ?? []).map((r) => [r.id, r])));
    const off = this._building.settings?.house_flow === false;
    this._net = computeNet(this._building, {
      load: (p) => {
        const room = p.room ? rooms.get(p.room) : null;
        const w = !p.entity && !p.device && room && p.type === "strom" ? roomPower(room, hass, this._byArea, exclude) : null;
        return pipeEndLoad(p, hass, w);
      },
      nodeValue: (n) => {
        const s = n.entity ? hass?.states?.[n.entity] : null;
        if (!s) return null;
        const medium = NODE_KINDS.find((k) => k[0] === n.kind)?.[3];
        return medium === "strom" ? watt(s) : medium === "netzwerk" ? mbit(s) : num(s);
      },
    });
    this._scene.setPipeFlow(off ? { edges: [] } : this._net);
  },

  /** Fenster mit den Werten eines Netzstücks bzw. Verteilers. */
  _pipePopup(hit) {
    this._closePopup?.();
    const el = document.createElement("div");
    el.className = "popup pipepop";
    const draw = () => {
      this._updatePipes();
      const net = this._net;
      let title = "";
      let icon = "mdi:transmission-tower";
      let body = "";
      if (hit.pipeNode) {
        const n = this._building.floors.flatMap((f) => f.nodes ?? []).find((x) => x.id === hit.pipeNode);
        const info = net?.nodes.get(hit.pipeNode);
        const kind = NODE_KINDS.find((k) => k[0] === n?.kind);
        if (!n || !kind) return this._closePopup();
        title = n.name || kind[1];
        icon = kind[2];
        body = `<div class="pbig">${info ? esc(fmtFlow(info.value, info.unit)) : "–"}</div>
          ${info?.meter != null ? `<div class="prow"><span>Zähler</span><b>${esc(fmtFlow(info.meter, info.unit))}</b></div>` : ""}
          ${info?.unknown != null && Math.abs(info.unknown) > 0.5 ? `<div class="prow"><span>nicht zugeordnet</span><b>${esc(fmtFlow(info.unknown, info.unit))}</b></div>` : ""}
          <div class="prow"><span>Art</span><b>${esc(kind[1])}</b></div>`;
      } else {
        const pipe = this._building.floors.flatMap((f) => f.pipes ?? []).find((x) => x.id === hit.pipe);
        const edgeId = this._scene.pipeEdgeAt(hit.pipe, hit.at ?? 0) ?? net?.edges.find((e) => e.pipeId === hit.pipe)?.id;
        const d = edgeId ? net?.details(edgeId) : null;
        const type = PIPE_TYPES.find((t) => t[0] === pipe?.type) ?? PIPE_TYPES[0];
        if (!pipe) return this._closePopup();
        title = pipe.name || type[1];
        icon = type[3];
        const sinks = (d?.sinks ?? []).filter((s) => Math.abs(s.value) > 0.05).slice(0, 8);
        body = `<div class="pbig">${d ? esc(fmtFlow(d.value, d.unit)) : "–"}</div>
          <div class="prow"><span>Leitung</span><b>${esc(type[1])}${d && d.value > 0.05 ? ` · fließt ${d.reverse ? "zum Anfang" : "zum Ende"}` : " · kein Fluss"}</b></div>
          ${sinks.length ? `<h4>Daran hängt</h4>${sinks.map((s) => `<div class="prow"><span>${esc(this._pipeSinkName(s))}</span><b>${esc(fmtFlow(s.value, d.unit))}</b></div>`).join("")}` : ""}`;
      }
      el.innerHTML = `<div class="head"><ha-icon icon="${icon}"></ha-icon><span>${esc(title)}</span><button class="icon x" title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="pbody">${body}</div>`;
      el.querySelector(".x").addEventListener("click", () => this._closePopup());
    };
    draw();
    el.addEventListener("click", (ev) => ev.stopPropagation());
    el._refresh = draw;
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  /** Lesbarer Name eines Verbrauchers (Raumname statt ID). */
  _pipeSinkName(s) {
    const room = this._building.floors.flatMap((f) => f.rooms ?? []).find((r) => r.id === s.name);
    if (room) return room.name;
    return this._hass?.states?.[s.name]?.attributes?.friendly_name ?? s.name;
  },
};

export const PIPENET_STYLE = `
.popup.pipepop { left: 50%; top: auto; bottom: 24px; right: auto; transform: translateX(-50%); width: min(340px, calc(100% - 32px)); padding: 0; }
.pipepop .head { display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px 14px; font-weight: 600; }
.pipepop .head span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pipepop .head .x { width: auto; flex: none; padding: 8px; }
.pipepop .pbody { padding: 2px 14px 14px; display: grid; gap: 4px; }
.pipepop .pbig { font-size: 28px; font-weight: 600; margin-bottom: 4px; }
.pipepop .prow { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.pipepop .prow span { color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pipepop h4 { margin: 8px 0 2px; font-size: 12px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
`;
