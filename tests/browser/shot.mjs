// Screenshots der Testseite: node tests/browser/shot.mjs <ausgabeordner>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

// Playwright ist global installiert: NODE_PATH="$(npm root -g)" node tests/browser/shot.mjs <ordner>
const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(new URL("../..", import.meta.url).pathname);
const out = process.argv[2] ?? ".";
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
async function shot(name, query, viewport, deviceScaleFactor = 1) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${name} [${m.type()}]: ${m.text()}`); });
  await page.goto(`http://localhost:${port}/tests/browser/harness.html${query}${process.env.HARNESS_DATA ? (query ? "&" : "?") + "data=" + process.env.HARNESS_DATA : ""}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}.png` });
  return page;
}
const desk = await shot("desktop-hell", "", { width: 1280, height: 800 });
// Klick auf ein Licht schaltet, Rechtsklick öffnet den Dialog
const info = await desk.evaluate(() => {
  const root = window.panel.shadowRoot;
  return { icons: root.querySelectorAll(".dev").length, labels: root.querySelectorAll(".label").length, energy: root.querySelector(".energy")?.innerText };
});
const dev = desk.locator('haus3d-panel .dev[title^="light.wohnzimmer_decke"]');
await dev.click();
await dev.click({ button: "right" });
await dev.click({ button: "middle" });
await desk.waitForTimeout(200);
const calls = await desk.evaluate(() => ({ calls: window.calls.filter((c) => c.service), events: window.events }));
// Temperaturansicht + Etage EG
await desk.locator("haus3d-panel .temp").click();
await desk.locator("haus3d-panel .floors button", { hasText: "EG" }).click();
await desk.waitForTimeout(1500);
await desk.screenshot({ path: `${out}/desktop-temperatur-eg.png` });
await desk.locator("haus3d-panel .floors button", { hasText: "KG" }).click();
await desk.locator("haus3d-panel .temp").click();
await desk.waitForTimeout(1500);
await desk.screenshot({ path: `${out}/desktop-kg.png` });
const phone = await shot("handy-dunkel", "?dark&narrow", { width: 390, height: 844 }, 2);
// HiDPI: die Zeichenfläche muss genau den sichtbaren Bereich füllen
const hidpi = await phone.evaluate(() => {
  const root = window.panel.shadowRoot;
  const c = root.querySelector("canvas").getBoundingClientRect();
  const st = root.querySelector(".stage").getBoundingClientRect();
  return { canvas: [Math.round(c.width), Math.round(c.height)], stage: [Math.round(st.width), Math.round(st.height)] };
});
if (hidpi.canvas.join() !== hidpi.stage.join()) errors.push(`HiDPI: Canvas ${hidpi.canvas} ≠ Bühne ${hidpi.stage}`);
const menuVisible = await (await shot("desktop-menu", "", { width: 1280, height: 800 })).evaluate(() => getComputedStyle(window.panel.shadowRoot.querySelector(".menu")).display);
if (menuVisible !== "none") errors.push(`Menüknopf auf breitem Bildschirm sichtbar (${menuVisible})`);
// Cyberpunk-Stil (Umschalter im Kopf)
const cyber = await shot("desktop-cyber", "", { width: 1280, height: 800 });
await cyber.locator("haus3d-panel .gear").click();
await cyber.locator("haus3d-panel .seg[data-key=style] button", { hasText: "Cyberpunk" }).click();
await cyber.locator("haus3d-panel .dialog .close").click();
await cyber.waitForTimeout(1500);
await cyber.screenshot({ path: `${out}/desktop-cyber.png` });
await cyber.locator("haus3d-panel .floors button", { hasText: "EG" }).click();
await cyber.waitForTimeout(1500);
await cyber.screenshot({ path: `${out}/desktop-cyber-eg.png` });
// Einstellungen: Geräte als 3D-Objekte, dann Raum anklicken (erst Etage, dann Raum)
const set = await shot("desktop-3d", "", { width: 1280, height: 800 });
await set.locator("haus3d-panel .gear").click();
await set.waitForTimeout(300);
await set.screenshot({ path: `${out}/einstellungen.png` });
await set.locator("haus3d-panel .seg[data-key=deviceMode] button", { hasText: "3D-Objekte" }).click();
await set.locator("haus3d-panel .dialog .close").click();
await set.locator("haus3d-panel .floors button", { hasText: "EG" }).click();
await set.waitForTimeout(1200);
await set.screenshot({ path: `${out}/desktop-3d.png` });
const box = await set.locator("haus3d-panel canvas").boundingBox();
await set.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
await set.waitForTimeout(1200);
await set.screenshot({ path: `${out}/raum-gewaehlt.png` });
const roomPanel = await set.evaluate(() => window.panel.shadowRoot.querySelector(".roompanel")?.innerText ?? null);
// Editor: Raum ziehen, Bereich zuweisen, Fenster setzen, Möbel platzieren, rückgängig, speichern
const ed = await shot("editor", "", { width: 1280, height: 800 });
await ed.locator("haus3d-panel .edit").click();
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.waitForTimeout(300);
await ed.screenshot({ path: `${out}/editor-start.png` });
const svg = await ed.locator("haus3d-panel .ed-svg").boundingBox();
// Plan-Koordinaten -> Bildschirm über die Transformation des Editors
const toScreen = (x, z) => ed.evaluate(([x, z]) => {
  const e = window.panel._editor; const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
await ed.locator("haus3d-panel .ed-bar button[data-tool=rect]").click();
let [ax, ay] = await toScreen(12, 1); let [bx, by] = await toScreen(15, 4);
await ed.mouse.move(ax, ay); await ed.mouse.down(); await ed.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 }); await ed.mouse.move(bx, by, { steps: 4 }); await ed.mouse.up();
await ed.locator("haus3d-panel .ed-props select[data-room=area_id]").selectOption("gaste_bad");
await ed.locator("haus3d-panel .ed-bar button[data-tool=window]").click();
[ax, ay] = await toScreen(13.5, 1.02); await ed.mouse.click(ax, ay);
await ed.locator("haus3d-panel .ed-props select[data-linkmode=contact]").selectOption("none");
await ed.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
await ed.locator("haus3d-panel .ed-props button[data-furn=bed]").click();
[ax, ay] = await toScreen(13.5, 2.5); await ed.mouse.click(ax, ay);
await ed.locator("haus3d-panel .ed-props input[data-num=rotation]").fill("90");
await ed.locator("haus3d-panel .ed-props input[data-num=rotation]").press("Tab");
// ein zusätzliches Möbel und gleich wieder rückgängig
await ed.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
await ed.locator("haus3d-panel .ed-props button[data-furn=plant]").click();
[ax, ay] = await toScreen(14.5, 3.5); await ed.mouse.click(ax, ay);
await ed.locator("haus3d-panel .ed-bar button[data-act=undo]").click();
await ed.locator("haus3d-panel .ed-bar button[data-tool=select]").click();
await ed.waitForTimeout(300);
await ed.screenshot({ path: `${out}/editor-bearbeitet.png` });
await ed.locator("haus3d-panel .ed-bar button[data-view='3d']").click();
await ed.waitForTimeout(1200);
await ed.screenshot({ path: `${out}/editor-vorschau.png` });
await ed.locator("haus3d-panel .ed-bar button[data-view='split']").click();
await ed.locator("haus3d-panel .ed-bar button[data-act=save]").click();
await ed.waitForTimeout(800);
const saved = await ed.evaluate(() => {
  const msg = window.calls.filter((c) => c.type === "haus3d/building/save").at(-1);
  if (!msg) return null;
  const eg = msg.building.floors.find((f) => f.id === "eg");
  const room = eg.rooms.at(-1);
  return { revision: msg.revision, room: { name: room.name, area: room.area_id, points: room.points },
    window: eg.openings.filter((o) => o.room_id === room.id).map((o) => ({ type: o.type, edge: o.edge, offset: o.offset, contact: o.contact })),
    furniture: eg.furniture.filter((m) => m.x > 12).map((m) => ({ type: m.type, x: m.x, z: m.z, rotation: m.rotation })),
    editorOpen: !!window.panel._editor };
});
// Etappe 1: zwei Raumfenster, verschieben, Gerät ausblenden, Nacht-Stil, Animation
const e1 = await shot("etappe1", "", { width: 1280, height: 800 });
await e1.locator("haus3d-panel .floors button", { hasText: "EG" }).click();
await e1.waitForTimeout(800);
const openRoom = (floorName, roomName) => e1.evaluate(([fn, rn]) => {
  const p = window.panel; const f = p._building.floors.find((x) => x.name === fn);
  p._selectRoom({ floorId: f.id, roomId: f.rooms.find((r) => r.name === rn).id }); }, [floorName, roomName]);
await openRoom("EG", "Wohnzimmer");
await openRoom("EG", "Küche");
await e1.waitForTimeout(600);
const panels = e1.locator("haus3d-panel .roompanel");
const head = panels.nth(1).locator(".rp-head");
const hb = await head.boundingBox();
await e1.mouse.move(hb.x + 60, hb.y + 10); await e1.mouse.down(); await e1.mouse.move(hb.x + 560, hb.y + 40, { steps: 6 }); await e1.mouse.up();
const moved = await panels.nth(1).boundingBox();
// Wohnzimmer: Stehlampe ausblenden
await panels.nth(0).locator(".cfg").click();
await panels.nth(0).locator('input[type=checkbox][data-id="light.wohnzimmer_stehlampe"]').uncheck();
await panels.nth(0).locator(".save").click();
await e1.waitForTimeout(800);
const hiddenSaved = await e1.evaluate(() => {
  const msg = window.calls.filter((c) => c.type === "haus3d/building/save").at(-1);
  const wz = msg?.building.floors.find((f) => f.id === "eg").rooms.find((r) => r.id === "wohnzimmer");
  return { hidden: wz?.hidden_entities, panelCount: window.panel._panels.length,
    stehlampeIcon: [...window.panel.shadowRoot.querySelectorAll(".dev")].some((d) => d.title.startsWith("light.wohnzimmer_stehlampe")) };
});
await e1.screenshot({ path: `${out}/zwei-raumfenster.png` });
// Nacht-Stil
await e1.locator("haus3d-panel .gear").click();
await e1.locator("haus3d-panel .seg[data-key=style] button", { hasText: "Nacht" }).click();
await e1.locator("haus3d-panel .dialog .close").click();
await e1.waitForTimeout(800);
await e1.screenshot({ path: `${out}/nacht.png` });
// Animation: Haustür öffnen, Winkel nach kurzer Zeit zwischen 0 und Ziel
const anim = await e1.evaluate(async () => {
  const p = window.panel;
  const s = { ...p._hass.states["binary_sensor.haustuer"], state: "on" };
  p.hass = { ...p._hass, states: { ...p._hass.states, "binary_sensor.haustuer": s } };
  const item = p._scene.floors.get("eg").openings.get("flur_haustuer");
  await new Promise((r) => setTimeout(r, 150));
  const mid = item.leaves[0].pivot.rotation.y;
  await new Promise((r) => setTimeout(r, 1200));
  return { mid: +mid.toFixed(3), end: +item.leaves[0].pivot.rotation.y.toFixed(3), target: +item.leaves[0].angle.toFixed(3) };
});
// Etappe 2: Dach, Balkon, Pflanzen, Wetter
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close(); // Rechenzeit freigeben
const dach = await shot("dach-regen", "?roof=gable&garden&weather=pouring", { width: 1280, height: 800 });
const outside = await dach.evaluate(() => {
  const sc = window.panel._scene;
  return { roof: sc.roofMeshes.length, roofVisible: sc._roofShown(), weather: sc.weather?.drops.length ?? 0, labelsHidden: [...window.panel.shadowRoot.querySelectorAll(".label")].filter((l) => l.style.display === "none" || l.hidden).length };
});
await dach.locator("haus3d-panel .floors button", { hasText: "EG" }).click();
await dach.waitForTimeout(1200);
outside.roofInEg = await dach.evaluate(() => window.panel._scene._roofShown());
await dach.screenshot({ path: `${out}/eg-regen-balkon.png` });
const schnee = await shot("walmdach-schnee", "?roof=hip&garden&weather=snowy", { width: 1280, height: 800 });
await schnee.locator("haus3d-panel .gear").click();
await schnee.waitForTimeout(300);
await schnee.locator("haus3d-panel .house-cfg select[data-r=type]").selectOption("shed");
await schnee.locator("haus3d-panel .house-save").click();
await schnee.waitForTimeout(800);
outside.savedRoof = await schnee.evaluate(() => window.calls.filter((c) => c.type === "haus3d/building/save").at(-1)?.building.settings.roof.type);
await schnee.locator("haus3d-panel .dialog .close").click();
await schnee.waitForTimeout(800);
await schnee.screenshot({ path: `${out}/pultdach-schnee.png` });
const cyberDach = await shot("cyber-dach", "?roof=gable&garden&weather=rainy", { width: 1280, height: 800 });
await cyberDach.locator("haus3d-panel .gear").click();
await cyberDach.locator("haus3d-panel .seg[data-key=style] button", { hasText: "Cyberpunk" }).click();
await cyberDach.locator("haus3d-panel .dialog .close").click();
await cyberDach.waitForTimeout(1200);
await cyberDach.screenshot({ path: `${out}/cyber-dach.png` });
console.log(JSON.stringify({ outside }));
// Etappe 3: Editor 2D + 3D, Magnet, Pfeiltasten, Möbelkatalog, Farben, eigene Körper, L-Dach
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close();
const e3 = await shot("etappe3", "?roof=gable&lhaus&garden", { width: 1280, height: 800 });
await e3.screenshot({ path: `${out}/l-dach.png` });
await e3.locator("haus3d-panel .edit").click();
await e3.waitForTimeout(400);
await e3.locator("haus3d-panel .floorsel").selectOption("eg");
await e3.locator("haus3d-panel .ed-bar button[data-view='split']").click();
await e3.waitForTimeout(800);
const plan = (x, z) => e3.evaluate(([x, z]) => {
  const e = window.panel._editor; const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
// Möbelkatalog: Kategorien, Vorschaubilder, Suche
await e3.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
await e3.waitForTimeout(2500);
const catalog = await e3.evaluate(() => {
  const el = window.panel._editor.props;
  return { cats: el.querySelectorAll(".cat").length, tiles: el.querySelectorAll(".tile").length, images: el.querySelectorAll(".tile img").length };
});
await e3.screenshot({ path: `${out}/moebelkatalog.png` });
await e3.locator("haus3d-panel .ed-props .search").fill("netz");
const searchHits = await e3.locator("haus3d-panel .ed-props .tile").count();
await e3.locator("haus3d-panel .ed-props .tile[data-furn=network_cabinet]").click();
let [px, py] = await plan(9.5, 1.5); await e3.mouse.click(px, py);
// Magnet: Schrank zur Wand bei x = 11 ziehen (Wohnzimmer/Küche liegen 0..11)
const before = await e3.evaluate(() => { const e = window.panel._editor; return e.floor.furniture.find((m) => m.id === e.sel.id); });
[px, py] = await plan(before.x, before.z);
let [qx, qy] = await plan(10.6, 1.6);
await e3.mouse.move(px, py); await e3.mouse.down(); await e3.mouse.move(qx, qy, { steps: 6 }); await e3.mouse.up();
const magnet = await e3.evaluate(() => { const e = window.panel._editor; const m = e.floor.furniture.find((x) => x.id === e.sel.id); return { x: m.x, z: m.z, rotation: m.rotation }; });
// Pfeiltasten: 2 × hoch (je 5 cm)
await e3.keyboard.press("ArrowUp"); await e3.keyboard.press("ArrowUp");
const nudged = await e3.evaluate(() => { const e = window.panel._editor; const m = e.floor.furniture.find((x) => x.id === e.sel.id); return { z: m.z, undo: e.undoStack.length }; });
// eigener Zylinder mit Farbe
await e3.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
await e3.locator("haus3d-panel .ed-props .search").fill("");
await e3.locator("haus3d-panel .ed-props .tile[data-furn=custom_cylinder]").click();
[px, py] = await plan(5, 2.5); await e3.mouse.click(px, py);
await e3.locator("haus3d-panel .ed-props button[data-swatch=color][data-c='#4f7fa8']").click();
await e3.locator("haus3d-panel .ed-props input[data-m=name]").fill("Regentonne");
await e3.locator("haus3d-panel .ed-props input[data-m=name]").press("Tab");
// Raum: Bodenfarbe und Wandfarbe
await e3.locator("haus3d-panel .ed-bar button[data-tool=select]").click();
[px, py] = await plan(2, 2); await e3.mouse.click(px, py);
await e3.locator("haus3d-panel .ed-props select[data-room=floor_material]").selectOption("walnut");
await e3.locator("haus3d-panel .ed-props button[data-swatch=wall_color][data-c='#9cc0dc']").click();
await e3.waitForTimeout(1500);
await e3.screenshot({ path: `${out}/editor-2d-3d.png` });
// 3D: Möbel in der 3D-Ansicht anklicken wählt es aus
const pick3d = await e3.evaluate(() => {
  const e = window.panel._editor; const sc = e.scene3d;
  const m = e.floor.furniture.find((x) => x.type === "custom_cylinder");
  const r = sc.renderer.domElement.getBoundingClientRect();
  const v = sc.camera.position.clone(); // Mittelpunkt des Zylinders auf den Bildschirm
  const p = new v.constructor(m.x, (e.floor.elevation ?? 0) + 0.5, m.z).project(sc.camera);
  const x = r.left + (p.x + 1) / 2 * r.width; const y = r.top + (1 - p.y) / 2 * r.height;
  return { x, y, hit: sc.pick(x, y, { furniture: true }), id: m.id };
});
// Wand ziehen: Wohnzimmer (0..7 × 0..5), Wand bei x = 7 um 0,5 m nach rechts; Küche geht mit
await e3.locator("haus3d-panel .ed-bar button[data-tool=select]").click();
[px, py] = await plan(2, 2); await e3.mouse.click(px, py);
const wall = await e3.evaluate(() => {
  const e = window.panel._editor; const r = e.floor.rooms.find((x) => x.id === "wohnzimmer");
  const i = r.points.findIndex((p, k) => { const q = r.points[(k + 1) % r.points.length]; return Math.abs(p[0] - 7) < 1e-6 && Math.abs(q[0] - 7) < 1e-6; });
  return i;
});
[px, py] = await plan(7, 1.2); [qx, qy] = await plan(7.5, 1.2);
await e3.mouse.move(px, py); await e3.mouse.down(); await e3.mouse.move(qx, qy, { steps: 5 }); await e3.mouse.up();
const wallMoved = await e3.evaluate((i) => {
  const e = window.panel._editor; const f = e.floor;
  return { edge: i, wz: f.rooms.find((x) => x.id === "wohnzimmer").points.map((p) => p[0]), kueche: f.rooms.find((x) => x.id === "kueche").points.map((p) => p[0]) };
}, wall);
console.log(JSON.stringify({ wallMoved }));
await e3.locator("haus3d-panel .ed-bar button[data-act=save]").click();
await e3.waitForTimeout(800);
const saved3 = await e3.evaluate(() => {
  const msg = window.calls.filter((c) => c.type === "haus3d/building/save").at(-1);
  const eg = msg.building.floors.find((f) => f.id === "eg");
  const wz = eg.rooms.find((r) => r.id === "wohnzimmer");
  const cyl = eg.furniture.find((m) => m.type === "custom_cylinder");
  return { floor: wz.floor_material, wall: wz.wall_color, cyl: { color: cyl.color, name: cyl.name } };
});
console.log(JSON.stringify({ catalog, searchHits, magnet, nudged, pick3d: { hit: pick3d.hit, id: pick3d.id }, saved3 }));
// Simulation: Schalten ohne echte Aufrufe, Dialog, Wetter, Beispielgeräte, lokales Speichern
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close();
const sm = await shot("simulation", "?lhaus", { width: 1280, height: 800 });
await sm.locator("haus3d-panel .gear").click();
await sm.locator("haus3d-panel .simtoggle").click();
await sm.waitForTimeout(800);
const callsBefore = await sm.evaluate(() => window.calls.filter((c) => c.service).length);
const lamp = sm.locator('haus3d-panel .dev[title^="light.wohnzimmer_decke"]');
await lamp.click();
await sm.waitForTimeout(400);
await lamp.click({ button: "right" });
await sm.waitForTimeout(300);
const simDialog = await sm.evaluate(() => !!window.panel.shadowRoot.querySelector(".simdlg"));
await sm.locator("haus3d-panel .simdlg button[data-set=on]").click();
await sm.locator("haus3d-panel .simbar select[data-sim=weather]").selectOption("snowy");
await sm.locator("haus3d-panel .simbar select[data-sim=daytime]").selectOption("night");
await sm.locator("haus3d-panel .simbar input[data-sim=demo]").check();
await sm.waitForTimeout(1500);
await sm.screenshot({ path: `${out}/simulation.png` });
const simState = await sm.evaluate(() => {
  const p = window.panel;
  return { lamp: p._hass.states["light.wohnzimmer_decke"].state, realLamp: p._realHass.states["light.wohnzimmer_decke"].state,
    weather: p._scene._weather?.kind ?? null, night: p.hasAttribute("night"), demo: Object.keys(p._hass.states).filter((e) => e.includes(".sim_")).length,
    newCalls: window.calls.filter((c) => c.service).length };
});
simState.newCalls -= callsBefore;
// Grundriss in der Simulation speichern: geht nicht ans Backend
const saves = await sm.evaluate(async () => {
  const before = window.calls.filter((c) => c.type === "haus3d/building/save").length;
  await window.panel._hass.callWS({ type: "haus3d/building/save", building: window.panel._building, revision: window.panel._revision });
  return window.calls.filter((c) => c.type === "haus3d/building/save").length - before;
});
await sm.locator("haus3d-panel .simbar button[data-sim=stop]").click();
await sm.waitForTimeout(1200);
const afterStop = await sm.evaluate(() => ({ lamp: window.panel._hass.states["light.wohnzimmer_decke"].state, bar: !!window.panel.shadowRoot.querySelector(".simbar"), demo: Object.keys(window.panel._hass.states).filter((e) => e.includes(".sim_")).length }));
console.log(JSON.stringify({ simulation: { simDialog, simState, saves, afterStop } }));
if (simState.newCalls !== 0 || saves !== 0) errors.push(`Simulation hat echte Aufrufe gemacht: ${simState.newCalls} / ${saves}`);
console.log(JSON.stringify({ info, calls, hidpi, roomPanel, saved, moved: { x: Math.round(moved.x), y: Math.round(moved.y) }, hiddenSaved, anim, errors: errors.filter((e) => !e.includes("404")) }, null, 1));
await browser.close();
server.close();
