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
// Funktionsrad unten rechts: aufklappen, Eintrag antippen, zuklappen
async function fnToggle(page, name) {
  await page.locator("haus3d-panel .wheel.right .fab").click();
  // ggf. durchdrehen, bis der Eintrag sichtbar ist
  for (let k = 0; k < 12 && !(await page.locator(`haus3d-panel .wheel.right .bub.vis[title="${name}"]`).count()); k++) await page.locator("haus3d-panel .wheel.right .spin.down").click();
  await page.waitForTimeout(300);
  await page.locator(`haus3d-panel .wheel.right .bub[title="${name}"]`).click();
  await page.locator("haus3d-panel .wheel.right .fab").click();
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
await fnToggle(desk, "Temperatur");
await desk.locator("haus3d-panel .floorbar button[data-floor]", { hasText: "EG" }).click();
await desk.waitForTimeout(1500);
await desk.screenshot({ path: `${out}/desktop-temperatur-eg.png` });
await desk.locator("haus3d-panel .floorbar button[data-floor]", { hasText: "KG" }).click();
await fnToggle(desk, "Temperatur");
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
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close(); // Rechenzeit freigeben
const cyber = await shot("desktop-cyber", "", { width: 1280, height: 800 });
await cyber.locator("haus3d-panel .gear").click();
await cyber.locator("haus3d-panel .seg[data-key=style] button", { hasText: "Cyberpunk" }).click();
await cyber.locator("haus3d-panel .dialog .close").click();
await cyber.waitForTimeout(1500);
await cyber.screenshot({ path: `${out}/desktop-cyber.png` });
await cyber.locator("haus3d-panel .floorbar button[data-floor]", { hasText: "EG" }).click();
await cyber.waitForTimeout(1500);
await cyber.screenshot({ path: `${out}/desktop-cyber-eg.png` });
// Einstellungen: Geräte als 3D-Objekte, dann Raum anklicken (erst Etage, dann Raum)
const set = await shot("desktop-3d", "", { width: 1280, height: 800 });
await set.locator("haus3d-panel .gear").click();
await set.waitForTimeout(300);
await set.screenshot({ path: `${out}/einstellungen.png` });
await set.locator("haus3d-panel .seg[data-key=deviceMode] button", { hasText: "3D-Objekte" }).click();
await set.locator("haus3d-panel .dialog .close").click();
await set.locator("haus3d-panel .floorbar button[data-floor]", { hasText: "EG" }).click();
await set.waitForTimeout(1200);
await set.screenshot({ path: `${out}/desktop-3d.png` });
const box = await set.locator("haus3d-panel canvas").boundingBox();
await set.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
await set.waitForTimeout(1200);
await set.screenshot({ path: `${out}/raum-gewaehlt.png` });
const roomPanel = await set.evaluate(() => window.panel.shadowRoot.querySelector(".roompanel")?.innerText ?? null);
// Editor: Raum ziehen, Bereich zuweisen, Fenster setzen, Möbel platzieren, rückgängig, speichern
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close(); // Rechenzeit freigeben
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
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close(); // Rechenzeit freigeben
const e1 = await shot("etappe1", "", { width: 1280, height: 800 });
await e1.locator("haus3d-panel .floorbar button[data-floor]", { hasText: "EG" }).click();
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
await dach.locator("haus3d-panel .floorbar button[data-floor]", { hasText: "EG" }).click();
await dach.waitForTimeout(1200);
outside.roofInEg = await dach.evaluate(() => window.panel._scene._roofShown());
await dach.screenshot({ path: `${out}/eg-regen-balkon.png` });
const schnee = await shot("walmdach-schnee", "?roof=hip&garden&weather=snowy", { width: 1280, height: 800 });
await schnee.locator("haus3d-panel .gear").click();
await schnee.waitForTimeout(300);
await schnee.locator("haus3d-panel .house-cfg select[data-r=type]").selectOption("shed");
await schnee.locator("haus3d-panel .house-cfg input[data-pv=S]").fill("6");
await schnee.locator("haus3d-panel .house-cfg button[data-rcs='#3a3d42']").click();
await schnee.locator("haus3d-panel .house-save").click();
await schnee.waitForTimeout(800);
outside.savedRoof = await schnee.evaluate(() => { const r = window.calls.filter((c) => c.type === "haus3d/building/save").at(-1)?.building.settings.roof; return `${r.type} ${r.color} S=${r.solar.S}`; });
await schnee.locator("haus3d-panel .dialog .close").click();
await schnee.waitForTimeout(800);
await schnee.screenshot({ path: `${out}/pultdach-schnee.png` });
for (const p of [dach, schnee]) await p.close(); // Rechenzeit freigeben (Wetter animiert)
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
// freistehende Wand im Garten zeichnen (leicht schief gezogen -> gerade), Tür hinein, Säule daneben
await e3.locator("haus3d-panel .ed-bar button[data-tool=wall]").click();
[px, py] = await plan(13, -2); await e3.mouse.click(px, py);
[qx, qy] = await plan(16.02, -1.8); await e3.mouse.click(qx, qy);
await e3.keyboard.press("Escape");
await e3.locator("haus3d-panel .ed-bar button[data-tool=door]").click();
[px, py] = await plan(14.5, -2); await e3.mouse.click(px, py);
await e3.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
await e3.locator("haus3d-panel .ed-props .search").fill("Säule");
await e3.locator("haus3d-panel .ed-props .tile[data-furn=column]").click();
[px, py] = await plan(16.5, -2.5); await e3.mouse.click(px, py);
await e3.waitForTimeout(800);
await e3.screenshot({ path: `${out}/wand-saeule.png` });
const freeWall = await e3.evaluate(() => {
  const f = window.panel._editor.floor;
  return { walls: f.walls.map((w) => [w.a, w.b, w.thickness]), door: f.openings.filter((o) => o.wall).map((o) => ({ wall: !!o.wall, type: o.type, offset: o.offset })), column: f.furniture.filter((m) => m.type === "column").map((m) => m.h) };
});
console.log(JSON.stringify({ freeWall }));
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
// Etappe HUD: Karten, Etagen-Leiste, Kurzwahl-Rad (mit Drehen), Funktionsrad, PV-Felder, Walm am Flügel
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close();
const hud = await shot("hud", "?roof=gable&lhaus&garden", { width: 1280, height: 800 });
// Karte anlegen
await hud.locator("haus3d-panel .cards .addcard").click();
await hud.locator("haus3d-panel .qedit .ttl").fill("Heizung");
await hud.locator("haus3d-panel .qedit button[data-icon='mdi:fire']").click();
await hud.locator("haus3d-panel .qedit .addv").click();
await hud.locator("haus3d-panel .qedit input[data-ent='0']").fill("sensor.bad_temperatur");
await hud.locator("haus3d-panel .qedit input[data-name='0']").fill("Bad");
await hud.locator("haus3d-panel .qedit .addv").click();
await hud.locator("haus3d-panel .qedit input[data-ent='1']").fill("climate.bad");
await hud.locator("haus3d-panel .qedit .save").click();
await hud.waitForTimeout(600);
// Kurzwahl mit 7 Einträgen anlegen (mehr als 5: Rad dreht)
await hud.evaluate(async () => {
  const p = window.panel;
  await p._saveBuildingSettings({ quick: ["automation.abend", "script.garage", "scene.kino", "button.klingel", "light.bar", "switch.kaffeemaschine", "light.kueche"].map((entity) => ({ entity })) }, "ok");
});
await hud.waitForTimeout(500);
await hud.locator("haus3d-panel .wheel.left .fab").click();
await hud.waitForTimeout(400);
const wheel1 = await hud.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".wheel.left .bub.vis[data-i]")].map((b) => b.title));
await hud.locator("haus3d-panel .wheel.left .bub.vis[data-i]").first().click();
await hud.waitForTimeout(300);
const quickCall = await hud.evaluate(() => window.calls.filter((c) => c.service).at(-1));
await hud.mouse.move(150, 650);
await hud.mouse.wheel(0, 120);
await hud.waitForTimeout(400);
const wheel2 = await hud.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".wheel.left .bub.vis[data-i]")].map((b) => b.title));
await hud.locator("haus3d-panel .wheel.right .fab").click();
await hud.waitForTimeout(400);
await hud.screenshot({ path: `${out}/hud-offen.png` });
const leftClosed = await hud.evaluate(() => !window.panel.shadowRoot.querySelector(".wheel.left").classList.contains("open"));
// Funktionsrad: Raster aus, Stil durchschalten
for (let k = 0; k < 12 && !(await hud.locator('haus3d-panel .wheel.right .bub.vis[title="Raster"]').count()); k++) await hud.locator("haus3d-panel .wheel.right .spin.down").click();
await hud.waitForTimeout(300);
const wheelR = await hud.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".wheel.right .bub.vis")].map((b) => b.title));
await hud.screenshot({ path: `${out}/hud-rad-gedreht.png` });
await hud.locator('haus3d-panel .wheel.right .bub[title="Raster"]').click();
const gridOff = await hud.evaluate(() => window.panel._settings.layers.grid === false);
for (let k = 0; k < 12 && !(await hud.locator("haus3d-panel .wheel.right .bub.vis[title^='Stil']").count()); k++) await hud.locator("haus3d-panel .wheel.right .spin.down").click();
await hud.waitForTimeout(300);
await hud.locator("haus3d-panel .wheel.right .bub[title^='Stil']").click();
const styleNow = await hud.evaluate(() => window.panel._settings.style);
for (let k = 0; k < 12 && !(await hud.locator('haus3d-panel .wheel.right .bub.vis[title="Raster"]').count()); k++) await hud.locator("haus3d-panel .wheel.right .spin.down").click();
await hud.waitForTimeout(300);
await hud.locator('haus3d-panel .wheel.right .bub[title="Raster"]').click();
// + öffnet „Funktionen anpassen“: eigenen Eintrag hinzufügen
await hud.locator("haus3d-panel .wheel.right .bub.plus").click();
await hud.locator("haus3d-panel .qedit .addq").click();
await hud.locator("haus3d-panel .qedit input[data-ent]").last().fill("script.garage");
await hud.locator("haus3d-panel .qedit input[data-name]").last().fill("Garage");
await hud.screenshot({ path: `${out}/hud-funktionen.png` });
await hud.locator("haus3d-panel .qedit .save").click();
await hud.waitForTimeout(600);
const fnCustom = await hud.evaluate(() => (window.panel._building.settings.functions ?? []).at(-1));
await hud.locator("haus3d-panel .wheel.right .fab").click();
// Etagen-Leiste: Pfeil runter von „Alle“
await hud.locator("haus3d-panel .floorbar button[data-step='1']").click();
const floorNow = await hud.evaluate(() => window.panel._filter);
await hud.locator("haus3d-panel .floorbar button[data-floor='all']").click();
// PV-Felder + Walm am Flügel (Norden unten im Plan)
await hud.evaluate(async () => {
  const p = window.panel;
  await p._saveBuildingSettings({ north: 180, roof: { type: "gable", pitch: 35, overhang: 0.4, wing_end: "hip", solar_arrays: [{ dir: "S", cols: 3, rows: 2, orient: "landscape", left: 0.3, row: 0 }, { dir: "W", cols: 2, rows: 2, orient: "portrait", left: 0.5, row: 0 }] } }, "ok");
});
await hud.waitForTimeout(1200);
const pv = await hud.evaluate(() => { let n = 0; window.panel._scene.roofHolder?.traverse((o) => { if (o.isMesh && o.geometry?.parameters?.depth !== undefined && o.geometry.parameters.height === 0.04) n++; }); return n; });
await hud.screenshot({ path: `${out}/hud-pv.png` });
const cardTxt = await hud.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".cards .card")].map((c) => c.innerText.replace(/\s+/g, " ")));
console.log(JSON.stringify({ hud: { cardTxt, wheel1, wheel2, wheelR, fnCustom, leftClosed, quickCall, gridOff, styleNow, floorNow, pv } }));
if (fnCustom?.entity !== "script.garage") errors.push(`Eigene Funktion fehlt: ${JSON.stringify(fnCustom)}`);
if (wheel1.length !== 4 || wheel1.join() === wheel2.join()) errors.push(`Rad dreht nicht: ${wheel1} / ${wheel2}`);
// Dach-Ebene im Editor: Kamin, Dachfenster, PV-Feld; Texturen; untere Etagen bleiben sichtbar
for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close();
const rf = await shot("textur", "?roof=gable&lhaus&garden", { width: 1280, height: 800 });
await rf.evaluate(async () => {
  const p = window.panel;
  await p._saveBuildingSettings({ wall_textures: { exterior: "brick" }, wall_colors: { exterior: "#e9c99a" } }, "ok");
});
await rf.waitForTimeout(800);
await rf.screenshot({ path: `${out}/textur-haus.png` });
const texMats = await rf.evaluate(() => [...window.panel._scene.texMats.keys()]);
await rf.locator("haus3d-panel .floorbar button[data-floor='eg']").click();
await rf.waitForTimeout(600);
const lowerVisible = await rf.evaluate(() => { const sc = window.panel._scene; return [...sc.floors.entries()].filter(([, e]) => e.group.visible).map(([id]) => id); });
await rf.screenshot({ path: `${out}/etage-eg-mit-kg.png` });
await rf.locator("haus3d-panel .floorbar button[data-floor='all']").click();
await rf.locator("haus3d-panel .edit").click();
await rf.waitForTimeout(400);
await rf.locator("haus3d-panel .floorsel").selectOption("__roof");
await rf.locator("haus3d-panel .ed-bar button[data-view='split']").click();
await rf.waitForTimeout(800);
const rplan = (x, z) => rf.evaluate(([x, z]) => {
  const e = window.panel._editor; const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
const roofTools = await rf.evaluate(() => [...window.panel._editor.root.querySelectorAll(".ed-bar [data-tool]")].map((b) => b.dataset.tool));
await rf.locator("haus3d-panel .ed-bar button[data-tool=pv]").click();
await rf.mouse.click(...(await rplan(3, 6.8)));
await rf.locator("haus3d-panel .ed-props [data-rn=cols]").fill("4");
await rf.locator("haus3d-panel .ed-props [data-rn=cols]").dispatchEvent("change");
await rf.locator("haus3d-panel .ed-bar button[data-tool=chimney]").click();
await rf.mouse.click(...(await rplan(5.5, 2)));
await rf.locator("haus3d-panel .ed-bar button[data-tool=skylight]").click();
await rf.mouse.click(...(await rplan(2, 1.5)));
// PV-Feld ziehen
await rf.locator("haus3d-panel .ed-bar button[data-tool=select]").click();
const pvBefore = await rf.evaluate(() => window.panel._editor.b.settings.roof.items.find((x) => x.type === "pv"));
const a0 = await rplan(pvBefore.x, pvBefore.z);
await rf.mouse.move(a0[0], a0[1]);
await rf.mouse.down();
await rf.mouse.move(a0[0] + 40, a0[1], { steps: 4 });
await rf.mouse.up();
await rf.waitForTimeout(900);
await rf.screenshot({ path: `${out}/dach-ebene.png` });
const roofItems = await rf.evaluate(() => window.panel._editor.b.settings.roof.items.map((x) => ({ type: x.type, x: x.x, z: x.z, cols: x.cols })));
// Textur-Auswahl am Raum
await rf.locator("haus3d-panel .floorsel").selectOption("eg");
await rf.waitForTimeout(300);
const texSelects = await rf.evaluate(() => window.panel._editor.props.querySelectorAll("[data-tex]").length);
await rf.locator("haus3d-panel .ed-bar button[data-act=save]").click();
await rf.waitForTimeout(1200);
const savedItems = await rf.evaluate(() => (window.panel._building.settings.roof.items ?? []).length);
const roof3d = await rf.evaluate(() => { let pv = 0; let n = 0; window.panel._scene.roofHolder?.traverse((o) => { if (!o.isMesh) return; n++; if (o.geometry?.parameters?.height === 0.04) pv++; }); return { pv, n }; });
await rf.screenshot({ path: `${out}/dach-3d.png` });
console.log(JSON.stringify({ roofLayer: { texMats, lowerVisible, roofTools, roofItems, texSelects, savedItems, roof3d, moved: roofItems.find((x) => x.type === "pv").x - pvBefore.x } }));
if (savedItems !== 3) errors.push(`Dach-Elemente nicht gespeichert: ${savedItems}`);
if (roof3d.pv < 3) errors.push(`PV-Feld und Dachfenster fehlen in 3D: ${roof3d.pv}`);
if (!lowerVisible.includes("kg")) errors.push(`KG unter EG nicht sichtbar: ${lowerVisible}`);
if (!texMats.some((k) => k.startsWith("wall:brick"))) errors.push(`Klinker fehlt: ${texMats}`);
console.log(JSON.stringify({ info, calls, hidpi, roomPanel, saved, moved: { x: Math.round(moved.x), y: Math.round(moved.y) }, hiddenSaved, anim, errors: errors.filter((e) => !e.includes("404")) }, null, 1));
await browser.close();
server.close();
