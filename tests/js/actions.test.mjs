// Was ein Tipp auslöst: Nachfrage bei heiklen Aktionen, Automationen nur aus der Kurzwahl
import assert from "node:assert/strict";
import { test } from "node:test";

import { bulkCalls, entityAction, lockText } from "../../custom_components/haus3d/frontend/actions.js";

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

test("Schloss: Aufschließen mit Nachfrage, Abschließen sofort, blockiert → Details", () => {
  const a = entityAction("lock.haustuer", st("lock.haustuer", "locked"));
  assert.deepEqual(a.call, ["lock", "unlock"]);
  assert.equal(a.confirm.ok, "Aufschließen");
  assert.ok(a.confirm.danger);
  const b = entityAction("lock.haustuer", st("lock.haustuer", "unlocked"));
  assert.deepEqual(b.call, ["lock", "lock"]);
  assert.equal(b.confirm, null);
  assert.equal(entityAction("lock.haustuer", st("lock.haustuer", "jammed")).dialog, "moreinfo");
  assert.equal(lockText("jammed"), "blockiert");
  // Sicherheit aus: ohne Nachfrage
  assert.equal(entityAction("lock.haustuer", st("lock.haustuer", "locked"), { safety: false }).confirm, null);
});

test("Garagentor: ausdrücklich öffnen/schließen mit Nachfrage; Rollladen ohne", () => {
  const g = entityAction("cover.garage", st("cover.garage", "open", { device_class: "garage" }));
  assert.deepEqual(g.call, ["cover", "close_cover"]);
  assert.ok(g.confirm);
  const h = entityAction("cover.tor", st("cover.tor", "closed", { device_class: "gate" }));
  assert.deepEqual(h.call, ["cover", "open_cover"]);
  assert.equal(h.verb, "wird geöffnet");
  const r = entityAction("cover.rollladen", st("cover.rollladen", "open", { device_class: "shutter" }));
  assert.deepEqual(r.call, ["cover", "toggle"]);
  assert.equal(r.confirm, null);
});

test("Automation: Tipp im Haus zeigt Details, Kurzwahl löst aus", () => {
  assert.equal(entityAction("automation.x", st("automation.x", "on")).dialog, "moreinfo");
  assert.deepEqual(entityAction("automation.x", st("automation.x", "on"), { source: "wheel" }).call, ["automation", "trigger"]);
});

test("Sirene, Medien, Licht, Klima, nicht erreichbar, Häkchen „Nachfragen“", () => {
  assert.ok(entityAction("siren.alarm", st("siren.alarm", "off")).confirm);
  assert.equal(entityAction("siren.alarm", st("siren.alarm", "on")).confirm, null);
  assert.deepEqual(entityAction("media_player.tv", st("media_player.tv", "playing")).call, ["media_player", "media_play_pause"]);
  const l = entityAction("light.flur", st("light.flur", "on"));
  assert.deepEqual([l.call, l.verb, l.confirm], [["light", "toggle"], "aus", null]);
  assert.equal(entityAction("climate.bad", st("climate.bad", "heat")).dialog, "moreinfo");
  assert.equal(entityAction("light.flur", st("light.flur", "unavailable")).dialog, "moreinfo");
  assert.ok(entityAction("script.kino", st("script.kino", "off"), { source: "wheel", confirm: true }).confirm);
  assert.deepEqual(entityAction("switch.x", undefined, { source: "wheel" }).call, ["switch", "toggle"]);
});

test("Sammel-Aktionen: ein Aufruf je Dienst", () => {
  const calls = bulkCalls([
    { entity_id: "light.a", call: ["light", "turn_off"] },
    { entity_id: "light.b", call: ["light", "turn_off"] },
    { entity_id: "light.a", call: ["light", "turn_off"] },
    { entity_id: "cover.c", call: ["cover", "close_cover"] },
    { entity_id: "x", call: null },
  ]);
  assert.deepEqual(calls, [
    { domain: "light", service: "turn_off", data: { entity_id: ["light.a", "light.b"] } },
    { domain: "cover", service: "close_cover", data: { entity_id: ["cover.c"] } },
  ]);
});
