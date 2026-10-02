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
await ed.locator("haus3d-panel .ed-bar button[data-act=preview]").click();
await ed.waitForTimeout(1200);
await ed.screenshot({ path: `${out}/editor-vorschau.png` });
await ed.locator("haus3d-panel .ed-back").click();
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
console.log(JSON.stringify({ info, calls, hidpi, roomPanel, saved, errors: errors.filter((e) => !e.includes("404")) }, null, 1));
await browser.close();
server.close();
