// 3D-Szene: baut das Haus einmal aus den Daten und ändert bei Zustandswechseln nur Materialien,
// Sichtbarkeit und Skalierung (kein Neuaufbau der Geometrie).

import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { buildDevice, buildFurniture, furnitureMaterials } from "./furniture.js";
import { centroid, computeWalls, labelPoint, pieceFootprint, pointInPolygon, wallPieces } from "./walls.js";

const FLOOR_COLORS = {
  wood: 0xc89f6a,
  oak: 0xa8743f,
  tiles: 0xd8d3ca,
  carpet: 0x8f9cb0,
  stone: 0xb3aea5,
  concrete: 0x9e9e9e,
};

const OUTDOOR = {
  lawn: { color: 0x6aa84f, y: -0.035, h: 0 },
  terrace: { color: 0xc2b39b, y: -0.035, h: 0.1 },
  path: { color: 0xbcb4a6, y: -0.025, h: 0 },
  driveway: { color: 0x8c8c8c, y: -0.025, h: 0 },
  pool: { color: 0xdedad2, y: -0.02, h: 0.04 },
  bed: { color: 0x6b4a2f, y: -0.035, h: 0.15 },
  hedge: { color: 0x2f6b2a, y: -0.035, h: 1.2 },
  fence: { color: 0x8a6f52, y: -0.035, h: 1.0 },
};

const SLAB = 0.15;
const WARM = new THREE.Color(0xffb347);
const ALERT = 0xe53935;

/** Plan [x, z] -> Shape in der XY-Ebene, die nach rotateX(-PI/2) wieder bei (x, 0, z) liegt. */
function shapeOf(points) {
  return new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
}

function flatOrExtruded(points, height) {
  const shape = shapeOf(points);
  const geo = height > 0 ? new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Sammelt Prismen (Wandstücke) in einem einzigen BufferGeometry. */
class PrismBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
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
    for (const v of [a, b, c, a, c, d]) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
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
      this.quad(bottom[i], bottom[j], top[j], top[i], mid.sub(center), side);
    }
    this.quad(top[0], top[1], top[2], top[3], new THREE.Vector3(0, 1, 0), cap);
    this.quad(bottom[0], bottom[1], bottom[2], bottom[3], new THREE.Vector3(0, -1, 0), side);
  }

  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeBoundingSphere();
    return geo;
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
    this.scene.add(this.hemi, this.sun);

    this.style = "standard";
    this.layers = {};
    this.lampBulbs = new Map(); // entity_id -> Leuchtmittel (Möbel-Lampen und 3D-Geräte)
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
    const next = style === "cyber" ? "cyber" : "standard";
    if (next === this.style) return;
    this.style = next;
    this._disposeMats();
    this._makeMats();
    this._applyBackground();
    if (this.building) this.setBuilding(this.building, { keepCamera: true });
  }

  _applyBackground() {
    const cyber = this.style === "cyber";
    this.scene.background = new THREE.Color(cyber ? 0x07030f : this.dark ? 0x1b1f24 : 0xe9eef2);
    this.hemi.color.set(cyber ? 0x8f7dff : 0xffffff);
    this.hemi.groundColor.set(cyber ? 0x1a0630 : 0x8a7f70);
    this.hemi.intensity = cyber ? 1.3 : this.dark ? 1.1 : 1.6;
    this.sun.intensity = cyber ? 0.7 : this.dark ? 1.1 : 1.6;
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
        }
      : {
          wall: std({ vertexColors: true, roughness: 0.9 }),
          glass: std({ color: 0x9fd3f0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
          glassAlert: std({ color: ALERT, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
          frame: std({ color: 0xfafafa, roughness: 0.6 }),
          frameAlert: std({ color: ALERT, emissive: ALERT, emissiveIntensity: 0.5 }),
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
        };
    const garden = cyber
      ? { lawn: 0x062a24, terrace: 0x2a1450, path: 0x1a1030, driveway: 0x140c26, pool: 0x1b0f33, bed: 0x3a0f3a, hedge: 0x0b4f3f, fence: 0x4a148c }
      : Object.fromEntries(Object.entries(OUTDOOR).map(([k, v]) => [k, v.color]));
    this.outdoorMats = Object.fromEntries(
      Object.keys(OUTDOOR).map((k) => [k, std(cyber ? { color: garden[k], emissive: garden[k], emissiveIntensity: 0.35, roughness: 1 } : { color: garden[k], roughness: 1 })]),
    );
  }

  _disposeMats() {
    for (const m of [...Object.values(this.mats ?? {}), ...Object.values(this.outdoorMats ?? {}), ...Object.values(this.furnMats ?? {})]) {
      if (!m) continue;
      m.map?.dispose();
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
    this.root.clear();
    this.floors.clear();
    this.anchors = [];
    this.flow = null;
    this.building = building;
    this.warnings = [];
    this.lampBulbs.clear();
    for (const floor of building.floors ?? []) this._buildFloor(floor, building.settings ?? {}, footing(building.floors, floor));
    this._buildEnergy(building);
    if (this.style === "cyber") {
      const lowest = Math.min(0, ...(building.floors ?? []).map((f) => f.elevation ?? 0));
      const grid = new THREE.GridHelper(120, 120, 0xff2bd6, 0x2a1450);
      grid.position.y = lowest - 0.08;
      grid.material.transparent = true;
      grid.material.opacity = 0.55;
      this.root.add(grid);
    }
    this.setFilter(this.filter, { fit: !keepCamera });
    if (this._deviceList) this.setDevices(this._deviceList);
    this.applyLayers();
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

  _syncDeviceVisibility() {
    for (const g of this.devicesGroup.children) g.visible = this.isFloorVisible(g.userData.floorId);
  }

  /** Was liegt unter dem Bildschirmpunkt? {entity_id} für Geräte/Lampen, {floorId, roomId} für Räume. */
  pick(clientX, clientY) {
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
      if (!entry.group.visible) continue;
      entry.group.traverse((o) => o.isMesh && (o.userData.entity || o.userData.room) && targets.push(o));
    }
    for (const hit of this.raycaster.intersectObjects(targets.filter(visible), false)) {
      if (hit.object.userData.entity) return { entity_id: hit.object.userData.entity };
      if (hit.object.userData.room) return { ...hit.object.userData.room };
    }
    return null;
  }

  /** Raum hervorheben (oder null); mit focus fährt die Kamera hin. */
  selectRoom(sel, { focus = true } = {}) {
    this.selected = sel;
    for (const [floorId, entry] of this.floors) {
      for (const [roomId, r] of entry.rooms) r.selected = !!sel && sel.floorId === floorId && sel.roomId === roomId;
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

  _animateCamera(target, position) {
    const t0 = this.controls.target.clone();
    const p0 = this.camera.position.clone();
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 450);
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
    for (const room of floor.rooms ?? []) {
      const geo = flatOrExtruded(room.points, SLAB);
      geo.translate(0, elev - SLAB, 0);
      const base = new THREE.Color(this.style === "cyber" ? 0x0e0820 : FLOOR_COLORS[room.floor_material] ?? FLOOR_COLORS.wood);
      const mat = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.85, emissive: 0x000000 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.layer = "floors";
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
    for (const seg of segments) {
      const h = seg.height ?? height;
      const color = seg.kind === "exterior" ? colors.exterior : colors.interior;
      // Wandfuß unter dem Boden: schließt die Fuge zur Etage darunter (Deckenstärke)
      prisms.prism(pieceFootprint(seg, 0, seg.length), elev - base, elev, color, colors.cap);
      for (const piece of wallPieces(seg, openings, h)) {
        const foot = pieceFootprint(seg, piece.s0, piece.s1);
        prisms.prism(foot, elev + piece.y0, elev + piece.y1, seg.kind === "exterior" ? colors.exterior : colors.interior, colors.cap);
      }
    }
    const walls = new THREE.Mesh(prisms.geometry(), this.mats.wall);
    walls.userData.layer = "walls";
    group.add(walls);
    if (cyber) {
      // Neonkanten an allen Wandkanten, Raumumrisse in Magenta knapp über dem Boden
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(walls.geometry, 25), this.mats.edge);
      edges.userData.layer = "walls";
      group.add(edges);
      for (const room of floor.rooms ?? []) {
        const line = outline(room.points, elev + 0.015, this.mats.outline);
        line.userData.layer = "floors";
        group.add(line);
      }
    }
    // Möbel (NeonPlan furniture[]); Lampen mit Entität leuchten, wenn das Licht an ist
    const furn = new THREE.Group();
    furn.userData.layer = "furniture";
    for (const item of floor.furniture ?? []) {
      const obj = buildFurniture(item, this.furnMats, elev, floor.height ?? 2.5);
      const entity = item.entity && item.entity !== "none" ? item.entity : null;
      if (entity) {
        obj.traverse((o) => (o.userData.entity = entity));
        if (!this.lampBulbs.has(entity)) this.lampBulbs.set(entity, []);
        this.lampBulbs.get(entity).push(...obj.userData.bulbs);
      }
      furn.add(obj);
    }
    group.add(furn);
    entry.occluders.push(walls);

    // Öffnungen
    const segById = new Map(segments.map((s) => [s.id, s]));
    for (const placed of openings) {
      const seg = segById.get(placed.segment);
      const item = this._buildOpening(seg, placed, elev, seg.height ?? height);
      item.group.userData.layer = "openings";
      group.add(item.group);
      entry.openings.set(placed.opening.id, item);
    }

    // Garten; Gartenflächen mit Bereich bekommen einen Anker für Beschriftung und Geräte
    for (const area of floor.outdoor ?? []) {
      garden.add(this._buildOutdoor(area, elev));
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
      const pane = box(width - 2 * f, h - 2 * f, 0.01, this.mats.glass, 0, h / 2, 0);
      pane.renderOrder = 3;
      group.add(pane);
      item.panes.push(pane);
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

  _buildOutdoor(area, elev) {
    const look = OUTDOOR[area.type] ?? OUTDOOR.lawn;
    const group = new THREE.Group();
    const heights = Array.isArray(area.heights) && area.heights.length === area.points.length ? area.heights.map((h) => Number(h) || 0) : null;
    let geo;
    if (heights && look.h === 0) {
      // schräge Fläche (Hang, Böschung): Höhe je Eckpunkt
      geo = slopedSurface(area.points, heights);
    } else {
      geo = flatOrExtruded(area.points, look.h);
      if (heights) geo.translate(0, heights.reduce((a, b) => a + b, 0) / heights.length, 0);
    }
    geo.translate(0, elev + look.y, 0);
    const mesh = new THREE.Mesh(geo, this.outdoorMats[area.type] ?? this.outdoorMats.lawn);
    group.add(mesh);
    if (this.mats.gardenLine) {
      const hs = Array.isArray(area.heights) && area.heights.length === area.points.length ? area.heights : null;
      group.add(outline(area.points, elev + look.y + look.h + 0.01, this.mats.gardenLine, hs));
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
    return group;
  }

  _buildEnergy(building) {
    // Schuppen mit Balkonkraftwerk: Raum mit area_id "balkonkraftwerk" (oder Name "Schuppen")
    let shed = null;
    for (const floor of building.floors ?? []) {
      const room = (floor.rooms ?? []).find((r) => r.area_id === "balkonkraftwerk") ?? (floor.rooms ?? []).find((r) => /schuppen/i.test(r.name));
      if (room) {
        shed = { floor, room };
        break;
      }
    }
    if (!shed) return;
    const entry = this.floors.get(shed.floor.id);
    const elev = shed.floor.elevation ?? 0;
    const top = elev + (shed.floor.height ?? 2.5);
    const tilt = THREE.MathUtils.degToRad(20);
    const solar = new THREE.Group();
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
    const nx = Math.max(1, Math.floor((a1 - a0 - 0.2) / (pw + 0.05)));
    const nz = Math.max(1, Math.floor((b1 - b0 - 0.2) / rowDepth));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const la = a0 + (i + 0.5) * ((a1 - a0) / nx);
        const lb = b0 + (j + 0.5) * ((b1 - b0) / nz);
        const [px, pz] = toPlan([la, lb]);
        if (!pointInPolygon([px, pz], shed.room.points)) continue;
        const holder = new THREE.Group();
        holder.rotation.y = yaw;
        holder.position.set(px, top + 0.35, pz);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.04, pd), [this.mats.solarFrame, this.mats.solarFrame, this.mats.solar, this.mats.solarFrame, this.mats.solarFrame, this.mats.solarFrame]);
        panel.rotation.x = -tilt; // Nordkante (+z) oben
        holder.add(panel);
        solar.add(holder);
      }
    }
    solar.userData.layer = "solar";
    entry.group.add(solar);

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
      const shared = [...Object.values(this.mats), ...Object.values(this.outdoorMats), ...Object.values(this.furnMats ?? {})];
      for (const m of [].concat(o.material ?? [])) if (!shared.includes(m)) m.dispose();
    });
  }

  // ------------------------------------------------------------------ Etagen und Kamera

  /** "all" oder eine Etagen-ID. */
  setFilter(filter, { fit = false } = {}) {
    this.filter = this.floors.has(filter) ? filter : "all";
    for (const [id, entry] of this.floors) entry.group.visible = this.filter === "all" || this.filter === id;
    this._syncDeviceVisibility();
    if (fit) this.fitCamera();
    this._cameraMoved();
  }

  isFloorVisible(floorId) {
    return this.filter === "all" || this.filter === floorId;
  }

  fitCamera() {
    const box = new THREE.Box3();
    for (const entry of this.floors.values()) {
      if (!entry.group.visible) continue;
      // Gartenflächen nicht mitzählen, sonst wird das Haus zu klein
      for (const m of entry.occluders) box.expandByObject(m);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 4) * 0.5;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect) * 1.05;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.35, 0.95, 0.75).normalize().multiplyScalar(dist));
    this.controls.update();
    this._cameraMoved();
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
          if (this.dark && this.style !== "cyber") color.multiplyScalar(0.8);
        }
        r.mesh.material.emissive.copy(lit && !s.tempMode ? WARM : new THREE.Color(0x000000));
        r.mesh.material.emissiveIntensity = lit ? 0.45 : 0;
        r.glow.visible = lit && !s.tempMode;
      }
      for (const [openingId, item] of entry.openings) {
        const key = `${floorId}:${openingId}`;
        const open = s.open.has(key);
        for (const m of item.frames) m.material = open ? this.mats.frameAlert : this.mats.frame;
        for (const p of item.panes) p.material = open ? this.mats.glassAlert : this.mats.glass;
        for (const solid of item.solids) solid.material = open ? this.mats.frameAlert : solid.userData.base;
        for (const leaf of item.leaves) {
          leaf.pivot.position.copy(open ? leaf.open : leaf.closed);
          leaf.pivot.rotation.y = open ? leaf.angle : 0;
        }
        const closed = s.covers.get(key);
        if (item.garage) {
          const frac = closed == null ? (open ? 0.15 : 1) : Math.max(0.08, closed);
          item.garage.scale.y = frac;
          item.garage.material = open ? this.mats.frameAlert : this.mats.garage;
        } else if (item.blind) {
          item.blind.visible = closed != null && closed > 0.02;
          item.blind.scale.y = Math.max(0.02, closed ?? 0);
        }
      }
    }
    for (const [entity, bulbs] of this.lampBulbs) {
      const on = s.onEntities?.has(entity);
      for (const b of bulbs) b.material = on ? this.furnMats.bulbOn : this.furnMats.bulb;
    }
    this._applySelection();
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
    return this.raycaster.intersectObjects(targets, false).length > 0;
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
  }

  _kick() {
    if (!this._running || this._raf) return;
    this._raf = requestAnimationFrame(() => this._frame());
  }

  _frame() {
    this._raf = null;
    if (!this._running) return;
    const dt = Math.min(0.1, this._clock.getDelta());
    const moving = this.controls.update();
    const flowing = this.flow && this.flow.speed > 0 && this.isFloorVisible(this.flow.floorId);
    if (flowing) {
      this.flow.phase = (this.flow.phase + dt * this.flow.speed) % 1;
      const n = this.flow.dots.length;
      this.flow.dots.forEach((d, i) => d.position.copy(this.flow.curve.getPointAt((this.flow.phase + i / n) % 1)));
    }
    if (this._dirty || moving || flowing) {
      this.renderer.render(this.scene, this.camera);
      this._dirty = false;
    }
    if (this._camDirty || moving) {
      this._camDirty = false;
      this.onCameraChange();
    }
    // weiterlaufen, solange gedämpft gedreht wird oder Energie fließt; sonst bis zur nächsten Änderung schlafen
    if (moving || flowing) this._kick();
  }

  dispose() {
    this.stop();
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
