// Kameras, Medien, Saugroboter, Abläufe an der Kurzwahl
import assert from "node:assert/strict";
import { test } from "node:test";

import { cameraSrc, doorbellRang, guessDoorbell, mediaCall, mediaInfo, routineInfo, vacuumCall, vacuumInfo } from "../../custom_components/haus3d/frontend/media.js";

const S = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

test("Medienplayer: Titel, Tasten nach supported_features, Dienste", () => {
  const st = S("media_player.wohnzimmer", "playing", { friendly_name: "Wohnzimmer", media_title: "Song", media_artist: "Band", volume_level: 0.35, supported_features: 1 | 4 | 8 | 16 | 32 | 16384 });
  const m = mediaInfo(st);
  assert.equal(m.title, "Song");
  assert.equal(m.artist, "Band");
  assert.equal(m.volume, 35);
  assert.deepEqual(m.can, { playPause: true, prev: true, next: true, volume: true, mute: true, power: false });
  assert.deepEqual(mediaCall(m, "volume", 50), ["media_player", "volume_set", { entity_id: "media_player.wohnzimmer", volume_level: 0.5 }]);
  assert.deepEqual(mediaCall(m, "mute"), ["media_player", "volume_mute", { entity_id: "media_player.wohnzimmer", is_volume_muted: true }]);
  const off = mediaInfo(S("media_player.tv", "off", { supported_features: 128 | 256 | 1 }));
  assert.equal(off.can.playPause, false);
  assert.equal(off.can.power, true);
  assert.deepEqual(mediaCall(off, "power"), ["media_player", "turn_on", { entity_id: "media_player.tv" }]);
});

test("Saugroboter: Zustand und Tasten", () => {
  const v = vacuumInfo(S("vacuum.robbi", "docked", { battery_level: 87, supported_features: 4 | 16 | 512 | 8192 }));
  assert.equal(v.stateText, "in der Station");
  assert.equal(v.battery, 87);
  assert.deepEqual(v.can, { start: true, pause: false, home: false, locate: true });
  const c = vacuumInfo(S("vacuum.robbi", "cleaning", { supported_features: 4 | 16 | 8192 }));
  assert.deepEqual(c.can, { start: false, pause: true, home: true, locate: false });
  assert.deepEqual(vacuumCall(c, "home"), ["vacuum", "return_to_base", { entity_id: "vacuum.robbi" }]);
});

test("Kamera-Bild und Klingel", () => {
  const cam = S("camera.haustuer", "idle", { entity_picture: "/api/camera_proxy/camera.haustuer?token=abc" });
  assert.equal(cameraSrc(cam, 5), "/api/camera_proxy/camera.haustuer?token=abc&t=5");
  assert.equal(cameraSrc(S("camera.x", "unavailable", { entity_picture: "/a" })), null);
  const e0 = S("event.klingel", "2026-10-05T10:00:00Z", { device_class: "doorbell" });
  const e1 = S("event.klingel", "2026-10-05T10:05:00Z", { device_class: "doorbell" });
  assert.equal(doorbellRang(e0, e1), true);
  assert.equal(doorbellRang(e1, e1), false);
  assert.equal(doorbellRang(null, e1), false);
  assert.equal(doorbellRang(S("binary_sensor.klingel", "off"), S("binary_sensor.klingel", "on")), true);
  assert.equal(guessDoorbell({ "event.klingel": e1 }), "event.klingel");
  assert.equal(guessDoorbell({ "binary_sensor.tuer_klingel": S("binary_sensor.tuer_klingel", "off") }), "binary_sensor.tuer_klingel");
  assert.equal(guessDoorbell({}), null);
});

test("Abläufe: läuft, zuletzt, Link zum Ablauf", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const a = routineInfo(S("automation.licht_abends", "on", { id: "1700", current: 1, last_triggered: "2026-10-05T11:50:00Z" }), now);
  assert.deepEqual(a, { running: true, off: false, last: Date.parse("2026-10-05T11:50:00Z"), lastText: "vor 10 min", trace: "/config/automation/trace/1700", edit: "/config/automation/edit/1700" });
  const s = routineInfo(S("script.gute_nacht", "off", {}), now);
  assert.equal(s.running, false);
  assert.equal(s.lastText, "noch nie");
  assert.equal(s.trace, "/config/script/trace/gute_nacht");
  assert.equal(routineInfo(S("automation.x", "off", {}), now).off, true);
  assert.equal(routineInfo(S("light.x", "on"), now), null);
});
