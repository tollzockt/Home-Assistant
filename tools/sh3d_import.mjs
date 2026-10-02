#!/usr/bin/env node
// Importiert einen Sweet-Home-3D-Plan (.sh3d) ins Haus-3D-/NeonPlan-Format.
//
//   node tools/sh3d_import.mjs plan.sh3d ausgabe.json [--vorlage haus3d.json]
//
// Aus der .sh3d-Datei kommen Räume (Innenmaße, Lücken werden geschlossen), Fenster, Türen und
// Garagentore. Mit --vorlage (ein Haus-3D- oder NeonPlan-Stand desselben Hauses) werden der Plan
// auf deren Koordinaten verschoben und von dort Raumnamen, Bereiche (area_id), Bodenbeläge,
// Etagen (Name, Höhe, HA-Etage), Gartenflächen und Einstellungen übernommen. Die Punktreihenfolge
// der Räume folgt dann der Vorlage, damit "edge"-Angaben (Kante i) dieselbe Wand meinen.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

import { closeGaps, pointInPolygon, signedArea } from "../custom_components/haus3d/frontend/walls.js";
import { DEFAULT_ENERGY } from "../custom_components/haus3d/frontend/model.js";

// ------------------------------------------------------------------ .sh3d lesen (ZIP, Home.xml)

export function readHomeXml(buf) {
  // Zentralverzeichnis suchen (End of Central Directory)
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("keine ZIP-Datei (.sh3d)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === "Home.xml") {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("Home.xml fehlt (Sweet Home 3D ab Version 5.3 speichert sie mit)");
}

const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)='([^']*)'|([\w:-]+)="([^"]*)"/g)].map((m) => (m[1] ? [m[1], m[2]] : [m[3], m[4]])));
const num = (v, d = 0) => (v === undefined || v === "" ? d : Number(v));

/** Ebenen, Räume und Öffnungen aus Home.xml (Meter, Plan x/z = Sweet Home x/y). */
export function parseHome(xml) {
  const levels = [...xml.matchAll(/<level\b([^>]*?)\/?>/g)].map((m) => attrs(m[1]));
  const rooms = [...xml.matchAll(/<room\b([^>]*)>([\s\S]*?)<\/room>/g)].map((m) => {
    const a = attrs(m[1]);
    const points = [...m[2].matchAll(/<point\b([^>]*)\/>/g)].map((p) => {
      const pa = attrs(p[1]);
      return [num(pa.x) / 100, num(pa.y) / 100];
    });
    // Sweet Home schließt Polygone teils mit dem Startpunkt
    if (points.length > 3 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-6) points.pop();
    return { level: a.level ?? null, name: a.name ?? null, points };
  });
  const openings = [...xml.matchAll(/<doorOrWindow\b([^>]*?)(\/>|>)/g)].map((m) => {
    const a = attrs(m[1]);
    return {
      level: a.level ?? null,
      name: a.name ?? "",
      x: num(a.x) / 100,
      z: num(a.y) / 100,
      angle: num(a.angle),
      width: num(a.width) / 100,
      depth: num(a.depth) / 100,
      height: num(a.height) / 100,
      sill: num(a.elevation) / 100,
      mirrored: a.modelMirrored === "true",
    };
  });
  return {
    levels: levels.map((l) => ({ id: l.id, name: l.name, elevation: num(l.elevation) / 100, height: num(l.height, 250) / 100 })),
    rooms,
    openings,
  };
}

// ------------------------------------------------------------------ Hilfen

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
};

/** Überlappungsfläche zweier Polygone (Rasterschätzung, 5 cm). */
function overlap(a, b) {
  const [ax0, az0, ax1, az1] = bbox(a);
  const [bx0, bz0, bx1, bz1] = bbox(b);
  const x0 = Math.max(ax0, bx0);
  const x1 = Math.min(ax1, bx1);
  const z0 = Math.max(az0, bz0);
  const z1 = Math.min(az1, bz1);
  if (x1 <= x0 || z1 <= z0) return 0;
  const step = 0.05;
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (pointInPolygon([x, z], a) && pointInPolygon([x, z], b)) n++;
  return n * step * step;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Größte zusammenhängende Gruppe von Räumen (Begrenzungsboxen höchstens 1 m auseinander): der Hauskörper. */
function houseCluster(rooms) {
  const boxes = rooms.map((r) => bbox(r.points));
  const near = (a, b) => a[0] - 1 <= b[2] && b[0] - 1 <= a[2] && a[1] - 1 <= b[3] && b[1] - 1 <= a[3];
  const seen = new Set();
  let best = [];
  rooms.forEach((_, i) => {
    if (seen.has(i)) return;
    const group = [i];
    seen.add(i);
    for (let k = 0; k < group.length; k++) {
      boxes.forEach((b, j) => {
        if (!seen.has(j) && near(boxes[group[k]], b)) {
          seen.add(j);
          group.push(j);
        }
      });
    }
    if (group.length > best.length) best = group;
  });
  return best.map((i) => rooms[i]);
}

function openingType(name) {
  if (/garage|tor\b/i.test(name)) return "garage";
  if (/tür|tuer|door/i.test(name)) return "door";
  return "window";
}

/** Legt eine Öffnung auf die nächstgelegene Raumkante (Abstand der Mitte zur Kantengeraden). */
function attach(o, rooms) {
  let best = null;
  for (const room of rooms) {
    const pts = room.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.3) continue;
      const ux = dx / len;
      const uz = dz / len;
      // Öffnung muss parallel zur Kante stehen (Sweet Home: Breite entlang cos/sin des Winkels)
      if (Math.abs(Math.abs(Math.cos(o.angle) * ux + Math.sin(o.angle) * uz) - 1) > 0.05) continue;
      const t = (o.x - p[0]) * ux + (o.z - p[1]) * uz;
      const dist = Math.abs((o.x - p[0]) * -uz + (o.z - p[1]) * ux);
      if (t < 0.05 || t > len - 0.05 || dist > 0.45) continue;
      const fit = Math.min(t, len - t) >= o.width / 2 - 0.05 ? 0 : 1; // passt ganz auf die Kante
      const score = fit * 10 + dist;
      if (!best || score < best.score) best = { room, edge: i, offset: t, len, score };
    }
  }
  return best;
}

// ------------------------------------------------------------------ Umwandlung

export function convert(home, vorlage = null) {
  const log = [];
  const tpl = vorlage ? (vorlage.format ? vorlage.building : vorlage) : null;
  const tplFloors = tpl ? tpl.floors.filter((f) => f.height >= 1) : [];
  const levels = [...home.levels].sort((a, b) => a.elevation - b.elevation);
  const floors = [];

  // Zuordnung Ebene -> Etage der Vorlage mit Verschiebung: Hauskörper (ohne freistehende Räume
  // wie den Schuppen) an der linken oberen Ecke ausrichten, Paarung mit der größten Überlappung
  const raw = levels.map((level) => home.rooms.filter((r) => r.level === level.id && r.points.length >= 3 && Math.abs(signedArea(r.points)) > 0.3));
  const match = new Map(); // Ebenenindex -> {floorTpl, dx, dz}
  if (tpl) {
    const cands = [];
    raw.forEach((rs, li) => {
      if (!rs.length) return;
      const [sx, sz] = bbox(houseCluster(rs).flatMap((r) => r.points));
      for (const f of tplFloors) {
        const [tx, tz] = bbox(houseCluster(f.rooms).flatMap((r) => r.points));
        const dx = tx - sx;
        const dz = tz - sz;
        const moved = rs.map((r) => r.points.map(([x, z]) => [x + dx, z + dz]));
        const a = moved.reduce((s, pts) => s + f.rooms.reduce((t, fr) => t + overlap(pts, fr.points), 0), 0);
        cands.push({ li, f, dx, dz, a });
      }
    });
    cands.sort((p, q) => q.a - p.a);
    const usedF = new Set();
    for (const c of cands) {
      if (match.has(c.li) || usedF.has(c.f) || c.a < 1) continue;
      match.set(c.li, { floorTpl: c.f, dx: c.dx, dz: c.dz });
      usedF.add(c.f);
      log.push(`${levels[c.li].name ?? c.li} -> ${c.f.name}: verschoben um (${r3(c.dx)}, ${r3(c.dz)}) m, Überlappung ${r3(c.a)} m²`);
    }
  }

  levels.forEach((level, li) => {
    const { floorTpl = null, dx = 0, dz = 0 } = match.get(li) ?? {};
    let rooms = raw[li].map((r, i) => ({ id: `sh3d_${li}_${i}`, name: r.name ?? `Raum ${i + 1}`, area_id: null, floor_material: "wood", points: r.points.map(([x, z]) => [r3(x + dx), r3(z + dz)]) }));
    const closed = closeGaps(rooms);
    rooms = closed.rooms;
    const floor = {
      id: floorTpl?.id ?? `level_${li}`,
      name: floorTpl?.name ?? level.name ?? `Ebene ${li + 1}`,
      elevation: floorTpl?.elevation ?? r3(level.elevation - levels[0].elevation),
      height: floorTpl?.height ?? level.height,
      cut_height: floorTpl?.cut_height ?? 1.15,
      rooms,
      openings: [],
      furniture: floorTpl?.furniture ?? [],
      placements: floorTpl?.placements ?? [],
      background: null,
      outdoor: floorTpl?.outdoor ?? [],
      walls: [],
      ha_floor: floorTpl?.ha_floor ?? null,
    };

    // Namen, Bereiche und Punktreihenfolge aus der Vorlage (größte Überlappung, jeder Vorlagenraum einmal)
    if (floorTpl) {
      const used = new Set();
      const pairs = [];
      for (const r of rooms) for (const fr of floorTpl.rooms) pairs.push({ r, fr, a: overlap(r.points, fr.points) });
      pairs.sort((p, q) => q.a - p.a);
      const done = new Set();
      for (const { r, fr, a } of pairs) {
        if (a < 0.5 || done.has(r) || used.has(fr)) continue;
        done.add(r);
        used.add(fr);
        Object.assign(r, { id: fr.id, name: fr.name, area_id: fr.area_id ?? null, floor_material: fr.floor_material ?? "wood" });
        if (fr.climate) r.climate = fr.climate;
        // gleicher Umlaufsinn und Startpunkt wie in der Vorlage
        if (Math.sign(signedArea(r.points)) !== Math.sign(signedArea(fr.points))) r.points.reverse();
        const s = fr.points[0];
        let k = 0;
        r.points.forEach((p, i) => {
          if (Math.hypot(p[0] - s[0], p[1] - s[1]) < Math.hypot(r.points[k][0] - s[0], r.points[k][1] - s[1])) k = i;
        });
        r.points = [...r.points.slice(k), ...r.points.slice(0, k)];
      }
      for (const fr of floorTpl.rooms) if (!used.has(fr)) {
        floor.rooms.push(fr); // Räume, die es in Sweet Home nicht gibt (z. B. Schuppen), bleiben
        log.push(`${floor.name}: ${fr.name} aus der Vorlage übernommen`);
      }
      for (const r of rooms) if (!done.has(r)) log.push(`${floor.name}: Raum ohne Gegenstück in der Vorlage (${r.id})`);
    }

    // Öffnungen
    let n = 0;
    for (const o of home.openings.filter((x) => x.level === level.id)) {
      const pos = { ...o, x: o.x + dx, z: o.z + dz };
      const hit = attach(pos, floor.rooms);
      if (!hit) {
        log.push(`${floor.name}: ${o.name} bei (${r3(pos.x)}, ${r3(pos.z)}) liegt an keiner Raumkante`);
        continue;
      }
      const type = openingType(o.name);
      n++;
      floor.openings.push({
        id: `${floor.id}_o${n}`,
        room_id: hit.room.id,
        edge: hit.edge,
        offset: r3(hit.offset),
        width: r3(o.width),
        type,
        sill: type === "window" ? r3(o.sill) : 0,
        height: r3(o.height),
        hinge: o.mirrored ? "right" : "left",
        leaves: 1,
        swing: "in",
        style: /vorder|haus/i.test(o.name) ? "front" : /nicht zu öffnen|fest/i.test(o.name) ? "standard" : null,
        contact2: null,
        cover: null,
        contact: null,
        tilt: null,
        name: o.name,
      });
    }
    log.push(`${floor.name}: ${rooms.length} Räume, ${closed.gaps.length} Lücken geschlossen, ${n} Fenster/Türen`);
    floors.push(floor);
  });

  const settings = { wall_exterior: 0.24, wall_interior: 0.12, grid: 0.05, north: 0, ...(tpl?.settings ?? {}) };
  settings.energy = { ...DEFAULT_ENERGY, ...(settings.energy ?? {}) };
  return { building: { version: 1, floors, settings, energy: tpl?.energy, presence: tpl?.presence ?? [] }, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const vi = args.indexOf("--vorlage");
  const vorlage = vi >= 0 ? JSON.parse(readFileSync(args[vi + 1], "utf8")) : null;
  const [input, output] = args.filter((_, i) => vi < 0 || (i !== vi && i !== vi + 1));
  if (!input || !output) {
    console.error("Aufruf: node tools/sh3d_import.mjs plan.sh3d ausgabe.json [--vorlage haus3d.json]");
    process.exit(2);
  }
  const home = parseHome(readHomeXml(readFileSync(input)));
  const { building, log } = convert(home, vorlage);
  for (const line of log) console.log(line);
  writeFileSync(output, JSON.stringify(building, null, 2) + "\n");
  console.log(`gespeichert: ${output}`);
}
