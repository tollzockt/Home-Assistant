// Leitungen in 3D (Mixin für HouseScene): Rohre am Boden/an der Wand je Etage, darin laufende Punkte,
// solange Strom bzw. Wasser fließt (setPipeFlow). Ebene „pipes“.

import * as THREE from "./vendor/three.module.min.js";
import { PIPE_TYPES, pathLength, pipePath } from "./pipes.js";

const RADIUS = 0.035;

export const ScenePipes = {
  _pipeMats() {
    return (this._pMats ??= Object.fromEntries(
      PIPE_TYPES.map(([k, , c]) => [
        k,
        {
          idle: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45 }),
          on: new THREE.MeshBasicMaterial({ color: c }),
          dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55) }),
        },
      ]),
    ));
  },

  /** Rohre einer Etage in entry.group (beim Aufbau der Etage). */
  _buildPipes(floor, entry, elev) {
    this._pipes ??= new Map();
    const list = (floor.pipes ?? []).filter((p) => (p.points?.length ?? 0) >= 2);
    if (!list.length) return;
    const group = new THREE.Group();
    group.userData.layer = "pipes";
    group.userData.noShadow = true;
    const mats = this._pipeMats();
    const dotGeo = (this._pDot ??= new THREE.SphereGeometry(RADIUS * 2.2, 10, 6));
    for (const pipe of list) {
      const path = pipePath(pipe);
      const len = pathLength(path);
      if (len < 0.05) continue;
      const lift = (y) => elev + Math.max(RADIUS + 0.02, y); // nicht im Boden versinken
      const curve = new THREE.CurvePath();
      for (let i = 1; i < path.length; i++) {
        const a = new THREE.Vector3(path[i - 1][0], lift(path[i - 1][1]), path[i - 1][2]);
        const b = new THREE.Vector3(path[i][0], lift(path[i][1]), path[i][2]);
        if (a.distanceTo(b) > 1e-4) curve.add(new THREE.LineCurve3(a, b));
      }
      if (!curve.curves.length) continue;
      const m = mats[pipe.type] ?? mats.strom;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(400, Math.ceil(len * 6) + path.length * 4), RADIUS, 6, false), m.idle);
      tube.userData.pipe = pipe.id;
      group.add(tube);
      const dots = [];
      const n = Math.max(2, Math.min(40, Math.round(len / 0.5)));
      for (let i = 0; i < n; i++) {
        const d = new THREE.Mesh(dotGeo, m.dot);
        d.visible = false;
        group.add(d);
        dots.push(d);
      }
      this._pipes.set(pipe.id, { floorId: floor.id, type: pipe.type, curve, len, tube, mats: m, dots, phase: Math.random(), speed: 0, reverse: false, active: false });
    }
    entry.group.add(group);
  },

  /** Hat das Haus Stromleitungen? (dann ersetzt der Fluss in den Leitungen die Luftlinie). */
  hasPowerPipes() {
    return [...(this._pipes?.values() ?? [])].some((p) => p.type === "strom");
  },

  /** Fluss je Leitung: map id → {active, speed (m/s), reverse}. */
  setPipeFlow(map) {
    let changed = false;
    for (const [id, p] of this._pipes ?? []) {
      const f = map.get?.(id) ?? map[id] ?? { active: false, speed: 0, reverse: false };
      if (p.active !== f.active || p.reverse !== !!f.reverse) changed = true;
      p.active = !!f.active;
      p.speed = f.active ? f.speed : 0;
      p.reverse = !!f.reverse;
      p.tube.material = p.active ? p.mats.on : p.mats.idle;
      for (const d of p.dots) d.visible = p.active;
    }
    if (changed) {
      this._stepPipes(0);
      this.invalidate?.();
    }
  },

  _pipesActive() {
    if (this._frozen || this.layers?.pipes === false) return false;
    for (const p of this._pipes?.values() ?? []) if (p.active && this.isFloorVisible(p.floorId)) return true;
    return false;
  },

  _stepPipes(dt) {
    for (const p of this._pipes?.values() ?? []) {
      if (!p.active) continue;
      p.phase = (p.phase + (dt * p.speed) / Math.max(0.5, p.len)) % 1;
      const n = p.dots.length;
      p.dots.forEach((d, i) => {
        const u = (p.phase + i / n) % 1;
        d.position.copy(p.curve.getPointAt(p.reverse ? 1 - u : u));
      });
    }
  },
};
