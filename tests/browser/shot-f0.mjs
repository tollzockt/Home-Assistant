// F0 Tablet: Funktionsrad mit dem Finger drehen (ohne Pfeile), keine Überdeckung von Karten und
// Etagenleiste, Editor-Leiste einzeilig mit Menüs
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("f0", "", { width: 1024, height: 768, touch: true });
await pg.locator("haus3d-panel .wheel.right .fab").tap();
await pg.waitForTimeout(400);
const before = await pg.evaluate(() => ({ off: window.panel._wheel_right.offset, n: window.panel._functionItems().filter((i) => !i.plus).length, spin: window.panel.shadowRoot.querySelectorAll(".spin").length, first: window.panel.shadowRoot.querySelector('.wheel.right .bub.vis[data-i]')?.title }));
t.check(before.spin === 0 && before.n > 4, `Pfeile weg / genug Einträge: ${JSON.stringify(before)}`);
// Finger auf einer Bubble ansetzen und im Bogen nach oben ziehen (Winkel um den Knopf wird kleiner → weiterdrehen)
const box = await pg.evaluate(() => {
  const r = window.panel._els.wheelR.getBoundingClientRect();
  return { cx: r.left - 32, cy: r.top - 32 };
});
const at = (deg, R = 170) => ({ x: box.cx - Math.sin((deg * Math.PI) / 180) * R, y: box.cy - Math.cos((deg * Math.PI) / 180) * R });
const cdp = await pg.context().newCDPSession(pg);
let p = at(67.5);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
for (let a = 64; a >= 0; a -= 4) {
  p = at(a);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y }] });
  await pg.waitForTimeout(12);
}
await pg.waitForTimeout(80); // langsam loslassen: kein großer Schwung
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await pg.waitForTimeout(700);
const after = await pg.evaluate(() => ({ off: window.panel._wheel_right.offset, open: window.panel._wheel_right.open, dragging: !!window.panel._els.wheelR._dragging, first: window.panel.shadowRoot.querySelector('.wheel.right .bub.vis[data-i]')?.title, vis: window.panel.shadowRoot.querySelectorAll(".wheel.right .bub.vis[data-i]").length }));
t.results.drehen = { before, after };
const moved = (((after.off - before.off) % before.n) + before.n) % before.n;
t.check(after.open && !after.dragging && moved >= 2 && after.vis === 4 && Number.isInteger(after.off), `Finger-Drehen: ${JSON.stringify({ before, after, moved })}`);
await t.shot(pg, "rad-gedreht-finger.png");
// Tipp nach dem Drehen löst den Eintrag aus (Rad bleibt offen)
const tapped = await pg.evaluate(() => window.panel.shadowRoot.querySelector('.wheel.right .bub.vis[data-i]').title);
const layersBefore = await pg.evaluate(() => JSON.stringify(window.panel._settings.layers) + window.panel._settings.style + window.panel._view);
await pg.locator(`haus3d-panel .wheel.right .bub.vis[title="${tapped}"]`).tap();
await pg.waitForTimeout(300);
const layersAfter = await pg.evaluate(() => JSON.stringify(window.panel._settings.layers) + window.panel._settings.style + window.panel._view);
t.check(layersAfter !== layersBefore || /Blickwinkel|Gute Nacht|Vollbild|einpassen|Netzwerk|Begehen/i.test(tapped), `Tipp nach Drehen wirkt nicht: ${tapped}`);
// Überdeckung: Karten (Energie aufgeklappt) gegen Etagenleiste
for (const [name, w, h] of [["tablet-quer", 1024, 768], ["tablet-hoch", 800, 1280], ["handy", 390, 844]]) {
  const q = await t.page(`f0-${name}`, "?netz=450", { width: w, height: h, touch: true });
  await q.evaluate(() => {
    const el = window.panel.shadowRoot.querySelector(".energy");
    if (el?.classList.contains("collapsed")) el.querySelector("h3").click();
  });
  await q.waitForTimeout(500);
  const hit = await q.evaluate(() => {
    const root = window.panel.shadowRoot;
    const bar = root.querySelector(".floorbar").getBoundingClientRect();
    const overl = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const cards = [...root.querySelectorAll(".cards > *")].filter((c) => !c.hidden && c.offsetParent).map((c) => c.getBoundingClientRect());
    const wheels = [...root.querySelectorAll(".wheel .fab")].map((f) => f.getBoundingClientRect());
    return { cards: cards.some((c) => overl(c, bar)), wheels: wheels.some((c) => overl(c, bar)), cls: root.querySelector(".floorbar").className };
  });
  t.results[`ecken-${name}`] = hit;
  t.check(!hit.cards && !hit.wheels, `${name}: Etagenleiste überdeckt ${JSON.stringify(hit)}`);
  await t.shot(q, `ecken-${name}.png`);
}
// Editor am Tablet: eine Zeile, Werkzeuge im Menü
const ed = await t.page("f0-editor", "", { width: 1024, height: 768, touch: true });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(500);
const bar = await ed.evaluate(() => {
  const b = window.panel.shadowRoot.querySelector(".ed-bar");
  return { h: b.getBoundingClientRect().height, compact: b.classList.contains("compact") };
});
await ed.locator('haus3d-panel .ed-bar [data-menu="tools"]').tap();
await ed.waitForTimeout(150);
const menu = await ed.evaluate(() => window.panel.shadowRoot.querySelectorAll('.ed-menu[data-for="tools"]:not([hidden]) button[data-tool]').length);
await t.shot(ed, "editor-menue.png");
await ed.locator('haus3d-panel .ed-menu button[data-tool="rect"]').tap();
await ed.waitForTimeout(150);
const tool = await ed.evaluate(() => ({ tool: window.panel._editor.tool, open: [...window.panel.shadowRoot.querySelectorAll(".ed-menu")].some((m) => !m.hidden), label: window.panel.shadowRoot.querySelector('.ed-bar [data-menu="tools"]').textContent.trim() }));
t.results.editor = { bar, menu, tool };
t.check(bar.compact && bar.h < 64 && menu >= 10 && tool.tool === "rect" && !tool.open && /Rechteck/.test(tool.label), `Editor-Leiste: ${JSON.stringify(t.results.editor)}`);
await t.done();
