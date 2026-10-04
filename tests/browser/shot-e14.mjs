// E14: Editor am Tablet – Zeichnen mit Fertig-Leiste, Schalter „Frei“, Langdruck-Menü, Entwurf sichern und
// fortsetzen, Zwischenspeichern
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const ed = await t.page("e14", "", { width: 1024, height: 768, touch: true });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.waitForTimeout(300);
const toScreen = (x, z) => ed.evaluate(([x, z]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
const rooms0 = await ed.evaluate(() => window.panel._editor.floor.rooms.length);
// Vieleck mit drei Tipps, dann „Fertig“
await ed.locator("haus3d-panel .ed-bar button[data-tool=poly]").tap();
for (const [x, z] of [[13, 1], [16, 1], [16, 4]]) {
  const [sx, sy] = await toScreen(x, z);
  await ed.touchscreen.tap(sx, sy);
  await ed.waitForTimeout(80);
}
const barShown = await ed.evaluate(() => !window.panel._editor._touchEl.querySelector(".ed-draftbar").hidden);
await t.shot(ed, "editor-tablet.png");
await ed.locator("haus3d-panel .ed-draftbar [data-d=done]").tap();
await ed.waitForTimeout(200);
const rooms1 = await ed.evaluate(() => window.panel._editor.floor.rooms.length);
t.results.zeichnen = { rooms0, rooms1, barShown };
t.check(barShown && rooms1 === rooms0 + 1, `Fertig-Leiste: ${JSON.stringify({ rooms0, rooms1, barShown })}`);
// Wandkette: zwei Tipps, „Kette beenden“
await ed.locator("haus3d-panel .ed-bar button[data-tool=wall]").tap();
for (const [x, z] of [[13, 6], [16, 6], [16, 8]]) {
  const [sx, sy] = await toScreen(x, z);
  await ed.touchscreen.tap(sx, sy);
  await ed.waitForTimeout(80);
}
await ed.locator("haus3d-panel .ed-draftbar [data-d=back]").tap();
const walls = await ed.evaluate(() => ({ n: (window.panel._editor.floor.walls ?? []).length, draft: window.panel._editor.draft }));
t.check(walls.n >= 2 && !walls.draft, `Wandkette: ${JSON.stringify(walls)}`);
// Schalter „Frei“ und Langdruck auf ein Möbelstück: Menü, Rückgängig unverändert
await ed.locator("haus3d-panel .ed-bar button[data-tool=select]").tap();
await ed.locator("haus3d-panel .ed-mods [data-mod=free]").tap();
const free = await ed.evaluate(() => window.panel._editor._free({}));
const furn = await ed.evaluate(() => window.panel._editor.floor.furniture.find((m) => m.type !== "lamp_floor") ?? window.panel._editor.floor.furniture[0]);
const undo0 = await ed.evaluate(() => window.panel._editor.undoStack.length);
const [fx, fy] = await toScreen(furn.x, furn.z);
const cdp = await ed.context().newCDPSession(ed);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fx, y: fy }] });
await ed.waitForTimeout(700);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await ed.waitForTimeout(200);
const ctx = await ed.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".ed-ctx button")].map((b) => b.textContent));
const undo1 = await ed.evaluate(() => window.panel._editor.undoStack.length);
t.results.langdruck = { ctx, undo0, undo1, free };
t.check(free && ctx.includes("Drehen 90°") && ctx.includes("Löschen") && undo1 === undo0, `Langdruck: ${JSON.stringify({ ctx, undo0, undo1, free })}`);
await t.shot(ed, "editor-langdruck.png");
await ed.locator("haus3d-panel .ed-ctx [data-c=rot]").tap();
const rot = await ed.evaluate((id) => window.panel._editor.floor.furniture.find((m) => m.id === id).rotation, furn.id);
t.check(rot !== furn.rotation, `Drehen: ${furn.rotation} → ${rot}`);
// Entwurf gesichert (1,5 s), neu laden → Banner → Fortsetzen
await ed.waitForTimeout(1800);
const saved = await ed.evaluate(() => !!localStorage.getItem("haus3d.editorDraft"));
t.check(saved, "Entwurf nicht gesichert");
await ed.reload();
await ed.waitForTimeout(2500);
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(400);
const banner = await ed.evaluate(() => window.panel.shadowRoot.querySelector(".ed-banner span")?.textContent ?? null);
t.check(/Ungespeicherter Entwurf/.test(banner ?? ""), `Banner: ${banner}`);
await ed.locator("haus3d-panel .ed-banner [data-b=go]").tap();
await ed.waitForTimeout(300);
const restored = await ed.evaluate(() => window.panel._editor.b.floors.find((f) => f.id === "eg").rooms.length);
t.check(restored === rooms1, `Fortsetzen: ${restored} Räume statt ${rooms1}`);
// Zwischenspeichern: Editor bleibt offen, Revision + 1, Entwurf weg
const rev0 = await ed.evaluate(() => window.panel._revision);
await ed.locator("haus3d-panel .ed-bar button[data-act=interim]").tap();
await ed.waitForTimeout(500);
const after = await ed.evaluate(() => ({ open: !!window.panel._editor, rev: window.panel._revision, edRev: window.panel._editor?.revision, draft: localStorage.getItem("haus3d.editorDraft"), dirty: window.panel._editor?.dirty }));
t.results.zwischen = { rev0, ...after, draft: !!after.draft };
t.check(after.open && after.rev === rev0 + 1 && after.edRev === after.rev && !after.draft && !after.dirty, `Zwischenspeichern: ${JSON.stringify({ rev0, ...after })}`);
await t.done();
