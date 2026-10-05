// 3D-Szene: baut das Haus einmal aus den Daten und ändert bei Zustandswechseln nur Materialien,
// Sichtbarkeit und Skalierung (kein Neuaufbau der Geometrie).

import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { buildDevice, buildFurniture, furnitureMaterials } from "./furniture.js";
import { angleBetween, sunLook, sunVector } from "./sun.js";
import { presetPose, roundPose } from "./camera.js";
import { roomHole, slabOpenings } from "./stairs.js";
import { colorKey } from "./light.js";
import { floorColor, textureFor } from "./model.js";
import { getTexture, planarUVs } from "./textures.js";
import { ambientInterval, lodState, resolveQuality, shouldRender } from "./perf.js";
import { ROOF_ITEMS, adjustRoofParts, findPvShed, freeEdges, panelArraySlots, panelSlots, pvLayout, roofFaces, roofFloor, roofParts, roofRooms, roofSettings, roofSurfaceAt, roomRoofGroups, scatter, seeded, panelBasis, roofObstacles, dormerShape } from "./exterior.js";
import { centroid, computeWalls, labelPoint, pieceFootprint, pointInPolygon, wallPieces } from "./walls.js";
import { SceneFx } from "./scene-fx.js";

const OUTDOOR = {
  lawn: { color: 0x6aa84f, y: -0.035, h: 0 },
  terrace: { color: 0xc2b39b, y: -0.035, h: 0.1 },
  path: { color: 0xbcb4a6, y: -0.025, h: 0 },
  driveway: { color: 0x8c8c8c, y: -0.025, h: 0 },
  pool: { color: 0xdedad2, y: -0.02, h: 0.04 },
  bed: { color: 0x6b4a2f, y: -0.035, h: 0.15 },
  hedge: { color: 0x2f6b2a, y: -0.035, h: 1.2 },
  fence: { color: 0x8a6f52, y: -0.035, h: 1.0 },
  balcony: { color: 0xb5ada3, y: 0, h: 0 },
  gravel: { color: 0xc4beb2, y: -0.03, h: 0.02 },
  paving: { color: 0xa39a8e, y: -0.03, h: 0.03 },
  rockery: { color: 0x8a8378, y: -0.035, h: 0.08 },
};

const SLAB = 0.15;
const WARM = new THREE.Color(0xffb347);
/**
 * Sammelt PV-Module (je eine Matrix) und macht daraus ein InstancedMesh: 2 statt etwa 6
 * Zeichenaufrufe je Modul. Einheitsmodul 1 × 0,04 × 1 m, die Matrix skaliert auf Breite/Länge.
 */
class PanelBatch {
  constructor(mats, data = {}) {
    this.mats = mats;
    this.data = data;
    this.list = [];
  }

  push(matrix) {
    this.list.push(matrix.clone());
  }

  mesh() {
    if (!this.list.length) return null;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.04, 1), this.mats, this.list.length);
    this.list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.computeBoundingBox();
    Object.assign(inst.userData, this.data);
    return inst;
  }
}

// Grund-Deckkraft des Licht-Glühens je Stil (nie mats.glow.opacity lesen: Blitze verändern es)
const STYLE_GLOW = { night: 0.32, cyber: 0.22, standard: 0.16 };
const ALERT = 0xe53935;

/** Plan [x, z] -> Shape in der XY-Ebene, die nach rotateX(-PI/2) wieder bei (x, 0, z) liegt. */
function shapeOf(points, holes = []) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  return shape;
}

function flatOrExtruded(points, height, holes = []) {
  const shape = shapeOf(points, holes);
  const geo = height > 0 ? new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Sammelt Prismen (Wandstücke) in einem einzigen BufferGeometry. */
class PrismBuilder {
  constructor() {
    this.buckets = new Map(); // Textur-Schlüssel ("" = glatt) -> {pos, nor, col}
  }

  quad(a, b, c, d, outward, color) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac);
    if (n.lengthSq() < 1e-12) return;
    if (n.dot(outward) < 0) {
      [b, d] = [d, b];
      n.negate();
    }
    n.normalize();
    // Farbe trägt optional ihre Textur (color.tex)
    const key = color.tex ?? "";
    if (!this.buckets.has(key)) this.buckets.set(key, { pos: [], nor: [], col: [] });
    const bk = this.buckets.get(key);
    for (const v of [a, b, c, a, c, d]) {
      bk.pos.push(v.x, v.y, v.z);
      bk.nor.push(n.x, n.y, n.z);
      bk.col.push(color.r, color.g, color.b);
    }
  }

  prism(foot, y0, y1, side, cap) {
    const bottom = foot.map(([x, z]) => new THREE.Vector3(x, y0, z));
    const top = foot.map(([x, z]) => new THREE.Vector3(x, y1, z));
    const center = new THREE.Vector3();
    for (const v of [...bottom, ...top]) center.add(v);
    center.multiplyScalar(1 / 8);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const mid = new THREE.Vector3().addVectors(bottom[i], top[j]).multiplyScalar(0.5);
      // side: eine Farbe oder je Fläche [Anfang, rechts, Ende, links] (Fußabdruck l0, r0, r1, l1)
      this.quad(bottom[i], bottom[j], top[j], top[i], mid.sub(center), Array.isArray(side) ? side[i] : side);
    }
    this.quad(top[0], top[1], top[2], top[3], new THREE.Vector3(0, 1, 0), cap);
    this.quad(bottom[0], bottom[1], bottom[2], bottom[3], new THREE.Vector3(0, -1, 0), Array.isArray(side) ? side[0] : side);
  }

  /** Je Textur ein BufferGeometry (mit UVs in Metern). */
  geometries() {
    const out = [];
    for (const [key, bk] of this.buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(bk.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(bk.nor, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(bk.col, 3));
      if (key) planarUVs(geo);
      geo.computeBoundingSphere();
      out.push({ key, geo });
    }
    return out;
  }
}

function solarTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#13294b";
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = "#5f7fb0";
  g.lineWidth = 1;
  for (let x = 0; x <= 128; x += 16) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, 64);
    g.stroke();
  }
  for (let y = 0; y <= 64; y += 16) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(128, y + 0.5);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class HouseScene {
  constructor(container, { dark = false, onCameraChange = () => {} } = {}) {
    this.container = container;
    this.onCameraChange = onCameraChange;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(10, 18, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 120;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => this._cameraMoved());

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(12, 30, 8);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this._sunCenter = new THREE.Vector3();
    this._sunR = 40;
    this._sunDir = null; // Richtung zur echten Sonne (setSun) oder null = feste Lampe
    this._lightCache = new Map(); // Lampen- und Fensterfarben (je Farbe ein Material)

    this.style = "standard";
    this.layers = {};
    this.lampBulbs = new Map(); // entity_id -> Leuchtmittel (Möbel-Lampen und 3D-Geräte)
    this.heatParts = []; // Heizkörper-Rippen (glühen beim Heizen)
    this.devicesGroup = new THREE.Group();
    this.selected = null;
    this._makeMats();

    this.root = new THREE.Group();
    this.scene.add(this.root, this.devicesGroup);
    this.floors = new Map(); // floorId -> {group, rooms: Map, openings: Map, floor}
    this.anchors = []; // Overlay-Anker {key, floorId, position: Vector3}
    this.raycaster = new THREE.Raycaster();
    this.flow = null;
    this.filter = "all";
    this._dirty = true;
    this._camDirty = true;
    this._clock = new THREE.Clock();
    this._running = false;
    this.quality = resolveQuality("schoen");
    this.stats = { renders: 0, frameMs: [] }; // für Tests und die Leistungsanzeige
    this._frozen = false;
    this.setTheme(dark);

    this._resize = new ResizeObserver(() => this.resize());
    this._resize.observe(container);
    this.resize();
  }

  setTheme(dark) {
    this.dark = dark;
    this._applyBackground();
    this.invalidate();
  }

  /** Darstellungsstil: "standard" oder "cyber" (Cyberpunk/Neon). Baut Materialien und Szene neu. */
  setStyle(style) {
    // "day" (Standard), "night", "cyber"; alte Einstellung "standard" = Tag
    const next = style === "cyber" ? "cyber" : style === "night" ? "night" : "standard";
    if (next === this.style) return;
    this.style = next;
    this._disposeMats();
    this._makeMats();
    this._applyBackground();
    if (this.building) this.setBuilding(this.building, { keepCamera: true });
  }

  _applyBackground() {
    const cyber = this.style === "cyber";
    const night = this.style === "night";
    this.scene.background = new THREE.Color(cyber ? 0x07030f : night ? 0x0a1022 : this.dark ? 0x1b1f24 : 0xe9eef2);
    this.hemi.color.set(cyber ? 0x8f7dff : night ? 0x5b6cff : 0xffffff);
    this.hemi.groundColor.set(cyber ? 0x1a0630 : night ? 0x0b0d1a : 0x8a7f70);
    this.hemi.intensity = cyber ? 1.3 : night ? 0.55 : this.dark ? 1.1 : 1.6;
    // Nacht: schwaches, bläuliches Mondlicht
    this.sun.color.set(night ? 0x9fb3ff : 0xffffff);
    this.sun.intensity = cyber ? 0.7 : night ? 0.35 : this.dark ? 1.1 : 1.6;
    // echte Sonne: nur im Tag-Stil Farbe und Stärke nach der Sonnenhöhe (Nacht/Cyber wie bisher)
    if (this.style === "standard" && this._sunLook) {
      this.sun.color.setHex(this._sunLook.colorHex);
      this.sun.intensity *= this._sunLook.intensityFactor;
      this.hemi.intensity *= this._sunLook.hemiFactor;
    }
    if (this.mats?.glow) this.mats.glow.opacity = STYLE_GLOW[this.style] ?? 0.16;
  }

  /**
   * Licht aus Richtung der echten Sonne. pos: {azimuth, elevation} (Grad) oder null = feste Lampe.
   * Kostet nichts pro Bild: nur Lichtwerte, neu gezeichnet erst ab 0,3° Änderung.
   */
  setSun(pos, north = 0) {
    const dir = pos && Number.isFinite(pos.azimuth) && Number.isFinite(pos.elevation) ? sunVector(pos.azimuth, pos.elevation, north) : null;
    const look = dir ? sunLook(pos.elevation) : null;
    const up = !!look;
    if (dir && this._sunDir && angleBetween(dir, this._sunDir) < 0.3 && up === !!this._sunLook) return false;
    if (!dir && !this._sunDir) return false;
    this._sunDir = up ? dir : null;
    this._sunLook = look;
    this._sunPos = up ? { azimuth: pos.azimuth, elevation: pos.elevation } : null;
    this._placeSun();
    this._applyBackground();
    this.invalidate();
    return true;
  }

  _placeSun() {
    if (this._sunDir) {
      const [x, y, z] = this._sunDir;
      this.sun.position.copy(this._sunCenter).add(new THREE.Vector3(x, y, z).multiplyScalar(this._sunR));
    } else this.sun.position.copy(this._sunCenter).add(new THREE.Vector3(12, 30, 8));
    this.sun.target.position.copy(this._sunCenter);
    this.sun.target.updateMatrixWorld();
  }

  /** Material in einer Lichtfarbe (Lampe an, beleuchtetes Fenster), höchstens 32 Stück. */
  _lightMat(kind, color, make) {
    const key = `${kind}:${colorKey(color)}`;
    let m = this._lightCache.get(key);
    if (!m) {
      if (this._lightCache.size >= 32) return null;
      m = make();
      this._lightCache.set(key, m);
    }
    return m;
  }

  _clearLightCache() {
    for (const m of this._lightCache.values()) m.dispose();
    this._lightCache.clear();
  }

  _makeMats() {
    const cyber = this.style === "cyber";
    this.furnMats = furnitureMaterials(this.style);
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mats = cyber
      ? {
          wall: std({ vertexColors: true, roughness: 0.6, transparent: true, opacity: 0.62, emissive: 0x0a0320 }),
          glass: std({ color: 0x00e5ff, emissive: 0x00b8d4, emissiveIntensity: 0.9, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
          glassAlert: std({ color: ALERT, emissive: 0xff1744, emissiveIntensity: 1, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
          frame: std({ color: 0x1b0f33, emissive: 0x00e5ff, emissiveIntensity: 0.7 }),
          frameAlert: std({ color: 0xff1744, emissive: 0xff1744, emissiveIntensity: 1.2 }),
          frameOk: std({ color: 0x00e676, emissive: 0x00e676, emissiveIntensity: 0.6 }),
          frameWarn: std({ color: 0xffab00, emissive: 0xffab00, emissiveIntensity: 0.9 }),
          door: std({ color: 0x24123f, emissive: 0xff2bd6, emissiveIntensity: 0.35 }),
          frontDoor: std({ color: 0x24123f, emissive: 0xff2bd6, emissiveIntensity: 0.6 }),
          garage: std({ color: 0x1b0f33, emissive: 0x7c4dff, emissiveIntensity: 0.45 }),
          blind: std({ color: 0x2a1450, emissive: 0x7c4dff, emissiveIntensity: 0.3 }),
          glow: new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
          water: std({ color: 0x00e5ff, transparent: true, opacity: 0.8, emissive: 0x00e5ff, emissiveIntensity: 0.8 }),
          solar: std({ map: solarTexture(), roughness: 0.3, metalness: 0.4, emissive: 0x2962ff, emissiveIntensity: 0.25 }),
          solarFrame: std({ color: 0x1b0f33, emissive: 0x00e5ff, emissiveIntensity: 0.4 }),
          flowLine: new THREE.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0.5 }),
          flowDot: new THREE.MeshBasicMaterial({ color: 0xfff176 }),
          edge: new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.95 }),
          outline: new THREE.LineBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.9 }),
          gardenLine: new THREE.LineBasicMaterial({ color: 0x1de9b6, transparent: true, opacity: 0.5 }),
          roof: std({ color: 0x1b0f33, emissive: 0x7c4dff, emissiveIntensity: 0.25, roughness: 0.8, side: THREE.DoubleSide }),
          roofEdge: new THREE.LineBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.9 }),
          gable: std({ color: 0x1d0f3a, emissive: 0x0a0320, side: THREE.DoubleSide }),
          railing: std({ color: 0x1b0f33, emissive: 0x00e5ff, emissiveIntensity: 0.6 }),
          railGlass: std({ color: 0x00e5ff, emissive: 0x00b8d4, emissiveIntensity: 0.5, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
          railWood: std({ color: 0x24123f, emissive: 0xff2bd6, emissiveIntensity: 0.3 }),
          balcony: std({ color: 0x2a1450, emissive: 0x2a1450, emissiveIntensity: 0.4 }),
          flowers: [0xff2bd6, 0x00e5ff, 0xffd000, 0x7c4dff].map((c) => std({ color: c, emissive: c, emissiveIntensity: 0.8 })),
          rain: new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.55 }),
          snow: new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }),
        }
      : {
          wall: std({ vertexColors: true, roughness: 0.9 }),
          glass: std({ color: 0x9fd3f0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
          glassAlert: std({ color: ALERT, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
          frame: std({ color: 0xfafafa, roughness: 0.6 }),
          frameAlert: std({ color: ALERT, emissive: ALERT, emissiveIntensity: 0.5 }),
          // Sicherheitsansicht: zu = grün, gekippt = orange
          frameOk: std({ color: 0x43a047, emissive: 0x2e7d32, emissiveIntensity: 0.35 }),
          frameWarn: std({ color: 0xffa000, emissive: 0xff8f00, emissiveIntensity: 0.5 }),
          door: std({ color: 0x8d6e63, roughness: 0.7 }),
          frontDoor: std({ color: 0x455a64, roughness: 0.6 }),
          garage: std({ color: 0xd5d5d5, roughness: 0.5, metalness: 0.2 }),
          blind: std({ color: 0x7b7b7b, roughness: 0.8 }),
          glow: new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
          water: std({ color: 0x2f9fe0, transparent: true, opacity: 0.85, roughness: 0.1, emissive: 0x0b4f7a, emissiveIntensity: 0.4 }),
          solar: std({ map: solarTexture(), roughness: 0.3, metalness: 0.4 }),
          solarFrame: std({ color: 0xb0b6bd, metalness: 0.6, roughness: 0.4 }),
          flowLine: new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.35 }),
          flowDot: new THREE.MeshBasicMaterial({ color: 0xffd54f }),
          roof: std({ color: 0x9a4a36, roughness: 0.85, side: THREE.DoubleSide }),
          gable: std({ color: this.dark ? 0xc9c3b8 : 0xf3efe7, roughness: 0.9, side: THREE.DoubleSide }),
          railing: std({ color: 0x5f6368, roughness: 0.5, metalness: 0.5 }),
          railGlass: std({ color: 0xbfe3f5, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
          railWood: std({ color: 0x8a6440, roughness: 0.85 }),
          balcony: std({ color: 0xb5ada3, roughness: 0.9 }),
          flowers: [0xe0457b, 0xf2c84b, 0x8e6ae0, 0xffffff, 0xf07c3a].map((c) => std({ color: c, roughness: 0.7 })),
          rain: new THREE.LineBasicMaterial({ color: this.style === "night" ? 0x8fa6d8 : 0x7f97ad, transparent: true, opacity: 0.5 }),
          snow: new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.95, depthWrite: false }),
        };
    const garden = cyber
      ? { lawn: 0x062a24, terrace: 0x2a1450, path: 0x1a1030, driveway: 0x140c26, pool: 0x1b0f33, bed: 0x3a0f3a, hedge: 0x0b4f3f, fence: 0x4a148c, balcony: 0x2a1450, gravel: 0x2a2440, paving: 0x221a3a, rockery: 0x2a1f3f }
      : Object.fromEntries(Object.entries(OUTDOOR).map(([k, v]) => [k, v.color]));
    this.outdoorMats = Object.fromEntries(
      Object.keys(OUTDOOR).map((k) => [k, std(cyber ? { color: garden[k], emissive: garden[k], emissiveIntensity: 0.35, roughness: 1 } : { color: garden[k], roughness: 1 })]),
    );
    this.texMats = new Map(); // Materialien mit Textur, je Grundmaterial und Schlüssel
  }

  /**
   * Material mit Textur (Kopie von base, je Art, Textur und Farbe einmal). Ohne Textur base selbst;
   * own = base ist eine Wegwerf-Kopie (eigene Farbe): sie wird entsorgt, die geteilte Kopie bleibt.
   */
  _texMat(base, key, tag, own = false) {
    if (this.style === "cyber") key = null;
    if (!key && !own) return base;
    const k = `${tag}:${key ?? ""}:${base.color.getHexString()}`;
    let m = this.texMats.get(k);
    if (!m) {
      m = base.clone();
      m.map = key ? getTexture(key, this.renderer) : null;
      m.needsUpdate = true;
      this.texMats.set(k, m);
    }
    if (own && m !== base) base.dispose();
    return m;
  }

  _disposeMats() {
    this._clearLightCache();
    // Texturen sind geteilt (textures.js) und werden nicht entsorgt
    for (const m of this.texMats?.values() ?? []) m.dispose();
    for (const m of [...Object.values(this.mats ?? {}).flat(), ...Object.values(this.outdoorMats ?? {}), ...Object.values(this.furnMats ?? {}).flat()]) {
      if (!m) continue;
      if (m !== this.mats?.solar) m.map = null;
      else m.map?.dispose();
      m.dispose();
    }
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // setSize leert die Zeichenfläche: sofort neu zeichnen, sonst flackert es bis zum nächsten Frame
    if (this._running) {
      this.renderer.render(this.scene, this.camera);
      this._dirty = false;
    }
    this._cameraMoved();
  }

  // ------------------------------------------------------------------ Aufbau

  setBuilding(building, { keepCamera = false } = {}) {
    for (const child of [...this.root.children]) this._dispose(child);
    this._clearLightCache();
    this.root.clear();
    this.floors.clear();
    this.anchors = [];
    this.flow = null;
    this._houseFlow = null; // hing an root, ist mit weg
    this.building = building;
    this.warnings = [];
    this.lampBulbs.clear();
    this.heatParts = [];
    this.pvFields = new Map(); // PV-Feld-ID → {mesh, solar, …} (Dach-Ebene)
    // Deckenöffnungen (Treppen von unten, Treppenlöcher) einmal je Etage
    this._slabHoles = new Map((building.floors ?? []).map((f) => [f.id, slabOpenings(building, f.id)]));
    for (const floor of building.floors ?? []) this._buildFloor(floor, building.settings ?? {}, footing(building.floors, floor));
    this._buildRoof(building);
    this._buildEnergy(building);
    if (this._weather) this.setWeather(this._weather, { force: true });
    {
      // Raster im Hintergrund (alle Stile, Ebene „grid“)
      const lowest = Math.min(0, ...(building.floors ?? []).map((f) => f.elevation ?? 0));
      const dark = this.style === "night" || this.dark;
      const [c1, c2, op] = this.style === "cyber" ? [0xff2bd6, 0x2a1450, 0.55] : dark ? [0x3d4f7a, 0x1d2740, 0.7] : [0x9aa6b2, 0xc9d1d9, 0.6];
      const grid = new THREE.GridHelper(120, 120, c1, c2);
      grid.position.y = lowest - 0.08;
      grid.material.transparent = true;
      grid.material.opacity = op;
      grid.userData.layer = "grid";
      this.root.add(grid);
    }
    this._contactShadows();
    this.setFilter(this.filter, { fit: !keepCamera });
    if (this._deviceList) this.setDevices(this._deviceList);
    this.applyLayers();
    // Mitte und Abstand der Sonne aus dem Haus (ohne Garten)
    const box = new THREE.Box3();
    for (const entry of this.floors.values()) for (const m of entry.occluders) box.expandByObject(m);
    if (!box.isEmpty()) {
      box.getCenter(this._sunCenter);
      this._sunR = Math.max(30, box.getSize(new THREE.Vector3()).length() * 2);
    }
    this._placeSun();
    this._applyShadows();
    // Jahreszeit auf neue Materialien (Texturen) erneut anwenden
    const season = this._season;
    this._season = null;
    if (season) this.setSeason(season);
  }

  // ------------------------------------------------------------------ Ebenen, Geräte, Auswahl

  /** Sichtbarkeit je Ebene: walls, openings, floors, furniture, garden, solar, flow, devices. */
  setLayers(layers) {
    this.layers = { ...layers };
    this.applyLayers();
  }

  applyLayers() {
    const on = (name) => this.layers[name] !== false;
    for (const obj of [this.root, this.devicesGroup]) {
      obj.traverse((o) => {
        if (o.userData.layer) o.visible = on(o.userData.layer);
      });
    }
    this.devicesGroup.visible = on("devices") && this._deviceList?.length > 0;
    this._syncGarden();
    if (this.weather) this.weather.obj.visible = on("weather");
    this._applyShadows();
    this._lodCheck(true);
    this._cameraMoved();
  }

  /**
   * Geräte als 3D-Objekte. list: [{entity_id, kind, stateObj, floorId, x, y, z}] (y = Höhe über Boden).
   * Leere Liste = keine 3D-Geräte (Symbol-Modus).
   */
  setDevices(list) {
    this._deviceList = list;
    for (const child of [...this.devicesGroup.children]) this._dispose(child);
    this.devicesGroup.clear();
    for (const [id, arr] of this.lampBulbs) {
      const kept = arr.filter((b) => !b.userData.device);
      if (kept.length) this.lampBulbs.set(id, kept);
      else this.lampBulbs.delete(id);
    }
    for (const d of list) {
      const entry = this.floors.get(d.floorId);
      if (!entry) continue;
      const g = buildDevice(d.kind, d.stateObj, this.furnMats);
      g.position.set(d.x, (entry.floor.elevation ?? 0) + d.y, d.z);
      g.userData.entity = d.entity_id;
      g.userData.floorId = d.floorId;
      g.traverse((o) => (o.userData.entity = d.entity_id));
      for (const b of g.userData.bulbs) {
        b.userData.device = true;
        if (!this.lampBulbs.has(d.entity_id)) this.lampBulbs.set(d.entity_id, []);
        this.lampBulbs.get(d.entity_id).push(b);
      }
      this.devicesGroup.add(g);
    }
    this._syncDeviceVisibility();
    this.applyLayers();
  }

  /** Sichtkegel der Kameras als halbdurchsichtige Fläche knapp über dem Boden (Ebene „Geräte“). */
  setCameraCones(list) {
    if (!this.conesGroup) {
      this.conesGroup = new THREE.Group();
      this.conesGroup.userData.layer = "devices";
      this.root.add(this.conesGroup);
    }
    for (const child of [...this.conesGroup.children]) this._dispose(child);
    this.conesGroup.clear();
    const mat = (this._coneMat ??= new THREE.MeshBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    for (const c of list) {
      const entry = this.floors.get(c.floorId);
      if (!entry) continue;
      const pts = c.poly;
      const pos = [];
      for (let i = 1; i < pts.length - 1; i++) pos.push(pts[0][0], 0, pts[0][1], pts[i][0], 0, pts[i][1], pts[i + 1][0], 0, pts[i + 1][1]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = (entry.floor.elevation ?? 0) + 0.03;
      mesh.renderOrder = 2;
      mesh.userData.floorId = c.floorId;
      mesh.userData.cone = c.entity_id;
      this.conesGroup.add(mesh);
    }
    this._syncDeviceVisibility();
    this._dirty = true;
  }

  _syncDeviceVisibility() {
    for (const m of this.conesGroup?.children ?? []) m.visible = this.isFloorVisible(m.userData.floorId);
    for (const g of this.devicesGroup.children) g.visible = this.isFloorVisible(g.userData.floorId);
  }

  /** Was liegt unter dem Bildschirmpunkt? {entity_id} für Geräte/Lampen, {floorId, roomId} für Räume. */
  /** Punkt auf der Ebene y (Weltkoordinaten) unter dem Zeiger als Plan [x, z], oder null. */
  planPoint(clientX, clientY, y = 0) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    return hit ? [hit.x, hit.z] : null;
  }

  /** Möbelstück hervorheben (Rahmen drumherum); null = keins. */
  markFurniture(id) {
    if (this._mark) {
      this._mark.parent?.remove(this._mark);
      this._mark.geometry.dispose();
      this._mark = null;
    }
    if (!id) return this.invalidate();
    let obj = null;
    this.root.traverse((o) => {
      if (!obj && o.userData.furniture === id && o.parent?.userData.furniture !== id) obj = o;
    });
    if (obj) {
      this._mark = new THREE.BoxHelper(obj, 0x03a9f4);
      this._mark.material.depthTest = false;
      this._mark.renderOrder = 10;
      this.root.add(this._mark);
    }
    this.invalidate();
  }

  pick(clientX, clientY, { furniture = false } = {}) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = Infinity;
    const targets = [];
    const visible = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    this.devicesGroup.traverse((o) => o.isMesh && targets.push(o));
    for (const entry of this.floors.values()) {
      if (!this.isFloorVisible(entry.floor.id)) continue; // Etagen darunter nur zur Ansicht
      entry.group.traverse((o) => o.isMesh && (o.userData.entity || o.userData.room || (furniture && o.userData.furniture)) && targets.push(o));
      if (furniture) entry.garden.traverse((o) => o.isMesh && o.userData.furniture && targets.push(o));
    }
    if (this._roofShown()) {
      for (const f of this.pvFields?.values() ?? []) targets.push(f.mesh);
      targets.push(...this.roofMeshes);
    }
    for (const hit of this.raycaster.intersectObjects(targets.filter(visible), false)) {
      if (hit.object.userData.pvField) return { pvField: hit.object.userData.pvField };
      if (hit.object.userData.roof) return null;
      if (furniture && hit.object.userData.furniture) return { furniture: hit.object.userData.furniture };
      if (hit.object.userData.entity) return { entity_id: hit.object.userData.entity };
      if (hit.object.userData.room) return { ...hit.object.userData.room };
    }
    return null;
  }

  /** Raum hervorheben (oder null); mit focus fährt die Kamera hin. */
  selectRoom(sel, { focus = true } = {}) {
    this.selectRooms(sel ? [sel] : [], { focus });
  }

  /** Mehrere Räume hervorheben; die Kamera fährt (mit focus) zum zuletzt gewählten. */
  selectRooms(list, { focus = true } = {}) {
    const sel = list.at(-1) ?? null;
    this.selected = sel;
    for (const [floorId, entry] of this.floors) {
      for (const [roomId, r] of entry.rooms) r.selected = list.some((x) => x.floorId === floorId && x.roomId === roomId);
    }
    if (sel && focus) {
      const r = this.floors.get(sel.floorId)?.rooms.get(sel.roomId);
      if (r) {
        const xs = r.room.points.map((p) => p[0]);
        const zs = r.room.points.map((p) => p[1]);
        const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 2);
        const target = new THREE.Vector3(r.center[0], (this.floors.get(sel.floorId).floor.elevation ?? 0) + 0.5, r.center[1]);
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        if (dir.y < 0.5) dir.setY(0.8).normalize();
        this._animateCamera(target, target.clone().add(dir.multiplyScalar(size * 1.7 + 3)));
      }
    }
    this._applySelection();
  }

  _applySelection() {
    for (const entry of this.floors.values()) {
      for (const r of entry.rooms.values()) {
        if (r.selected) {
          r.mesh.material.emissive.set(this.style === "cyber" ? 0xff2bd6 : 0x2196f3);
          r.mesh.material.emissiveIntensity = this.style === "cyber" ? 0.6 : 0.35;
        }
      }
    }
    this.invalidate();
  }

  _animateCamera(target, position, duration = 450) {
    const t0 = this.controls.target.clone();
    const p0 = this.camera.position.clone();
    const start = performance.now();
    if (duration <= 0) {
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.controls.update();
      this._cameraMoved();
      return;
    }
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / duration);
      const e = k * k * (3 - 2 * k);
      this.controls.target.lerpVectors(t0, target, e);
      this.camera.position.lerpVectors(p0, position, e);
      this.controls.update();
      this._cameraMoved();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _buildFloor(floor, settings, base = SLAB) {
    const group = new THREE.Group();
    group.name = `floor:${floor.id}`;
    const elev = floor.elevation ?? 0;
    // Garten in eigener Gruppe: bleibt sichtbar, wenn nur eine Etage gezeigt wird (Gelände ums Haus)
    const garden = new THREE.Group();
    garden.name = `garden:${floor.id}`;
    garden.userData.layer = "garden";
    const entry = { floor, group, garden, rooms: new Map(), openings: new Map(), occluders: [] };

    // Böden
    const openings0 = this._slabHoles?.get(floor.id) ?? [];
    for (const room of floor.rooms ?? []) {
      const holes = openings0.map((o) => roomHole(room.points, o.poly)).filter(Boolean);
      const geo = flatOrExtruded(room.points, SLAB, holes);
      geo.translate(0, elev - SLAB, 0);
      // Cyberpunk: Bodenbelag dunkel getönt, aber deckend und klar vom Hintergrund abgesetzt
      const base = new THREE.Color(floorColor(room));
      if (this.style === "cyber") base.lerp(new THREE.Color(0x3a2470), 0.45);
      const ftex = this.style === "cyber" ? null : getTexture(textureFor("floor", room.floor_texture, room.floor_material), this.renderer);
      const mat = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.85, emissive: 0x000000, map: ftex });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.layer = "floors";
      mesh.userData.holes = holes.length;
      mesh.userData.room = { floorId: floor.id, roomId: room.id };
      group.add(mesh);
      entry.occluders.push(mesh);

      const glowGeo = flatOrExtruded(room.points, Math.max(0.5, (floor.height ?? 2.5) - 0.1));
      glowGeo.translate(0, elev + 0.01, 0);
      const glow = new THREE.Mesh(glowGeo, this.mats.glow);
      glow.visible = false;
      glow.renderOrder = 2;
      group.add(glow);

      const c = labelPoint(room.points);
      entry.rooms.set(room.id, { room, mesh, glow, base, center: c });
      this.anchors.push({ key: `room:${floor.id}:${room.id}`, floorId: floor.id, position: new THREE.Vector3(c[0], elev + 0.05, c[1]) });
    }

    // Wände
    const { segments, openings, warnings } = computeWalls(floor, settings);
    this.warnings.push(...warnings.map((w) => `${floor.name}: ${w}`));
    const height = floor.height ?? 2.5;
    const prisms = new PrismBuilder();
    const dark = this.dark;
    const cyber = this.style === "cyber";
    const colors = cyber
      ? { exterior: new THREE.Color(0x1d0f3a), interior: new THREE.Color(0x160b2e), cap: new THREE.Color(0x00e5ff) }
      : {
          exterior: new THREE.Color(dark ? 0xc9c3b8 : 0xf3efe7),
          interior: new THREE.Color(dark ? 0xbdb7ac : 0xe7e1d6),
          cap: new THREE.Color(dark ? 0x5d5a55 : 0x77726b),
        };
    // eigene Farben: settings.wall_colors {exterior, interior}, je Raum wall_color (Innenseite); nicht im Cyberpunk-Stil
    const hex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? "");
    const custom = (v, fallback) => (!cyber && hex(v) ? new THREE.Color(v) : fallback);
    // Textur hängt an der Farbe (color.tex): settings.wall_textures {exterior, interior}, je Raum wall_texture/exterior_texture
    const tex = (c, chosen, fallback) => Object.assign(c.clone(), { tex: cyber ? null : textureFor("wall", chosen || fallback || "") });
    const wt = settings.wall_textures ?? {};
    const extCol = tex(custom(settings.wall_colors?.exterior, colors.exterior), wt.exterior);
    const intCol = tex(custom(settings.wall_colors?.interior, colors.interior), wt.interior);
    const roomCols = new Map((floor.rooms ?? []).map((r) => [r.id, tex(custom(r.wall_color, intCol), r.wall_texture, wt.interior)]));
    // Außenseite: Farbe des Raums dahinter (room.exterior_color, z. B. Holzschuppen), sonst Hausfarbe
    const extCols = new Map((floor.rooms ?? []).map((r) => [r.id, tex(custom(r.exterior_color, extCol), r.exterior_texture, wt.exterior)]));
    // Aussehen je Wand: room.edge_styles[Kante] {color, texture, exterior_color, exterior_texture}
    const roomById = new Map((floor.rooms ?? []).map((r) => [r.id, r]));
    const edgeStyle = (seg, roomId) => {
      const e = seg.sources?.find((x) => x.room_id === roomId)?.edge;
      return e === undefined ? null : roomById.get(roomId)?.edge_styles?.[e] ?? null;
    };
    const styled = (base, color, texture) => (color || texture ? Object.assign(custom(color, base).clone(), { tex: texture ? (cyber ? null : textureFor("wall", texture)) : base.tex }) : base);
    for (const seg of segments) {
      const extRoom = seg.roomLeft ?? seg.roomRight;
      const extStyle = seg.kind === "exterior" ? edgeStyle(seg, extRoom) : null;
      const outside = styled(extCols.get(extRoom) ?? extCol, extStyle?.exterior_color, extStyle?.exterior_texture);
      const face = (roomId) => {
        if (!roomId) return outside;
        const st = edgeStyle(seg, roomId);
        return styled(roomCols.get(roomId) ?? intCol, st?.color, st?.texture);
      };
      const h = seg.height ?? height;
      const end = seg.kind === "exterior" ? outside : intCol;
      const fw = seg.kind === "free" ? (floor.walls ?? []).find((w) => w.id === seg.freeId) : null;
      const freeCol = fw ? tex(custom(fw.color, intCol), fw.texture, wt.interior) : null;
      const sides = seg.kind === "free" ? freeCol : [end, face(seg.roomRight), end, face(seg.roomLeft)];
      // Wandfuß unter dem Boden: schließt die Fuge zur Etage darunter (Deckenstärke)
      prisms.prism(pieceFootprint(seg, 0, seg.length), elev - base, elev, sides, colors.cap);
      for (const piece of wallPieces(seg, openings, h)) {
        const foot = pieceFootprint(seg, piece.s0, piece.s1);
        prisms.prism(foot, elev + piece.y0, elev + piece.y1, sides, colors.cap);
      }
    }
    const wallMeshes = prisms.geometries().map(({ key, geo }) => {
      const m = new THREE.Mesh(geo, this._texMat(this.mats.wall, key, "wall"));
      m.userData.layer = "walls";
      group.add(m);
      return m;
    });
    if (cyber) {
      // Neonkanten an allen Wandkanten, Raumumrisse in Magenta knapp über dem Boden
      for (const walls of wallMeshes) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(walls.geometry, 25), this.mats.edge);
        edges.userData.layer = "walls";
        group.add(edges);
      }
      for (const room of floor.rooms ?? []) {
        const line = outline(room.points, elev + 0.015, this.mats.outline);
        line.userData.layer = "floors";
        group.add(line);
      }
    }
    // Möbel (NeonPlan furniture[]); Lampen mit Entität leuchten, wenn das Licht an ist
    const furn = new THREE.Group();
    furn.userData.layer = "furniture";
    // Gartenmöbel und Pflanzen außerhalb der Räume (und nicht auf dem Balkon) gehören zum Gelände
    const gardenFurn = new THREE.Group();
    gardenFurn.userData.layer = "furniture";
    const inside = (p) =>
      (floor.rooms ?? []).some((r) => pointInPolygon(p, r.points)) ||
      (floor.outdoor ?? []).some((o) => o.type === "balcony" && pointInPolygon(p, o.points));
    for (const item of floor.furniture ?? []) {
      const obj = buildFurniture(item, this.furnMats, elev, floor.height ?? 2.5);
      if (item.type === "radiator") {
        // Heizkörper glühen beim Heizen: verknüpftes Thermostat oder das des Raums
        const meshes = [];
        obj.traverse((o) => o.userData.heat && meshes.push(o));
        const room = (floor.rooms ?? []).find((r) => pointInPolygon([item.x, item.z], r.points));
        this.heatParts.push({ meshes, base: meshes[0]?.material, entity: item.entity && String(item.entity).startsWith("climate.") ? item.entity : null, roomKey: room ? `${floor.id}:${room.id}` : null });
      }
      const entity = item.entity && item.entity !== "none" ? item.entity : null;
      if (entity) {
        obj.traverse((o) => (o.userData.entity = entity));
        if (!this.lampBulbs.has(entity)) this.lampBulbs.set(entity, []);
        this.lampBulbs.get(entity).push(...obj.userData.bulbs);
      }
      (inside([item.x, item.z]) ? furn : gardenFurn).add(obj);
    }
    group.add(furn);
    entry.furn = furn; // Möbel innen (werden bei Draufsicht mit Dach ausgeblendet)
    garden.add(gardenFurn);
    entry.occluders.push(...wallMeshes);

    // Öffnungen
    const segById = new Map(segments.map((s) => [s.id, s]));
    for (const placed of openings) {
      const seg = segById.get(placed.segment);
      const item = this._buildOpening(seg, placed, elev, seg.height ?? height);
      item.group.userData.layer = "openings";
      item.roomId = placed.opening.room_id ?? null;
      group.add(item.group);
      entry.openings.set(placed.opening.id, item);
    }

    // Garten; Gartenflächen mit Bereich bekommen einen Anker für Beschriftung und Geräte
    for (const area of floor.outdoor ?? []) {
      // Balkone gehören zur Etage (verschwinden mit ihr), der übrige Garten bleibt stehen
      const obj = this._buildOutdoor(area, elev, floor);
      if (area.type === "balcony") {
        obj.userData.layer = "floors";
        group.add(obj);
      } else garden.add(obj);
      if (!area.area_id) continue;
      const c = labelPoint(area.points);
      const hs = Array.isArray(area.heights) ? area.heights : [];
      const y = hs.length ? hs.reduce((a, b) => a + (Number(b) || 0), 0) / hs.length : 0;
      this.anchors.push({ key: `room:${floor.id}:${area.id}`, floorId: floor.id, position: new THREE.Vector3(c[0], elev + y + 0.05, c[1]) });
    }

    this.root.add(group, garden);
    this.floors.set(floor.id, entry);
  }

  _buildOpening(seg, placed, elev, wallHeight) {
    const o = placed.opening;
    const width = placed.s1 - placed.s0;
    const sill = Math.min(o.sill ?? 0, wallHeight);
    const h = Math.max(0.05, Math.min(o.height, wallHeight - sill));
    const thick = seg.left + seg.right;
    const group = new THREE.Group();
    const mid = (placed.s0 + placed.s1) / 2;
    const px = seg.a[0] + seg.u[0] * mid + seg.n[0] * ((seg.left - seg.right) / 2);
    const pz = seg.a[1] + seg.u[1] * mid + seg.n[1] * ((seg.left - seg.right) / 2);
    group.position.set(px, elev + sill, pz);
    // lokale x-Achse entlang der Wand, lokale z-Achse = linke Normale der Wand
    group.rotation.y = Math.atan2(-seg.u[1], seg.u[0]);

    const item = { opening: o, group, kind: o.type, frames: [], panes: [], solids: [], leaves: [], blind: null, blindHeight: h, garage: null };
    const box = (w, hh, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
      m.position.set(x, y, z);
      return m;
    };
    const rs = placed.roomSide; // Seite des Raums in lokalem z
    const f = 0.05; // Rahmenstärke

    if (o.type === "window") {
      for (const m of [
        box(width, f, 0.08, this.mats.frame, 0, f / 2, 0),
        box(width, f, 0.08, this.mats.frame, 0, h - f / 2, 0),
        box(f, h, 0.08, this.mats.frame, -width / 2 + f / 2, h / 2, 0),
        box(f, h, 0.08, this.mats.frame, width / 2 - f / 2, h / 2, 0),
      ]) {
        group.add(m);
        item.frames.push(m);
      }
      // Flügel: Glas mit innerem Rahmen an einem Drehpunkt auf der Anschlagseite (schwenkt nach innen)
      const sw = width - 2 * f;
      const side = (o.hinge === "right" ? 1 : -1) * rs;
      const sash = new THREE.Group();
      sash.position.set(side * (sw / 2), 0, 0);
      const pane = box(sw - 0.04, h - 2 * f - 0.04, 0.01, this.mats.glass, -side * (sw / 2), h / 2, 0);
      pane.renderOrder = 3;
      sash.add(pane);
      item.panes.push(pane);
      for (const m of [box(sw, 0.03, 0.05, this.mats.frame, -side * (sw / 2), f + 0.015, 0), box(sw, 0.03, 0.05, this.mats.frame, -side * (sw / 2), h - f - 0.015, 0), box(0.03, h - 2 * f, 0.05, this.mats.frame, -side * 0.015, h / 2, 0), box(0.03, h - 2 * f, 0.05, this.mats.frame, -side * (sw - 0.015), h / 2, 0)]) {
        sash.add(m);
        item.frames.push(m);
      }
      group.add(sash);
      // fest verglaste Fenster ("nicht zu öffnen", fixed) bleiben zu
      const fixed = o.fixed === true || /nicht zu öffnen|fest/i.test(o.name ?? "");
      if (!fixed) item.leaves.push({ pivot: sash, closed: sash.position.clone(), open: sash.position.clone(), angle: THREE.MathUtils.degToRad(35) * rs * side });
    } else if (o.type === "door") {
      const style = o.style ?? null;
      if (style !== "passage") {
        // Zarge
        for (const m of [box(width, f, thick + 0.02, this.mats.frame, 0, h - f / 2, 0), box(f, h, thick + 0.02, this.mats.frame, -width / 2 + f / 2, h / 2, 0), box(f, h, thick + 0.02, this.mats.frame, width / 2 - f / 2, h / 2, 0)]) {
          group.add(m);
          item.frames.push(m);
        }
        const hingeSign = (o.hinge === "right" ? 1 : -1) * rs;
        const leafH = h - f;
        const front = exteriorDoor(seg) ? this.mats.frontDoor : this.mats.door;
        const sliding = style === "sliding";
        const swingSide = (o.swing === "out" ? -1 : 1) * rs;
        // zweiflügelig: Flügel an beiden Zargen, Hauptflügel auf der Anschlagseite
        const sides = o.leaves === 2 ? [hingeSign, -hingeSign] : [hingeSign];
        const leafW = (width - 2 * f) / sides.length;
        item.leaves = [];
        for (const side of sides) {
          const pivot = new THREE.Group();
          // Drehpunkt an der Zarge auf dieser Seite
          pivot.position.set(side * ((width - 2 * f) / 2), 0, 0);
          const leaf = new THREE.Group();
          leaf.position.set(-side * (leafW / 2), 0, 0);
          if (style === "glass" || sliding) {
            const pane = box(leafW - 0.1, leafH - 0.1, 0.012, this.mats.glass, 0, leafH / 2, 0);
            pane.renderOrder = 3;
            leaf.add(pane);
            item.panes.push(pane);
            for (const m of [box(leafW, 0.05, 0.04, this.mats.frame, 0, 0.025, 0), box(leafW, 0.05, 0.04, this.mats.frame, 0, leafH - 0.025, 0), box(0.05, leafH, 0.04, this.mats.frame, -leafW / 2 + 0.025, leafH / 2, 0), box(0.05, leafH, 0.04, this.mats.frame, leafW / 2 - 0.025, leafH / 2, 0)]) {
              leaf.add(m);
              item.frames.push(m);
            }
          } else {
            const solid = box(leafW, leafH, 0.04, front, 0, leafH / 2, 0);
            solid.userData.base = front;
            leaf.add(solid);
            item.solids.push(solid);
            if (style === "front_glass" || style === "front" || style === "sidelight" || style === "sidelights") {
              const pane = box(Math.min(0.22, leafW * 0.3), leafH * 0.7, 0.05, this.mats.glass, 0, leafH * 0.5, 0);
              pane.renderOrder = 3;
              leaf.add(pane);
              item.panes.push(pane);
            }
          }
          pivot.add(leaf);
          group.add(pivot);
          const closed = pivot.position.clone();
          if (sliding) {
            // Schiebetür: Flügel fährt zur eigenen Seite hinter die Wand, etwas versetzt
            const open = closed.clone().add(new THREE.Vector3(side * leafW * 0.9, 0, swingSide * 0.06));
            item.leaves.push({ pivot, closed, open, angle: 0 });
          } else {
            // Drehtür: freies Ende schwenkt zur Aufschlagseite (rein = Raumseite)
            const freeDir = -side;
            item.leaves.push({ pivot, closed, open: closed, angle: THREE.MathUtils.degToRad(80) * -swingSide * freeDir });
          }
        }
      }
    } else if (o.type === "garage") {
      const panel = box(width, h, 0.06, this.mats.garage, 0, 0, 0);
      panel.geometry.translate(0, -h / 2, 0); // Oberkante als Drehpunkt, damit es nach oben "einfährt"
      panel.position.set(0, h, 0);
      group.add(panel);
      item.garage = panel;
    }

    // Behang (Rollladen) außen vor Fenstern und Glastüren
    if (o.type !== "garage") {
      const outside = seg.kind === "exterior" ? (seg.left > 0 ? 1 : -1) : -rs;
      const z = outside * (thick / 2 + 0.03);
      const blind = box(width, h, 0.025, this.mats.blind, 0, 0, z);
      blind.geometry.translate(0, -h / 2, 0);
      blind.position.set(0, h, z);
      blind.visible = false;
      group.add(blind);
      item.blind = blind;
    }
    return item;
  }

  _buildOutdoor(area, elev, floor = null) {
    const look = OUTDOOR[area.type] ?? OUTDOOR.lawn;
    const group = new THREE.Group();
    const heights = Array.isArray(area.heights) && area.heights.length === area.points.length ? area.heights.map((h) => Number(h) || 0) : null;
    let geo;
    if (area.type === "balcony") {
      // Platte unter Fußbodenhöhe der Etage, Oberkante = Boden
      const slab = new THREE.Mesh(flatOrExtruded(area.points, 0.2), this._texMat(this.outdoorMats.balcony, textureFor("ground", area.texture, "balcony"), "ground:balcony"));
      slab.position.y = elev - 0.2;
      group.add(slab);
      if (this.mats.gardenLine) group.add(outline(area.points, elev + 0.01, this.mats.gardenLine));
      this._buildRailing(group, area, elev, floor);
      return group;
    }
    // Zaun als Linie: Pfosten und Füllung statt Block
    if (area.type === "fence" && Array.isArray(area.line?.points) && area.line.points.length > 1) {
      this._buildFence(group, area, elev + look.y);
      return group;
    }
    // Hecke/Zaun: eigene Höhe
    const ownH = (area.type === "hedge" || area.type === "fence") && Number(area.height) > 0 ? Math.min(6, Number(area.height)) : look.h;
    if (heights && look.h === 0) {
      // schräge Fläche (Hang, Böschung): Höhe je Eckpunkt
      geo = planarUVs(slopedSurface(area.points, heights));
    } else {
      geo = flatOrExtruded(area.points, ownH);
      if (heights) geo.translate(0, heights.reduce((a, b) => a + b, 0) / heights.length, 0);
    }
    geo.translate(0, elev + look.y, 0);
    const gmat = this.outdoorMats[area.type] ?? this.outdoorMats.lawn;
    const mesh = new THREE.Mesh(geo, this._texMat(gmat, textureFor("ground", area.texture, area.type), `ground:${area.type}`));
    group.add(mesh);
    if (this.mats.gardenLine) {
      const hs = Array.isArray(area.heights) && area.heights.length === area.points.length ? area.heights : null;
      group.add(outline(area.points, elev + look.y + ownH + 0.01, this.mats.gardenLine, hs));
    }
    if (area.type === "pool") {
      // Wasser etwas nach innen versetzt, über dem Rand
      const c = centroid(area.points);
      const inner = area.points.map(([x, z]) => {
        const dx = x - c[0];
        const dz = z - c[1];
        const l = Math.hypot(dx, dz) || 1;
        const k = Math.max(0, (l - 0.25) / l);
        return [c[0] + dx * k, c[1] + dz * k];
      });
      const water = new THREE.Mesh(flatOrExtruded(inner, 0), this.mats.water);
      water.position.y = elev + look.y + look.h + 0.005;
      group.add(water);
    }
    if (area.type === "bed") this._buildFlowers(group, area, elev + look.y + look.h);
    if (area.type === "gravel" || area.type === "rockery") this._buildStones(group, area, elev + look.y + look.h);
    if (!heights) this._buildRailing(group, area, elev + look.y + look.h, floor);
    return group;
  }

  /**
   * Zaun entlang seiner Mittellinie (area.line): Pfosten alle 2 m (instanziert) und Füllung nach
   * area.fence_style – Holz (Bretter), Doppelstabmatte (Stäbe, instanziert), Lamellen.
   */
  _buildFence(group, area, y) {
    const h = Math.min(3, Math.max(0.3, Number(area.height) || 1.0));
    const pts = area.line.points;
    const style = area.fence_style ?? "wood";
    const mat = style === "bars" ? this.mats.railing : this.mats.railWood;
    const fence = new THREE.Group();
    fence.userData.layer = "garden";
    const posts = [];
    const bars = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const beam = (a, b, y0, y1, t) => {
      const len = Math.max(t, Math.hypot(b[0] - a[0], b[1] - a[1]));
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, t), mat);
      mesh.position.set((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
      mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      fence.add(mesh);
    };
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const ang = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      const at = (t) => [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len, ang];
      const n = Math.max(1, Math.ceil(len / 2));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) posts.push(at((len * k) / n));
      if (style === "bars") {
        beam(a, b, y + 0.1, y + 0.14, 0.04);
        beam(a, b, y + h - 0.06, y + h - 0.02, 0.04);
        for (let t = 0.05; t < len - 0.02; t += 0.05) bars.push(at(t));
      } else if (style === "slats") {
        for (let z = 0.08; z < h - 0.05; z += 0.14) beam(a, b, y + z, y + z + 0.1, 0.025);
      } else {
        beam(a, b, y + h * 0.2, y + h * 0.2 + 0.08, 0.03);
        beam(a, b, y + h * 0.75, y + h * 0.75 + 0.08, 0.03);
        for (let t = 0.06; t < len - 0.03; t += 0.12) bars.push(at(t));
      }
    }
    const inst = (list, geo) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const up = new THREE.Vector3(0, 1, 0);
      list.forEach((p, i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(p[0], y + geo.parameters.height / 2, p[1]), q.setFromAxisAngle(up, p[2] ?? 0), new THREE.Vector3(1, 1, 1))));
      im.instanceMatrix.needsUpdate = true;
      fence.add(im);
    };
    if (posts.length) inst(posts, new THREE.BoxGeometry(0.08, h + 0.05, 0.08));
    if (bars.length) inst(bars, style === "bars" ? new THREE.BoxGeometry(0.012, h - 0.1, 0.012) : new THREE.BoxGeometry(0.09, h * 0.95, 0.02));
    group.add(fence);
  }

  /**
   * Geländer/Zaun an den Kanten, die nicht am Haus liegen. area.railing: glass | bars | wood | none
   * (Balkon: Glas, sonst keins), area.railing_height in m (Standard 1,0).
   */
  _buildRailing(group, area, y, floor) {
    const style = area.railing ?? (area.type === "balcony" ? "glass" : "none");
    if (!style || style === "none") return;
    const h = Math.min(2.5, Math.max(0.3, Number(area.railing_height) || 1));
    const edges = freeEdges(area.points, floor?.rooms ?? []);
    const rail = new THREE.Group();
    rail.userData.layer = "walls";
    const beam = (mat, a, b, y0, y1, t) => {
      const len = Math.max(t, Math.hypot(b[0] - a[0], b[1] - a[1]));
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, t), mat);
      m.position.set((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
      m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      rail.add(m);
      return m;
    };
    const bars = [];
    const wood = style === "wood";
    const frame = wood ? this.mats.railWood : this.mats.railing;
    for (const [a, b] of edges) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const at = (t) => [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len];
      beam(frame, a, b, y + h - 0.05, y + h, 0.07); // Handlauf
      const posts = Math.max(1, Math.ceil(len / 1.5));
      for (let i = 0; i <= posts; i++) {
        const p = at((len * i) / posts);
        beam(frame, p, p, y, y + h, 0.05);
      }
      if (style === "glass") beam(this.mats.railGlass, a, b, y + 0.06, y + h - 0.06, 0.015);
      else if (wood) for (const k of [0.25, 0.5, 0.75]) beam(frame, a, b, y + h * k - 0.05, y + h * k + 0.05, 0.03);
      else {
        beam(frame, a, b, y + 0.08, y + 0.12, 0.04);
        for (let t = 0.12; t < len - 0.06; t += 0.12) bars.push(at(t));
      }
    }
    if (bars.length) {
      const geo = new THREE.BoxGeometry(0.02, h - 0.17, 0.02);
      const inst = new THREE.InstancedMesh(geo, frame, bars.length);
      const m = new THREE.Matrix4();
      bars.forEach((p, i) => inst.setMatrixAt(i, m.makeTranslation(p[0], y + 0.12 + (h - 0.17) / 2, p[1])));
      rail.add(inst);
    }
    group.add(rail);
  }

  /** Kies: viele kleine Kiesel; Steingarten: Findlinge mit etwas Grün. */
  _buildStones(group, area, y) {
    const rockery = area.type === "rockery";
    const pts = scatter(area.points, { seed: `${area.id}:steine`, perM2: rockery ? 1.6 : 40, n: rockery ? 60 : 900, margin: 0.05 });
    if (!pts.length) return;
    const rnd = seeded(`${area.id}:groesse`);
    const geo = rockery ? new THREE.DodecahedronGeometry(0.5, 0) : new THREE.IcosahedronGeometry(0.5, 0);
    const mats = [this.furnMats.stone, this.furnMats.stoneLight];
    const lists = [[], []];
    pts.forEach((p) => lists[rnd() < 0.5 ? 0 : 1].push(p));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    lists.forEach((list, k) => {
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(geo, mats[k], list.length);
      list.forEach((p, i) => {
        const size = rockery ? 0.2 + rnd() * 0.45 : 0.03 + rnd() * 0.04;
        q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3));
        sc.set(size * (0.8 + rnd() * 0.5), size * (rockery ? 0.6 : 0.5), size);
        inst.setMatrixAt(i, m.compose(new THREE.Vector3(p[0], y + sc.y * 0.3, p[1]), q, sc));
      });
      group.add(inst);
    });
    if (rockery) this._buildFlowers(group, { ...area, id: `${area.id}:gruen` }, y, 1.2);
  }

  /** Beet: Büsche und Blüten, bei jedem Aufbau gleich verteilt. */
  _buildFlowers(group, area, y, perM2 = 7) {
    const pts = scatter(area.points, { seed: area.id ?? "beet", perM2, n: 160, margin: 0.12 });
    if (!pts.length) return;
    const rnd = seeded(`${area.id}:farbe`);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3();
    const leafGeo = new THREE.SphereGeometry(0.13, 8, 6);
    const leaves = new THREE.InstancedMesh(leafGeo, this.furnMats.green, pts.length);
    const blooms = this.mats.flowers.map(() => []);
    pts.forEach((p, i) => {
      const s = 0.7 + rnd() * 0.6;
      leaves.setMatrixAt(i, m.compose(new THREE.Vector3(p[0], y + 0.08 * s, p[1]), q, one.set(s, s * 0.8, s)));
      blooms[Math.floor(rnd() * blooms.length)].push([p, s]);
    });
    group.add(leaves);
    const bloomGeo = new THREE.SphereGeometry(0.06, 8, 6);
    blooms.forEach((list, k) => {
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(bloomGeo, this.mats.flowers[k], list.length);
      list.forEach(([p, s], i) => inst.setMatrixAt(i, m.makeTranslation(p[0] + 0.04, y + 0.2 * s, p[1] - 0.03)));
      group.add(inst);
    });
  }

  /** Dach über der obersten Etage (settings.roof, nur in „Alle“) und eigene Dächer einzelner Räume (room.roof). */
  _buildRoof(building) {
    this.roofHolder = null;
    this.roofModel = null;
    this.roofMeshes = [];
    this.roomRoofs = new Map(); // roomId -> {parts, eave, tan, type}
    const wall = building.settings?.wall_exterior ?? 0.24;
    const roof = roofSettings(building.settings);
    if (roof.type !== "none") {
      const floor = roofFloor(building, roof);
      const rooms = roofRooms(floor, roof);
      if (rooms.length) {
        const holder = new THREE.Group();
        const inner = new THREE.Group();
        inner.userData.layer = "roof";
        holder.add(inner);
        const top = (floor.elevation ?? 0) + (floor.height ?? 2.5);
        const res = this._roofGeometry(rooms, roof, top, wall, inner, { settings: building.settings });
        const model = { roof, parts: res.parts, top, eave: res.eave, tan: res.tan };
        this.roofModel = model; // für Kenndaten der PV-Felder (gleiche Flächen wie im Bild)
        const items = Array.isArray(roof.items) ? roof.items : [];
        // verschiebbare PV-Felder (Dach-Ebene im Editor) ersetzen die Angaben je Richtung
        if (!items.some((it) => it.type === "pv")) this._roofPanels(inner, model, building.settings?.north ?? 0);
        this._roofItems(inner, model, items);
        this.roofMeshes.push(...res.meshes);
        for (const m of res.meshes) m.userData.roof = true;
        this.roofHolder = holder;
        this.root.add(holder);
      }
    }
    // eigene Dächer (Schuppen, Carport …): gehören zur Etage, immer sichtbar
    for (const floor of building.floors ?? []) {
      const entry = this.floors.get(floor.id);
      if (!entry) continue;
      entry.roofWrappers = [];
      for (const g of roomRoofGroups(floor)) {
        // Hülle ohne Ebene: Etagenwahl blendet sie aus (man schaut hinein), innen die Ebene „roof“
        const wrap = new THREE.Group();
        const group = new THREE.Group();
        group.userData.layer = "roof";
        wrap.add(group);
        const top = (floor.elevation ?? 0) + (floor.height ?? 2.5);
        const res = this._roofGeometry(g.rooms, g.roof, top, building.settings?.wall_exterior ?? 0.24, group, { roomRoof: true });
        res.group = group;
        for (const r of g.rooms) this.roomRoofs.set(r.id, res);
        entry.group.add(wrap);
        entry.roofWrappers.push(wrap);
      }
    }
  }

  /**
   * Ein PV-Modul (oder Dachfenster) flach auf der Dachfläche: Mitte p (Grundriss), Höhe y, Richtung
   * hangabwärts out. Ziel ist ein PanelBatch (Module) oder eine Gruppe (eigenes Mesh, Dachfenster).
   */
  _panelOnRoof(group, p, y, out, tan, w, l, mats, along = null) {
    const b = panelBasis(out, tan, along);
    const [U, N, Z] = [b.U, b.N, b.Z].map((v) => new THREE.Vector3(...v));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(U, N, Z));
    const pos = new THREE.Vector3(p[0], y, p[1]).addScaledVector(N, 0.07);
    if (group instanceof PanelBatch) {
      group.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(w, 1, l)));
      return null;
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, l), mats);
    panel.quaternion.copy(q);
    panel.position.copy(pos);
    group.add(panel);
    return panel;
  }

  /** Materialien eines PV-Felds: eigene Kopie der Moduloberseite (glänzt je nach Leistung). */
  _pvMats() {
    const f = this.mats.solarFrame;
    return [f, f, this.mats.solar.clone(), f, f, f];
  }

  /** PV-Feld fertigstellen: InstancedMesh einhängen, für Leistung/Auswahl und Schild merken. */
  _finishPvField(batch, parent, id, label = null) {
    const inst = batch.mesh();
    if (!inst) return null;
    parent.add(inst);
    if (id) {
      const solar = Array.isArray(inst.material) ? inst.material[2] : null;
      const box = inst.boundingBox ?? new THREE.Box3();
      const c = box.getCenter(new THREE.Vector3());
      this.pvFields.set(id, { mesh: inst, solar, base: solar?.emissiveIntensity ?? 0, baseColor: solar?.emissive.getHex() ?? 0, label });
      this.anchors.push({ key: `pv:${id}`, floorId: null, roof: true, position: new THREE.Vector3(c.x, box.max.y + 0.35, c.z) });
    }
    return inst;
  }

  /**
   * Leistung je PV-Feld (Map id → Anteil 0..1 der Spitzenleistung): Module glänzen leicht, ohne
   * Neuaufbau.
   */
  setPvPower(ratios) {
    let changed = false;
    for (const [id, f] of this.pvFields ?? []) {
      if (!f.solar) continue;
      const r = Math.min(1, Math.max(0, Number(ratios?.get(id)) || 0));
      const want = f.base + 0.3 * r;
      if (Math.abs(f.solar.emissiveIntensity - want) < 0.01) continue;
      if (!f.baseColor) f.solar.emissive.setHex(r > 0 ? 0x4f8fe8 : 0x000000);
      f.solar.emissiveIntensity = want;
      changed = true;
    }
    if (changed) this.invalidate();
  }

  /**
   * PV-Module nach Himmelsrichtung (roof.solar = {N, E, S, W} Anzahl) bzw. PV-Felder je Richtung
   * (roof.solar_arrays). Ältere Angaben; die Dach-Ebene im Editor nutzt roof.items.
   */
  _roofPanels(parent, model, north) {
    const { roof, tan } = model;
    const arrays = roof.solar_arrays;
    if ((!roof.solar && !arrays?.length) || !["gable", "hip", "shed"].includes(roof.type)) return;
    const group = new THREE.Group();
    group.userData.layer = "solar";
    const faces = roofFaces(model, north);
    const mats = [this.mats.solarFrame, this.mats.solarFrame, this.mats.solar, this.mats.solarFrame, this.mats.solarFrame, this.mats.solarFrame];
    const batch = new PanelBatch(mats);
    const place = (f, slots) => {
      const fr = f.fr;
      for (const { s, x, w = 1.0, l = 1.7 } of slots) {
        const t = roof.type === "shed" ? -fr.width / 2 + x : f.sg * (fr.width / 2 - x);
        const p = [fr.center[0] + s * fr.u[0] + t * fr.v[0], fr.center[1] + s * fr.u[1] + t * fr.v[1]];
        this._panelOnRoof(batch, p, model.eave + x * tan, f.out, tan, w, l, mats);
      }
    };
    if (arrays?.length) {
      for (const a of arrays) {
        const f = faces.filter((x) => x.dir === a.dir).sort((p, q) => q.fr.length - p.fr.length)[0];
        if (!f) continue;
        place(f, panelArraySlots(f.fr, { tan, type: roof.type, cols: Math.max(1, Number(a.cols) || 1), rows: Math.max(1, Number(a.rows) || 1), orient: a.orient === "landscape" ? "landscape" : "portrait", left: Math.max(0, Number(a.left) || 0), row: Math.max(0, Number(a.row) || 0), flip: f.flip, hipEnds: f.fr.hipEnds ?? [false, false], blocked: f.blocked }));
      }
    } else {
      for (const dir of ["S", "E", "W", "N"]) {
        let left = Math.max(0, Math.round(Number(roof.solar[dir]) || 0));
        for (const f of faces.filter((x) => x.dir === dir).sort((a, b) => b.fr.length - a.fr.length)) {
          if (left <= 0) break;
          const slots = panelSlots(f.fr, { tan, count: left, type: roof.type, hipEnds: f.fr.hipEnds ?? [false, false], blocked: f.blocked });
          left -= slots.length;
          place(f, slots);
        }
      }
    }
    this._finishPvField(batch, group, null);
    if (group.children.length) parent.add(group);
  }

  /**
   * Gaube: Frontwand mit Fenstern, Seitenwangen bis aufs Hauptdach, Dach als Schlepp-, Sattel- oder
   * Flachdach (exterior.js:dormerShape).
   */
  _buildDormer(group, model, it) {
    const g = dormerShape(model, it);
    if (!g) return;
    const V = (p, y) => new THREE.Vector3(p[0], y, p[1]);
    const tri = (list) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(list.flatMap((v) => [v.x, v.y, v.z]), 3));
      geo.computeVertexNormals();
      return geo;
    };
    const quad = (a, b, c, d) => [a, b, c, a, c, d];
    const cyber = this.style === "cyber";
    const wallMat = new THREE.MeshStandardMaterial(cyber ? { color: 0x1b0f33, emissive: 0xff2bd6, emissiveIntensity: 0.2, side: THREE.DoubleSide } : { color: /^#[0-9a-f]{6}$/i.test(it.color ?? "") ? it.color : 0xe9e4dc, roughness: 0.9, side: THREE.DoubleSide });
    const roofMat = this.mats.roof.clone();
    if (!cyber && /^#[0-9a-f]{6}$/i.test(it.roof_color ?? "")) roofMat.color.set(it.roof_color);
    const { f0, f1, b0, b1, y0, yTop, yBack, out } = g;
    const c = [(f0[0] + f1[0]) / 2, (f0[1] + f1[1]) / 2];
    const back = (p, k) => [p[0] - out[0] * k, p[1] - out[1] * k];
    const wall = [];
    const roof = [];
    wall.push(...quad(V(f0, y0), V(f1, y0), V(f1, yTop), V(f0, yTop)));
    if (g.style === "gable") {
      const e0 = back(f0, g.eave);
      const e1 = back(f1, g.eave);
      const rb = back(c, g.depth);
      wall.push(V(f0, yTop), V(f1, yTop), V(c, g.ridge)); // Giebeldreieck
      wall.push(V(f0, y0), V(f0, yTop), V(e0, yTop), V(f1, y0), V(f1, yTop), V(e1, yTop));
      roof.push(...quad(V(f0, yTop), V(c, g.ridge), V(rb, g.ridge), V(e0, yTop)));
      roof.push(...quad(V(f1, yTop), V(c, g.ridge), V(rb, g.ridge), V(e1, yTop)));
    } else {
      wall.push(V(f0, y0), V(f0, yTop), V(b0, yBack), V(f1, y0), V(f1, yTop), V(b1, yBack));
      // kleiner Überstand vorne
      const o0 = [f0[0] + out[0] * 0.12, f0[1] + out[1] * 0.12];
      const o1 = [f1[0] + out[0] * 0.12, f1[1] + out[1] * 0.12];
      roof.push(...quad(V(o0, yTop + 0.12 * g.tanP + 0.03), V(o1, yTop + 0.12 * g.tanP + 0.03), V(b1, yBack + 0.03), V(b0, yBack + 0.03)));
    }
    const wm = new THREE.Mesh(tri(wall), wallMat);
    const rm = new THREE.Mesh(tri(roof), roofMat);
    group.add(wm, rm);
    // Fenster in der Front
    const n = g.windows;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5;
      const ww = Math.min(0.9, (g.w / n) * 0.7);
      const p = [c[0] + g.along[0] * t * g.w + out[0] * 0.02, c[1] + g.along[1] * t * g.w + out[1] * 0.02];
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, g.h * 0.6), this.mats.glass);
      pane.position.set(p[0], y0 + g.h * 0.5, p[1]);
      pane.rotation.y = Math.atan2(out[0], out[1]);
      group.add(pane);
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(ww + 0.08, g.h * 0.6 + 0.08), this.mats.frame);
      frame.position.set(p[0] - out[0] * 0.005, y0 + g.h * 0.5, p[1] - out[1] * 0.005);
      frame.rotation.y = pane.rotation.y;
      group.add(frame);
    }
  }

  /** Dinge auf dem Dach (roof.items): Kamin, Dachfenster, PV-Felder; Lage im Grundriss, Höhe aus der Dachfläche. */
  _roofItems(parent, model, items) {
    const solar = new THREE.Group();
    solar.userData.layer = "solar";
    const other = new THREE.Group();
    other.userData.layer = "roof";
    const cyber = this.style === "cyber";
    const pvMats = [this.mats.solarFrame, this.mats.solarFrame, this.mats.solar, this.mats.solarFrame, this.mats.solarFrame, this.mats.solarFrame];
    const skyMats = [this.mats.frame, this.mats.frame, this.mats.glass, this.mats.frame, this.mats.frame, this.mats.frame];
    const obstacles = roofObstacles(model, items); // Kamin und Dachfenster: dort keine Module
    for (const it of items) {
      if (!Number.isFinite(it?.x) || !Number.isFinite(it?.z)) continue;
      if (it.type === "pv") {
        const lay = pvLayout(model, it, { obstacles });
        const batch = new PanelBatch(this._pvMats(), { pvField: it.id ?? null });
        for (const [i, p] of lay.panels.entries()) {
          const hit = roofSurfaceAt(model, p);
          if (!hit || !lay.fits[i]) continue;
          this._panelOnRoof(batch, p, hit.y, hit.out ? lay.out : null, model.tan, lay.w, lay.l, pvMats, lay.along);
        }
        this._finishPvField(batch, solar, it.id ?? null, it.name ?? null);
      } else if (it.type === "skylight") {
        const hit = roofSurfaceAt(model, [it.x, it.z]);
        if (!hit) continue;
        const w = Number(it.w) || ROOF_ITEMS.skylight.w;
        const l = Number(it.l) || ROOF_ITEMS.skylight.l;
        this._panelOnRoof(other, [it.x, it.z], hit.y, hit.out, model.tan, w, l, skyMats, [1, 0]);
      } else if (it.type === "dormer") {
        this._buildDormer(other, model, it);
      } else if (it.type === "chimney") {
        const w = Number(it.w) || ROOF_ITEMS.chimney.w;
        const d = Number(it.d) || ROOF_ITEMS.chimney.d;
        const above = Number.isFinite(Number(it.h)) && it.h !== null ? Number(it.h) : ROOF_ITEMS.chimney.h;
        const a = ((it.rotation || 0) * Math.PI) / 180;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => [it.x + (i * w * Math.cos(a)) / 2 - (k * d * Math.sin(a)) / 2, it.z + (i * w * Math.sin(a)) / 2 + (k * d * Math.cos(a)) / 2]);
        const ys = corners.map((c) => roofSurfaceAt(model, c)?.y).filter(Number.isFinite);
        if (!ys.length) continue;
        const y0 = model.top - 0.3;
        const y1 = Math.max(...ys) + above;
        const base = new THREE.MeshStandardMaterial(cyber ? { color: 0x1b0f33, emissive: 0xff2bd6, emissiveIntensity: 0.3 } : { color: /^#[0-9a-f]{6}$/i.test(it.color ?? "") ? it.color : 0x9c5a44, roughness: 0.9 });
        const mat = this._texMat(base, textureFor("wall", it.texture || "brick"), "chimney", true);
        const geo = planarUVs(new THREE.BoxGeometry(w, y1 - y0, d).toNonIndexed());
        const body = new THREE.Mesh(geo, mat);
        body.position.set(it.x, (y0 + y1) / 2, it.z);
        body.rotation.y = -a;
        other.add(body);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.1), this.mats.solarFrame);
        cap.position.set(it.x, y1 + 0.04, it.z);
        cap.rotation.y = -a;
        other.add(cap);
      }
    }
    if (solar.children.length) parent.add(solar);
    if (other.children.length) parent.add(other);
  }

  /**
   * Dachflächen und Giebel für eine Gruppe von Räumen bauen und in parent hängen.
   * @returns {{meshes: THREE.Mesh[], parts: object[], eave: number, tan: number, type: string, top: number}}
   */
  _roofGeometry(rooms, roof, top, wall, parent, { roomRoof = false, settings = {} } = {}) {
    const ov = roof.overhang;
    // von Hand angepasste Dachteile (roof.adjust, Dach-Ebene im Editor)
    const parts = adjustRoofParts(roofParts(rooms, { wall, overhang: ov, direction: roof.direction }), roof.adjust, !!roof.flip);
    const tan = Math.tan(THREE.MathUtils.degToRad(roof.pitch));
    const roofPos = [];
    const gablePos = [];
    const tri = (list, ...pts) => list.push(...pts.flat());
    const quad = (list, a, b, c, d) => tri(list, a, b, c, a, c, d);
    const eave = top - ov * tan; // Dachfläche trifft die Wand genau an ihrer Oberkante
    const meshes = [];
    // eigene Dachfarbe (roof.color), sonst Standard des Stils
    const custom = /^#[0-9a-f]{6}$/i.test(roof.color ?? "") && this.style !== "cyber";
    let roofMat = custom ? this.mats.roof.clone() : this.mats.roof;
    if (custom) roofMat.color.set(roof.color);
    roofMat = this._texMat(roofMat, textureFor("roof", roof.texture, roof.type), "roof", custom);
    // L-/T-Häuser: mehrere Teile; ein Flügel steckt mit einem Ende (open) im Hauptdach
    for (const fr of parts) {
      const L = fr.length / 2;
      const W = fr.width / 2;
      const Wi = Math.max(0.1, W - ov);
      const [openLo, openHi] = fr.open ?? [false, false];
      const Llo = openLo ? L : Math.max(0.1, L - ov);
      const Lhi = openHi ? L : Math.max(0.1, L - ov);
      const P = (s, t, y) => [fr.center[0] + s * fr.u[0] + t * fr.v[0], y, fr.center[1] + s * fr.u[1] + t * fr.v[1]];
      if (roof.type === "flat") {
        const slab = new THREE.Mesh(planarUVs(new THREE.BoxGeometry(2 * L, 0.25, 2 * W).toNonIndexed()), roofMat);
        slab.position.set(fr.center[0], top + 0.125, fr.center[1]);
        slab.rotation.y = -Math.atan2(fr.u[1], fr.u[0]);
        parent.add(slab);
        meshes.push(slab);
      } else if (roof.type === "gable" || roof.type === "hip") {
        const ridge = eave + W * tan;
        // Walm an den freien Enden; beim Satteldach optional am freien Ende eines Flügels (roof.wing_end)
        const wingHip = roof.type === "gable" && roof.wing_end === "hip" && (openLo || openHi);
        const hipLo = !openLo && (roof.type === "hip" || (wingHip && openHi));
        const hipHi = !openHi && (roof.type === "hip" || (wingHip && openLo));
        fr.hipEnds = [hipLo, hipHi];
        const rLo = hipLo ? Math.max(0, L - W) : L;
        const rHi = hipHi ? Math.max(0, L - W) : L;
        // Stück im Nachbardach (inner): ohne seitlichen Überstand, sonst schaut es unter dessen Giebel heraus
        const [inLo, inHi] = fr.inner ?? [0, 0];
        const sA = -L + Math.min(inLo, L);
        const sB = L - Math.min(inHi, L);
        for (const sg of [-1, 1]) {
          quad(roofPos, P(sA, sg * W, eave), P(sB, sg * W, eave), P(Math.min(sB, rHi), 0, ridge), P(Math.max(sA, -rLo), 0, ridge));
          if (inLo) quad(roofPos, P(-L, sg * Wi, top), P(sA, sg * Wi, top), P(sA, 0, ridge), P(-L, 0, ridge));
          if (inHi) quad(roofPos, P(sB, sg * Wi, top), P(L, sg * Wi, top), P(L, 0, ridge), P(sB, 0, ridge));
        }
        const yi = eave + (W - Wi) * tan;
        if (hipLo) tri(roofPos, P(-L, -W, eave), P(-L, W, eave), P(-rLo, 0, ridge));
        else if (!openLo) tri(gablePos, P(-Llo, -Wi, yi), P(-Llo, Wi, yi), P(-Llo, 0, ridge));
        if (hipHi) tri(roofPos, P(L, -W, eave), P(L, W, eave), P(rHi, 0, ridge));
        else if (!openHi) tri(gablePos, P(Lhi, -Wi, yi), P(Lhi, Wi, yi), P(Lhi, 0, ridge));
      } else if (roof.type === "shed") {
        const yAt = (t) => eave + (t + W) * tan;
        quad(roofPos, P(-L, -W, eave), P(L, -W, eave), P(L, W, yAt(W)), P(-L, W, yAt(W)));
        if (!openLo) tri(gablePos, P(-Llo, -Wi, top), P(-Llo, Wi, top), P(-Llo, Wi, yAt(Wi)));
        if (!openHi) tri(gablePos, P(Lhi, -Wi, top), P(Lhi, Wi, top), P(Lhi, Wi, yAt(Wi)));
        quad(gablePos, P(-Llo, Wi, top), P(Lhi, Wi, top), P(Lhi, Wi, yAt(Wi)), P(-Llo, Wi, yAt(Wi)));
      }
    }
    const mesh = (pos, mat) => {
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      planarUVs(geo);
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      meshes.push(m);
    };
    mesh(roofPos, roofMat);
    // Giebel: eigene Farbe/Textur (roof.gable_color/gable_texture), bei Raumdächern die Außenwand des Raums,
    // sonst die Außenwände des Hauses
    const hex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? "") && this.style !== "cyber";
    const gCol = hex(roof.gable_color) ? roof.gable_color : roomRoof && hex(rooms[0]?.exterior_color) ? rooms[0].exterior_color : !roomRoof && hex(settings.wall_colors?.exterior) ? settings.wall_colors.exterior : null;
    let gableMat = gCol ? this.mats.gable.clone() : this.mats.gable;
    if (gCol) gableMat.color.set(gCol);
    const gTex = textureFor("wall", roof.gable_texture || (roomRoof ? rooms[0]?.exterior_texture : settings.wall_textures?.exterior) || "");
    gableMat = this._texMat(gableMat, gTex, "gable", !!gCol);
    mesh(gablePos, gableMat);
    // Cyberpunk: Neonkanten (als Kind des Dachs, damit sie dessen Lage übernehmen)
    if (this.mats.roofEdge) for (const m of meshes) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), this.mats.roofEdge));
    return { meshes, parts, eave, tan, type: roof.type, top };
  }

  _buildEnergy(building) {
    // Raum mit Balkonkraftwerk (room.energy_role, früher Bereich „balkonkraftwerk“ oder Name Schuppen)
    const shed = findPvShed(building);
    if (!shed) return;
    const entry = this.floors.get(shed.floor.id);
    const elev = shed.floor.elevation ?? 0;
    const top = elev + (shed.floor.height ?? 2.5);
    const tilt = THREE.MathUtils.degToRad(20);
    const solar = new THREE.Group();
    const pitched = this.roomRoofs?.get(shed.room.id);
    if (pitched && (pitched.type === "gable" || pitched.type === "shed")) {
      // Schuppen mit eigenem Dach: Module liegen flach auf den Dachflächen (wie in echt) und
      // verschwinden mit dem Dach (Ebene „Dach“ aus oder Etage gewählt)
      this._panelsOnRoof(solar, pitched, shed.room.solar_panels ?? 4);
      solar.userData.layer = "solar";
      pitched.group.add(solar);
      this._buildFlow(building, shed, top + (pitched.parts[0]?.width ?? 2) / 2 * pitched.tan, entry);
      return;
    }
    // Dachplatte
    const roof = new THREE.Mesh(flatOrExtruded(shed.room.points, 0.08), this.mats.solarFrame);
    roof.position.y = top;
    solar.add(roof);
    // Ausrichtung: settings.north = Richtung Nord im Plan, Grad im Uhrzeigersinn von "oben" (-z).
    // Lokales +z der Modulreihen zeigt nach Norden, die Module neigen sich nach Süden.
    const north = THREE.MathUtils.degToRad(building.settings?.north ?? 0);
    const yaw = Math.PI - north;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Plan -> lokales System der Modulreihen (Drehung um -yaw) und zurück
    const toLocal = ([x, z]) => [x * cos - z * sin, x * sin + z * cos];
    const toPlan = ([a, b]) => [a * cos + b * sin, -a * sin + b * cos];
    const local = shed.room.points.map(toLocal);
    const as = local.map((p) => p[0]);
    const bs = local.map((p) => p[1]);
    const [a0, a1, b0, b1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
    const pw = 1.0;
    const pd = 1.7;
    const rowDepth = pd * Math.cos(tilt) + 0.3;
    const rack = new PanelBatch([this.mats.solarFrame, this.mats.solarFrame, this.mats.solar, this.mats.solarFrame, this.mats.solarFrame, this.mats.solarFrame]);
    // Gestell: um yaw gedreht, Modul um -tilt geneigt (Nordkante oben)
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tilt));
    const scale = new THREE.Vector3(pw, 1, pd);
    const nx = Math.max(1, Math.floor((a1 - a0 - 0.2) / (pw + 0.05)));
    const nz = Math.max(1, Math.floor((b1 - b0 - 0.2) / rowDepth));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const la = a0 + (i + 0.5) * ((a1 - a0) / nx);
        const lb = b0 + (j + 0.5) * ((b1 - b0) / nz);
        const [px, pz] = toPlan([la, lb]);
        if (!pointInPolygon([px, pz], shed.room.points)) continue;
        rack.push(new THREE.Matrix4().compose(new THREE.Vector3(px, top + 0.35, pz), rot, scale));
      }
    }
    this._finishPvField(rack, solar, null);
    solar.userData.layer = "solar";
    // ohne eigenes Dach: Platte mit Modulen ist das Dach (Ebene „roof“ und Etagenwahl wie Raumdächer)
    const wrap = new THREE.Group();
    const asRoof = new THREE.Group();
    asRoof.userData.layer = "roof";
    asRoof.add(solar);
    wrap.add(asRoof);
    entry.group.add(wrap);
    (entry.roofWrappers ??= []).push(wrap);
    this._buildFlow(building, shed, top, entry);
  }

  /** Module (1,0 × 1,7 m, hochkant) gleichmäßig auf die Dachflächen verteilen. */
  _panelsOnRoof(group, roofInfo, count) {
    const fr = roofInfo.parts[0];
    if (!fr || count <= 0) return;
    const L = fr.length / 2;
    const W = fr.width / 2;
    const slopes = roofInfo.type === "gable" ? [-1, 1] : [0];
    const pw = 1.0;
    const pd = Math.min(1.7, (roofInfo.type === "gable" ? W : 2 * W) / Math.cos(Math.atan(roofInfo.tan)) - 0.25);
    const perSlope = Math.ceil(count / slopes.length);
    const fit = Math.max(1, Math.floor((2 * L - 0.3) / (pw + 0.05)));
    let left = count;
    const batch = new PanelBatch([this.mats.solarFrame, this.mats.solarFrame, this.mats.solar, this.mats.solarFrame, this.mats.solarFrame, this.mats.solarFrame]);
    for (const sg of slopes) {
      const n = Math.min(perSlope, fit, left);
      left -= n;
      // Mitte der Dachfläche quer zum First; Höhe dort
      const t = roofInfo.type === "gable" ? sg * (W / 2) : 0;
      const y = roofInfo.type === "gable" ? roofInfo.eave + (W - Math.abs(t)) * roofInfo.tan : roofInfo.eave + W * roofInfo.tan;
      const U = new THREE.Vector3(fr.u[0], 0, fr.u[1]);
      // Richtung hangabwärts und Flächennormale
      const down = roofInfo.type === "gable" ? new THREE.Vector3(sg * fr.v[0], -roofInfo.tan, sg * fr.v[1]).normalize() : new THREE.Vector3(-fr.v[0], -roofInfo.tan, -fr.v[1]).normalize();
      let N = new THREE.Vector3().crossVectors(down, U).normalize();
      if (N.y < 0) N.negate();
      const Z = new THREE.Vector3().crossVectors(U, N);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(U, N, Z));
      const scale = new THREE.Vector3(pw, 1, pd);
      for (let k = 0; k < n; k++) {
        const s = (k - (n - 1) / 2) * (pw + 0.05);
        const pos = new THREE.Vector3(fr.center[0] + s * fr.u[0] + t * fr.v[0], y, fr.center[1] + s * fr.u[1] + t * fr.v[1]).addScaledVector(N, 0.06);
        batch.push(new THREE.Matrix4().compose(pos, q, scale));
      }
    }
    this._finishPvField(batch, group, null);
  }

  /** Energieflusslinie vom Schuppen zum Haus. */
  _buildFlow(building, shed, top, entry) {
    // Energieflusslinie zum Haus (Schwerpunkt der übrigen Räume der Etage, sonst aller Etagen)
    const others = (shed.floor.rooms ?? []).filter((r) => r !== shed.room);
    const pool = others.length ? others : (building.floors ?? []).flatMap((f) => f.rooms ?? []).filter((r) => r !== shed.room);
    if (!pool.length) return;
    const pts = pool.map((r) => centroid(r.points));
    const target = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const sc = labelPoint(shed.room.points);
    const start = new THREE.Vector3(sc[0], top + 0.6, sc[1]);
    const end = new THREE.Vector3(target[0], top + 0.3, target[1]);
    const ctrl = start.clone().lerp(end, 0.5);
    ctrl.y += Math.max(1.5, start.distanceTo(end) * 0.25);
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
    const flowGroup = new THREE.Group();
    flowGroup.userData.layer = "flow";
    entry.group.add(flowGroup);
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.035, 6, false), this.mats.flowLine);
    flowGroup.add(line);
    const dots = [];
    const dotGeo = new THREE.SphereGeometry(0.11, 12, 8);
    for (let i = 0; i < 10; i++) {
      const dot = new THREE.Mesh(dotGeo, this.mats.flowDot);
      dot.visible = false;
      flowGroup.add(dot);
      dots.push(dot);
    }
    this.flow = { floorId: shed.floor.id, curve, line, dots, phase: 0, speed: 0 };
    this.anchors.push({ key: "energy", floorId: shed.floor.id, position: start.clone().add(new THREE.Vector3(0, 0.6, 0)) });
  }

  _dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const shared = [...Object.values(this.mats).flat(), ...Object.values(this.outdoorMats), ...Object.values(this.furnMats ?? {}).flat()];
      for (const m of [].concat(o.material ?? [])) if (!shared.includes(m)) m.dispose();
    });
  }

  // ------------------------------------------------------------------ Etagen und Kamera

  /** "all" oder eine Etagen-ID. */
  setFilter(filter, { fit = false } = {}) {
    this.filter = this.floors.has(filter) ? filter : "all";
    // gewählte Etage und alle darunter (Außenwände bleiben stehen, man schaut nur von oben hinein)
    const elev = this.floors.get(this.filter)?.floor.elevation ?? Infinity;
    for (const [id, entry] of this.floors) entry.group.visible = this.filter === "all" || this.filter === id || (entry.floor.elevation ?? 0) < elev;
    // Dach nur in der Gesamtansicht; mit Etagenwahl schaut man hinein (auch Raumdächer dieser Etage)
    if (this.roofHolder) this.roofHolder.visible = this.filter === "all";
    for (const [id, entry] of this.floors) for (const w of entry.roofWrappers ?? []) w.visible = this.filter !== id;
    this._syncGarden();
    this._syncDeviceVisibility();
    this._syncHouseFlow();
    if (fit) this.fitCamera();
    this._cameraMoved();
  }

  /** Keller gewählt: Garten der Etagen darüber ausblenden, sonst liegt der Rasen über dem Keller. */
  _syncGarden() {
    const elev = this.floors.get(this.filter)?.floor.elevation ?? Infinity;
    for (const entry of this.floors.values()) entry.garden.visible = this.layers?.garden !== false && !(elev < -0.5 && (entry.floor.elevation ?? 0) > elev);
  }

  isFloorVisible(floorId) {
    return this.filter === "all" || this.filter === floorId;
  }

  /** Umriss der sichtbaren Etagen (ohne Garten) als {min, max}. */
  viewBox() {
    const box = new THREE.Box3();
    for (const entry of this.floors.values()) {
      if (!this.isFloorVisible(entry.floor.id)) continue;
      // Gartenflächen nicht mitzählen, sonst wird das Haus zu klein
      for (const m of entry.occluders) box.expandByObject(m);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    return { min: box.min.toArray(), max: box.max.toArray() };
  }

  /** Feste Ansicht (camera.js: iso, oben, sued, nord, ost, west). */
  viewPreset(name, north = 0, { duration = 450 } = {}) {
    const pose = presetPose(name, this.viewBox(), { north, fov: this.camera.fov, aspect: this.camera.aspect });
    this.setView(pose, { duration });
    return pose;
  }

  fitCamera() {
    this.viewPreset("iso", 0, { duration: 0 });
  }

  /** Aktuelle Ansicht (auf cm gerundet). */
  getView() {
    return roundPose({ target: this.controls.target.toArray(), position: this.camera.position.toArray() });
  }

  setView(pose, { duration = 450 } = {}) {
    this._animateCamera(new THREE.Vector3(...pose.target), new THREE.Vector3(...pose.position), duration);
  }

  _cameraMoved() {
    this._camDirty = true;
    this.invalidate();
  }

  invalidate() {
    this._dirty = true;
    this._kick();
  }

  // ------------------------------------------------------------------ Zustände

  /**
   * @param {object} s
   * @param {Set<string>} s.lit Raum-IDs mit eingeschaltetem Licht ("floorId:roomId")
   * @param {Map<string, number|null>} s.temps Temperatur je "floorId:roomId"
   * @param {boolean} s.tempMode Temperaturansicht
   * @param {(t:number)=>number[]} s.tempColor
   * @param {Set<string>} s.open offene Öffnungen ("floorId:openingId")
   * @param {Map<string, number|null>} s.covers geschlossener Anteil je Öffnung
   * @param {number|null} s.feedIn Einspeiseleistung in W
   */
  applyStates(s) {
    this._lastStates = s;
    // Heizkörper: glühen, solange ihr Thermostat (oder das des Raums) heizt
    for (const h of this.heatParts ?? []) {
      const on = h.entity ? !!s.heating?.has(h.entity) : !!(h.roomKey && s.heatRooms?.has(h.roomKey));
      const mat = on ? this.furnMats.heatOn : h.base;
      for (const m of h.meshes) if (m.material !== mat) m.material = mat;
    }
    for (const [floorId, entry] of this.floors) {
      for (const [roomId, r] of entry.rooms) {
        const key = `${floorId}:${roomId}`;
        const lit = s.lit.has(key);
        const color = r.mesh.material.color;
        if (s.tempMode) {
          const t = s.temps.get(key);
          if (t == null) color.setRGB(0.55, 0.55, 0.55, THREE.SRGBColorSpace);
          else color.setRGB(...s.tempColor(t), THREE.SRGBColorSpace);
        } else {
          color.copy(r.base);
          if (this.dark && this.style === "standard") color.multiplyScalar(0.8);
        }
        // Cyberpunk: Boden glimmt leicht in seiner Farbe, damit er sich deutlich vom Hintergrund abhebt
        const idle = this.style === "cyber" && !s.tempMode ? r.base : new THREE.Color(0x000000);
        // echtes Licht: Farbe und Helligkeit der Lampen (sonst warmweiß)
        const look = lit ? s.lights?.get(key) : null;
        r.mesh.material.emissive.copy(lit && !s.tempMode ? WARM : idle);
        if (look && !s.tempMode) r.mesh.material.emissive.setRGB(...look.color, THREE.SRGBColorSpace);
        r.mesh.material.emissiveIntensity = lit ? (this.style === "night" ? 0.9 : 0.45) * (look ? 0.4 + 0.6 * look.level : 1) : this.style === "cyber" ? 0.3 : 0;
        if (look) {
          r.glowMat = r.glowMat ?? this.mats.glow.clone();
          r.glowMat.color.setRGB(...look.color, THREE.SRGBColorSpace);
          r.glowMat.opacity = (STYLE_GLOW[this.style] ?? 0.16) * (0.35 + 0.65 * look.level);
          r.glow.material = r.glowMat;
        } else r.glow.material = this.mats.glow;
        // Hinweis im Raum: Boden rot (kritisch) bzw. orange (Warnung); Auswahl geht vor
        const alert = s.alerts?.get(key);
        if (alert) {
          r.mesh.material.emissive.set(alert === "critical" ? 0xe53935 : 0xff8f00);
          r.mesh.material.emissiveIntensity = alert === "critical" ? 0.55 : 0.4;
        }
        r.glow.visible = lit && !s.tempMode && this.quality.glow !== false;
      }
      for (const [openingId, item] of entry.openings) {
        const key = `${floorId}:${openingId}`;
        // Sicherheitsansicht: gekippt orange, zu grün (nur Öffnungen mit Kontakt)
        const tilted = !!s.security?.tilted.has(key);
        const open = s.open.has(key) && !tilted;
        const ok = !!s.security?.closed.has(key);
        const frame = open ? this.mats.frameAlert : tilted ? this.mats.frameWarn : ok ? this.mats.frameOk : this.mats.frame;
        for (const m of item.frames) m.material = frame;
        // nachts leuchten Fenster beleuchteter Räume in der Lichtfarbe (Rollladen zu dimmt)
        const roomKey = item.roomId ? `${floorId}:${item.roomId}` : null;
        const litLook = !open && this.style === "night" && roomKey && s.lit.has(roomKey) && (s.covers.get(key) ?? 0) < 0.9 ? s.lights?.get(roomKey) ?? { color: [1, 0.78, 0.45], level: 1 } : null;
        const glassLit = litLook ? this._lightMat("glass", litLook.color, () => {
          const m = this.mats.glass.clone();
          m.emissive.setRGB(...litLook.color, THREE.SRGBColorSpace);
          m.emissiveIntensity = 1.1;
          m.opacity = 0.75;
          return m;
        }) : null;
        for (const p of item.panes) p.material = open ? this.mats.glassAlert : glassLit ?? this.mats.glass;
        for (const solid of item.solids) solid.material = open || tilted ? frame : solid.userData.base;
        const closed = s.covers.get(key);
        // Ziele setzen; die Bewegung macht _animate() Bild für Bild
        item.anim = item.anim ?? { open: open ? 1 : 0, cover: null };
        item.anim.openTarget = open ? 1 : tilted ? 0.3 : 0;
        if (item.garage) {
          item.anim.coverTarget = closed == null ? (open ? 0.15 : 1) : Math.max(0.08, closed);
          item.garage.material = open ? this.mats.frameAlert : this.mats.garage;
        } else if (item.blind) {
          item.anim.coverTarget = closed ?? 0;
        }
        if (item.anim.cover == null) item.anim.cover = item.anim.coverTarget ?? 0;
        this._animating = true;
      }
    }
    for (const [entity, bulbs] of this.lampBulbs) {
      const on = s.onEntities?.has(entity);
      const look = on ? s.lightLooks?.get(entity) : null;
      const mat = !on ? this.furnMats.bulb : (look && this._lightMat("bulb", look.color, () => {
        const m = this.furnMats.bulbOn.clone();
        m.emissive.setRGB(...look.color, THREE.SRGBColorSpace);
        m.color.setRGB(...look.color.map((v) => 0.6 + 0.4 * v), THREE.SRGBColorSpace);
        return m;
      })) || this.furnMats.bulbOn;
      for (const b of bulbs) b.material = mat;
    }
    this._applySelection();
    this._animate(1 / 60);
    if (this.flow) {
      const w = s.feedIn ?? 0;
      const active = w > 1;
      // 0.05 bis 0.8 Umläufe pro Sekunde, abhängig von der Einspeisung
      this.flow.speed = active ? Math.min(0.8, 0.05 + w / 1000) : 0;
      this.flow.line.material.opacity = active ? 0.45 : 0.15;
      for (const d of this.flow.dots) d.visible = active;
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ Overlays

  /** Bildschirmposition eines Weltpunkts (oder null, wenn hinter der Kamera). */
  project(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
  }

  /** Liegt zwischen Kamera und Punkt Geometrie einer anderen sichtbaren Etage (z. B. EG über KG)? */
  occluded(v, floorId = null) {
    const dir = v.clone().sub(this.camera.position);
    const dist = dir.length();
    this.raycaster.set(this.camera.position, dir.normalize());
    this.raycaster.far = dist - 0.15;
    const targets = [];
    for (const [id, entry] of this.floors) if (entry.group.visible && id !== floorId) targets.push(...entry.occluders);
    if (this._roofShown()) targets.push(...this.roofMeshes);
    return this.raycaster.intersectObjects(targets, false).length > 0;
  }

  _roofShown() {
    return !!this.roofHolder?.visible && this.layers.roof !== false && this.roofMeshes?.length > 0;
  }

  // ------------------------------------------------------------------ Schleife

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.getDelta();
    this._kick();
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    clearTimeout(this._timer);
    this._timer = null;
  }

  _kick() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._running || this._raf) return;
    this._raf = requestAnimationFrame(() => this._frame());
  }

  _frame() {
    this._raf = null;
    if (!this._running) return;
    const dt = Math.min(0.1, this._clock.getDelta());
    const moving = this.controls.update();
    // Animationen nach echter Zeit (bei wenigen Bildern pro Sekunde nicht langsamer, nur ruckeliger)
    const now = performance.now();
    const animDt = Math.min(0.5, (now - (this._lastAnim ?? now)) / 1000);
    this._lastAnim = now;
    const animating = this._animating && this._animate(animDt);
    // Hintergrund-Animationen nur, wenn sichtbar (Ebene an) und die Ansicht nicht ruht
    const flowing = !this._frozen && this.flow && this.flow.speed > 0 && this.layers.flow !== false && this.isFloorVisible(this.flow.floorId);
    const weatherOn = !this._frozen && !!this._weather && this.layers.weather !== false;
    const houseFlow = this._houseFlowActive();
    const ambient = flowing || weatherOn || houseFlow;
    const interval = ambientInterval(this.quality.ambientFps);
    const render = shouldRender({ dirty: this._dirty, moving, animating, ambient, now, lastRender: this._lastRender ?? -Infinity, interval });
    if (render) {
      // Fluss und Wetter nur weiterrechnen, wenn auch gezeichnet wird (nach echter Zeit)
      const ambDt = Math.min(0.5, (now - (this._lastAmbient ?? now)) / 1000);
      this._lastAmbient = now;
      if (flowing) {
        this.flow.phase = (this.flow.phase + ambDt * this.flow.speed) % 1;
        const n = this.flow.dots.length;
        this.flow.dots.forEach((d, i) => d.position.copy(this.flow.curve.getPointAt((this.flow.phase + i / n) % 1)));
      }
      if (weatherOn) this._stepWeather(ambDt);
      if (houseFlow) this._stepHouseFlow(ambDt);
      const t0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.stats.renders++;
      if (moving) {
        // Bildabstand beim Drehen messen (für die automatische Auflösung)
        if (this._lastMoveFrame) this.stats.frameMs.push(t0 - this._lastMoveFrame);
        if (this.stats.frameMs.length > 120) this.stats.frameMs.shift();
        this._lastMoveFrame = t0;
      } else this._lastMoveFrame = null;
      this._dirty = false;
      this._lastRender = now;
    }
    if (this._camDirty || moving) {
      this._camDirty = false;
      this.onCameraChange();
      this._lodCheck();
    }
    // weiter: sofort bei Bewegung, sonst Hintergrund-Animation im gedrosselten Takt, sonst schlafen
    if (moving || animating || this._dirty) this._kick();
    else if (ambient) {
      const wait = Math.max(0, interval - (performance.now() - this._lastRender));
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._timer = null;
        this._kick();
      }, wait);
    }
  }

  /** Qualitätsstufe zur Laufzeit (perf.js): Auflösung, Glühen, Wetter-Dichte, Möbel innen. */
  setQuality(profile) {
    const prev = this.quality;
    this.quality = profile;
    this._applyShadows();
    const dpr = Math.min(window.devicePixelRatio || 1, profile.dpr ?? profile.maxDpr);
    if (Math.abs(this.renderer.getPixelRatio() - dpr) > 1e-3) {
      this.renderer.setPixelRatio(dpr);
      this.resize();
    }
    if (prev && this._weather && prev.weatherScale !== profile.weatherScale && this.building) this.setWeather(this._weather, { force: true });
    if (this._lastStates) this.applyStates(this._lastStates);
    this._lodCheck(true);
    this.invalidate();
  }

  /** Hintergrund-Animationen anhalten (Ruhemodus). */
  setPerf({ frozen = false } = {}) {
    this._frozen = !!frozen;
    this.invalidate();
  }

  /** Möbel innen ausblenden, wenn das Dach drauf ist und man von oben schaut (perf.js:lodState). */
  _lodCheck(force = false) {
    const now = performance.now();
    if (!force && now - (this._lodAt ?? 0) < 150) return;
    this._lodAt = now;
    const polar = this.controls.getPolarAngle?.() ?? 0;
    const { hideInterior } = lodState(polar, this._roofShown(), this.quality);
    if (hideInterior === this._hideInterior && !force) return;
    this._hideInterior = hideInterior;
    const on = this.layers.furniture !== false;
    for (const entry of this.floors.values()) if (entry.furn) entry.furn.visible = on && !hideInterior;
    this._dirty = true;
  }

  /** Bewegt Türen, Fensterflügel, Rollläden und Tore Richtung Ziel; true, solange sich etwas bewegt. */
  _animate(dt) {
    let busy = false;
    const step = (cur, target, speed) => {
      const d = target - cur;
      if (Math.abs(d) < 0.002) return target;
      busy = true;
      return cur + Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    };
    for (const entry of this.floors.values()) {
      for (const item of entry.openings.values()) {
        const a = item.anim;
        if (!a) continue;
        a.open = step(a.open, a.openTarget ?? 0, 1.6); // ca. 0,6 s für eine Tür
        const t = a.open * a.open * (3 - 2 * a.open); // weich an- und auslaufen
        for (const leaf of item.leaves) {
          leaf.pivot.position.lerpVectors(leaf.closed, leaf.open, t);
          leaf.pivot.rotation.y = leaf.angle * t;
        }
        if (a.coverTarget != null) {
          a.cover = step(a.cover, a.coverTarget, 0.35); // Rollladen: ca. 3 s ganz auf/zu
          if (item.garage) item.garage.scale.y = Math.max(0.02, a.cover);
          else if (item.blind) {
            item.blind.visible = a.cover > 0.02;
            item.blind.scale.y = Math.max(0.02, a.cover);
          }
        }
      }
    }
    this._animating = busy;
    if (busy) this._dirty = true;
    return busy;
  }

  // ------------------------------------------------------------------ Wetter

  /** Regen, Schnee oder Hagel draußen; w = {kind: "rain"|"snow"|"hail"|null, amount 0..1, lightning}. */
  setWeather(w, { force = false } = {}) {
    const next = w && (w.kind || w.lightning) ? { kind: w.kind ?? null, amount: w.amount ?? 0.5, lightning: !!w.lightning } : null;
    const prev = this._weather;
    if (!force && JSON.stringify(prev ?? null) === JSON.stringify(next)) return;
    this._weather = next;
    if (this.weather) {
      this.scene.remove(this.weather.obj);
      this.weather.obj.geometry.dispose();
      this.weather = null;
    }
    this._flash = 0;
    this._applyBackground();
    this._snowTint(next?.kind === "snow" ? 0.25 + 0.5 * next.amount : 0);
    if (next?.kind && this.building) this._buildWeather(next);
    this.applyLayers();
    this.invalidate();
  }

  /** Schnee bleibt liegen: Rasen, Wege und Dach werden heller. */
  /** Gelände- und Dachmaterialien inklusive ihrer Textur-Kopien (für Schnee und Jahreszeiten). */
  _groundRoofMats() {
    const out = [...["lawn", "terrace", "path", "driveway", "bed", "hedge", "balcony", "gravel", "rockery"].map((t) => this.outdoorMats[t]), this.mats.roof];
    for (const [key, m] of this.texMats ?? []) if (key.startsWith("ground:") || key.startsWith("roof:")) out.push(m);
    return out;
  }

  _snowTint(k) {
    this._snowK = k;
    const white = new THREE.Color(0xf4f7fb);
    const mats = this._groundRoofMats();
    const tint = (m, f) => {
      if (!m) return;
      m.userData.base ??= m.color.clone();
      m.color.copy(m.userData.base).lerp(white, (this.style === "cyber" ? 0.4 : 1) * f);
    };
    for (const m of mats) tint(m, k);
    // Baumkronen und Büsche nur leicht angezuckert
    for (const m of [this.furnMats.leaf, this.furnMats.leafDark]) tint(m, k * 0.45);
  }

  _buildWeather(w) {
    // Bereich: ums Haus herum, Tropfen nur außerhalb der Räume (x, z bleiben fest, nur y läuft)
    const floors = this.building.floors ?? [];
    const polys = floors.flatMap((f) => (f.rooms ?? []).map((r) => r.points));
    const pts = floors.flatMap((f) => [...(f.rooms ?? []), ...(f.outdoor ?? [])].flatMap((r) => r.points ?? []));
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs) - 6, Math.max(...xs) + 6, Math.min(...zs) - 6, Math.max(...zs) + 6];
    const ground = Math.min(...floors.map((f) => f.elevation ?? 0).filter((e) => e <= 0), 0) - 0.05;
    const groundAt = (x, z) => {
      // Gartenfläche an dieser Stelle (höchste Etage mit Fläche unter dem Punkt)
      let y = ground;
      for (const f of floors) for (const o of f.outdoor ?? []) if (o.type !== "balcony" && pointInPolygon([x, z], o.points)) y = Math.max(y, (f.elevation ?? 0) - 0.03);
      return y;
    };
    const top = Math.max(...floors.map((f) => (f.elevation ?? 0) + (f.height ?? 2.5)), 3) + 7;
    const area = (x1 - x0) * (z1 - z0);
    const density = w.kind === "rain" ? 10 : w.kind === "hail" ? 4 : 6;
    const n = Math.min(6000, Math.round(area * density * (0.3 + 0.7 * w.amount) * (this.quality.weatherScale ?? 1)));
    const rnd = seeded(`wetter:${n}`);
    const drops = [];
    for (let tries = 0; drops.length < n && tries < n * 4; tries++) {
      const x = x0 + rnd() * (x1 - x0);
      const z = z0 + rnd() * (z1 - z0);
      if (polys.some((p) => pointInPolygon([x, z], p))) continue;
      const g = groundAt(x, z);
      drops.push({ x, z, g, y: g + rnd() * (top - g), phase: rnd() * Math.PI * 2 });
    }
    const rain = w.kind === "rain";
    const len = 0.25 + 0.25 * w.amount;
    const pos = new Float32Array(drops.length * (rain ? 6 : 3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const obj = rain ? new THREE.LineSegments(geo, this.mats.rain) : new THREE.Points(geo, this.mats.snow);
    obj.frustumCulled = false;
    obj.userData.layer = "weather";
    if (w.kind === "hail") obj.material = this.mats.snow;
    this.scene.add(obj);
    this.weather = { obj, drops, top, rain, len, speed: rain ? 8 + 4 * w.amount : w.kind === "hail" ? 10 : 0.9, snow: w.kind === "snow", t: 0 };
    this._stepWeather(0);
  }

  /** Bewegt Regen/Schnee; true, solange Wetter angezeigt wird. */
  _stepWeather(dt) {
    const wx = this.weather;
    if (this._weather?.lightning) {
      // Blitz: ab und zu kurz hell
      if (this._flash > 0) {
        this._flash -= dt;
        if (this._flash <= 0) this._applyBackground();
      } else if (Math.random() < dt / 6) {
        this._flash = 0.12;
        this.hemi.intensity += 2.5;
      }
    }
    if (!wx) return !!this._weather?.lightning;
    wx.t += dt;
    const pos = wx.obj.geometry.attributes.position.array;
    const fall = wx.speed * dt;
    wx.drops.forEach((d, i) => {
      d.y -= fall;
      if (d.y < d.g) d.y += wx.top - d.g;
      if (wx.rain) {
        const k = i * 6;
        pos[k] = pos[k + 3] = d.x + 0.05;
        pos[k + 2] = pos[k + 5] = d.z;
        pos[k + 1] = d.y;
        pos[k + 4] = d.y + wx.len;
      } else {
        const sway = wx.snow ? 0.25 * Math.sin(wx.t * 0.8 + d.phase) : 0;
        pos[i * 3] = d.x + sway;
        pos[i * 3 + 1] = d.y;
        pos[i * 3 + 2] = d.z + (wx.snow ? 0.2 * Math.cos(wx.t * 0.6 + d.phase) : 0);
      }
    });
    wx.obj.geometry.attributes.position.needsUpdate = true;
    return true;
  }

  dispose() {
    this.stop();
    if (this.weather) this.weather.obj.geometry.dispose();
    this._resize.disconnect();
    this.controls.dispose();
    for (const child of [...this.root.children]) this._dispose(child);
    this._disposeMats();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function exteriorDoor(seg) {
  return seg.kind === "exterior";
}

/** Wandfuß unter einer Etage: bis zur Oberkante der Etage darunter (höchstens 1 m), mindestens SLAB. */
function footing(floors, floor) {
  const below = (floors ?? []).filter((f) => f.elevation < floor.elevation).sort((p, q) => q.elevation - p.elevation)[0];
  if (!below) return SLAB;
  const gap = floor.elevation - (below.elevation + (below.height ?? 2.5));
  return gap > 0 && gap <= 1 ? Math.max(SLAB, gap) : SLAB;
}


/** Fläche mit Höhe je Eckpunkt (relativ), trianguliert; Plan [x, z] -> Welt (x, y, z). */
function slopedSurface(points, heights) {
  const contour = points.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [];
  for (const [a, b, c] of tris) {
    for (const k of [a, c, b]) pos.push(points[k][0], heights[k], points[k][1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // Normalen nach oben ausrichten (Umlaufsinn des Polygons ist beliebig)
  const n = geo.getAttribute("normal");
  let up = 0;
  for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) {
    for (let i = 0; i < pos.length; i += 9) {
      for (let j = 0; j < 3; j++) [pos[i + 3 + j], pos[i + 6 + j]] = [pos[i + 6 + j], pos[i + 3 + j]];
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
  }
  return geo;
}

/** Umriss eines Polygons als Linie (optional mit Höhe je Punkt). */
function outline(points, y, material, heights = null) {
  const pts = points.map(([x, z], i) => new THREE.Vector3(x, y + (heights ? Number(heights[i]) || 0 : 0), z));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
}

Object.assign(HouseScene.prototype, SceneFx);
