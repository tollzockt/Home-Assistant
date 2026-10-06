// H6: Leitungen im Editor legen (Strom an der Wand, Höhenwechsel), Zielraum wählen, in 3D als Rohr mit
// laufenden Punkten, solange der Raum Strom braucht; Wasser mit Ventil
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const ed = await t.page("h6", "?power", { width: 1280, height: 800 });
const E = (fn, arg) => ed.evaluate(fn, arg);
await E(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.waitForTimeout(300);
const toScreen = (x, z) => E(([x, z]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
const click = async (x, z) => {
  const [sx, sy] = await toScreen(x, z);
  await ed.mouse.click(sx, sy);
  await ed.waitForTimeout(80);
};
const room = await E(() => {
  const r = window.panel._editor.floor.rooms.find((x) => x.area_id === "kueche");
  return { id: r.id, pts: r.points };
});
const [a, b] = room.pts;
const mid = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

await ed.locator("haus3d-panel .ed-bar button[data-tool=pipe]").click();
await ed.waitForTimeout(100);
const tool = await E(() => window.panel._editor.props.querySelector("h3")?.textContent);
t.check(tool === "Leitung legen", `Werkzeug-Eigenschaften: ${tool}`);
// zwei Punkte an der Wand (knapp daneben → rastet an der Kante ein), dann Höhe „Steckdose“ und dritter Punkt
await click(...mid(0.1));
await click(...mid(0.5));
await ed.locator('haus3d-panel .ed-props [data-pheight] [data-h="0.3"]').click();
await click(...mid(0.8));
const draft = await E(() => structuredClone(window.panel._editor.draft));
t.results.entwurf = draft;
t.check(draft?.pipe && draft.line.length === 3 && draft.heights.at(-1) === 0.3, `Entwurf: ${JSON.stringify(draft)}`);
// Punkte liegen an der Wand (Abstand zur Kante ~4 cm)
const off = await E(([a, b, p]) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  return Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / Math.hypot(dx, dz);
}, [a, b, draft.line[1]]);
t.results.wandabstand = off;
t.check(off > 0.05 && off < 0.25, `Abstand zur Wand: ${off}`);
await t.shot(ed, "h6-entwurf.png");
await E(() => window.panel._editor._draftAction("done"));
await ed.waitForTimeout(150);
const made = await E(() => ({ pipes: structuredClone(window.panel._editor.floor.pipes), head: window.panel._editor.props.querySelector("h3")?.textContent, svg: window.panel._editor.svg.querySelectorAll('[data-kind="pipe"]').length }));
t.results.leitung = made;
t.check(made.pipes?.length === 1 && made.pipes[0].type === "strom" && made.head === "Leitung" && made.svg === 1, `Leitung: ${JSON.stringify(made)}`);
await ed.locator("haus3d-panel .ed-props select[data-pf=room]").selectOption(room.id);
await ed.waitForTimeout(100);
// Wasserleitung mit Ventil
await ed.locator("haus3d-panel .ed-bar button[data-tool=pipe]").click();
await ed.locator('haus3d-panel .ed-props [data-ptype] [data-k="wasser_kalt"]').click();
await click(...mid(0.2).map((v) => v + 1.6));
await click(...mid(0.7).map((v) => v + 1.6));
await E(() => window.panel._editor._draftAction("done"));
await ed.waitForTimeout(100);
await ed.locator("haus3d-panel .ed-props input[data-pf=entity]").fill("switch.kaffeemaschine");
await ed.locator("haus3d-panel .ed-props input[data-pf=entity]").dispatchEvent("change");
await ed.waitForTimeout(100);
const two = await E(() => window.panel._editor.floor.pipes.map((p) => ({ type: p.type, room: p.room, entity: p.entity })));
t.results.zwei = two;
t.check(two.length === 2 && two[0].room === room.id && two[1].type === "wasser_kalt" && two[1].entity === "switch.kaffeemaschine", `Zwei Leitungen: ${JSON.stringify(two)}`);
await t.shot(ed, "h6-plan.png");
// Richtung umdrehen
const before = await E(() => window.panel._editor.floor.pipes[1].points[0]);
await ed.locator("haus3d-panel .ed-props [data-act=pipeflip]").click();
const after = await E(() => window.panel._editor.floor.pipes[1].points.at(-1));
t.check(JSON.stringify(before) === JSON.stringify(after), "Richtung umdrehen");

await ed.locator('haus3d-panel .ed [data-act="save"]').click();
await ed.waitForTimeout(1500);
const scene = await E(() => {
  const s = window.panel._scene;
  return {
    editor: !!window.panel._editor,
    saved: window.panel._building.floors.find((f) => f.id === "eg").pipes?.length,
    pipes: [...s._pipes.values()].map((p) => ({ type: p.type, active: p.active, dots: [...s._pipeEdges.values()].filter((e) => e.pipe === p).reduce((n, e) => n + e.dots.filter((d) => d.visible).length, 0), len: Math.round(p.len * 100) / 100 })),
    ambient: s._pipesActive(),
  };
});
t.results.szene = scene;
t.check(!scene.editor && scene.saved === 2 && scene.pipes.length === 2 && scene.pipes.every((p) => p.active && p.dots > 0) && scene.ambient, `3D: ${JSON.stringify(scene)}`);
// Ventil zu → Wasser steht
await E(() => {
  const h = window.panel.hass;
  window.panel.hass = { ...h, states: { ...h.states, "switch.kaffeemaschine": { ...h.states["switch.kaffeemaschine"], state: "off" } } };
});
await ed.waitForTimeout(400);
const off2 = await E(() => [...window.panel._scene._pipes.values()].map((p) => p.active));
t.check(off2[0] === true && off2[1] === false, `Ventil zu: ${JSON.stringify(off2)}`);
// Ebene „Leitungen“ aus blendet die Rohre aus
await E(() => {
  window.panel._scene.setLayers({ ...window.panel._scene.layers, pipes: false });
});
const hidden = await E(() => [...window.panel._scene._pipes.values()].every((p) => !p.tube.parent.visible) && !window.panel._scene._pipesActive());
t.check(hidden, "Ebene Leitungen aus");
await E(() => window.panel._scene.setLayers({ ...window.panel._scene.layers, pipes: true }));
await E(([id]) => window.panel._focusRoom({ floorId: "eg", roomId: id }), [room.id]);
await ed.waitForTimeout(2000);
await t.shot(ed, "h6-3d.png");
await t.done();
