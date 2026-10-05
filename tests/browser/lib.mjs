// Gemeinsames für die Browser-Tests: Server, Browser, Seiten mit Harness, kleine Helfer.
// Nutzung in shot-<etappe>.mjs: const t = await start(process.argv[2]); … await t.done();
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

// Playwright ist global installiert: NODE_PATH="$(npm root -g)"
const { chromium } = createRequire(import.meta.url)("playwright");

export const root = resolve(new URL("../..", import.meta.url).pathname);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };

export async function start(out = ".") {
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
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium",
    // ohne Drosselung: sonst liefert headless Chromium teils nur ~1 Bild/s (requestAnimationFrame)
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"],
  });
  const errors = [];
  const results = {};

  /** Seite mit dem Harness öffnen (query z. B. "?roof=gable&lock"), optional Touch-Gerät. */
  async function page(name, query = "", { width = 1280, height = 800, touch = false, scale = 1, wait = 2500 } = {}) {
    // vorherige Seiten schließen: offene Seiten rendern weiter und bremsen SwiftShader aus
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.close();
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch });
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    pg.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(`${name} [${m.type()}]: ${m.text()}`);
    });
    if (!/quality=/.test(query)) query = `${query}${query ? "&" : "?"}quality=schoen`; // SwiftShader: Stufe festlegen
    if (!/schatten=/.test(query)) query += "&schatten=aus"; // Schattenkarten sind in SwiftShader sehr langsam
    const data = process.env.HARNESS_DATA ? `&data=${process.env.HARNESS_DATA}` : "";
    await pg.goto(`http://localhost:${port}/tests/browser/harness.html${query}${data}`);
    await pg.waitForTimeout(wait);
    return pg;
  }

  async function shot(pg, file) {
    await pg.screenshot({ path: `${out}/${file}` });
  }

  /** Funktionsrad unten rechts: aufklappen, bis zum Eintrag drehen, antippen, zuklappen. */
  async function fnToggle(pg, name) {
    await pg.locator("haus3d-panel .wheel.right .fab").click();
    const sel = `haus3d-panel .wheel.right .bub.vis[title^="${name}"]`;
    for (let k = 0; k < 20 && !(await pg.locator(sel).count()); k++) await pg.evaluate(() => window.panel._els.wheelR._turn(1));
    await pg.waitForTimeout(300);
    await pg.locator(sel).click();
    await pg.locator("haus3d-panel .wheel.right .fab").click();
  }

  /** Bedingung prüfen und Fehler sammeln. */
  function check(ok, msg) {
    if (!ok) errors.push(msg);
  }

  async function done() {
    await browser.close();
    server.close();
    const real = errors.filter((e) => !e.includes("404"));
    console.log(JSON.stringify({ results, errors: real }, null, 1));
    if (real.length) process.exitCode = 1;
  }

  return { browser, port, page, shot, fnToggle, check, results, errors, done, out };
}

/** Bearbeiten bzw. Admin-Einstellungen per PIN freischalten (wie am Tablet: PIN-Feld, Ziffern tippen). */
export async function unlock(pg, scope = "edit", { pin = "0000", cat = null, arg = null } = {}) {
  await pg.waitForFunction(() => window.panel?._building && window.panel._els?.stage, null, { timeout: 30000 });
  await pg.evaluate(([s, c, a]) => {
    window.__unlocking = s === "admin" ? window.panel._openAdmin(c, a) : window.panel._startEdit();
  }, [scope, cat, arg]);
  // schon freigeschaltet (z. B. Admin-Modus läuft noch): kein PIN-Feld
  await pg.waitForFunction((s) => {
    const p = window.panel;
    return !!p.shadowRoot.querySelector(".pinpad") || (s === "admin" ? p._adminOpen : p._editMode);
  }, scope, { timeout: 15000 });
  if (!(await pg.evaluate(() => !!window.panel.shadowRoot.querySelector(".pinpad")))) {
    await pg.evaluate(() => window.__unlocking);
    await pg.waitForTimeout(150);
    return;
  }
  await pg.keyboard.type(pin, { delay: 60 });
  await pg.waitForFunction(() => !window.panel.shadowRoot.querySelector(".pinpad"), null, { timeout: 8000 });
  await pg.evaluate(() => window.__unlocking);
  await pg.waitForTimeout(150);
}
