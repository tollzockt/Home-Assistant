import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUptime, isNetworkTracker, networkDevices, networkInfo, networkRole, signalLevel } from "../../custom_components/haus3d/frontend/network.js";
import { iconKind } from "../../custom_components/haus3d/frontend/devices.js";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const s = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });
const hass = {
  states: {
    "device_tracker.ap_flur": s("device_tracker.ap_flur", "home", { source_type: "router", mac: "aa:01", friendly_name: "AP Flur", ip: "10.0.0.2" }),
    "sensor.ap_flur_uptime": s("sensor.ap_flur_uptime", new Date(NOW - (2 * 86400 + 3 * 3600) * 1000).toISOString(), { device_class: "timestamp" }),
    "sensor.ap_flur_clients": s("sensor.ap_flur_clients", "5"),
    "button.ap_flur_restart": s("button.ap_flur_restart", "unknown"),
    "device_tracker.tv": s("device_tracker.tv", "home", { source_type: "router", ip: "10.0.0.50", is_wired: false, essid: "Netz", signal: -63, ap_mac: "AA:01", friendly_name: "TV" }),
    "device_tracker.drucker": s("device_tracker.drucker", "not_home", { source_type: "router", is_wired: true, friendly_name: "Drucker" }),
    "device_tracker.handy": s("device_tracker.handy", "home", { source_type: "gps", friendly_name: "Handy" }),
  },
  entities: {
    "device_tracker.ap_flur": { device_id: "d1", platform: "unifi" },
    "sensor.ap_flur_uptime": { device_id: "d1", platform: "unifi" },
    "sensor.ap_flur_clients": { device_id: "d1", platform: "unifi" },
    "button.ap_flur_restart": { device_id: "d1", platform: "unifi", entity_category: "config" },
  },
  devices: { d1: { model: "U6 Lite", manufacturer: "Ubiquiti Networks", name: "AP Flur" } },
};

test("Netzwerk-Tracker: nur source_type router, Symbolart network", () => {
  assert.equal(isNetworkTracker(hass.states["device_tracker.tv"]), true);
  assert.equal(isNetworkTracker(hass.states["device_tracker.handy"]), false);
  assert.equal(iconKind(hass.states["device_tracker.tv"]), "network");
  assert.equal(iconKind(hass.states["device_tracker.handy"]), null);
});

test("networkInfo: Werte aus Attributen und Geschwister-Entitäten", () => {
  const ap = networkInfo("device_tracker.ap_flur", hass, NOW);
  assert.equal(ap.role, "ap");
  assert.equal(ap.uptime, "2 T 3 h");
  assert.equal(ap.restart, "button.ap_flur_restart");
  assert.deepEqual(ap.extra.map((x) => [x.key, x.text]), [["clients", "5"]]);
  assert.equal(ap.unifi, true);
  const tv = networkInfo("device_tracker.tv", hass, NOW);
  assert.equal(tv.role, "client");
  assert.equal(tv.ap, "AP Flur"); // per MAC gefunden (Groß/klein egal)
  assert.equal(tv.wired, false);
  assert.equal(tv.signal.level, 3);
  assert.equal(networkInfo("device_tracker.drucker", hass).online, false);
});

test("Hilfen: Laufzeit, Signal, Rolle, Liste", () => {
  assert.equal(formatUptime(125), "2 min");
  assert.equal(formatUptime(3 * 3600 + 60), "3 h 1 min");
  assert.equal(formatUptime("kaputt"), null);
  assert.equal(signalLevel(-85).level, 0);
  assert.equal(signalLevel(null), null);
  assert.equal(networkRole(s("device_tracker.x", "home", { friendly_name: "USW Lite 8" })), "switch");
  assert.equal(networkRole(s("device_tracker.x", "home", { friendly_name: "Dream Machine" })), "gateway");
  const list = networkDevices(hass);
  assert.deepEqual(list.map((n) => n.id), ["device_tracker.ap_flur", "device_tracker.tv", "device_tracker.drucker"]);
});
