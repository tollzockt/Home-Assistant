// Rad-Menüs, Kurzwahl und Karten
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeCards, nextStyle, quickService, rotateWheel, wheelLayout } from "../../custom_components/haus3d/frontend/hud.js";

test("Rad: bis 5 sichtbar im Viertelkreis, mehr wird durchgedreht", () => {
  const four = wheelLayout(4);
  assert.deepEqual(four.map((p) => p.angle), [0, 30, 60, 90]);
  assert.ok(four.every((p) => p.visible));
  const eight = wheelLayout(8, 0);
  assert.equal(eight.filter((p) => p.visible).length, 5);
  assert.deepEqual(eight.slice(0, 5).map((p) => p.angle), [0, 22.5, 45, 67.5, 90]);
  // eine Position weiter: Eintrag 1 steht oben, Eintrag 0 ist ans Ende gewandert (unsichtbar)
  const off = rotateWheel(0, 1, 8);
  const turned = wheelLayout(8, off);
  assert.equal(turned[1].angle, 0);
  assert.equal(turned[0].visible, false);
  assert.equal(rotateWheel(0, -1, 8), 7);
  assert.equal(rotateWheel(3, 1, 4), 0); // passt alles hinein: keine Drehung
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
