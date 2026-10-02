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
console.log(JSON.stringify({ info, calls, hidpi, errors: errors.filter((e) => !e.includes("404")) }, null, 1));
await browser.close();
server.close();
