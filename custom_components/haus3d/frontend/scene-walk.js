// Begehen-Modus (Mixin für HouseScene): Blick aus Augenhöhe durch eine Etage. Linker Joystick/WASD gehen
// (vor, zurück, seitlich), rechter Joystick/Ziehen/Pfeiltasten links-rechts schauen, Tippen auf den Boden
// geht dorthin. Nur Wände halten auf (Türen sind Löcher in den Wänden und lassen durch).

import * as THREE from "./vendor/three.module.min.js";
import { labelPoint, signedArea } from "./walls.js";

const EYE = 1.6;
const KNEE = 0.45;
const RADIUS = 0.25;

export const SceneWalk = {
  isWalking() {
    return !!this._walk;
  },

  /** Begehen starten (Etage, optional Startpunkt [x, z] im Plan). */
  enterWalk(floorId, at = null) {
    const entry = this.floors.get(floorId);
    if (!entry || this._walk) return false;
    const rooms = entry.floor.rooms ?? [];
    if (!rooms.length) return false;
    const big = [...rooms].sort((a, b) => Math.abs(signedArea(b.points)) - Math.abs(signedArea(a.points)))[0];
    const p = at ?? labelPoint(big.points);
    const elev = entry.floor.elevation ?? 0;
    this._walk = { floorId, elev, saved: this.getView(), fov: this.camera.fov, yaw: 0, pitch: -0.08, move: [0, 0], turn: [0, 0], glide: null };
    this.controls.enabled = false;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(p[0], elev + EYE, p[1]);
    // Blick zur Raummitte des größten anderen Raums bzw. nach Süden
    const other = rooms.find((r) => r !== big);
    if (other) {
      const c = labelPoint(other.points);
      this._walk.yaw = Math.atan2(-(c[0] - p[0]), -(c[1] - p[1]));
    }
    this._walkLook();
    this._bindWalk();
    this.invalidate();
    return true;
  },

  exitWalk() {
    const w = this._walk;
    if (!w) return;
    this._walk = null;
    this._walkWalls = null;
    clearInterval(this._walkTimer);
    this._walkTimer = null;
    this._unbindWalk?.();
    this.camera.fov = w.fov;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = true;
    this.setView(w.saved);
    this.invalidate();
  },

  _walkLook() {
    const w = this._walk;
    const dir = new THREE.Vector3(-Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.cos(w.yaw) * Math.cos(w.pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this._camDirty = true;
    this.invalidate();
  },

  /** Linker Joystick/Tasten: forward, strafe in -1..1 (wird bis zum nächsten Aufruf gehalten). */
  walkInput(forward, strafe) {
    const w = this._walk;
    if (!w) return;
    w.move = [forward, strafe];
    this._walkRun();
  },

  /** Rechter Joystick: drehen (yaw, + = links) und auf/ab schauen (pitch, + = hoch) in -1..1. */
  walkLookInput(yaw, pitch) {
    const w = this._walk;
    if (!w) return;
    w.turn = [yaw, pitch];
    this._walkRun();
  },

  /** Ein Takt für Gehen und Schauen, solange einer der Joysticks ausgelenkt ist. */
  _walkRun() {
    const w = this._walk;
    const dead = (v) => (Math.abs(v) > 0.08 ? v : 0);
    const active = w && [...w.move, ...w.turn].some((v) => dead(v) !== 0);
    if (active && !this._walkTimer) {
      let last = performance.now();
      this._walkTimer = setInterval(() => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const ww = this._walk;
        if (!ww) return;
        const [f, s] = ww.move.map(dead);
        const [ty, tp] = ww.turn.map(dead);
        // Kurve: feine Bewegung nahe der Mitte, schnell am Rand
        const curve = (v) => Math.sign(v) * v * v;
        if (ty || tp) {
          ww.yaw += curve(ty) * 2.2 * dt;
          ww.pitch = Math.max(-1.2, Math.min(1.2, ww.pitch + curve(tp) * 1.3 * dt));
          this._walkLook();
        }
        if (f || s) this.walkStep(f * 1.6 * dt, s * 1.3 * dt);
      }, 33);
    } else if (!active) {
      clearInterval(this._walkTimer);
      this._walkTimer = null;
    }
  },

  /** Ein Schritt (Meter vor, Meter seitlich), Wände halten auf. true = bewegt. */
  walkStep(forward, strafe) {
    const w = this._walk;
    if (!w) return false;
    const f = new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    const r = new THREE.Vector3(Math.cos(w.yaw), 0, -Math.sin(w.yaw));
    const d = f.multiplyScalar(forward).add(r.multiplyScalar(strafe));
    const len = d.length();
    if (len < 1e-5) return false;
    const dir = d.clone().normalize();
    if (this._walkBlocked(dir, len)) {
      // an der Wand entlang gleiten: nur die freie Achse
      const ax = new THREE.Vector3(Math.sign(d.x), 0, 0);
      const az = new THREE.Vector3(0, 0, Math.sign(d.z));
      let moved = false;
      if (Math.abs(d.x) > 1e-5 && !this._walkBlocked(ax, Math.abs(d.x))) {
        this.camera.position.x += d.x;
        moved = true;
      }
      if (Math.abs(d.z) > 1e-5 && !this._walkBlocked(az, Math.abs(d.z))) {
        this.camera.position.z += d.z;
        moved = true;
      }
      if (moved) this._walkLook();
      return moved;
    }
    this.camera.position.add(d);
    this._walkLook();
    return true;
  },

  /** Wand in Bewegungsrichtung näher als len + Körperradius? (Strahl in Kniehöhe) */
  _walkBlocked(dir, len) {
    const w = this._walk;
    const entry = this.floors.get(w.floorId);
    const from = new THREE.Vector3(this.camera.position.x, w.elev + KNEE, this.camera.position.z);
    this._walkRay ??= new THREE.Raycaster();
    this._walkRay.set(from, dir);
    this._walkRay.far = len + RADIUS;
    // nur Wände (auch freistehende): Lichtschein, Türblätter, Leitungen, Möbel und Geräte lassen durch
    let targets = (this._walkWalls ??= new Map()).get(w.floorId) ?? [];
    if (!targets.length || !targets[0].parent) {
      targets = []; // nach einem Neuaufbau der Etage neu sammeln
      entry.group.traverse((o) => o.isMesh && o.userData.layer === "walls" && targets.push(o));
      this._walkWalls.set(w.floorId, targets);
    }
    return this._walkRay.intersectObjects(targets, false).some((h) => Math.abs(h.face?.normal?.y ?? 0) < 0.5);
  },

  /** Tipp auf den Boden: in 0,6 s dorthin gehen (Wände halten auf). */
  walkTo(clientX, clientY) {
    const w = this._walk;
    if (!w) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -w.elev);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    const target = new THREE.Vector3(hit.x, this.camera.position.y, hit.z);
    const dist = target.distanceTo(this.camera.position);
    if (dist < 0.2 || dist > 25) return;
    const steps = Math.max(6, Math.round(dist / 0.15));
    let i = 0;
    clearInterval(this._walkGlide);
    this._walkGlide = setInterval(() => {
      if (!this._walk || i++ >= steps) return clearInterval(this._walkGlide);
      const to = target.clone().sub(this.camera.position);
      const step = Math.min(to.length(), dist / steps);
      const d = to.normalize().multiplyScalar(step);
      if (this._walkBlocked(d.clone().normalize(), step)) return clearInterval(this._walkGlide);
      this.camera.position.add(d);
      this._walkLook();
    }, 25);
  },

  _bindWalk() {
    const el = this.renderer.domElement;
    let drag = null;
    const down = (ev) => {
      drag = { x: ev.clientX, y: ev.clientY, yaw: this._walk.yaw, pitch: this._walk.pitch, moved: false };
      el.setPointerCapture?.(ev.pointerId);
    };
    const move = (ev) => {
      if (!drag || !this._walk) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      this._walk.yaw = drag.yaw + dx * 0.006;
      this._walk.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch + dy * 0.004));
      this._walkLook();
    };
    const up = (ev) => {
      if (drag && !drag.moved) this.walkTo(ev.clientX, ev.clientY);
      drag = null;
    };
    const wheel = (ev) => {
      ev.preventDefault();
      this.walkStep(-Math.sign(ev.deltaY) * 0.35, 0);
    };
    const keys = new Set();
    const keyMap = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], a: [0, -1], d: [0, 1] };
    this._walkWalls = null; // Wände der Etage beim ersten Schritt neu sammeln
    const turn = { arrowleft: 1, arrowright: -1, q: 1, e: -1 };
    const sync = () => {
      let f = 0;
      let s = 0;
      for (const k of keys) {
        if (keyMap[k]) {
          f += keyMap[k][0];
          s += keyMap[k][1];
        }
      }
      this.walkInput(Math.max(-1, Math.min(1, f)), Math.max(-1, Math.min(1, s)));
    };
    const kd = (ev) => {
      if (ev.target?.closest?.("input, select, textarea")) return;
      const k = ev.key.toLowerCase();
      if (turn[k]) {
        this._walk.yaw += turn[k] * 0.12;
        this._walkLook();
        ev.preventDefault();
      } else if (keyMap[k]) {
        keys.add(k);
        sync();
        ev.preventDefault();
      }
    };
    const ku = (ev) => {
      keys.delete(ev.key.toLowerCase());
      sync();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    this._unbindWalk = () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      clearInterval(this._walkGlide);
    };
  },
};
