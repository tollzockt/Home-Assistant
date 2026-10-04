// Rad-Menüs, Kurzwahl und Karten
import assert from "node:assert/strict";
import { test } from "node:test";

import { FUNCTION_KEYS, labelPlace, normalizeCards, normalizeFunctions, nextStyle, quickService, rotateWheel, wheelLayout, wheelPlusAngle } from "../../custom_components/haus3d/frontend/hud.js";

test("Rad: 4 sichtbar im Viertelkreis, dahinter fest das +, mehr wird durchgedreht", () => {
  const three = wheelLayout(3);
  assert.deepEqual(three.map((p) => p.angle), [0, 22.5, 45]);
  assert.equal(wheelPlusAngle(3), 67.5);
  const eight = wheelLayout(8, 0);
  assert.equal(eight.filter((p) => p.visible).length, 4);
  assert.deepEqual(eight.slice(0, 4).map((p) => p.angle), [0, 22.5, 45, 67.5]);
  assert.equal(wheelPlusAngle(8), 90);
  // Ausgeblendete warten vor dem Anfang (letzter) bzw. hinter dem +
  assert.equal(eight[7].angle, -22.5);
  assert.equal(eight[5].angle, 90);
  // eine Position weiter: Eintrag 1 steht oben, Eintrag 0 ist vor den Anfang gewandert (unsichtbar)
  const off = rotateWheel(0, 1, 8);
  const turned = wheelLayout(8, off);
  assert.equal(turned[1].angle, 0);
  assert.equal(turned[0].visible, false);
  assert.equal(turned[0].angle, -22.5);
  assert.equal(rotateWheel(0, -1, 8), 7);
  assert.equal(rotateWheel(3, 1, 4), 0); // passt alles hinein: keine Drehung
  assert.deepEqual([0, 22.5, 45, 67.5, 90].map(labelPlace), ["top", "diag", "diag", "diag", "side"]);
});

test("Funktionsrad: Standard, Reihenfolge, eigene Einträge", () => {
  assert.deepEqual(normalizeFunctions(undefined).map((f) => f.key), FUNCTION_KEYS);
  const f = normalizeFunctions([{ key: "grid" }, { key: "grid" }, { key: "quatsch" }, { entity: "script.kino", name: "Kino" }, { entity: "kaputt" }, { key: "flow" }]);
  assert.deepEqual(f, [{ key: "grid" }, { entity: "script.kino", name: "Kino" }, { key: "flow" }]);
  assert.deepEqual(normalizeFunctions([]), []);
});

test("Kurzwahl-Dienste", () => {
  assert.deepEqual(quickService("automation.abend"), ["automation", "trigger"]);
  assert.deepEqual(quickService("script.garage"), ["script", "turn_on"]);
  assert.deepEqual(quickService("scene.kino"), ["scene", "turn_on"]);
  assert.deepEqual(quickService("button.klingel"), ["button", "press"]);
  assert.deepEqual(quickService("lock.tuer", { state: "locked" }), ["lock", "unlock"]);
  assert.deepEqual(quickService("light.flur"), ["light", "toggle"]);
});

test("Karten werden bereinigt und auf 5 begrenzt", () => {
  const cards = normalizeCards([{ title: "Heizung", icon: "mdi:fire", entities: ["sensor.vorlauf", { entity: "climate.hk", name: "Modus" }, { entity: "kaputt" }] }, ...Array(9).fill({})]);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards[0].entities, [{ entity: "sensor.vorlauf" }, { entity: "climate.hk", name: "Modus" }]);
  assert.equal(cards[1].icon, "mdi:card-text-outline");
  assert.equal(nextStyle("auto"), "day");
  assert.equal(nextStyle("cyber"), "auto");
});
