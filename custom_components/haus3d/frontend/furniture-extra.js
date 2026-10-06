// 3D-Modelle des erweiterten Katalogs (catalog-extra.js): Einheitsrahmen wie in furniture.js – Breite w
// entlang x, Tiefe d entlang z, Höhe h nach oben, Vorderseite nach +z. Leuchtende Teile kommen in
// bulbs (folgen einer verknüpften Licht-Entität in Farbe und Helligkeit).

import * as THREE from "./vendor/three.module.min.js";
import { pvModules } from "./catalog-extra.js";

function box(g, mat, w, h, d, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.004), Math.max(h, 0.004), Math.max(d, 0.004)), mat);
  mesh.position.set(x, y + h / 2, z);
  g.add(mesh);
  return mesh;
}

function cyl(g, mat, r, h, x = 0, y = 0, z = 0, seg = 16, r2 = r) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, Math.max(h, 0.004), seg), mat);
  mesh.position.set(x, y + h / 2, z);
  g.add(mesh);
  return mesh;
}

function ball(g, mat, r, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function place(g, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** Stab von a nach b (Rohr, Kabel, Bein). */
function rod(g, mat, a, b, r = 0.012) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  g.add(mesh);
  return mesh;
}

// Zusatzmaterialien je Stil (an M gebunden)
const extraMats = new WeakMap();
function X(M) {
  let x = extraMats.get(M);
  if (x) return x;
  const cyber = !!M.edge;
  const m = (color, extra = {}) => (cyber ? new THREE.MeshStandardMaterial({ color: 0x150a2c, emissive: color, emissiveIntensity: 0.25, roughness: 0.6, ...extra }) : new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }));
  x = {
    pv: m(0x1b2a4a, { metalness: 0.35, roughness: 0.25 }),
    alu: m(0xc9ccd1, { metalness: 0.6, roughness: 0.35 }),
    birch: m(0xd9b98a),
    oak: m(0xb58d5c),
    black: m(0x1e1f22, { roughness: 0.5 }),
    grey: m(0x8a8f96),
    orange: m(0xe8710a),
    red: m(0xc62828),
    green: m(0x2e7d32),
    teal: m(0x00897b),
    cream: m(0xece4d4),
    car: m(0x546e7a, { metalness: 0.5, roughness: 0.35 }),
    tyre: m(0x222222, { roughness: 0.9 }),
  };
  extraMats.set(M, x);
  return x;
}

/** Korpus mit Fronten (Türen bzw. Schubladen) als dünne Fugen. */
function cabinet(g, M, mat, w, h, d, { doors = 1, drawers = 0, legs = 0, handle = true } = {}) {
  const y0 = legs;
  box(g, mat, w, h - y0, d, 0, y0, 0);
  if (legs) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, M.dark, 0.03, legs, 0.03, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
  const fz = d / 2 + 0.003;
  if (drawers) {
    const cols = w > 1 ? 2 : 1;
    const rows = Math.ceil(drawers / cols);
    for (let c = 1; c < cols; c++) box(g, M.dark, 0.006, h - y0 - 0.04, 0.004, -w / 2 + (c * w) / cols, y0 + 0.02, fz);
    for (let r = 1; r < rows; r++) box(g, M.dark, w * 0.97, 0.006, 0.004, 0, y0 + ((h - y0) * r) / rows, fz);
    if (handle) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) box(g, M.metal, Math.min(0.12, w / cols / 3), 0.012, 0.015, -w / 2 + ((c + 0.5) * w) / cols, y0 + ((h - y0) * (r + 0.7)) / rows, fz + 0.006);
  } else {
    for (let i = 1; i < doors; i++) box(g, M.dark, 0.006, h - y0 - 0.04, 0.004, -w / 2 + (i * w) / doors, y0 + 0.02, fz);
    if (handle) for (let i = 0; i < doors; i++) box(g, M.metal, 0.012, Math.min(0.25, h * 0.15), 0.015, -w / 2 + ((i + 0.5) * w) / doors + (i % 2 ? -1 : 1) * (w / doors) * 0.38, y0 + (h - y0) * 0.5, fz + 0.006);
  }
}

/** Regal: Seiten, Böden (rows) und Fächer (cols), optional Rückwand. */
function shelfGrid(g, mat, w, h, d, cols, rows, { t = 0.02, back = null } = {}) {
  for (let c = 0; c <= cols; c++) box(g, mat, t, h, d, -w / 2 + t / 2 + (c * (w - t)) / cols, 0, 0);
  for (let r = 0; r <= rows; r++) box(g, mat, w, t, d, 0, (r * (h - t)) / rows, 0);
  if (back) box(g, back, w, h, 0.005, 0, 0, -d / 2 + 0.003);
}

/** Polstersofa/-sessel: Sitz, Lehne, Armlehnen, Kissen. */
function sofa(g, M, mat, w, h, d, { arms = 0.12, seatH = 0.45, legs = 0.08, cushions = 3, chaise = 0 } = {}) {
  const base = seatH - 0.1;
  box(g, mat, w, base - legs, d, 0, legs, 0);
  if (legs) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, M.wood, 0.04, legs, 0.04, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08));
  box(g, mat, w, h - legs, 0.2, 0, legs, -d / 2 + 0.1);
  if (arms) for (const sx of [-1, 1]) box(g, mat, arms, h * 0.72 - legs, d, sx * (w / 2 - arms / 2), legs, 0);
  const inner = w - 2 * arms;
  for (let i = 0; i < cushions; i++) box(g, mat, inner / cushions - 0.01, 0.12, d - 0.25, -inner / 2 + ((i + 0.5) * inner) / cushions, base, 0.05);
  if (chaise) box(g, mat, chaise, base - legs + 0.12, 0.6, w / 2 - arms - chaise / 2, legs, d / 2 + 0.3);
}

function table(g, M, top, legMat, w, h, d, { t = 0.04, leg = 0.05, round = false, inset = 0.05 } = {}) {
  if (round) cyl(g, top, Math.min(w, d) / 2, t, 0, h - t, 0, 32);
  else box(g, top, w, t, d, 0, h - t, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, legMat, leg, h - t, leg, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
}

/** PV-Modul (Rahmen + Zellenfläche) auf der Fläche (x, y, z), geneigt um tilt (rad) um die x-Achse. */
function panel(g, M, x, y, z, pw, pl, tilt, face = 1) {
  const p = new THREE.Group();
  box(p, X(M).alu, pw, 0.035, pl, 0, -0.036, 0);
  box(p, X(M).pv, pw - 0.03, 0.006, pl - 0.03, 0, -0.004, 0);
  p.position.set(x, y, z);
  p.rotation.x = -tilt * face;
  g.add(p);
  return p;
}

// ------------------------------------------------------------------ einzelne Gruppen

function ikea(type, w, d, h, M, g) {
  const x = X(M);
  switch (type) {
    case "ikea_kallax_1x4":
    case "ikea_kallax_2x2":
    case "ikea_kallax_2x4":
    case "ikea_kallax_4x4": {
      const [c, r] = { ikea_kallax_1x4: [1, 4], ikea_kallax_2x2: [2, 2], ikea_kallax_2x4: [2, 4], ikea_kallax_4x4: [4, 4] }[type];
      shelfGrid(g, M.white, w, h, d, c, r, { t: 0.038 });
      return true;
    }
    case "ikea_billy_80":
    case "ikea_billy_40":
      shelfGrid(g, M.white, w, h, d, 1, 6, { t: 0.018, back: M.white });
      return true;
    case "ikea_ivar":
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, x.birch, 0.03, h, 0.03, sx * (w / 2 - 0.015), 0, sz * (d / 2 - 0.015));
      for (let i = 0; i < 5; i++) box(g, x.birch, w - 0.06, 0.02, d, 0, 0.12 + (i * (h - 0.16)) / 4, 0);
      return true;
    case "ikea_pax_100":
    case "ikea_pax_50":
      cabinet(g, M, M.white, w, h, d, { doors: type === "ikea_pax_100" ? 2 : 1 });
      return true;
    case "ikea_brimnes_3":
      cabinet(g, M, M.white, w, h, d, { doors: 3 });
      box(g, M.glass, w / 3 - 0.06, h * 0.75, 0.004, 0, 0.2, d / 2 + 0.006);
      return true;
    case "ikea_malm_chest6":
      cabinet(g, M, M.white, w, h, d, { drawers: 6, handle: false });
      return true;
    case "ikea_hemnes_chest8":
      cabinet(g, M, x.oak, w, h, d, { drawers: 8, legs: 0.08 });
      return true;
    case "ikea_malm_dressing":
      box(g, M.white, w, 0.12, d, 0, h - 0.12, 0);
      for (const sx of [-1, 1]) box(g, M.white, 0.02, h - 0.12, d, sx * (w / 2 - 0.01), 0, 0);
      box(g, M.white, w, 0.02, 0.02, 0, 0, -d / 2 + 0.01);
      return true;
    case "ikea_malm_bed160":
      box(g, M.white, w, 0.38, d, 0, 0, 0);
      box(g, M.light, w - 0.16, 0.2, d - 0.2, 0, 0.3, 0.05);
      box(g, M.white, w, h, 0.05, 0, 0, -d / 2 + 0.025);
      box(g, M.white, w * 0.15, 0.4, 0.4, -w / 2 + w * 0.075, 0.38, -d / 2 + 0.25);
      box(g, M.white, w * 0.15, 0.4, 0.4, w / 2 - w * 0.075, 0.38, -d / 2 + 0.25);
      return true;
    case "ikea_ektorp_3":
      sofa(g, M, x.cream, w, h, d, { arms: 0.2, cushions: 3, legs: 0.05 });
      return true;
    case "ikea_kivik_3":
      sofa(g, M, M.fabric, w, h, d, { arms: 0.25, cushions: 3, legs: 0.06 });
      return true;
    case "ikea_soderhamn_3":
      sofa(g, M, x.grey, w, h, d, { arms: 0.1, cushions: 3, legs: 0.03, seatH: 0.4 });
      return true;
    case "ikea_friheten":
      sofa(g, M, x.grey, w, h, d - 0.6, { arms: 0, cushions: 3, legs: 0.08, chaise: 0.85 });
      return true;
    case "ikea_poang": {
      // geschwungenes Birkenholz-Gestell, Polster
      for (const sx of [-1, 1]) {
        rod(g, x.birch, [sx * (w / 2 - 0.04), 0.02, d / 2 - 0.05], [sx * (w / 2 - 0.04), 0.02, -d / 2 + 0.05], 0.02);
        rod(g, x.birch, [sx * (w / 2 - 0.04), 0.02, d / 2 - 0.05], [sx * (w / 2 - 0.04), 0.55, d / 2 - 0.12], 0.02);
      }
      const seat = box(g, M.fabric, w - 0.14, 0.08, d * 0.55, 0, 0.32, 0.08);
      seat.rotation.x = 0.25;
      const back = box(g, M.fabric, w - 0.14, h * 0.62, 0.08, 0, 0.36, -d / 2 + 0.18);
      back.rotation.x = -0.35;
      return true;
    }
    case "ikea_strandmon":
      sofa(g, M, x.teal, w, h, d, { arms: 0.14, cushions: 1, legs: 0.12 });
      box(g, x.teal, 0.14, 0.25, 0.25, -w / 2 + 0.07, h - 0.25, -d / 2 + 0.2);
      box(g, x.teal, 0.14, 0.25, 0.25, w / 2 - 0.07, h - 0.25, -d / 2 + 0.2);
      return true;
    case "ikea_lack_coffee":
    case "ikea_lack_side":
      table(g, M, M.dark, M.dark, w, h, d, { t: 0.05, leg: 0.05, inset: 0.025 });
      if (type === "ikea_lack_coffee") box(g, M.dark, w - 0.1, 0.02, d - 0.1, 0, 0.12, 0);
      return true;
    case "ikea_besta_tv":
      cabinet(g, M, M.white, w, h, d, { doors: 3, legs: 0.0 });
      return true;
    case "ikea_micke":
      box(g, M.white, w, 0.025, d, 0, h - 0.025, 0);
      box(g, M.white, 0.02, h - 0.025, d, -w / 2 + 0.01, 0, 0);
      box(g, M.white, 0.35, h - 0.025, d, w / 2 - 0.175, 0, 0);
      return true;
    case "ikea_alex":
      box(g, M.white, w, 0.03, d, 0, h - 0.03, 0);
      {
        const sub = new THREE.Group();
        cabinet(sub, M, M.white, 0.36, h - 0.03, d, { drawers: 5, handle: false });
        sub.position.x = -w / 2 + 0.18;
        g.add(sub);
      }
      box(g, M.white, 0.02, h - 0.03, d, w / 2 - 0.01, 0, 0);
      return true;
    case "ikea_bekant":
      box(g, M.white, w, 0.025, d, 0, h - 0.025, 0);
      for (const sx of [-1, 1]) {
        box(g, M.dark, 0.06, h - 0.1, 0.06, sx * (w / 2 - 0.15), 0.05, 0);
        box(g, M.dark, 0.06, 0.05, d - 0.1, sx * (w / 2 - 0.15), 0, 0);
      }
      return true;
    case "ikea_linnmon_100":
    case "ikea_linnmon_150":
      box(g, M.white, w, 0.034, d, 0, h - 0.034, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, M.white, 0.025, h - 0.034, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 12);
      return true;
    case "ikea_markus":
      cyl(g, M.dark, w * 0.4, 0.05, 0, 0, 0, 5);
      cyl(g, M.metal, 0.025, 0.4, 0, 0.05, 0, 10);
      box(g, M.dark, w * 0.8, 0.08, d * 0.75, 0, 0.45, 0.04);
      box(g, M.dark, w * 0.75, h - 0.6, 0.06, 0, 0.6, -d / 2 + 0.12);
      return true;
    case "ikea_nordviken":
      table(g, M, M.dark, M.dark, w, h, d, { leg: 0.06 });
      return true;
    case "ikea_ekedalen":
      table(g, M, x.oak, x.oak, w, h, d, { leg: 0.06 });
      return true;
  }
  return false;
}

function lamps(type, w, d, h, M, g, bulbs) {
  switch (type) {
    case "lamp_arc": {
      // Marmorfuß, Bogen nach vorn (+x), Schirm am Ende
      box(g, M.stone ?? M.light, 0.32, 0.06, 0.25, -w / 2 + 0.16, 0, 0);
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push([-w / 2 + 0.16 + t * (w - 0.3), 0.06 + Math.sin(t * Math.PI * 0.8) * (h - 0.06) + t * 0.2 - (t > 0.8 ? (t - 0.8) * 1.5 : 0), 0]);
      }
      for (let i = 1; i < pts.length; i++) rod(g, M.metal, pts[i - 1], pts[i], 0.012);
      const end = pts.at(-1);
      const shade = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.metal);
      shade.position.set(end[0], end[1] - 0.02, 0);
      g.add(shade);
      bulbs.push(ball(g, M.bulb, 0.07, end[0], end[1] - 0.05, 0));
      return true;
    }
    case "lamp_tripod":
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        rod(g, M.wood, [Math.cos(a) * w * 0.42, 0, Math.sin(a) * d * 0.42], [0, h * 0.75, 0], 0.014);
      }
      place(g, new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.36, h * 0.25, 20, 1, true), M.light), 0, h * 0.86, 0);
      bulbs.push(ball(g, M.bulb, 0.06, 0, h * 0.8, 0));
      return true;
    case "lamp_globe":
      rod(g, M.dark, [0, h, 0], [0, w / 2, 0], 0.005);
      {
        const b = ball(g, M.bulb, Math.min(w, d) / 2, 0, w / 2, 0);
        bulbs.push(b);
      }
      return true;
    case "lamp_chandelier": {
      rod(g, M.metal, [0, h, 0], [0, h * 0.45, 0], 0.008);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.38, 0.012, 6, 32), M.metal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h * 0.35;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI * 2) / 6;
        const px = Math.cos(a) * w * 0.38;
        const pz = Math.sin(a) * d * 0.38;
        rod(g, M.metal, [0, h * 0.45, 0], [px, h * 0.35, pz], 0.006);
        cyl(g, M.white, 0.012, 0.1, px, h * 0.35, pz, 8);
        bulbs.push(ball(g, M.bulb, 0.025, px, h * 0.35 + 0.13, pz));
      }
      return true;
    }
    case "lamp_ring": {
      rod(g, M.dark, [0, h, 0], [0, 0.05, 0], 0.003);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w / 2 - 0.02, 0.02, 8, 48), M.bulb);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
      bulbs.push(ring);
      return true;
    }
    case "lamp_cluster":
      box(g, M.dark, w, 0.03, d * 0.4, 0, h - 0.03, 0);
      for (const [i, len] of [[-1, 0.55], [0, 0.4], [1, 0.65]]) {
        const px = i * w * 0.35;
        rod(g, M.dark, [px, h - 0.03, 0], [px, h - len, 0], 0.004);
        bulbs.push(ball(g, M.bulb, 0.06, px, h - len - 0.06, 0));
      }
      return true;
    case "lamp_edison":
      rod(g, M.dark, [0, h, 0], [0, 0.14, 0], 0.004);
      cyl(g, M.metal, 0.018, 0.05, 0, 0.1, 0, 10);
      {
        const b = ball(g, M.bulb, 0.05, 0, 0.06, 0);
        b.scale.y = 1.3;
        bulbs.push(b);
      }
      return true;
    case "lamp_track":
      box(g, M.dark, w, 0.03, 0.04, 0, h - 0.03, 0);
      for (const t of [-0.35, 0, 0.35]) {
        const px = t * w;
        rod(g, M.dark, [px, h - 0.03, 0], [px, h * 0.45, 0.02], 0.008);
        const s = cyl(g, M.dark, 0.035, 0.09, px, h * 0.05, 0.04, 14);
        s.rotation.x = 0.4;
        bulbs.push(cyl(g, M.bulb, 0.03, 0.01, px, h * 0.05, 0.075, 14));
      }
      return true;
    case "lamp_desk":
      cyl(g, M.dark, 0.08, 0.02, 0, 0, -d / 2 + 0.1, 16);
      rod(g, M.dark, [0, 0.02, -d / 2 + 0.1], [0, h * 0.85, -d * 0.1], 0.008);
      rod(g, M.dark, [0, h * 0.85, -d * 0.1], [0, h * 0.7, d / 2 - 0.06], 0.008);
      place(g, new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 16, 1, true), M.dark), 0, h * 0.62, d / 2 - 0.06);
      bulbs.push(ball(g, M.bulb, 0.03, 0, h * 0.6, d / 2 - 0.06));
      return true;
    case "lamp_mushroom":
      cyl(g, M.white, 0.06, 0.02, 0, 0, 0, 20);
      cyl(g, M.white, 0.02, h * 0.55, 0, 0.02, 0, 12);
      {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.bulb);
        cap.position.y = h * 0.55;
        cap.scale.y = 0.75;
        g.add(cap);
        bulbs.push(cap);
      }
      return true;
    case "lamp_neon": {
      box(g, M.glass, w, h, 0.01, 0, 0, -d / 2 + 0.005);
      // geschwungener Schriftzug als Röhrenstücke
      for (let i = 0; i < 6; i++) {
        const x0 = -w / 2 + 0.06 + (i * (w - 0.12)) / 6;
        bulbs.push(rod(g, M.bulb, [x0, h * (i % 2 ? 0.3 : 0.7), 0], [x0 + (w - 0.12) / 6, h * (i % 2 ? 0.7 : 0.3), 0], 0.008));
      }
      return true;
    }
  }
  return false;
}

function leds(type, w, d, h, M, g, bulbs) {
  switch (type) {
    case "led_cove":
      box(g, M.white, w, 0.04, d, 0, 0, 0);
      bulbs.push(box(g, M.bulb, w - 0.02, 0.008, 0.02, 0, -0.008, d / 2 - 0.01));
      return true;
    case "led_profile":
      box(g, X(M).alu, w, h, d, 0, 0, 0);
      bulbs.push(box(g, M.bulb, w - 0.01, h * 0.5, 0.004, 0, h * 0.25, d / 2));
      return true;
    case "led_bar":
      box(g, M.dark, w, 0.02, d, 0, 0, 0);
      bulbs.push(box(g, M.bulb, w * 0.85, h - 0.02, d * 0.85, 0, 0.02, 0));
      return true;
    case "led_corner":
      cyl(g, M.dark, w / 2, 0.02, 0, 0, 0, 20);
      bulbs.push(cyl(g, M.bulb, 0.02, h - 0.02, 0, 0.02, 0, 10));
      return true;
    case "led_tv":
      // Rahmen hinter dem Fernseher
      for (const [x, y, ww, hh] of [[0, 0, w, 0.012], [0, h - 0.012, w, 0.012], [-w / 2, 0, 0.012, h], [w / 2, 0, 0.012, h]]) bulbs.push(box(g, M.bulb, ww, hh, 0.01, x, y, -d / 2));
      return true;
    case "led_hex": {
      const r = 0.12;
      const cells = [[0, 0], [1, 0], [0.5, 0.866], [1.5, 0.866], [2, 0], [1, -0.866], [2.5, 0.866]];
      for (const [cx, cy] of cells) {
        const hx = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.012, 6), M.bulb);
        hx.rotation.x = Math.PI / 2;
        hx.position.set(-w / 2 + r + cx * r * 1.75, h / 2 + cy * r * 1.75, 0);
        g.add(hx);
        bulbs.push(hx);
      }
      return true;
    }
    case "led_lines":
      for (let i = 0; i < 5; i++) {
        const a = (i % 2 ? 1 : -1) * 0.5;
        const x0 = -w / 2 + 0.1 + i * ((w - 0.2) / 5);
        bulbs.push(rod(g, M.bulb, [x0, h * 0.2, 0], [x0 + Math.sin(a) * 0.25, h * 0.2 + Math.cos(a) * 0.35, 0], 0.012));
      }
      return true;
    case "led_bed":
      for (const [x, z, ww, dd] of [[0, d / 2 - 0.02, w - 0.1, 0.012], [-w / 2 + 0.03, 0, 0.012, d - 0.1], [w / 2 - 0.03, 0, 0.012, d - 0.1]]) bulbs.push(box(g, M.bulb, ww, 0.012, dd, x, 0.005, z));
      return true;
    case "led_stairs":
      for (let i = 0; i < 12; i++) bulbs.push(box(g, M.bulb, w - 0.1, 0.01, 0.015, 0, (i * 2.6) / 12, -d / 2 + 0.05 + (i * (d - 0.1)) / 12));
      return true;
  }
  return false;
}

function gaming(type, w, d, h, M, g, bulbs) {
  const x = X(M);
  switch (type) {
    case "gaming_pc":
    case "gaming_pc_showcase": {
      box(g, M.dark, w, h, d, 0, 0.02, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, M.dark, 0.03, 0.02, 0.03, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.04));
      // Glasseite (links), Lüfter mit RGB vorn
      box(g, M.glass, 0.005, h * 0.9, d * 0.9, -w / 2 - 0.003, 0.04, 0);
      const fans = type === "gaming_pc_showcase" ? 3 : 2;
      for (let i = 0; i < fans; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, h) * 0.18, 0.008, 6, 24), M.bulb);
        ring.position.set(0, 0.02 + h * (0.25 + i * 0.25), d / 2 + 0.004);
        g.add(ring);
        bulbs.push(ring);
      }
      bulbs.push(box(g, M.bulb, 0.004, h * 0.7, 0.01, -w / 2 + 0.01, 0.1, d / 2 - 0.03));
      return true;
    }
    case "gaming_desk":
      box(g, M.dark, w, 0.03, d, 0, h - 0.03, 0);
      for (const sx of [-1, 1]) {
        box(g, M.dark, 0.06, h - 0.05, 0.06, sx * (w / 2 - 0.12), 0.02, 0);
        box(g, M.dark, 0.08, 0.03, d - 0.1, sx * (w / 2 - 0.12), 0, 0);
      }
      bulbs.push(box(g, M.bulb, w - 0.04, 0.008, 0.008, 0, h - 0.036, d / 2 - 0.004));
      box(g, M.fabric, w * 0.9, 0.004, d * 0.6, 0, h, 0.05); // Schreibtischunterlage
      return true;
    case "gaming_chair":
      cyl(g, M.dark, w * 0.42, 0.05, 0, 0, 0, 5);
      cyl(g, M.metal, 0.028, 0.38, 0, 0.05, 0, 10);
      box(g, M.dark, w * 0.72, 0.1, d * 0.68, 0, 0.43, 0.06);
      for (const sx of [-1, 1]) box(g, x.red, 0.06, 0.12, d * 0.68, sx * w * 0.33, 0.47, 0.06);
      {
        const back = box(g, M.dark, w * 0.65, h - 0.55, 0.12, 0, 0.53, -d / 2 + 0.16);
        back.rotation.x = -0.12;
        box(g, x.red, w * 0.2, h - 0.65, 0.01, 0, 0.58, -d / 2 + 0.235).rotation.x = -0.12;
      }
      for (const sx of [-1, 1]) box(g, M.dark, 0.06, 0.03, 0.3, sx * w * 0.42, 0.68, 0.05);
      return true;
    case "monitor_27":
    case "monitor_34":
    case "monitor_49":
    case "monitor_dual": {
      const screens = type === "monitor_dual" ? [-w / 4, w / 4] : [0];
      const sw = type === "monitor_dual" ? w / 2 - 0.01 : w;
      const curved = type === "monitor_34" || type === "monitor_49";
      for (const sx of screens) {
        cyl(g, M.dark, 0.1, 0.015, sx, 0, -d / 2 + 0.12, 16);
        box(g, M.dark, 0.04, h * 0.5, 0.03, sx, 0.015, -d / 2 + 0.1);
        if (curved) {
          // gebogen: Segmente auf einem Kreisbogen, Ränder zum Betrachter (+z)
          const n = 7;
          const R = sw * 1.2;
          const ang = sw / R;
          for (let i = 0; i < n; i++) {
            const a = -ang / 2 + ((i + 0.5) * ang) / n;
            const seg = new THREE.Group();
            box(seg, M.dark, (sw / n) * 1.02, h * 0.62, 0.03, 0, -h * 0.31, 0);
            box(seg, M.screen, (sw / n) * 1.02, h * 0.58, 0.004, 0, -h * 0.29, 0.017);
            seg.position.set(sx + Math.sin(a) * R, h * 0.62, -d / 2 + 0.13 + (1 - Math.cos(a)) * R);
            seg.rotation.y = -a;
            g.add(seg);
          }
        } else {
          box(g, M.dark, sw, h * 0.62, 0.03, sx, h * 0.31, -d / 2 + 0.13);
          box(g, M.screen, sw - 0.02, h * 0.58, 0.004, sx, h * 0.33, -d / 2 + 0.147);
        }
        bulbs.push(box(g, M.bulb, sw * 0.6, 0.01, 0.01, sx, h * 0.3, -d / 2 + 0.1));
      }
      return true;
    }
    case "keyboard_mouse":
      box(g, M.dark, w * 0.68, h * 0.6, d * 0.7, -w * 0.12, 0, 0);
      bulbs.push(box(g, M.bulb, w * 0.66, 0.004, d * 0.66, -w * 0.12, h * 0.6, 0));
      {
        const mouse = ball(g, M.dark, 0.035, w / 2 - 0.08, 0.015, 0);
        mouse.scale.set(0.9, 0.5, 1.6);
      }
      box(g, M.fabric, w, 0.003, d, 0, -0.003, 0);
      return true;
    case "pc_speakers":
      for (const sx of [-1, 1]) {
        box(g, M.dark, 0.1, h, d * 0.9, sx * (w / 2 - 0.05), 0, 0);
        cyl(g, M.metal, 0.035, 0.01, sx * (w / 2 - 0.05), h * 0.35, d * 0.45, 16).rotation.x = Math.PI / 2;
      }
      return true;
    case "headset_stand":
      cyl(g, M.dark, w / 2, 0.015, 0, 0, 0, 16);
      cyl(g, M.dark, 0.012, h - 0.04, 0, 0.015, 0, 8);
      {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 20, Math.PI), M.dark);
        band.position.y = h - 0.09;
        g.add(band);
        for (const sx of [-1, 1]) box(g, M.dark, 0.03, 0.08, 0.07, sx * 0.08, h - 0.17, 0);
        bulbs.push(cyl(g, M.bulb, w / 2 - 0.01, 0.004, 0, 0.015, 0, 16));
      }
      return true;
    case "streaming_mic":
      box(g, M.dark, 0.05, 0.05, 0.05, 0, 0, -d / 2 + 0.03);
      rod(g, M.dark, [0, 0.05, -d / 2 + 0.03], [0, h * 0.75, -d * 0.1], 0.008);
      rod(g, M.dark, [0, h * 0.75, -d * 0.1], [0, h * 0.55, d / 2 - 0.05], 0.008);
      cyl(g, M.dark, 0.03, 0.15, 0, h * 0.4, d / 2 - 0.05, 12);
      return true;
    case "console_ps5":
    case "console_ps5_pro":
      box(g, M.white, w * 0.7, h, d, 0, 0, 0);
      box(g, M.dark, w * 0.25, h * 0.96, d * 0.98, 0, 0.005, 0);
      bulbs.push(box(g, M.bulb, w * 0.3, h * 0.6, 0.004, 0, h * 0.2, d / 2 + 0.002));
      return true;
    case "console_xbox_x":
      box(g, M.dark, w, h, d, 0, 0, 0);
      cyl(g, x.black, w * 0.4, 0.004, 0, h, 0, 24);
      bulbs.push(cyl(g, x.green, w * 0.38, 0.003, 0, h + 0.004, 0, 24));
      return true;
    case "console_xbox_s":
      box(g, M.white, w, h, d, 0, 0, 0);
      cyl(g, M.dark, h * 0.3, 0.004, w / 2 + 0.002, h * 0.6, d * 0.1, 20).rotation.z = Math.PI / 2;
      return true;
    case "console_switch":
      box(g, M.dark, w * 0.75, h * 0.65, d, 0, 0, 0);
      box(g, M.dark, w * 0.72, h * 0.62, 0.014, 0, h * 0.35, d / 2 + 0.008);
      box(g, M.screen, w * 0.55, h * 0.5, 0.004, 0, h * 0.4, d / 2 + 0.016);
      box(g, x.teal, w * 0.09, h * 0.62, 0.014, -w * 0.41, h * 0.35, d / 2 + 0.008);
      box(g, x.red, w * 0.09, h * 0.62, 0.014, w * 0.41, h * 0.35, d / 2 + 0.008);
      return true;
    case "steam_deck":
      box(g, M.dark, w, h * 0.5, d, 0, 0, 0);
      box(g, M.screen, w * 0.55, 0.004, d * 0.75, 0, h * 0.5, 0);
      return true;
    case "gamepad": {
      const body = ball(g, M.dark, 0.05, 0, 0.025, 0);
      body.scale.set(1.5, 0.5, 1);
      for (const sx of [-1, 1]) {
        const grip = ball(g, M.dark, 0.03, sx * 0.055, 0.02, 0.03);
        grip.scale.set(1, 0.8, 1.3);
      }
      bulbs.push(box(g, M.bulb, 0.03, 0.004, 0.008, 0, 0.045, -0.02));
      return true;
    }
    case "vr_headset":
      box(g, M.white, w, h * 0.7, d * 0.5, 0, 0.02, 0.03);
      {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(w * 0.42, 0.01, 6, 24, Math.PI), M.dark);
        strap.rotation.x = Math.PI / 2;
        strap.position.set(0, h * 0.4, -0.02);
        g.add(strap);
      }
      return true;
    case "racing_cockpit": {
      // Rahmen, Sitz hinten, Lenkrad und Pedale vorn
      box(g, M.dark, 0.05, 0.05, d, -w / 2 + 0.06, 0, 0);
      box(g, M.dark, 0.05, 0.05, d, w / 2 - 0.06, 0, 0);
      const seat = box(g, M.dark, w * 0.85, 0.1, 0.5, 0, 0.2, -d / 2 + 0.35);
      seat.rotation.x = 0.15;
      const back = box(g, M.dark, w * 0.85, 0.75, 0.1, 0, 0.25, -d / 2 + 0.1);
      back.rotation.x = -0.45;
      box(g, x.red, w * 0.6, 0.6, 0.012, 0, 0.3, -d / 2 + 0.16).rotation.x = -0.45;
      rod(g, M.dark, [0, 0.05, d / 2 - 0.35], [0, h * 0.75, d / 2 - 0.45], 0.03);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 8, 28), M.dark);
      wheel.position.set(0, h * 0.78, d / 2 - 0.5);
      wheel.rotation.x = -0.3;
      g.add(wheel);
      box(g, M.dark, 0.35, 0.1, 0.2, 0, 0.05, d / 2 - 0.12);
      bulbs.push(box(g, M.bulb, 0.06, 0.02, 0.01, 0, h * 0.78 + 0.02, d / 2 - 0.5));
      return true;
    }
  }
  return false;
}

/** Wallbox: Gehäuse, Statusring/-leiste (leuchtet), Ladekabel als Schlaufe darunter. */
function wallbox(type, w, d, h, M, g, bulbs) {
  if (type === "ev_car") {
    const x = X(M);
    box(g, x.car, w, h * 0.45, d * 0.96, 0, 0.18, 0);
    const cab = box(g, x.car, w * 0.88, h * 0.35, d * 0.5, 0, 0.18 + h * 0.45, -d * 0.05);
    cab.scale.z = 1;
    box(g, M.glass, w * 0.9, h * 0.3, d * 0.48, 0, 0.2 + h * 0.45, -d * 0.05);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const t = cyl(g, x.tyre, 0.33, 0.24, sx * (w / 2 - 0.12), 0.33 - 0.12, sz * (d / 2 - 0.8), 20);
      t.rotation.z = Math.PI / 2;
    }
    bulbs.push(box(g, M.bulb, w * 0.7, 0.04, 0.01, 0, 0.18 + h * 0.35, d / 2 - 0.02));
    return true;
  }
  if (!type.startsWith("wallbox")) return false;
  const x = X(M);
  const body = type === "wallbox_tesla" || type === "wallbox_easee" || type === "wallbox_zaptec" ? M.white : type === "wallbox_heidelberg" ? x.grey : M.dark;
  box(g, body, w, h, d * 0.9, 0, 0, -d * 0.05);
  if (type === "wallbox_easee" || type === "wallbox_zaptec") box(g, M.dark, w * 0.9, h * 0.9, 0.01, 0, h * 0.05, d / 2 - 0.05);
  // Statusleuchte
  if (type === "wallbox_goe" || type === "wallbox_pulsar") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, h) * 0.28, 0.008, 6, 28), M.bulb);
    ring.position.set(0, h * 0.55, d * 0.4 + 0.004);
    g.add(ring);
    bulbs.push(ring);
  } else bulbs.push(box(g, M.bulb, w * 0.5, 0.012, 0.006, 0, h * 0.7, d * 0.4 + 0.003));
  // Kabel: Schlaufe nach unten, Stecker im Halter
  const cx = type === "wallbox_heidelberg" ? 0 : w * 0.35;
  rod(g, M.dark, [0, 0.01, d * 0.2], [0, -0.35, d * 0.25], 0.012);
  rod(g, M.dark, [0, -0.35, d * 0.25], [cx, -0.25, d * 0.3], 0.012);
  rod(g, M.dark, [cx, -0.25, d * 0.3], [cx, h * 0.3, d * 0.45], 0.012);
  box(g, M.dark, 0.06, 0.1, 0.05, cx, h * 0.3, d * 0.45 + 0.02);
  return true;
}

/** Wechselrichter, Speicher, Mikrowechselrichter. */
function energy(type, w, d, h, M, g, bulbs) {
  const x = X(M);
  if (type.startsWith("inv_")) {
    const col = { inv_fronius_gen24: M.white, inv_sma_stp_se: M.white, inv_huawei_sun2000: M.white, inv_kostal_plenticore: M.white, inv_solaredge_hub: M.white, inv_victron_mp2: x.teal, inv_growatt_mod: M.white, inv_sungrow_sh: M.white, inv_goodwe_et: M.white, inv_deye_hybrid: M.white }[type] ?? M.white;
    const accent = { inv_fronius_gen24: x.red, inv_sma_stp_se: x.orange, inv_huawei_sun2000: x.red, inv_kostal_plenticore: x.red, inv_solaredge_hub: x.red, inv_victron_mp2: M.dark, inv_growatt_mod: x.orange, inv_sungrow_sh: x.orange, inv_goodwe_et: x.teal, inv_deye_hybrid: x.teal }[type] ?? x.grey;
    box(g, col, w, h, d, 0, 0, 0);
    box(g, accent, w, h * 0.08, 0.006, 0, h * 0.82, d / 2 + 0.003);
    box(g, M.screen, w * 0.25, h * 0.1, 0.005, 0, h * 0.6, d / 2 + 0.003);
    bulbs.push(box(g, M.bulb, 0.04, 0.012, 0.006, w * 0.25, h * 0.62, d / 2 + 0.004));
    for (let i = 0; i < 4; i++) cyl(g, M.dark, 0.012, 0.04, -w * 0.3 + i * w * 0.2, -0.04, 0, 8);
    return true;
  }
  if (type.startsWith("bat_")) {
    const stack = {
      bat_byd_hvs: [M.white, 4, x.red], bat_huawei_luna10: [M.white, 3, x.red], bat_huawei_luna15: [M.white, 4, x.red], bat_sma_home: [M.white, 3, x.orange],
      bat_sonnen10: [M.white, 1, x.orange], bat_tesla_pw3: [M.white, 1, M.dark], bat_e3dc: [M.white, 2, x.teal], bat_pylontech: [M.dark, 1, x.green],
      bat_zendure_sf800: [x.grey, 1, M.dark], bat_zendure_hyper: [x.grey, 3, M.dark], bat_ecoflow_stream: [x.grey, 1, M.dark], bat_ecoflow_delta: [x.grey, 1, M.dark],
      bat_marstek_venus: [M.white, 1, M.dark], bat_senec_v3: [M.white, 1, x.green], bat_growatt_noah: [M.white, 1, x.orange],
    }[type] ?? [M.white, 1, x.grey];
    const [mat, n, accent] = stack;
    const gap = 0.006;
    for (let i = 0; i < n; i++) {
      const mh = (h - gap * (n - 1)) / n;
      box(g, mat, w, mh, d, 0, i * (mh + gap), 0);
    }
    box(g, accent, w * 0.6, 0.012, 0.004, 0, h - 0.06, d / 2 + 0.002);
    // Ladestandsanzeige (leuchtet, wenn verknüpft)
    for (let i = 0; i < 4; i++) bulbs.push(box(g, M.bulb, w * 0.06, 0.012, 0.004, -w * 0.12 + i * w * 0.08, h * 0.5, d / 2 + 0.003));
    if (type === "bat_pylontech") for (const sx of [-1, 1]) box(g, M.metal, 0.02, h, 0.02, sx * (w / 2 + 0.01), 0, d / 2 - 0.02);
    return true;
  }
  if (type.startsWith("micro_")) {
    box(g, type === "micro_ecoflow" ? x.grey : M.dark, w, h, d, 0, 0, 0);
    for (let i = 0; i < 6; i++) box(g, M.dark, w * 0.9, 0.006, d * 0.4, 0, h * (0.15 + i * 0.13), d / 2);
    bulbs.push(box(g, M.bulb, 0.012, 0.012, 0.004, w * 0.4, h * 0.85, d / 2 + 0.002));
    rod(g, M.dark, [-w * 0.3, 0, 0], [-w * 0.3, -0.25, 0.02], 0.006);
    rod(g, M.dark, [w * 0.3, 0, 0], [w * 0.3, -0.25, 0.02], 0.006);
    return true;
  }
  return false;
}

/** Solar-Aufständerungen: Module in Reihen mit Gestell. */
function solar(type, w, d, h, M, g) {
  if (!type.startsWith("pv_")) return false;
  const x = X(M);
  const { across, rows } = pvModules(type, w, d);
  const pw = w / across;
  const deg = (v) => THREE.MathUtils.degToRad(v);
  if (type === "pv_balcony") {
    // senkrecht am Geländer, Module quer
    for (let i = 0; i < across; i++) {
      const p = panel(g, M, -w / 2 + pw * (i + 0.5), h / 2, 0, pw - 0.02, h, deg(90), 1);
      p.rotation.x = 0;
      p.rotation.set(Math.PI / 2, 0, 0);
    }
    box(g, x.alu, w, 0.03, 0.03, 0, h * 0.95, -0.04);
    box(g, x.alu, w, 0.03, 0.03, 0, h * 0.05, -0.04);
    return true;
  }
  if (type === "pv_facade") {
    const p = panel(g, M, 0, h / 2, 0, w - 0.02, h, 0);
    p.rotation.set(Math.PI / 2, 0, 0);
    box(g, x.alu, w * 0.9, 0.03, 0.03, 0, h * 0.2, -d / 2);
    box(g, x.alu, w * 0.9, 0.03, 0.03, 0, h * 0.8, -d / 2);
    return true;
  }
  if (type === "pv_carport" || type === "pv_pergola") {
    const roofY = h;
    const tilt = deg(type === "pv_carport" ? 6 : 8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, type === "pv_pergola" ? M.dark : x.oak, 0.12, roofY - Math.max(0, sz) * Math.tan(tilt) * d, 0.12, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08));
    for (const sz of [-1, 1]) box(g, x.alu, w, 0.1, 0.08, 0, roofY - 0.12 - (sz > 0 ? Math.tan(tilt) * d : 0), sz * (d / 2 - 0.08));
    const pl = d / rows;
    for (let r = 0; r < rows; r++) for (let i = 0; i < across; i++) {
      const z = -d / 2 + pl * (r + 0.5);
      panel(g, M, -w / 2 + pw * (i + 0.5), roofY - (z + d / 2) * Math.tan(tilt), z, pw - 0.02, pl / Math.cos(tilt) - 0.02, tilt, -1);
    }
    return true;
  }
  // Ständer mit geneigten Modulen
  const tiltDeg = { pv_flat_south: 15, pv_flat_ew: 10, pv_ground: 30, pv_balcony_tilt: 30 }[type] ?? 20;
  const tilt = deg(tiltDeg);
  if (type === "pv_flat_ew") {
    // Zelt: je Paar ein Modul nach Ost (−z) und West (+z)
    const pairs = rows / 2;
    const pd = d / pairs;
    const pl = pd / 2 / Math.cos(tilt);
    for (let r = 0; r < pairs; r++) {
      const zc = -d / 2 + pd * (r + 0.5);
      for (let i = 0; i < across; i++) {
        const px = -w / 2 + pw * (i + 0.5);
        const ridge = 0.08 + Math.sin(tilt) * pl;
        panel(g, M, px, 0.08 + ridge / 2 - 0.04, zc - pd / 4, pw - 0.02, pl, tilt, 1);
        panel(g, M, px, 0.08 + ridge / 2 - 0.04, zc + pd / 4, pw - 0.02, pl, tilt, -1);
      }
      box(g, x.alu, w, 0.04, 0.04, 0, 0, zc - pd / 2 + 0.05);
      box(g, x.alu, w, 0.04, 0.04, 0, 0, zc + pd / 2 - 0.05);
    }
    return true;
  }
  const pl = d / Math.cos(tilt);
  const lowY = type === "pv_ground" ? 0.5 : type === "pv_balcony_tilt" ? 0.05 : 0.08;
  const highY = lowY + Math.sin(tilt) * pl;
  for (let i = 0; i < across; i++) panel(g, M, -w / 2 + pw * (i + 0.5), (lowY + highY) / 2, 0, pw - 0.02, pl, tilt, -1);
  // Stützen: vorn kurz, hinten lang (hoch zur Nordseite −z)
  for (let i = 0; i <= across; i++) {
    const px = -w / 2 + 0.05 + (i * (w - 0.1)) / across;
    box(g, x.alu, 0.04, lowY, 0.04, px, 0, d / 2 - 0.05);
    box(g, x.alu, 0.04, highY - 0.02, 0.04, px, 0, -d / 2 + 0.05);
    if (type !== "pv_balcony_tilt") box(g, x.alu, 0.04, 0.04, d, px, 0, 0);
  }
  if (type === "pv_flat_south") for (const sz of [-1, 1]) box(g, M.stone ?? x.grey, w, 0.06, 0.2, 0, 0, sz * (d / 2 - 0.1)); // Ballast
  return true;
}

/** Baut einen Typ aus dem erweiterten Katalog; false, wenn der Typ nicht dazugehört. */
export function buildExtra(type, w, d, h, M, g, bulbs) {
  return ikea(type, w, d, h, M, g) || lamps(type, w, d, h, M, g, bulbs) || leds(type, w, d, h, M, g, bulbs) || gaming(type, w, d, h, M, g, bulbs) || wallbox(type, w, d, h, M, g, bulbs) || energy(type, w, d, h, M, g, bulbs) || solar(type, w, d, h, M, g);
}
