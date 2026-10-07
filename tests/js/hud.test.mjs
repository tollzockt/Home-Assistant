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
  // Raster, Stil, Dach … stehen seit 0.16 im Zahnrad und fallen still aus dem Rad
  assert.deepEqual(f, [{ entity: "script.kino", name: "Kino" }, { key: "flow" }]);
  for (const k of ["style", "roof", "grid", "weather", "labels", "devices", "furniture", "presence", "fullscreen", "shadows"]) assert.ok(!FUNCTION_KEYS.includes(k), k);
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

test("Funktionsrad: neue eingebaute Schlüssel kommen einmal dazu, ausgeblendete bleiben weg", async () => {
  const hud = await import("../../custom_components/haus3d/frontend/hud.js");
  const { normalizeFunctions, FUNCTION_KEYS, LEGACY_FUNCTION_KEYS } = hud;
  assert.deepEqual(normalizeFunctions([]), []); // alles bewusst ausgeblendet und gespeichert
  // Nutzer hat bis 0.13 „Raster“ ausgeblendet: bleibt weg, auch wenn er functions_seen noch nicht hat
  const saved = LEGACY_FUNCTION_KEYS.filter((k) => k !== "grid").map((key) => ({ key }));
  const out = normalizeFunctions(saved, LEGACY_FUNCTION_KEYS);
  assert.ok(!out.some((f) => f.key === "grid"));
  // ein neuer Schlüssel (simuliert) erscheint am Ende
  FUNCTION_KEYS.push("neu_test");
  try {
    const withNew = normalizeFunctions(saved, LEGACY_FUNCTION_KEYS);
    assert.equal(withNew.at(-1).key, "neu_test");
    assert.ok(!normalizeFunctions(saved, [...LEGACY_FUNCTION_KEYS, "neu_test"]).some((f) => f.key === "neu_test"));
  } finally {
    FUNCTION_KEYS.pop();
  }
  assert.deepEqual(normalizeFunctions([{ entity: "script.x", confirm: true }])[0], { entity: "script.x", confirm: true });
});

test("Bodenfarbe: durchschalten und alte Einstellung übernehmen", async () => {
  const { nextView, migrateView } = await import("../../custom_components/haus3d/frontend/hud.js");
  assert.deepEqual(["none", "temp", "humidity", "co2", "power", "energy"].map(nextView), ["temp", "humidity", "co2", "power", "energy", "none"]);
  assert.equal(migrateView(null, "1"), "temp");
  assert.equal(migrateView(null, "0"), "none");
  assert.equal(migrateView("humidity", "1"), "humidity");
});

test("Rad stufenlos: Lage, Ein-/Ausblenden, Fingerwinkel, Schwung", async () => {
  const { wheelPositions, pointerAngle, wheelFling } = await import("../../custom_components/haus3d/frontend/hud.js");
  const p0 = wheelPositions(8, 0);
  assert.deepEqual(p0.slice(0, 4).map((p) => [p.angle, p.opacity]), [[0, 1], [22.5, 1], [45, 1], [67.5, 1]]);
  assert.equal(p0[4].opacity, 0);
  assert.equal(p0[7].angle, -22.5); // wartet vor dem Bogen
  const half = wheelPositions(8, 0.5);
  assert.equal(half[0].angle, -11.25);
  assert.equal(half[0].opacity, 0.5);
  assert.equal(half[4].angle, 78.75);
  assert.equal(half[4].opacity, 0.5);
  // wenige Einträge: fest
  assert.deepEqual(wheelPositions(3, 1.7).map((p) => p.angle), [0, 22.5, 45]);
  // Finger: rechts oben über dem Knopf 0°, links daneben 90°
  assert.ok(Math.abs(pointerAngle("right", 100, 100, 100, 0)) < 1e-9);
  assert.ok(Math.abs(pointerAngle("right", 100, 100, 0, 100) - 90) < 1e-9);
  assert.ok(Math.abs(pointerAngle("left", 0, 100, 100, 100) - 90) < 1e-9);
  assert.equal(wheelFling(2.4, 0), 2);
  assert.ok(wheelFling(2, 0.01) > 2);
  assert.ok(wheelFling(2, -0.01) < 2);
  assert.ok(wheelFling(0, 1) <= 6);
});
