// Licht und Effekte der Szene (Mixin für HouseScene): echte Schatten der Sonne, Kontaktschatten unter
// Möbeln, Jahreszeit im Garten, Energiefluss im Haus und die PV-Verschattung über einen Tag.

import * as THREE from "./vendor/three.module.min.js";
import { sunVector } from "./sun.js";
import { SEASON_LOOK } from "./fx.js";
import { centroid, labelPoint } from "./walls.js";

let blobTex = null;
/** Weicher, runder Schatten (einmal erzeugt, von allen Möbeln geteilt). */
function contactTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.25)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export const SceneFx = {
  // ------------------------------------------------------------------ Schatten

  /** Schatten an/aus nach Qualitätsstufe und Ebene „Schatten“; Schattenbereich ums ganze Grundstück. */
  _applyShadows() {
    const on = !!this.quality?.shadows && this.layers?.shadows !== false && this.style !== "cyber";
    const r = this.renderer;
    if (r.shadowMap.enabled !== on) {
      r.shadowMap.enabled = on;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene.traverse((o) => {
        for (const m of [].concat(o.material ?? [])) m.needsUpdate = true;
      });
    }
    this.sun.castShadow = on;
    if (on) {
      const size = this.quality.shadowSize ?? 2048;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      // Bereich: Häuser und Garten (ohne Raster)
      const box = new THREE.Box3();
      for (const e of this.floors.values()) {
        box.expandByObject(e.group);
        box.expandByObject(e.garden);
      }
      const R = box.isEmpty() ? 20 : Math.max(8, box.getSize(new THREE.Vector3()).length() / 2 + 1);
      const cam = this.sun.shadow.camera;
      Object.assign(cam, { left: -R, right: R, top: R, bottom: -R, near: 0.5, far: this._sunR + R * 2 });
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.03;
      this.sun.shadow.radius = 3;
    }
    for (const holder of [this.root, this.devicesGroup]) {
      holder.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        const mats = [].concat(o.material ?? []);
        const clear = mats.some((m) => m.transparent && m.opacity < 0.9) || o.userData.noShadow;
        o.castShadow = on && !clear;
        o.receiveShadow = on && !o.userData.noShadow;
      });
    }
    this.invalidate?.();
  },

  // ------------------------------------------------------------------ Kontaktschatten

  /** Weicher Schatten unter Möbeln und Bäumen (auch ohne Sonnenschatten, kostet fast nichts). */
  _contactShadows() {
    if (this.quality?.contact === false || this.style === "cyber") return;
    const tex = contactTexture();
    const mat = (this._blobMat ??= new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 }));
    const geo = (this._blobGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    for (const e of this.floors.values()) {
      const elev = e.floor.elevation ?? 0;
      const items = [];
      for (const holder of [e.group, e.garden]) {
        holder.traverse((o) => {
          if (o.userData.furniture && o.parent?.userData.furniture !== o.userData.furniture && !o.userData.blob) items.push(o);
        });
      }
      for (const o of items) {
        box.setFromObject(o);
        if (box.isEmpty()) continue;
        box.getSize(size);
        // nur Dinge, die auf dem Boden stehen (keine Wandlampen, Bilder …)
        if (box.min.y - elev > 0.15 || size.y < 0.15) continue;
        box.getCenter(center);
        const blob = new THREE.Mesh(geo, mat);
        blob.scale.set(size.x * 1.25 + 0.15, 1, size.z * 1.25 + 0.15);
        blob.position.set(center.x, box.min.y + 0.012, center.z);
        blob.renderOrder = 1;
        blob.userData.blob = true;
        blob.userData.noShadow = true;
        // gleiche Ebene wie das Möbelstück (an/aus mit „Möbel“)
        blob.userData.layer = o.parent?.userData.layer ?? "furniture";
        (o.parent ?? e.group).add(blob);
      }
    }
  },

  // ------------------------------------------------------------------ Jahreszeit

  /** Rasen- und Laubfarbe nach Jahreszeit (Schnee-Tönung bleibt darüber). */
  setSeason(key) {
    if (this._season === key) return;
    this._season = key;
    const look = SEASON_LOOK[key] ?? SEASON_LOOK.summer;
    const set = (m, hex) => {
      if (!m) return;
      m.userData.orig ??= (m.userData.base ?? m.color).clone();
      const c = hex == null ? m.userData.orig.clone() : m.userData.orig.clone().lerp(new THREE.Color(hex), 0.85);
      m.userData.base = c;
      m.color.copy(c);
    };
    const cyber = this.style === "cyber";
    set(this.outdoorMats?.lawn, cyber ? null : look.lawn);
    for (const [k, m] of this.texMats ?? []) if (k === "ground:lawn") set(m, cyber ? null : look.lawn);
    set(this.furnMats?.leaf, cyber ? null : look.leaf);
    if (this.furnMats?.flower) set(this.furnMats.flower, cyber ? null : look.blossom);
    if (this._snowK) this._snowTint(this._snowK);
    this.invalidate?.();
  },

  // ------------------------------------------------------------------ Energiefluss im Haus

  /**
   * Linien vom Hausanschluss zu Räumen mit Verbrauch und zum Netz (fx.js:houseFlowItems). Wird nur neu
   * gebaut, wenn sich die Räume ändern; Leistung ändert nur Tempo und Punkte.
   */
  setHouseFlow(items) {
    const sig = items.map((i) => `${i.key}:${i.dots}:${i.reverse ? 1 : 0}`).join(",");
    if (this._houseFlow?.sig === sig) {
      for (const f of this._houseFlow.list) f.speed = items.find((i) => i.key === f.key)?.speed ?? 0;
      return;
    }
    this._clearHouseFlow();
    if (!items.length) return;
    const floors = [...this.floors.values()];
    const ground = floors.filter((e) => (e.floor.elevation ?? 0) >= -0.5).sort((a, b) => (a.floor.elevation ?? 0) - (b.floor.elevation ?? 0))[0] ?? floors[0];
    if (!ground) return;
    const rooms = (ground.floor.rooms ?? []).filter((r) => !r.energy_role);
    if (!rooms.length) return;
    const pts = rooms.map((r) => centroid(r.points));
    const hubXZ = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const elev0 = ground.floor.elevation ?? 0;
    const hub = new THREE.Vector3(hubXZ[0], elev0 + 0.25, hubXZ[1]);
    const group = new THREE.Group();
    group.userData.layer = "flow";
    group.userData.noShadow = true;
    this.root.add(group);
    const mats = (this._hfMats ??= {
      room: [new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: 0.35, depthWrite: false }), new THREE.MeshBasicMaterial({ color: 0xffb74d })],
      import: [new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.35, depthWrite: false }), new THREE.MeshBasicMaterial({ color: 0xef5350 })],
      export: [new THREE.MeshBasicMaterial({ color: 0x43a047, transparent: true, opacity: 0.35, depthWrite: false }), new THREE.MeshBasicMaterial({ color: 0x66bb6a })],
    });
    const dotGeo = (this._hfDot ??= new THREE.SphereGeometry(0.07, 10, 6));
    const xs = pts.map((p) => p[0]);
    const list = [];
    for (const it of items) {
      let end;
      let floorId = ground.floor.id;
      if (it.kind === "grid") end = new THREE.Vector3(Math.min(...xs) - 4, elev0 + 0.25, hubXZ[1]);
      else {
        const hit = floors.map((e) => ({ e, r: (e.floor.rooms ?? []).find((r) => r.id === it.key) })).find((x) => x.r);
        if (!hit) continue;
        const lp = labelPoint(hit.r.points);
        floorId = hit.e.floor.id;
        end = new THREE.Vector3(lp[0], (hit.e.floor.elevation ?? 0) + 0.3, lp[1]);
      }
      if (end.distanceTo(hub) < 0.5) end.x += 0.6;
      const ctrl = hub.clone().lerp(end, 0.5);
      ctrl.y = Math.max(hub.y, end.y) + 0.6 + hub.distanceTo(end) * 0.12;
      const curve = new THREE.QuadraticBezierCurve3(hub, ctrl, end);
      const [lineMat, dotMat] = mats[it.kind === "grid" ? it.color : "room"];
      const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.018, 5, false), lineMat);
      line.userData.floorId = floorId;
      group.add(line);
      const dots = [];
      for (let i = 0; i < it.dots; i++) {
        const d = new THREE.Mesh(dotGeo, dotMat);
        d.userData.floorId = floorId;
        group.add(d);
        dots.push(d);
      }
      list.push({ key: it.key, floorId, curve, line, dots, phase: Math.random(), speed: it.speed, reverse: it.reverse });
    }
    this._houseFlow = { sig, group, list };
    this._stepHouseFlow(0);
    this._syncHouseFlow();
    this.invalidate?.();
  },

  _clearHouseFlow() {
    if (!this._houseFlow) return;
    for (const f of this._houseFlow.list) f.line.geometry.dispose();
    this._houseFlow.group.removeFromParent();
    this._houseFlow = null;
  },

  /** Nur Linien sichtbarer Etagen (wie die Räume). */
  _syncHouseFlow() {
    for (const f of this._houseFlow?.list ?? []) {
      const vis = this.isFloorVisible(f.floorId) || this.filter === "all";
      f.line.visible = vis;
      for (const d of f.dots) d.visible = vis;
    }
  },

  _houseFlowActive() {
    return !!this._houseFlow?.list.length && this.layers?.flow !== false && !this._frozen;
  },

  _stepHouseFlow(dt) {
    for (const f of this._houseFlow?.list ?? []) {
      f.phase = (f.phase + dt * f.speed) % 1;
      const n = f.dots.length;
      f.dots.forEach((d, i) => {
        const u = (f.phase + i / n) % 1;
        d.position.copy(f.curve.getPointAt(f.reverse ? 1 - u : u));
      });
    }
  },

  // ------------------------------------------------------------------ PV-Verschattung

  /**
   * Verschattung je PV-Feld für Sonnenstände samples [{t, azimuth, elevation}]: Strahl von jeder
   * Modulmitte zur Sonne gegen Dach, Wände, Gauben, Kamine und Bäume.
   * @returns {Map<string, {t: number, elevation: number, shaded: number, total: number}[]>}
   */
  pvShadingRows(samples, north = 0) {
    const out = new Map();
    if (!this.pvFields?.size) return out;
    const pvMeshes = new Set([...this.pvFields.values()].map((f) => f.mesh));
    const occluders = [];
    const add = (holder) =>
      holder?.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || pvMeshes.has(o) || o.userData.blob || o.userData.cone) return;
        const mats = [].concat(o.material ?? []);
        if (mats.some((m) => m.transparent && m.opacity < 0.6)) return;
        let p = o;
        while (p) {
          if (p.userData.layer === "flow" || p.userData.layer === "pipes" || p.userData.layer === "weather" || p.userData.layer === "grid") return;
          p = p.parent;
        }
        occluders.push(o);
      });
    add(this.root);
    this.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.far = 80;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (const [id, f] of this.pvFields) {
      const inst = f.mesh;
      const mods = [];
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m);
        m.premultiply(inst.matrixWorld);
        m.decompose(pos, q, s);
        up.set(0, 1, 0).applyQuaternion(q).normalize();
        mods.push({ p: pos.clone().addScaledVector(up, 0.08), n: up.clone() });
      }
      const rows = [];
      for (const smp of samples) {
        const [x, y, z] = sunVector(smp.azimuth, smp.elevation, north);
        const dir = new THREE.Vector3(x, y, z).normalize();
        let shaded = 0;
        let total = 0;
        for (const md of mods) {
          if (md.n.dot(dir) <= 0.02) continue; // Sonne hinter dem Modul: zählt nicht
          total++;
          ray.set(md.p, dir);
          if (ray.intersectObjects(occluders, false).length) shaded++;
        }
        rows.push({ t: smp.t, elevation: smp.elevation, shaded, total });
      }
      out.set(id, rows);
    }
    return out;
  },
};
