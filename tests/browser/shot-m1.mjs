// M1: Simulation nur im Admin-Modus (Beispielgeräte mit Leistung), Energiefluss aus blendet Leitungen aus,
// Name oben links im Bearbeiten-Modus, Finger-Scrollen in „Geräte anpassen“, Rahmenfarbe von Fenstern,
// Dachgeschoss als Etage (Dach nur mit Dach in den Einstellungen)
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);

// --- Simulation nur im Admin-Modus --------------------------------------------------------------
let pg = await t.page("m1", "?power");
let E = (fn, arg) => pg.evaluate(fn, arg);
await E(() => window.panel._openSettings());
await pg.waitForTimeout(300);
t.check(!(await E(() => !!window.panel.shadowRoot.querySelector('.basics [data-act="sim"]'))), "Simulations-Kachel ohne Admin sichtbar");
await E(() => window.panel._closeDialog());
await E(() => window.panel._setSim(true));
t.check(!(await E(() => !!window.panel._sim)), "Simulation ohne Admin gestartet");
await unlock(pg, "admin");
await E(() => window.panel._closeDialog());
await E(() => window.panel._openSettings());
await pg.waitForTimeout(300);
t.check(await E(() => !!window.panel.shadowRoot.querySelector('.basics [data-act="sim"]')), "Simulations-Kachel im Admin-Modus fehlt");
await pg.locator('haus3d-panel .basics [data-act="sim"]').click();
await pg.waitForTimeout(600);
t.check(await E(() => !!window.panel._sim), "Simulation im Admin-Modus startet nicht");
// Beispielgeräte: Räume ohne Geräte bekommen Leistung, Licht schaltet sie hoch
await pg.locator("haus3d-panel .simbar [data-sim=demo]").check();
await pg.waitForTimeout(600);
const demo = await E(() => Object.keys(window.panel._hass.states).filter((id) => /^sensor\.sim_.*_leistung$/.test(id)));
t.results.simLeistung = demo.length;
t.check(demo.length > 0, "keine Beispiel-Leistungssensoren");
await t.shot(pg, "m1-simulation.png");
// Admin beenden → Simulation aus
await E(() => window.panel._endAdmin());
await pg.waitForTimeout(800);
t.check(!(await E(() => !!window.panel._sim)), "Simulation läuft nach Admin-Ende weiter");
// alter Merker startet nicht mehr von selbst
await E(() => {
  localStorage.setItem("haus3d.settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("haus3d.settings") ?? "{}"), sim: true, simDemo: false }));
});
pg = await t.page("m1b", "?power");
E = (fn, arg) => pg.evaluate(fn, arg);
t.check(!(await E(() => !!window.panel._sim)), "Simulation startet beim Laden ohne Admin");

// --- Energiefluss aus: Leitungen weg -------------------------------------------------------------
await E(() => {
  const p = window.panel;
  const b = structuredClone(p._building);
  b.floors[0].pipes = [{ id: "test_leitung", type: "strom", points: [[0.5, 0.5], [3, 0.5]], heights: [0.3, 0.3], entity: null, room: null, name: "Test" }];
  p._setBuilding(b, p._revision, { keepCamera: true });
});
await pg.waitForTimeout(500);
const pipeVis = () => E(() => {
  const groups = [];
  window.panel._scene.root.traverse((o) => o.userData.layer === "pipes" && groups.push(o.visible));
  return groups;
});
const vis1 = await pipeVis();
t.check(vis1.length && vis1.every(Boolean), `Leitungen nicht sichtbar: ${vis1}`);
await E(() => window.panel._scene.setLayers({ ...window.panel._scene.layers, flow: false }));
const vis2 = await pipeVis();
t.check(vis2.length && vis2.every((v) => !v), `Leitungen trotz Energiefluss aus sichtbar: ${vis2}`);
await E(() => window.panel._scene.setLayers({ ...window.panel._scene.layers, flow: true }));
t.check((await pipeVis()).every(Boolean), "Leitungen nach Energiefluss an nicht wieder sichtbar");

// --- Name oben links ------------------------------------------------------------------------------
const title = () => E(() => window.panel.shadowRoot.querySelector("header .title").textContent);
t.check((await title()) === "Haus 3D", `Titel: ${await title()}`);
await pg.locator("haus3d-panel header .title").click();
t.check(!(await E(() => !!window.panel.shadowRoot.querySelector("header .titlein"))), "Titel ohne Bearbeiten-Modus änderbar");
await unlock(pg, "edit");
await pg.locator("haus3d-panel header .title").click();
await pg.waitForSelector("haus3d-panel header .titlein");
await pg.keyboard.press("Control+A");
await pg.keyboard.type("Testhaus Süd");
await t.shot(pg, "m1-titel.png");
await pg.keyboard.press("Enter");
await pg.waitForTimeout(600);
t.results.titel = await title();
t.check(t.results.titel === "Testhaus Süd" && (await E(() => window.panel._building.settings.title)) === "Testhaus Süd", `Titel nicht gespeichert: ${t.results.titel}`);
await E(() => window.panel._endEdit());

// --- Geräte anpassen: Finger-Scrollen (Tablet) -----------------------------------------------------
pg = await t.page("m1c", "", { width: 1024, height: 700, touch: true });
E = (fn, arg) => pg.evaluate(fn, arg);
await unlock(pg, "edit");
await E(() => {
  const p = window.panel;
  const b = structuredClone(p._building);
  const room = b.floors.find((f) => f.id === "eg").rooms.find((r) => r.id === "wohnzimmer");
  room.panel = Object.keys(p._hass.states).slice(0, 30);
  p._setBuilding(b, p._revision, { keepCamera: true });
  p._selectRoom({ floorId: "eg", roomId: "wohnzimmer" });
});
await pg.waitForTimeout(400);
await E(() => {
  const p = window.panel;
  const panel = p._panels.at(-1);
  const room = p._building.floors.find((f) => f.id === "eg").rooms.find((r) => r.id === "wohnzimmer");
  p._customizeRoom(panel, room);
});
await pg.waitForTimeout(300);
const box = await pg.locator("haus3d-panel .roompanel.rp-edit .rp-list").boundingBox();
const layout = await E(() => {
  const l = window.panel.shadowRoot.querySelector(".roompanel.rp-edit .rp-list");
  const btns = window.panel.shadowRoot.querySelector(".roompanel.rp-edit .rp-btns").getBoundingClientRect();
  return { scrollH: l.scrollHeight, h: l.clientHeight, btnsVisible: btns.bottom <= window.innerHeight };
});
t.results.liste = layout;
t.check(layout.scrollH > layout.h + 50 && layout.btnsVisible, `Liste scrollt nicht eigenständig / Knöpfe nicht sichtbar: ${JSON.stringify(layout)}`);
const checks0 = await E(() => [...window.panel.shadowRoot.querySelectorAll(".rp-list input[type=checkbox]")].map((c) => c.checked).join());
const cdp = await pg.context().newCDPSession(pg);
const x = box.x + box.width / 2;
const y0 = box.y + box.height - 20;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
for (let i = 1; i <= 10; i++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 - i * 18 }] });
  await pg.waitForTimeout(16);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await pg.waitForTimeout(400);
const scrolled = await E(() => window.panel.shadowRoot.querySelector(".roompanel.rp-edit .rp-list").scrollTop);
const checks1 = await E(() => [...window.panel.shadowRoot.querySelectorAll(".rp-list input[type=checkbox]")].map((c) => c.checked).join());
t.results.fingerScroll = scrolled;
t.check(scrolled > 40, `Finger-Scrollen in „Geräte anpassen“ geht nicht: ${scrolled}`);
t.check(checks0 === checks1, "Wischen hat einen Haken umgeschaltet");
await t.shot(pg, "m1-geraete-scroll.png");

// --- Rahmenfarbe ---------------------------------------------------------------------------------
pg = await t.page("m1d", "");
E = (fn, arg) => pg.evaluate(fn, arg);
await unlock(pg, "edit");
await E(() => window.panel._openEditor());
await pg.waitForTimeout(1200);
const win = await E(() => {
  const ed = window.panel._editor;
  const o = ed.floor.openings.find((x) => x.type === "window");
  ed.sel = { kind: "opening", id: o.id };
  ed.renderProps();
  ed.render();
  return o.id;
});
await pg.waitForTimeout(200);
t.check(await E(() => !!window.panel.shadowRoot.querySelector('.ed-props [data-color="frame_color"]')), "Rahmenfarbe fehlt in den Fenster-Eigenschaften");
await pg.locator('haus3d-panel .ed-props [data-swatch="frame_color"]').nth(2).click();
await pg.waitForTimeout(300);
const fc = await E((id) => window.panel._editor.floor.openings.find((x) => x.id === id).frame_color, win);
t.results.rahmenfarbe = fc;
t.check(/^#[0-9a-f]{6}$/i.test(fc ?? ""), `Rahmenfarbe nicht gesetzt: ${fc}`);
await t.shot(pg, "m1-rahmenfarbe-editor.png");
await pg.locator("haus3d-panel .ed-bar [data-act=save]").click();
await pg.waitForTimeout(1500);
const mat = await E((id) => {
  const s = window.panel._scene;
  for (const entry of s.floors.values()) {
    const item = entry.openings.get(id);
    if (item) return "#" + item.frames[0].material.color.getHexString();
  }
  return null;
}, win);
t.results.rahmen3d = mat;
t.check(mat?.toLowerCase() === fc?.toLowerCase(), `Rahmen in 3D: ${mat} statt ${fc}`);

// --- Dachgeschoss ----------------------------------------------------------------------------------
pg = await t.page("m1e", "");
E = (fn, arg) => pg.evaluate(fn, arg);
await unlock(pg, "edit");
await E(() => window.panel._openEditor());
await pg.waitForTimeout(1200);
const opts = () => E(() => [...window.panel.shadowRoot.querySelectorAll(".ed-bar .floorsel option")].map((o) => o.value));
const o1 = await opts();
t.check(o1.includes("__attic") && !o1.includes("__roof"), `Etagen-Auswahl ohne Dach: ${o1}`);
await pg.locator("haus3d-panel .ed-bar .floorsel").selectOption("__attic");
await pg.waitForTimeout(600);
const dg = await E(() => {
  const ed = window.panel._editor;
  return { attic: !!ed.floor.attic, name: ed.floor.name, floors: ed.b.floors.length };
});
t.results.dachgeschoss = dg;
t.check(dg.attic && dg.name === "Dachgeschoss", `Dachgeschoss nicht angelegt: ${JSON.stringify(dg)}`);
t.check(await E(() => !!window.panel.shadowRoot.querySelector(".ed-props [data-knee]")), "Kniestock fehlt in den Etagen-Eigenschaften");
// Räume ins Dachgeschoss (wie im Erdgeschoss) und Dach an → Dach-Eintrag, Dach auf dem Kniestock
await E(() => {
  const ed = window.panel._editor;
  ed.changeBuilding((b) => {
    const dgFloor = b.floors.find((f) => f.attic);
    const eg = b.floors.find((f) => f.id === "eg");
    dgFloor.rooms = structuredClone(eg.rooms).map((r) => ({ ...r, id: `dg_${r.id}`, area_id: null }));
    b.settings.roof = { type: "gable", pitch: 40, overhang: 0.4 };
  });
  ed.renderBar();
});
await pg.waitForTimeout(300);
const o2 = await opts();
t.check(o2.includes("__roof") && !o2.includes("__attic"), `Etagen-Auswahl mit Dach: ${o2}`);
await pg.locator("haus3d-panel .ed-bar [data-act=save]").click();
await pg.waitForTimeout(2500);
const roof = await E(() => {
  const s = window.panel._scene;
  const dgFloor = window.panel._building.floors.find((f) => f.attic);
  return { top: s.roofModel?.top, base: dgFloor.elevation + dgFloor.knee, attic: s._attic?.floor?.id === dgFloor.id };
});
t.results.dach = roof;
t.check(roof.attic && Math.abs(roof.top - roof.base) < 1e-6, `Dach nicht auf dem Kniestock: ${JSON.stringify(roof)}`);
await E(() => window.panel._setFilter("all"));
await pg.waitForTimeout(800);
await t.shot(pg, "m1-dachgeschoss.png");
await t.done();
