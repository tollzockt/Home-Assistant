// Leitungsnetz in 3D (Mixin für HouseScene): Rohre am Boden/an der Wand je Etage, Verteiler (Haupt-/
// Unterverteilung, Router, Hausanschluss, Durchführung …) und laufende Punkte je Netzstück (pipenet.js):
// Dichte und Tempo nach Menge, Richtung nach Flussrichtung. Ebene „pipes“, Punkte nur mit „Energiefluss“.

import * as THREE from "./vendor/three.module.min.js";
import { PIPE_TYPES } from "./pipes.js";
import { flowLook } from "./pipenet.js";

const RADIUS = 0.035;
const MAX_DOTS = 60;

/** 3D-Weg einer Leitung (wie pipes.js:pipePath, Höhen angehoben) und Länge bis zu jeder Stelle. */
function pipeGeometry(pipe, elev) {
  const pts = pipe.points;
  const h = (i) => {
    const v = Number(pipe.heights?.[i]);
    return elev + Math.max(RADIUS + 0.02, Number.isFinite(v) ? v : Number(pipe.height) || 0.03);
  };
  const path = [];
  const segs = [];
  let L = 0;
  pts.forEach((p, i) => {
    if (i === 0) {
      path.push(new THREE.Vector3(p[0], h(0), p[1]));
      return;
    }
    const a = pts[i - 1];
    const vert = Math.abs(h(i) - h(i - 1));
    if (vert > 1e-6) path.push(new THREE.Vector3(a[0], h(i), a[1]));
    const hor = Math.hypot(p[0] - a[0], p[1] - a[1]);
    segs.push({ start: L, vert, hor });
    L += vert + hor;
    path.push(new THREE.Vector3(p[0], h(i), p[1]));
  });
  // Stelle s (Segment + Anteil, wie pipenet) → Länge entlang des 3D-Wegs
  const lenAt = (s) => {
    if (s <= 0) return 0;
    const i = Math.min(Math.floor(s), segs.length - 1);
    const t = Math.min(1, s - i);
    const g = segs[i];
    return t <= 0 ? g.start : g.start + g.vert + t * g.hor;
  };
  return { path, len: L, lenAt };
}

export const ScenePipes = {
  _pipeMats() {
    return (this._pMats ??= Object.fromEntries(
      PIPE_TYPES.map(([k, , c]) => [
        k,
        {
          idle: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4 }),
          on: new THREE.MeshBasicMaterial({ color: c }),
          dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55) }),
        },
      ]),
    ));
  },

  /** Rohre und Verteiler einer Etage in entry.group (beim Aufbau der Etage). */
  _buildPipes(floor, entry, elev) {
    this._pipes ??= new Map();
    this._pipeNodes ??= new Map();
    const list = (floor.pipes ?? []).filter((p) => (p.points?.length ?? 0) >= 2);
    const nodes = floor.nodes ?? [];
    if (!list.length && !nodes.length) return;
    const group = new THREE.Group();
    group.userData.layer = "pipes";
    group.userData.noShadow = true;
    const mats = this._pipeMats();
    for (const pipe of list) {
      const g = pipeGeometry(pipe, elev);
      if (g.len < 0.05) continue;
      const curve = new THREE.CurvePath();
      for (let i = 1; i < g.path.length; i++) if (g.path[i - 1].distanceTo(g.path[i]) > 1e-4) curve.add(new THREE.LineCurve3(g.path[i - 1], g.path[i]));
      if (!curve.curves.length) continue;
      const m = mats[pipe.type] ?? mats.strom;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(400, Math.ceil(g.len * 6) + g.path.length * 4), RADIUS, 6, false), m.idle);
      tube.userData.pipe = pipe.id;
      group.add(tube);
      this._pipes.set(pipe.id, { id: pipe.id, floorId: floor.id, type: pipe.type, name: pipe.name, curve, len: g.len, lenAt: g.lenAt, path: g.path, tube, mats: m, group, active: false });
    }
    for (const n of nodes) {
      const obj = this._buildPipeNode(n, elev, floor);
      if (!obj) continue;
      obj.traverse((o) => (o.userData.pipeNode = n.id));
      group.add(obj);
      this._pipeNodes.set(n.id, { id: n.id, floorId: floor.id, obj, kind: n.kind });
    }
    entry.group.add(group);
  },

  /** Einfaches 3D-Modell eines Verteilers. */
  _buildPipeNode(n, elev, floor) {
    const M = this.furnMats;
    const g = new THREE.Group();
    const box = (w, h, d, mat, y = 0, z = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(0, y + h / 2, z);
      g.add(b);
      return b;
    };
    const cyl = (r, h, mat, y = 0) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat);
      c.position.y = y + h / 2;
      g.add(c);
      return c;
    };
    const stripe = (c) => new THREE.MeshBasicMaterial({ color: c });
    const y = Number.isFinite(n.y) ? n.y : null;
    switch (n.kind) {
      case "hv":
      case "uv":
        box(n.kind === "hv" ? 0.6 : 0.45, n.kind === "hv" ? 0.9 : 0.6, 0.16, M.white, y ?? 0.9);
        box(n.kind === "hv" ? 0.6 : 0.45, 0.04, 0.005, stripe(0xfbc02d), (y ?? 0.9) + (n.kind === "hv" ? 0.8 : 0.52), 0.083);
        break;
      case "einspeisung":
        box(0.35, 0.45, 0.15, M.white, y ?? 1.0);
        box(0.35, 0.05, 0.005, stripe(0xff9800), (y ?? 1.0) + 0.36, 0.078);
        break;
      case "router":
      case "switch":
        box(n.kind === "router" ? 0.28 : 0.44, 0.05, 0.18, M.dark, y ?? 0.8);
        box(0.2, 0.008, 0.004, stripe(0x00acc1), (y ?? 0.8) + 0.02, 0.092);
        break;
      case "wasser_in":
        cyl(0.07, 0.25, stripe(0x1e88e5), y ?? 0.3);
        break;
      case "warm_in":
        cyl(0.28, 1.5, M.white, y ?? 0);
        cyl(0.285, 0.05, stripe(0xe53935), (y ?? 0) + 1.3);
        break;
      case "durch": {
        // senkrechte Hülse durch Boden und Decke
        const h = floor.height ?? 2.5;
        const c = cyl(0.06, h, stripe(0x9e9e9e), 0);
        c.material = new THREE.MeshBasicMaterial({ color: 0x9e9e9e, transparent: true, opacity: 0.55 });
        break;
      }
      default:
        return null;
    }
    g.position.set(n.x, elev, n.z);
    return g;
  },

  /** Hat das Haus Stromleitungen? (dann ersetzt der Fluss in den Leitungen die Luftlinie). */
  hasPowerPipes() {
    return [...(this._pipes?.values() ?? [])].some((p) => p.type === "strom");
  },

  /**
   * Fluss setzen: net.edges aus pipenet.computeNet (je Stück pipeId, s0, s1, value, unit, reverse).
   * Punkte werden je Stück wiederverwendet; nur wenn sich die Anzahl ändert, entstehen neue.
   */
  setPipeFlow(net) {
    this._pipeEdges ??= new Map();
    const dotGeo = (this._pDot ??= new THREE.SphereGeometry(RADIUS * 2.2, 10, 6));
    const seen = new Set();
    const activePipes = new Set();
    for (const e of net?.edges ?? []) {
      const p = this._pipes?.get(e.pipeId);
      if (!p) continue;
      seen.add(e.id);
      const L0 = p.lenAt(e.s0);
      const L1 = p.lenAt(e.s1);
      const look = flowLook(e.value, e.unit);
      const want = look.active ? Math.max(1, Math.min(MAX_DOTS, Math.round(Math.abs(L1 - L0) * look.perMeter))) : 0;
      let ed = this._pipeEdges.get(e.id);
      if (!ed || ed.pipe !== p) {
        ed?.dots.forEach((d) => d.removeFromParent());
        ed = { id: e.id, pipe: p, dots: [], phase: Math.random() };
        this._pipeEdges.set(e.id, ed);
      }
      while (ed.dots.length < want) {
        const d = new THREE.Mesh(dotGeo, p.mats.dot);
        p.group.add(d);
        ed.dots.push(d);
      }
      while (ed.dots.length > want) ed.dots.pop().removeFromParent();
      Object.assign(ed, { L0, L1, value: e.value, unit: e.unit, reverse: !!e.reverse, speed: look.speed, active: look.active });
      if (look.active) activePipes.add(p.id);
    }
    for (const [id, ed] of this._pipeEdges) {
      if (seen.has(id) && this._pipes?.get(ed.pipe.id) === ed.pipe) continue;
      ed.dots.forEach((d) => d.removeFromParent());
      this._pipeEdges.delete(id);
    }
    for (const p of this._pipes?.values() ?? []) {
      p.active = activePipes.has(p.id);
      p.tube.material = p.active ? p.mats.on : p.mats.idle;
    }
    this._syncPipeDots();
    this._stepPipes(0);
    this.invalidate?.();
  },

  /** Punkte nur, solange es fließt und die Ebene „Energiefluss“ an ist. */
  _syncPipeDots() {
    const on = this.layers?.flow !== false;
    for (const ed of this._pipeEdges?.values() ?? []) for (const d of ed.dots) d.visible = on && ed.active;
  },

  _pipesActive() {
    if (this._frozen || this.layers?.pipes === false || this.layers?.flow === false) return false;
    for (const ed of this._pipeEdges?.values() ?? []) if (ed.active && ed.dots.length && this.isFloorVisible(ed.pipe.floorId)) return true;
    return false;
  },

  _stepPipes(dt) {
    for (const ed of this._pipeEdges?.values() ?? []) {
      if (!ed.active || !ed.dots.length) continue;
      const span = ed.L1 - ed.L0;
      ed.phase = (ed.phase + (dt * ed.speed) / Math.max(0.3, Math.abs(span))) % 1;
      const n = ed.dots.length;
      const len = ed.pipe.len || 1;
      ed.dots.forEach((d, i) => {
        let u = (ed.phase + i / n) % 1;
        if (ed.reverse) u = 1 - u;
        d.position.copy(ed.pipe.curve.getPointAt(Math.min(1, Math.max(0, (ed.L0 + u * span) / len))));
      });
    }
  },

  /**
   * Leitung oder Verteiler am Zeiger: direkter Treffer, sonst Rohr in der Nähe (Bildschirmabstand).
   * @returns {{pipe: string, at: number}|{pipeNode: string}|null} at = Länge entlang des Rohrs
   */
  pickPipe(clientX, clientY, maxPx = this.fingerPx ?? 30) {
    if (this.layers?.pipes === false || !this._pipes?.size) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const proj = (v) => {
      const p = v.clone().project(this.camera);
      return p.z > 1 ? null : [(p.x * 0.5 + 0.5) * rect.width, (-p.y * 0.5 + 0.5) * rect.height];
    };
    let best = null;
    for (const n of this._pipeNodes?.values() ?? []) {
      if (!this.isFloorVisible(n.floorId)) continue;
      const c = new THREE.Box3().setFromObject(n.obj).getCenter(new THREE.Vector3());
      const s = proj(c);
      if (!s) continue;
      const d = Math.hypot(s[0] - sx, s[1] - sy);
      if (d < maxPx && (!best || d < best.d)) best = { d, hit: { pipeNode: n.id } };
    }
    for (const p of this._pipes.values()) {
      if (!this.isFloorVisible(p.floorId)) continue;
      let acc = 0;
      for (let i = 1; i < p.path.length; i++) {
        const a3 = p.path[i - 1];
        const b3 = p.path[i];
        const seg = a3.distanceTo(b3);
        const a = proj(a3);
        const b = proj(b3);
        if (a && b) {
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / l2));
          const d = Math.hypot(a[0] + dx * t - sx, a[1] + dy * t - sy);
          if (d < maxPx * 0.6 && (!best || d < best.d)) best = { d, hit: { pipe: p.id, at: acc + t * seg } };
        }
        acc += seg;
      }
    }
    return best?.hit ?? null;
  },

  /** Netzstück einer Leitung an Länge at (für das Detail-Fenster). */
  pipeEdgeAt(pipeId, at) {
    for (const ed of this._pipeEdges?.values() ?? []) if (ed.pipe.id === pipeId && at >= Math.min(ed.L0, ed.L1) - 1e-6 && at <= Math.max(ed.L0, ed.L1) + 1e-6) return ed.id;
    return null;
  },
};
