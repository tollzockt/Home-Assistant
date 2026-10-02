#!/usr/bin/env node
// Bereitet einen NeonPlan-Export für Haus 3D auf:
//  1. Etagen mit weniger als 1 m Höhe (z. B. "Garten unten/oben", als Räume gezeichnet) werden aufgelöst:
//     ihre Flächen werden Gartenflächen (outdoor[]) der Hausetage auf gleicher Höhe. Bereich (area_id)
//     und Name bleiben erhalten. Der Schuppen (area_id balkonkraftwerk) bleibt ein Raum.
//  2. Lücken zwischen Räumen werden geschlossen (gegenüberliegende Kanten auf eine Mittellinie).
//  3. settings.energy bekommt die Startwerte, falls sie fehlen.
//
//   node tools/neonplan_aufbereiten.mjs <export.json> <ausgabe.json>

import { readFileSync, writeFileSync } from "node:fs";

import { closeGaps, computeWalls } from "../custom_components/haus3d/frontend/walls.js";
import { DEFAULT_ENERGY } from "../custom_components/haus3d/frontend/model.js";

const TYPES = [
  [/terrass/i, "terrace"],
  [/einfahrt|parkplatz|stellplatz|carport/i, "driveway"],
  [/pool|teich/i, "pool"],
  [/weg|pfad/i, "path"],
  [/beet/i, "bed"],
  [/hecke/i, "hedge"],
  [/zaun/i, "fence"],
];

export function prepare(raw) {
  const b = structuredClone(raw.format ? raw.building : raw);
  const log = [];
  const houseFloors = b.floors.filter((f) => f.height >= 1);
  for (const garden of b.floors.filter((f) => f.height < 1)) {
    const target = houseFloors.reduce((best, f) => (!best || Math.abs(f.elevation - garden.elevation) < Math.abs(best.elevation - garden.elevation) ? f : best), null);
    if (!target || Math.abs(target.elevation - garden.elevation) > 0.5) {
      log.push(`Etage ${garden.name}: keine Hausetage auf gleicher Höhe, bleibt bestehen`);
      continue;
    }
    for (const r of garden.rooms) {
      if (r.area_id === "balkonkraftwerk" || /schuppen|gartenhaus/i.test(r.name)) {
        target.rooms.push(r);
        log.push(`${r.name}: Raum auf ${target.name}`);
        continue;
      }
      const type = TYPES.find(([re]) => re.test(r.name))?.[1] ?? "lawn";
      const area = { id: r.id, type, points: r.points, name: r.name };
      if (r.area_id) area.area_id = r.area_id;
      target.outdoor.push(area);
      log.push(`${r.name}: ${type} auf ${target.name}${r.area_id ? ` (Bereich ${r.area_id})` : ""}`);
    }
    target.outdoor.push(...(garden.outdoor ?? []));
    b.floors = b.floors.filter((f) => f !== garden);
  }
  for (const f of b.floors) {
    const before = computeWalls(f, b.settings).segments.filter((s) => s.kind === "interior").length;
    const { rooms, gaps } = closeGaps(f.rooms);
    f.rooms = rooms;
    const after = computeWalls(f, b.settings).segments.filter((s) => s.kind === "interior").length;
    log.push(`${f.name}: ${gaps.length} Lücken geschlossen, Innenwände ${before} -> ${after}`);
  }
  b.settings = b.settings ?? {};
  b.settings.energy = { ...DEFAULT_ENERGY, ...(b.settings.energy ?? {}) };
  return { building: b, log };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Aufruf: node tools/neonplan_aufbereiten.mjs <export.json> <ausgabe.json>");
    process.exit(2);
  }
  const { building, log } = prepare(JSON.parse(readFileSync(input, "utf8")));
  for (const line of log) console.log(line);
  writeFileSync(output, JSON.stringify(building, null, 2) + "\n");
  console.log(`gespeichert: ${output}`);
}
