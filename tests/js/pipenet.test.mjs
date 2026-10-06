import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNet, flowLook, fmtFlow } from "../../custom_components/haus3d/frontend/pipenet.js";

const P = (id, type, points, extra = {}) => ({ id, type, points, ...extra });
const B = (floors) => ({ floors });
const byPipe = (net, id) => net.edges.filter((e) => e.pipeId === id);

test("Garage-Zubringer: Strom fließt auf beiden Leitungen bis zum Büro", () => {
  const b = B([{ id: "eg", nodes: [{ id: "hv", kind: "hv", x: 0, z: 0 }], pipes: [
    P("zu_garage", "strom", [[0, 0], [5, 0]]),
    P("garage_buero", "strom", [[5, 0], [5, 4]], { room: "buero" }),
  ] }]);
  const net = computeNet(b, { load: (p) => (p.room === "buero" ? 300 : null) });
  for (const id of ["zu_garage", "garage_buero"]) {
    const [e] = byPipe(net, id);
    assert.equal(e.value, 300, id);
    assert.equal(e.reverse, false, id); // in Zeichenrichtung (von der HV weg)
  }
});

test("Abzweig mitten auf einer Leitung: davor die Summe, danach nur der Rest", () => {
  const b = B([{ id: "eg", nodes: [{ id: "hv", kind: "hv", x: 0, z: 0 }], pipes: [
    P("haupt", "strom", [[0, 0], [10, 0]], { room: "kueche" }),
    P("abzweig", "strom", [[4, 0.02], [4, 3]], { room: "bad" }), // beginnt 2 cm neben der Leitung
  ] }]);
  const net = computeNet(b, { load: (p) => ({ kueche: 500, bad: 200 })[p.room] ?? null });
  const haupt = byPipe(net, "haupt").sort((x, y) => x.s0 - y.s0);
  assert.equal(haupt.length, 2);
  assert.equal(haupt[0].value, 700);
  assert.equal(haupt[1].value, 500);
  assert.equal(byPipe(net, "abzweig")[0].value, 200);
  const d = net.details(haupt[0].id);
  assert.deepEqual(d.sinks.map((s) => s.value), [500, 200]);
});

test("Unterverteilung mit Zähler: oberhalb gemessen, Rest als nicht zugeordnet", () => {
  const b = B([{ id: "eg", nodes: [{ id: "hv", kind: "hv", x: 0, z: 0 }, { id: "uv", kind: "uv", x: 6, z: 0, name: "UV OG", entity: "sensor.uv" }], pipes: [
    P("zur_uv", "strom", [[0, 0], [6, 0]]),
    P("uv_raum", "strom", [[6, 0], [6, 5]], { room: "buero" }),
  ] }]);
  const net = computeNet(b, { load: (p) => (p.room ? 800 : null), nodeValue: (n) => (n.id === "uv" ? 1200 : null) });
  assert.equal(byPipe(net, "zur_uv")[0].value, 1200);
  assert.equal(byPipe(net, "uv_raum")[0].value, 800);
  assert.equal(net.nodes.get("uv").unknown, 400);
  assert.ok(net.details(byPipe(net, "zur_uv")[0].id).sinks.some((s) => /nicht zugeordnet/.test(s.name) && s.value === 400));
});

test("Balkonkraftwerk speist mehr ein als verbraucht wird: Fluss Richtung Hauptverteilung", () => {
  const b = B([{ id: "eg", nodes: [{ id: "hv", kind: "hv", x: 0, z: 0 }, { id: "bkw", kind: "einspeisung", x: 8, z: 0 }], pipes: [
    P("bkw_hv", "strom", [[8, 0], [0, 0]]), // gezeichnet vom BKW zur HV
    P("hv_haus", "strom", [[0, 0], [0, 4]], { room: "wohnen" }),
  ] }]);
  const net = computeNet(b, { load: (p) => (p.room ? 200 : null), nodeValue: (n) => (n.kind === "einspeisung" ? 600 : null) });
  const [e] = byPipe(net, "bkw_hv");
  assert.equal(e.value, 600);
  assert.equal(e.reverse, false); // fließt in Zeichenrichtung BKW → HV
  assert.equal(byPipe(net, "hv_haus")[0].value, 200);
});

test("Durchführung verbindet Keller und EG", () => {
  const b = B([
    { id: "kg", nodes: [{ id: "hv", kind: "hv", x: 0, z: 0 }, { id: "d1", kind: "durch", x: 3, z: 3, link: "d2" }], pipes: [P("kg_hoch", "strom", [[0, 0], [3, 0], [3, 3]])] },
    { id: "eg", nodes: [{ id: "d2", kind: "durch", x: 3, z: 3, link: "d1" }], pipes: [P("eg_raum", "strom", [[3, 3], [7, 3]], { room: "wohnen" })] },
  ]);
  const net = computeNet(b, { load: (p) => (p.room ? 450 : null) });
  assert.equal(byPipe(net, "kg_hoch")[0].value, 450);
  assert.equal(byPipe(net, "eg_raum")[0].value, 450);
});

test("Netzwerk und Wasser getrennt vom Strom; Darstellung nach Menge", () => {
  const b = B([{ id: "eg", nodes: [{ id: "r", kind: "router", x: 0, z: 0 }, { id: "hv", kind: "hv", x: 0, z: 0 }], pipes: [
    P("lan", "netzwerk", [[0, 0], [4, 0]], { device: "device_tracker.tv" }),
    P("strom", "strom", [[0, 0], [0, 4]], { room: "x" }),
  ] }]);
  const net = computeNet(b, { load: (p) => (p.type === "netzwerk" ? 50 : 100) });
  assert.equal(byPipe(net, "lan")[0].value, 50);
  assert.equal(byPipe(net, "lan")[0].unit, "Mbit/s");
  assert.equal(byPipe(net, "strom")[0].value, 100);
  assert.equal(flowLook(2, "W").active, false);
  assert.ok(flowLook(3000, "W").perMeter > flowLook(100, "W").perMeter);
  assert.equal(fmtFlow(1250, "W"), "1,25 kW");
});

test("ohne Hauptverteilung: Anfang der Leitung ist die Quelle (wie bisher)", () => {
  const net = computeNet(B([{ id: "eg", pipes: [P("a", "strom", [[0, 0], [3, 0]], { room: "r" })] }]), { load: () => 120 });
  assert.equal(net.edges[0].value, 120);
  assert.equal(net.edges[0].reverse, false);
});
