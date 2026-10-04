// Texturen aus dem Canvas (keine Bilddateien, keine Normal-/Reliefkarten): hell und fein gemustert,
// damit die Farbe der Fläche sie tönt. Je Schlüssel einmal erzeugt; UVs der Flächen sind in Metern,
// repeat = 1 / Kachelgröße.

import * as THREE from "./vendor/three.module.min.js";
import { seeded } from "./exterior.js";

const N = 256;

/** Kachelgröße in Metern [Breite, Höhe] je Textur. */
const TILE = {
  plaster: [1.5, 1.5], brick: [1, 0.5], stone: [1.2, 1.2], wood_v: [0.96, 1.5], wood_h: [1.5, 0.96], panel: [0.8, 1.5],
  concrete: [2, 1], tiles: [0.6, 0.6], tiles_large: [1.2, 1.2], parquet: [1.2, 1.2], carpet: [0.6, 0.6],
  roof_tiles: [1.2, 1.32], roof_slate: [0.8, 0.8], roof_metal: [1.5, 1.5], roof_shingle: [1, 1],
  grass: [1.5, 1.5], gravel: [1, 1], paving: [1, 1], slabs: [1.2, 1.2], deck: [1.2, 1.2], asphalt: [2, 2], soil: [1.2, 1.2],
};

function canvas() {
  const c = document.createElement("canvas");
  c.width = c.height = N;
  return [c, c.getContext("2d")];
}

/** Grauwert-Rauschen (Körnung) über die ganze Fläche. */
function grain(g, rnd, amount = 14, base = 236, n = 2600, size = 2) {
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < n; i++) {
    const v = base + (rnd() - 0.5) * 2 * amount;
    g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    g.fillRect(rnd() * N, rnd() * N, size, size);
  }
}

const shade = (g, v, a = 1) => (g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${a})`);

/** Reihen von Steinen/Brettern: rows × cols, versetzt, Fuge f (px), Tonwerte schwanken. */
function courses(g, rnd, { rows, cols, joint, mortar, base = 225, spread = 22, offset = 0.5, vertical = false }) {
  shade(g, mortar);
  g.fillRect(0, 0, N, N);
  const h = N / rows;
  const w = N / cols;
  for (let r = 0; r < rows; r++) {
    const shift = (r % 2) * offset * w;
    for (let k = -1; k <= cols; k++) {
      const v = base + (rnd() - 0.5) * 2 * spread;
      shade(g, v);
      const x = k * w + shift;
      if (vertical) g.fillRect(r * h + joint / 2, x + joint / 2, h - joint, w - joint);
      else g.fillRect(x + joint / 2, r * h + joint / 2, w - joint, h - joint);
    }
  }
}

const DRAW = {
  plaster: (g, rnd) => grain(g, rnd, 12, 238, 9000, 1.5),
  brick: (g, rnd) => {
    courses(g, rnd, { rows: 6, cols: 4, joint: 4, mortar: 250, base: 215, spread: 26 });
    grain_overlay(g, rnd, 0.06);
  },
  stone: (g, rnd) => {
    shade(g, 200);
    g.fillRect(0, 0, N, N);
    for (let r = 0, y = 0; y < N; r++) {
      const h = 28 + rnd() * 26;
      for (let x = -rnd() * 40; x < N; ) {
        const w = 34 + rnd() * 60;
        shade(g, 205 + (rnd() - 0.5) * 70);
        g.fillRect(x + 2, y + 2, w - 4, Math.min(h, N - y) - 4);
        x += w;
      }
      y += h;
    }
    grain_overlay(g, rnd, 0.08);
  },
  wood_v: (g, rnd) => boards(g, rnd, 8, true),
  wood_h: (g, rnd) => boards(g, rnd, 8, false),
  panel: (g, rnd) => {
    grain(g, rnd, 6, 232, 3000, 1);
    for (let k = 0; k < 8; k++) {
      shade(g, 170, 0.9);
      g.fillRect(k * 32, 0, 3, N);
      shade(g, 252, 0.7);
      g.fillRect(k * 32 + 3, 0, 2, N);
    }
  },
  concrete: (g, rnd) => {
    grain(g, rnd, 16, 228, 9000, 2);
    shade(g, 185, 0.8);
    g.fillRect(0, N / 2 - 1, N, 2);
    g.fillRect(N / 2 - 1, 0, 2, N);
    for (const [x, y] of [[32, 64], [96, 64], [160, 64], [224, 64], [32, 192], [96, 192], [160, 192], [224, 192]]) {
      shade(g, 175);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  },
  tiles: (g, rnd) => tilesGrid(g, rnd, 2),
  tiles_large: (g, rnd) => tilesGrid(g, rnd, 2),
  parquet: (g, rnd) => {
    courses(g, rnd, { rows: 6, cols: 2, joint: 2, mortar: 185, base: 222, spread: 20, offset: 0.37 });
    for (let i = 0; i < 160; i++) {
      shade(g, 200 + rnd() * 20, 0.35);
      g.fillRect(rnd() * N, rnd() * N, 18 + rnd() * 50, 1);
    }
  },
  carpet: (g, rnd) => grain(g, rnd, 22, 225, 16000, 1.2),
  roof_tiles: (g, rnd) => {
    // Pfannen: Reihen mit Schatten unten, gewölbte Helligkeit quer
    const rows = 4;
    const cols = 4;
    const h = N / rows;
    const w = N / cols;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const base = 215 + (rnd() - 0.5) * 30;
        const grd = g.createLinearGradient(k * w, 0, (k + 1) * w, 0);
        grd.addColorStop(0, `rgb(${base - 30 | 0},${base - 30 | 0},${base - 30 | 0})`);
        grd.addColorStop(0.45, `rgb(${base + 22 | 0},${base + 22 | 0},${base + 22 | 0})`);
        grd.addColorStop(1, `rgb(${base - 20 | 0},${base - 20 | 0},${base - 20 | 0})`);
        g.fillStyle = grd;
        g.fillRect(k * w, r * h, w, h);
      }
      shade(g, 120, 0.55);
      g.fillRect(0, r * h + h - 7, N, 7);
    }
  },
  roof_slate: (g, rnd) => {
    courses(g, rnd, { rows: 8, cols: 6, joint: 3, mortar: 150, base: 215, spread: 28 });
  },
  roof_metal: (g, rnd) => {
    grain(g, rnd, 5, 230, 2000, 1);
    for (let k = 0; k < 3; k++) {
      shade(g, 255, 0.8);
      g.fillRect(k * (N / 3), 0, 3, N);
      shade(g, 175, 0.8);
      g.fillRect(k * (N / 3) + 3, 0, 3, N);
    }
  },
  roof_shingle: (g, rnd) => {
    courses(g, rnd, { rows: 8, cols: 3, joint: 3, mortar: 140, base: 210, spread: 18 });
    grain_overlay(g, rnd, 0.1);
  },
  grass: (g, rnd) => {
    grain(g, rnd, 10, 225, 0);
    for (let i = 0; i < 7000; i++) {
      shade(g, 175 + rnd() * 80, 0.8);
      g.fillRect(rnd() * N, rnd() * N, 1.3, 3 + rnd() * 4);
    }
  },
  gravel: (g, rnd) => {
    shade(g, 190);
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 2600; i++) {
      shade(g, 170 + rnd() * 85);
      g.beginPath();
      g.ellipse(rnd() * N, rnd() * N, 2 + rnd() * 3, 1.5 + rnd() * 2.5, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  },
  paving: (g, rnd) => courses(g, rnd, { rows: 8, cols: 4, joint: 3, mortar: 165, base: 215, spread: 22 }),
  slabs: (g, rnd) => {
    courses(g, rnd, { rows: 3, cols: 3, joint: 3, mortar: 170, base: 228, spread: 10, offset: 0 });
    grain_overlay(g, rnd, 0.07);
  },
  deck: (g, rnd) => boards(g, rnd, 9, false),
  asphalt: (g, rnd) => grain(g, rnd, 30, 215, 20000, 1.6),
  soil: (g, rnd) => grain(g, rnd, 35, 205, 14000, 2.5),
};

function boards(g, rnd, n, vertical) {
  const w = N / n;
  for (let k = 0; k < n; k++) {
    const base = 222 + (rnd() - 0.5) * 34;
    shade(g, base);
    if (vertical) g.fillRect(k * w, 0, w, N);
    else g.fillRect(0, k * w, N, w);
    // Maserung
    for (let i = 0; i < 26; i++) {
      shade(g, base - 12 - rnd() * 18, 0.45);
      const p = k * w + 2 + rnd() * (w - 4);
      const q = rnd() * N;
      if (vertical) g.fillRect(p, q, 1, 20 + rnd() * 60);
      else g.fillRect(q, p, 20 + rnd() * 60, 1);
    }
    shade(g, 150, 0.9);
    if (vertical) g.fillRect(k * w, 0, 2, N);
    else g.fillRect(0, k * w, N, 2);
  }
}

function tilesGrid(g, rnd, joint) {
  courses(g, rnd, { rows: 2, cols: 2, joint: joint * 2, mortar: 200, base: 240, spread: 6, offset: 0 });
  grain_overlay(g, rnd, 0.04);
}

function grain_overlay(g, rnd, alpha) {
  for (let i = 0; i < 5000; i++) {
    shade(g, rnd() < 0.5 ? 120 : 255, alpha);
    g.fillRect(rnd() * N, rnd() * N, 1.5, 1.5);
  }
}

const cache = new Map();

/** Textur zu einem Schlüssel (oder null). Wird je Schlüssel einmal erzeugt und geteilt. */
export function getTexture(key, renderer = null) {
  if (!key || !DRAW[key]) return null;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas();
  DRAW[key](g, seeded(key));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  const [w, h] = TILE[key] ?? [1, 1];
  t.repeat.set(1 / w, 1 / h);
  t.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  cache.set(key, t);
  return t;
}

/**
 * UVs in Metern je Dreieck: waagerechte Flächen nach Grundriss (x, z), alle anderen entlang der
 * Fläche (u waagerecht, v die Fläche hinauf). Für Wände, Dächer, Giebel.
 */
export function planarUVs(geo) {
  const p = geo.getAttribute("position");
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();
  const bt = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(v.subVectors(c, a)).normalize();
    const flat = Math.abs(n.y) > 0.92;
    if (!flat) {
      t.set(-n.z, 0, n.x).normalize();
      bt.crossVectors(n, t);
      if (bt.y < 0) bt.negate();
      // Wände: v genau die Höhe (Fugen waagerecht durchgehend über Ecken)
      if (Math.abs(n.y) < 0.05) bt.set(0, 1, 0);
    }
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k);
      if (flat) {
        uv[(i + k) * 2] = v.x;
        uv[(i + k) * 2 + 1] = -v.z;
      } else {
        uv[(i + k) * 2] = v.dot(t);
        uv[(i + k) * 2 + 1] = v.dot(bt);
      }
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}
