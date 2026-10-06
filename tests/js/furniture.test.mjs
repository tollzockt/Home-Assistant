// Möbel: jede Art lässt sich bauen und steht in genau einer Kategorie
import assert from "node:assert/strict";
import { test } from "node:test";

import { FURNITURE, FURNITURE_CATEGORIES, buildFurniture, furnitureMaterials } from "../../custom_components/haus3d/frontend/furniture.js";

test("Kategorien enthalten jeden Möbeltyp genau einmal", () => {
  const listed = FURNITURE_CATEGORIES.flatMap(([, types]) => types);
  assert.deepEqual([...listed].sort(), Object.keys(FURNITURE).sort());
  assert.equal(new Set(listed).size, listed.length);
});

test("Jeder Typ baut ein Modell in seinen Maßen, auch mit eigener Farbe", () => {
  for (const style of ["standard", "cyber"]) {
    const M = furnitureMaterials(style);
    for (const [type, [, w, d, h]] of Object.entries(FURNITURE)) {
      const g = buildFurniture({ id: type, type, x: 1, z: 2, rotation: 90, w, d, h, color: "#ff0000" }, M, 0, 2.5);
      assert.ok(g.children.length > 0, type);
      assert.equal(g.position.x, 1);
    }
  }
});

test("Erweiterter Katalog: Montagehöhen, freie Typen, Lampen und PV-Module gültig", async () => {
  const { EXTRA, EXTRA_FREE, EXTRA_LAMPS, EXTRA_MOUNT, pvModules } = await import("../../custom_components/haus3d/frontend/catalog-extra.js");
  for (const k of [...Object.keys(EXTRA_MOUNT), ...EXTRA_FREE, ...EXTRA_LAMPS]) assert.ok(EXTRA[k], k);
  for (const [k, [name, w, d, h]] of Object.entries(EXTRA)) assert.ok(name && w > 0 && d > 0 && h > 0, k);
  assert.ok(FURNITURE_CATEGORIES.find(([c]) => c === "Licht")[1].includes("lamp_chandelier"));
  assert.deepEqual(pvModules("pv_flat_south", 2.3, 1.7), { across: 2, rows: 1 });
  assert.deepEqual(pvModules("pv_flat_ew", 2.3, 3.4), { across: 2, rows: 4 });
  assert.deepEqual(pvModules("pv_balcony", 3.45, 0.08), { across: 2, rows: 1 });
  // Wandgeräte hängen in ihrer Montagehöhe, Deckenleuchten unter der Decke
  const M = furnitureMaterials("standard");
  assert.equal(buildFurniture({ id: "w", type: "wallbox_goe", x: 0, z: 0 }, M, 0, 2.5).position.y, 1.0);
  const ch = buildFurniture({ id: "k", type: "lamp_chandelier", x: 0, z: 0 }, M, 0, 2.5);
  assert.ok(Math.abs(ch.position.y - (2.5 - 0.7 - 0.01)) < 1e-9);
  // Lampen und RGB-Teile leuchten (bulbs)
  for (const t of ["lamp_ring", "led_hex", "gaming_pc", "wallbox_tesla"]) assert.ok(buildFurniture({ id: t, type: t, x: 0, z: 0 }, M, 0, 2.5).userData.bulbs.length > 0, t);
});
