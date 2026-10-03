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
