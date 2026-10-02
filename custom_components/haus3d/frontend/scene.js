// 3D-Szene: baut das Haus einmal aus den Daten und ändert bei Zustandswechseln nur Materialien,
// Sichtbarkeit und Skalierung (kein Neuaufbau der Geometrie).

import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
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

    this.mats = {
      wall: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fd3f0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
      glassAlert: new THREE.MeshStandardMaterial({ color: ALERT, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
      frame: new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.6 }),
      frameAlert: new THREE.MeshStandardMaterial({ color: ALERT, emissive: ALERT, emissiveIntensity: 0.5 }),
      door: new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 }),
      frontDoor: new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 }),
      garage: new THREE.MeshStandardMaterial({ color: 0xd5d5d5, roughness: 0.5, metalness: 0.2 }),
      blind: new THREE.MeshStandardMaterial({ color: 0x7b7b7b, roughness: 0.8 }),
      glow: new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
      water: new THREE.MeshStandardMaterial({ color: 0x2f9fe0, transparent: true, opacity: 0.85, roughness: 0.1, emissive: 0x0b4f7a, emissiveIntensity: 0.4 }),
      solar: new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.3, metalness: 0.4 }),
      solarFrame: new THREE.MeshStandardMaterial({ color: 0xb0b6bd, metalness: 0.6, roughness: 0.4 }),
      flowLine: new THREE.MeshBasicMaterial({ color: 0xffc107, transparent: true, opacity: 0.35 }),
      flowDot: new THREE.MeshBasicMaterial({ color: 0xffd54f }),
    };
    this.outdoorMats = Object.fromEntries(Object.entries(OUTDOOR).map(([k, v]) => [k, new THREE.MeshStandardMaterial({ color: v.color, roughness: 1 })]));

    this.root = new THREE.Group();
    this.scene.add(this.root);
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
    this.scene.background = new THREE.Color(dark ? 0x1b1f24 : 0xe9eef2);
    this.hemi.intensity = dark ? 1.1 : 1.6;
    this.sun.intensity = dark ? 1.1 : 1.6;
    this.invalidate();
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
    for (const floor of building.floors ?? []) this._buildFloor(floor, building.settings ?? {}, footing(building.floors, floor));
    this._buildEnergy(building);
    this.setFilter(this.filter, { fit: !keepCamera });
  }

  _buildFloor(floor, settings, base = SLAB) {
    const group = new THREE.Group();
    group.name = `floor:${floor.id}`;
    const elev = floor.elevation ?? 0;
    const entry = { floor, group, rooms: new Map(), openings: new Map(), occluders: [] };

    // Böden
    for (const room of floor.rooms ?? []) {
      const geo = flatOrExtruded(room.points, SLAB);
      geo.translate(0, elev - SLAB, 0);
      const base = new THREE.Color(FLOOR_COLORS[room.floor_material] ?? FLOOR_COLORS.wood);
      const mat = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.85, emissive: 0x000000 });
      const mesh = new THREE.Mesh(geo, mat);
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
    const colors = {
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
    group.add(walls);
    entry.occluders.push(walls);

    // Öffnungen
    const segById = new Map(segments.map((s) => [s.id, s]));
    for (const placed of openings) {
      const seg = segById.get(placed.segment);
      const item = this._buildOpening(seg, placed, elev, seg.height ?? height);
      group.add(item.group);
      entry.openings.set(placed.opening.id, item);
    }

    // Garten
    for (const area of floor.outdoor ?? []) group.add(this._buildOutdoor(area, elev));

    this.root.add(group);
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
    const geo = flatOrExtruded(area.points, look.h);
    geo.translate(0, elev + look.y, 0);
    const mesh = new THREE.Mesh(geo, this.outdoorMats[area.type] ?? this.outdoorMats.lawn);
    group.add(mesh);
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
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.035, 6, false), this.mats.flowLine);
    entry.group.add(line);
    const dots = [];
    const dotGeo = new THREE.SphereGeometry(0.11, 12, 8);
    for (let i = 0; i < 10; i++) {
      const dot = new THREE.Mesh(dotGeo, this.mats.flowDot);
      dot.visible = false;
      entry.group.add(dot);
      dots.push(dot);
    }
    this.flow = { floorId: shed.floor.id, curve, line, dots, phase: 0, speed: 0 };
    this.anchors.push({ key: "energy", floorId: shed.floor.id, position: start.clone().add(new THREE.Vector3(0, 0.6, 0)) });
  }

  _dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !Object.values(this.mats).includes(o.material) && !Object.values(this.outdoorMats).includes(o.material)) {
        for (const m of [].concat(o.material)) if (!Object.values(this.mats).includes(m)) m.dispose();
      }
    });
  }

  // ------------------------------------------------------------------ Etagen und Kamera

  /** "all" oder eine Etagen-ID. */
  setFilter(filter, { fit = false } = {}) {
    this.filter = this.floors.has(filter) ? filter : "all";
    for (const [id, entry] of this.floors) entry.group.visible = this.filter === "all" || this.filter === id;
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
          if (this.dark) color.multiplyScalar(0.8);
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
    for (const m of [...Object.values(this.mats), ...Object.values(this.outdoorMats)]) m.dispose();
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

