// Möbel und Geräte als einfache 3D-Modelle aus Grundkörpern.
// Typen und Maße wie bei NeonPlan (furniture[]: type, x, z, rotation in Grad, w, d, h, mount_y).
// Jedes Modell wird in einem Einheitsrahmen gebaut: Breite w entlang x, Tiefe d entlang z,
// Höhe h nach oben, Mittelpunkt der Grundfläche im Ursprung, Vorderseite zeigt nach +z.

import * as THREE from "./vendor/three.module.min.js";

/** Deutsche Namen und Standardmaße (w, d, h in m) für den Editor. */
export const FURNITURE = {
  sofa: ["Sofa", 2.1, 0.9, 0.85],
  armchair: ["Sessel", 0.85, 0.85, 0.85],
  stool: ["Hocker", 0.4, 0.4, 0.45],
  coffee_table: ["Couchtisch", 1.1, 0.6, 0.42],
  tv_board: ["TV-Board", 1.8, 0.42, 0.5],
  tv_wall: ["Fernseher", 1.25, 0.08, 0.75],
  sideboard: ["Sideboard", 1.6, 0.45, 0.8],
  shelf: ["Regal", 0.9, 0.35, 1.9],
  plant: ["Pflanze", 0.45, 0.45, 1.2],
  rug: ["Teppich", 2.0, 1.4, 0.02],
  table: ["Esstisch", 1.6, 0.9, 0.75],
  table_round: ["Runder Tisch", 1.1, 1.1, 0.75],
  chair: ["Stuhl", 0.45, 0.5, 0.9],
  bench: ["Bank", 1.4, 0.4, 0.45],
  corner_bench: ["Eckbank", 1.8, 1.4, 0.9],
  bar_stool: ["Barhocker", 0.4, 0.4, 0.75],
  kitchen: ["Küchenzeile", 2.4, 0.6, 0.9],
  kitchen_wall: ["Hängeschrank", 2.4, 0.35, 0.7],
  kitchen_tall: ["Hochschrank", 0.6, 0.6, 2.1],
  island: ["Kochinsel", 1.8, 0.9, 0.9],
  sink: ["Spüle", 0.8, 0.6, 0.9],
  stove: ["Herd", 0.6, 0.6, 0.9],
  dishwasher: ["Spülmaschine", 0.6, 0.6, 0.85],
  fridge: ["Kühlschrank", 0.6, 0.65, 1.8],
  fridge_smart: ["Kühlschrank (Side-by-Side)", 0.9, 0.7, 1.8],
  bed: ["Bett", 1.8, 2.1, 0.5],
  bunk_bed: ["Etagenbett", 1.0, 2.1, 1.6],
  nightstand: ["Nachttisch", 0.45, 0.4, 0.5],
  wardrobe: ["Kleiderschrank", 2.0, 0.6, 2.2],
  dresser: ["Kommode", 1.2, 0.5, 0.85],
  bathtub: ["Badewanne", 1.7, 0.75, 0.6],
  shower: ["Dusche", 0.9, 0.9, 2.0],
  wc: ["WC", 0.4, 0.65, 0.8],
  washbasin: ["Waschbecken", 0.6, 0.45, 0.85],
  washer: ["Waschmaschine", 0.6, 0.6, 0.85],
  dryer: ["Trockner", 0.6, 0.6, 0.85],
  desk: ["Schreibtisch", 1.4, 0.7, 0.75],
  office_chair: ["Bürostuhl", 0.6, 0.6, 1.1],
  tall_cabinet: ["Hochschrank", 0.8, 0.45, 2.0],
  coat_rack: ["Garderobe", 0.9, 0.35, 1.8],
  radiator: ["Heizkörper", 1.0, 0.1, 0.6],
  stairs: ["Treppe", 1.0, 3.0, 2.6],
  stairwell: ["Treppenloch", 1.0, 3.0, 0.02],
  robot_vacuum: ["Saugroboter", 0.35, 0.35, 0.1],
  parking: ["Stellplatz", 2.5, 5.0, 0.02],
  lamp_ceiling: ["Deckenleuchte", 0.4, 0.4, 0.12],
  lamp_downlight: ["Einbauspot", 0.1, 0.1, 0.03],
  lamp_spot: ["Spot", 0.12, 0.12, 0.15],
  lamp_panel: ["LED-Panel", 0.6, 0.6, 0.04],
  lamp_pendant: ["Pendelleuchte", 0.4, 0.4, 0.6],
  lamp_floor: ["Stehlampe", 0.35, 0.35, 1.6],
  lamp_table: ["Tischlampe", 0.25, 0.25, 0.45],
  lamp_wall: ["Wandleuchte", 0.25, 0.12, 0.25],
  led_strip: ["LED-Streifen", 2.0, 0.02, 0.02],
  lamp_uplight: ["Deckenfluter", 0.35, 0.35, 1.8],
  lamp_bollard: ["Pollerleuchte", 0.15, 0.15, 0.7],
  lamp_garden: ["Gartenleuchte", 0.2, 0.2, 0.5],
};

/** Farben je Stil; im Cyberpunk-Stil dunkel mit Neon-Kanten. */
export function furnitureMaterials(style) {
  const cyber = style === "cyber";
  const m = (color, extra = {}) =>
    new THREE.MeshStandardMaterial(cyber ? { color: 0x150a2c, emissive: color, emissiveIntensity: 0.18, roughness: 0.7, ...extra } : { color, roughness: 0.75, ...extra });
  return {
    wood: m(0x9c6b3e),
    light: m(0xe8e2d6),
    fabric: m(0x5f7a8a),
    dark: m(0x2e2e33),
    metal: m(0xb8bcc2, { metalness: cyber ? 0.2 : 0.6, roughness: 0.35 }),
    white: m(0xf5f5f5),
    ceramic: m(0xffffff, { roughness: 0.2 }),
    green: m(0x3f8f4a),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd3f0, transparent: true, opacity: 0.3, depthWrite: false }),
    screen: m(0x111111, { emissive: cyber ? 0x2962ff : 0x000000, emissiveIntensity: cyber ? 0.6 : 0 }),
    bulb: new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0x000000 }),
    bulbOn: new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffc94d, emissiveIntensity: 1.6 }),
    edge: cyber ? new THREE.LineBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.8 }) : null,
  };
}

function box(g, mat, w, h, d, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.005), Math.max(h, 0.005), Math.max(d, 0.005)), mat);
  mesh.position.set(x, y + h / 2, z);
  g.add(mesh);
  return mesh;
}

function cyl(g, mat, r, h, x = 0, y = 0, z = 0, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(h, 0.005), seg), mat);
  mesh.position.set(x, y + h / 2, z);
  g.add(mesh);
  return mesh;
}

const legs = (g, mat, w, d, h, t = 0.04) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, mat, t, h, t, sx * (w / 2 - t), 0, sz * (d / 2 - t));
};

/** Baut das Modell im Einheitsrahmen. Lampen bekommen userData.bulbs (Meshes, die leuchten). */
function buildModel(type, w, d, h, M) {
  const g = new THREE.Group();
  const bulbs = [];
  switch (type) {
    case "sofa":
      box(g, M.fabric, w, h * 0.45, d, 0, 0, 0);
      box(g, M.fabric, w, h * 0.55, d * 0.25, 0, h * 0.45, -d * 0.375);
      box(g, M.fabric, w * 0.08, h * 0.25, d * 0.75, -w * 0.46, h * 0.45, d * 0.125);
      box(g, M.fabric, w * 0.08, h * 0.25, d * 0.75, w * 0.46, h * 0.45, d * 0.125);
      break;
    case "armchair":
      box(g, M.fabric, w, h * 0.45, d);
      box(g, M.fabric, w, h * 0.55, d * 0.25, 0, h * 0.45, -d * 0.375);
      box(g, M.fabric, w * 0.15, h * 0.25, d * 0.75, -w * 0.425, h * 0.45, d * 0.125);
      box(g, M.fabric, w * 0.15, h * 0.25, d * 0.75, w * 0.425, h * 0.45, d * 0.125);
      break;
    case "chair":
    case "office_chair":
    case "bar_stool":
    case "stool": {
      const seat = type === "chair" || type === "office_chair" ? h * 0.5 : h * 0.92;
      if (type === "office_chair") {
        cyl(g, M.dark, w * 0.4, 0.05, 0, 0, 0);
        cyl(g, M.metal, 0.03, seat - 0.05, 0, 0.05, 0);
      } else legs(g, type === "bar_stool" ? M.metal : M.wood, w, d, seat - 0.04, 0.03);
      box(g, type === "office_chair" ? M.dark : M.wood, w, 0.05, d, 0, seat - 0.05, 0);
      if (type === "chair" || type === "office_chair") box(g, type === "office_chair" ? M.dark : M.wood, w, h - seat, 0.04, 0, seat, -d / 2 + 0.02);
      break;
    }
    case "coffee_table":
    case "table":
    case "desk":
      box(g, M.wood, w, 0.04, d, 0, h - 0.04, 0);
      legs(g, type === "desk" ? M.metal : M.wood, w, d, h - 0.04);
      break;
    case "table_round":
      cyl(g, M.wood, Math.min(w, d) / 2, 0.04, 0, h - 0.04, 0, 32);
      cyl(g, M.wood, 0.05, h - 0.04, 0, 0, 0);
      cyl(g, M.wood, Math.min(w, d) / 4, 0.03, 0, 0, 0);
      break;
    case "bench":
      box(g, M.wood, w, 0.05, d, 0, h - 0.05, 0);
      legs(g, M.wood, w, d, h - 0.05);
      break;
    case "corner_bench":
      box(g, M.fabric, w, h * 0.5, 0.5, 0, 0, -d / 2 + 0.25);
      box(g, M.fabric, 0.5, h * 0.5, d - 0.5, -w / 2 + 0.25, 0, 0.25);
      box(g, M.fabric, w, h * 0.5, 0.1, 0, h * 0.5, -d / 2 + 0.05);
      box(g, M.fabric, 0.1, h * 0.5, d - 0.1, -w / 2 + 0.05, h * 0.5, 0.05);
      break;
    case "tv_board":
    case "sideboard":
    case "dresser":
    case "nightstand":
      box(g, type === "tv_board" ? M.dark : M.wood, w, h, d);
      box(g, M.light, w * 0.96, 0.01, 0.005, 0, h * 0.5, d / 2 + 0.003);
      break;
    case "tv_wall":
      box(g, M.dark, w, h, d * 0.5);
      box(g, M.screen, w * 0.96, h * 0.92, 0.005, 0, h * 0.04, d * 0.25 + 0.003);
      break;
    case "shelf":
    case "coat_rack":
      box(g, M.wood, 0.03, h, d, -w / 2 + 0.015, 0, 0);
      box(g, M.wood, 0.03, h, d, w / 2 - 0.015, 0, 0);
      for (let i = 0; i <= 4; i++) box(g, M.wood, w, 0.025, d, 0, (i * (h - 0.025)) / 4, 0);
      break;
    case "wardrobe":
    case "tall_cabinet":
    case "kitchen_tall":
      box(g, type === "kitchen_tall" ? M.white : M.light, w, h, d);
      box(g, M.dark, 0.01, h * 0.96, 0.005, 0, h * 0.02, d / 2 + 0.003);
      break;
    case "plant":
      cyl(g, M.dark, w * 0.3, h * 0.3, 0, 0, 0);
      {
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) / 2, 16, 12), M.green);
        leaves.scale.y = (h * 0.7) / Math.min(w, d);
        leaves.position.y = h * 0.3 + h * 0.35;
        g.add(leaves);
      }
      break;
    case "rug":
    case "parking":
    case "stairwell":
      box(g, type === "rug" ? M.fabric : M.dark, w, Math.max(h, 0.01), d);
      break;
    case "kitchen":
    case "island":
      box(g, M.white, w, h - 0.04, d);
      box(g, M.dark, w + 0.02, 0.04, d + 0.02, 0, h - 0.04, 0);
      break;
    case "kitchen_wall":
      box(g, M.white, w, h, d, 0, 0, 0);
      break;
    case "sink":
      box(g, M.white, w, h - 0.04, d);
      box(g, M.metal, w, 0.04, d, 0, h - 0.04, 0);
      break;
    case "stove":
      box(g, M.white, w, h - 0.03, d);
      box(g, M.dark, w, 0.03, d, 0, h - 0.03, 0);
      break;
    case "dishwasher":
    case "washer":
    case "dryer":
      box(g, M.white, w, h, d);
      if (type !== "dishwasher") {
        const door = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.02, 24), M.glass);
        door.rotation.x = Math.PI / 2;
        door.position.set(0, h * 0.55, d / 2 + 0.01);
        g.add(door);
      }
      break;
    case "fridge":
    case "fridge_smart":
      box(g, M.metal, w, h, d);
      if (type === "fridge_smart") box(g, M.dark, 0.01, h * 0.96, 0.005, 0, h * 0.02, d / 2 + 0.003);
      else box(g, M.dark, w * 0.96, 0.01, 0.005, 0, h * 0.62, d / 2 + 0.003);
      break;
    case "bed":
    case "bunk_bed": {
      const levels = type === "bunk_bed" ? [0, h * 0.6] : [0];
      for (const y0 of levels) {
        box(g, M.wood, w, 0.3, d, 0, y0, 0);
        box(g, M.white, w * 0.95, 0.15, d * 0.95, 0, y0 + 0.3, 0.02);
        box(g, M.fabric, w * 0.95, 0.04, d * 0.6, 0, y0 + 0.45, d * 0.17);
      }
      box(g, M.wood, w, type === "bunk_bed" ? h : 0.9, 0.06, 0, 0, -d / 2 + 0.03);
      break;
    }
    case "bathtub":
      box(g, M.ceramic, w, h, d);
      box(g, M.glass, w * 0.85, 0.02, d * 0.7, 0, h - 0.04, 0);
      break;
    case "shower":
      box(g, M.ceramic, w, 0.06, d);
      box(g, M.glass, w, h, 0.01, 0, 0, d / 2 - 0.005);
      box(g, M.glass, 0.01, h, d, w / 2 - 0.005, 0, 0);
      break;
    case "wc":
      box(g, M.ceramic, w * 0.8, 0.4, d * 0.65, 0, 0, d * 0.1);
      box(g, M.ceramic, w, h - 0.4, d * 0.25, 0, 0.4, -d * 0.375);
      break;
    case "washbasin":
      box(g, M.wood, w, h - 0.15, d);
      box(g, M.ceramic, w, 0.15, d, 0, h - 0.15, 0);
      break;
    case "radiator":
      for (let i = 0; i < Math.max(3, Math.round(w / 0.08)); i++) box(g, M.white, 0.05, h, d, -w / 2 + 0.025 + i * 0.08, 0.1, 0);
      break;
    case "stairs": {
      const n = Math.max(8, Math.round(h / 0.18));
      for (let i = 0; i < n; i++) box(g, M.wood, w, (h * (i + 1)) / n, d / n, 0, 0, d / 2 - (i + 0.5) * (d / n));
      break;
    }
    case "robot_vacuum":
      cyl(g, M.dark, Math.min(w, d) / 2, h, 0, 0, 0, 28);
      break;
    // Lampen: Leuchtmittel leuchtet, wenn das Licht an ist
    case "lamp_ceiling":
    case "lamp_panel":
    case "lamp_downlight": {
      const b = type === "lamp_ceiling" ? cyl(g, M.bulb, Math.min(w, d) / 2, h, 0, 0, 0, 28) : box(g, M.bulb, w, h, d);
      bulbs.push(b);
      break;
    }
    case "lamp_pendant": {
      cyl(g, M.dark, 0.006, h * 0.7, 0, h * 0.3, 0, 6);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) / 2, h * 0.3, 24, 1, true), M.dark);
      shade.position.y = h * 0.15;
      g.add(shade);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.bulb);
      b.position.y = h * 0.05;
      g.add(b);
      bulbs.push(b);
      break;
    }
    case "lamp_spot":
    case "lamp_wall": {
      box(g, M.dark, w, h, d * 0.5, 0, 0, -d * 0.25);
      bulbs.push(box(g, M.bulb, w * 0.7, h * 0.7, d * 0.5, 0, h * 0.15, d * 0.25));
      break;
    }
    case "lamp_floor":
    case "lamp_uplight":
    case "lamp_table":
    case "lamp_bollard":
    case "lamp_garden": {
      cyl(g, M.dark, Math.min(w, d) * 0.35, 0.02, 0, 0, 0);
      cyl(g, M.metal, 0.012, h * 0.8, 0, 0.02, 0, 8);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.35, Math.min(w, d) / 2, h * 0.2, 20, 1, true), M.light);
      shade.position.y = h * 0.9;
      g.add(shade);
      const b = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.22, 12, 8), M.bulb);
      b.position.y = h * 0.88;
      g.add(b);
      bulbs.push(b);
      break;
    }
    case "led_strip":
      bulbs.push(box(g, M.bulb, w, Math.max(h, 0.01), Math.max(d, 0.01)));
      break;
    default:
      box(g, M.light, w, h, d);
  }
  g.userData.bulbs = bulbs;
  return g;
}

/**
 * Ein Möbelstück aus furniture[] als Objekt in Weltkoordinaten der Etage.
 * @param {object} item {type, x, z, rotation, w, d, h, mount_y}
 * @param {number} elev Höhe des Etagenbodens
 * @param {number} floorHeight Raumhöhe (Deckenleuchten hängen unter der Decke)
 */
export function buildFurniture(item, M, elev, floorHeight) {
  const def = FURNITURE[item.type] ?? ["Möbel", 0.6, 0.6, 0.8];
  const w = item.w || def[1];
  const d = item.d || def[2];
  const h = item.h || def[3];
  const g = buildModel(item.type, w, d, h, M);
  const ceiling = ["lamp_ceiling", "lamp_panel", "lamp_downlight", "lamp_pendant", "kitchen_wall"].includes(item.type);
  const wall = ["lamp_wall", "lamp_spot", "tv_wall", "radiator"].includes(item.type);
  let y = item.mount_y ?? (ceiling ? floorHeight - h - 0.01 : wall ? (item.type === "radiator" ? 0.1 : 1.6) : 0);
  if (item.type === "kitchen_wall" && item.mount_y == null) y = 1.45;
  if (item.type === "radiator" && item.mount_y == null) y = 0;
  g.position.set(item.x, elev + y, item.z);
  g.rotation.y = -THREE.MathUtils.degToRad(item.rotation || 0);
  if (M.edge) {
    g.traverse((o) => {
      if (o.isMesh && o.material !== M.glass) o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), M.edge));
    });
  }
  g.userData.furniture = item.id;
  return g;
}

/** Gerät als 3D-Objekt (statt Symbol): Lampe, Steckdose/Schalter, Lüfter, Rollladen-Taster, Thermostat, Sensor. */
export function buildDevice(kind, stateObj, M) {
  const g = new THREE.Group();
  const bulbs = [];
  const cls = stateObj?.attributes?.device_class;
  if (kind === "light") {
    // Glühbirne mit Fassung
    cyl(g, M.dark, 0.035, 0.08, 0, 0.12, 0, 12);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), M.bulb);
    b.position.y = 0.06;
    g.add(b);
    bulbs.push(b);
  } else if (kind === "switch" && cls === "outlet") {
    // Steckdose: Platte mit zwei Löchern
    box(g, M.white, 0.12, 0.12, 0.03, 0, 0, 0);
    cyl(g, M.dark, 0.012, 0.01, -0.025, 0.06, 0.02, 8).rotation.x = Math.PI / 2;
    cyl(g, M.dark, 0.012, 0.01, 0.025, 0.06, 0.02, 8).rotation.x = Math.PI / 2;
    bulbs.push(box(g, M.bulb, 0.02, 0.02, 0.01, 0.045, 0.1, 0.02));
  } else if (kind === "switch") {
    box(g, M.white, 0.1, 0.1, 0.03);
    bulbs.push(box(g, M.bulb, 0.04, 0.05, 0.02, 0, 0.025, 0.02));
  } else if (kind === "fan") {
    cyl(g, M.dark, 0.05, 0.05, 0, 0, 0, 12);
    for (let i = 0; i < 3; i++) {
      const blade = box(g, M.light, 0.32, 0.01, 0.07, 0, 0.02, 0);
      blade.geometry.translate(0.16, 0, 0);
      blade.rotation.y = (i * Math.PI * 2) / 3;
    }
    g.userData.spin = true;
  } else if (kind === "cover") {
    box(g, M.white, 0.08, 0.14, 0.03);
    bulbs.push(box(g, M.bulb, 0.04, 0.03, 0.01, 0, 0.09, 0.02));
  } else if (kind === "climate") {
    cyl(g, M.white, 0.05, 0.07, 0, 0, 0, 20).rotation.x = Math.PI / 2;
    bulbs.push(box(g, M.bulb, 0.03, 0.03, 0.01, 0, 0.02, 0.04));
  } else {
    // Fenster-/Türkontakt
    box(g, M.white, 0.03, 0.09, 0.025);
    bulbs.push(box(g, M.bulb, 0.015, 0.015, 0.01, 0, 0.06, 0.015));
  }
  g.userData.bulbs = bulbs;
  return g;
}
