// L1: Leitungsnetz – Hauptverteilung setzen, Leitung ab HV, zweite Leitung als Abzweig, Höhe eines Punkts
// nachträglich ändern, Fluss auf dem ganzen Weg (auch auf dem Zubringer ohne eigenes Ziel), Details beim
// Antippen, Durchführung mit Gegenstück auf anderer Etage
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const ed = await t.page("l1", "?power", { width: 1280, height: 800 });
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
const kueche = await E(() => window.panel._editor.floor.rooms.find((r) => r.area_id === "kueche").id);

// Hauptverteilung in der Küche (x 7..11, z 0..4)
await ed.locator("haus3d-panel .ed-bar button[data-tool=node]").click();
await ed.locator('haus3d-panel .ed-props [data-nk="hv"]').click();
await click(7.5, 0.6);
const hv = await E(() => window.panel._editor.floor.nodes.at(-1));
t.check(hv?.kind === "hv", `HV: ${JSON.stringify(hv)}`);

// Zubringer ab der HV (rastet am Verteiler ein), ohne Ziel
await ed.locator("haus3d-panel .ed-bar button[data-tool=pipe]").click();
await click(hv.x + 0.05, hv.z + 0.05);
await click(hv.x, 3.5);
await E(() => window.panel._editor._draftAction("done"));
await ed.waitForTimeout(150);
const zu = await E(() => structuredClone(window.panel._editor.floor.pipes.at(-1)));
t.check(zu.points[0][0] === hv.x && zu.points[0][1] === hv.z, `Zubringer beginnt an der HV: ${JSON.stringify(zu.points)}`);
// Abzweig: beginnt auf dem Zubringer, endet in der Küche (Raum mit Verbrauch)
await ed.locator("haus3d-panel .ed-bar button[data-tool=pipe]").click();
await click(hv.x + 0.06, 2.0);
const marker = await E(() => !!window.panel._editor.svg.querySelector("text") && [...window.panel._editor.svg.querySelectorAll("text")].some((x) => x.textContent === "Abzweig"));
await click(10, 2.0);
await E(() => window.panel._editor._draftAction("done"));
await ed.waitForTimeout(150);
const ab = await E(() => structuredClone(window.panel._editor.floor.pipes.at(-1)));
t.results.abzweig = { start: ab.points[0], marker };
t.check(ab.points[0][0] === hv.x, `Abzweig rastet auf der Leitung ein: ${JSON.stringify(ab.points[0])}`);
await ed.locator("haus3d-panel .ed-props select[data-pf=room]").selectOption(kueche);
await ed.waitForTimeout(100);
await t.shot(ed, "l1-plan.png");

// Höhe eines Punkts der gelegten Zubringer-Leitung nachträglich ändern
await E((id) => {
  const e = window.panel._editor;
  e.sel = { kind: "pipe", id };
  e.render();
  e.renderProps();
}, zu.id);
const [px, py] = await toScreen(zu.points[1][0], zu.points[1][1]);
await ed.mouse.click(px, py);
await ed.waitForTimeout(150);
const box = await E(() => window.panel._editor.props.querySelector(".ptbox")?.textContent.replace(/\s+/g, " "));
t.check(/Punkt 2 von 2/.test(box ?? ""), `Punkt gewählt: ${box}`);
await ed.locator('haus3d-panel .ed-props [data-pth] [data-h="0.3"]').click();
const hs = await E((id) => window.panel._editor.floor.pipes.find((x) => x.id === id).heights, zu.id);
t.check(hs[1] === 0.3 && hs[0] !== 0.3, `Höhe je Punkt: ${JSON.stringify(hs)}`);

// Durchführung zum Keller: Gegenstück entsteht
await ed.locator("haus3d-panel .ed-bar button[data-tool=node]").click();
await ed.locator('haus3d-panel .ed-props [data-nk="durch"]').click();
await click(10.5, 3.5);
await ed.locator("haus3d-panel .ed-props select[data-link]").selectOption("kg");
const links = await E(() => {
  const b = window.panel._editor.b;
  const eg = b.floors.find((f) => f.id === "eg").nodes.find((n) => n.kind === "durch");
  const kg = (b.floors.find((f) => f.id === "kg").nodes ?? []).find((n) => n.kind === "durch");
  return { eg: eg?.link, kg: kg?.link, kgId: kg?.id, egId: eg?.id };
});
t.check(links.eg === links.kgId && links.kg === links.egId, `Durchführung: ${JSON.stringify(links)}`);

// Speichern: Fluss auf dem ganzen Weg
await ed.locator('haus3d-panel .ed [data-act="save"]').click();
await ed.waitForTimeout(1500);
const flow = await E(([zuId, abId]) => {
  const net = window.panel._net;
  const pick = (id) => net.edges.filter((e) => e.pipeId === id).sort((a, b) => a.s0 - b.s0).map((e) => Math.round(e.value));
  const s = window.panel._scene;
  const dots = [...s._pipeEdges.values()].reduce((n, e) => n + e.dots.filter((d) => d.visible).length, 0);
  return { zu: pick(zuId), ab: pick(abId), dots };
}, [zu.id, ab.id]);
t.results.fluss = flow;
t.check(flow.zu[0] > 0 && flow.zu[0] === flow.ab[0] && flow.zu.at(-1) === 0 && flow.dots > 0, `Fluss: ${JSON.stringify(flow)}`);

// Antippen: Details mit Wert und Verbraucher
await E((id) => window.panel._pipePopup({ pipe: id, at: 0.2 }), zu.id);
await ed.waitForTimeout(200);
const pop = await E(() => window.panel.shadowRoot.querySelector(".pipepop")?.textContent.replace(/\s+/g, " "));
t.results.popup = pop;
t.check(/\d+ W/.test(pop ?? "") && /Küche/.test(pop ?? "") && /fließt zum Ende/.test(pop ?? ""), `Popup: ${pop}`);
await E((id) => window.panel._focusRoom({ floorId: "eg", roomId: id }), kueche);
await ed.waitForTimeout(1800);
await t.shot(ed, "l1-3d.png");
await t.done();
