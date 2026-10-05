// E15: Maße – Kantenlängen am Plan, Länge eintippen, Messen, Flächen; PV-Module über dem Kamin entfallen
import { start } from "./lib.mjs";
// Editor-Werkzeug wählen (am Tablet steckt es im Menü „Werkzeug ▾“)
const edTool = async (pg, tool) => {
  if (await pg.locator("haus3d-panel .ed-bar.compact").count()) await pg.locator('haus3d-panel .ed-bar [data-menu="tools"]').click();
  await pg.locator(`haus3d-panel .ed-bar button[data-tool=${tool}]`).click();
};


const t = await start(process.argv[2]);
const ed = await t.page("e15", "", { width: 1280, height: 800 });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.waitForTimeout(300);
const toScreen = (x, z) => ed.evaluate(([x, z]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
// Flächen der Etage (nichts gewählt)
const areas = await ed.evaluate(() => window.panel._editor.props.querySelector(".ed-areas .sum b")?.textContent ?? null);
t.check(/m²$/.test(areas ?? ""), `Fläche gesamt: ${areas}`);
// Rechteck zeichnen → 4 Maße, Breite eintippen
await edTool(ed, "rect");
let [ax, ay] = await toScreen(13, 1);
let [bx, by] = await toScreen(17, 4);
await ed.mouse.move(ax, ay);
await ed.mouse.down();
await ed.mouse.move(bx, by, { steps: 6 });
await ed.mouse.up();
await ed.waitForTimeout(200);
const dims = await ed.evaluate(() => window.panel._editor.svg.querySelectorAll("[data-dim]").length);
t.check(dims === 4, `Maße am Raum: ${dims}`);
await ed.locator("haus3d-panel .ed-props [data-rectsize=w]").fill("5");
await ed.locator("haus3d-panel .ed-props [data-rectsize=w]").press("Enter");
await ed.locator("haus3d-panel .ed-props [data-rectsize=w]").dispatchEvent("change");
await ed.waitForTimeout(200);
const pts = await ed.evaluate(() => { const e = window.panel._editor; return e.floor.rooms.find((r) => r.id === e.sel.id).points; });
const xs = pts.map((p) => p[0]);
t.results.rechteck = pts;
t.check(Math.abs(Math.max(...xs) - Math.min(...xs) - 5) < 1e-6, `Breite 5: ${JSON.stringify(pts)}`);
await t.shot(ed, "editor-masse.png");
// Messen
await edTool(ed, "measure");
[ax, ay] = await toScreen(pts[0][0], pts[0][1]);
[bx, by] = await toScreen(pts[1][0], pts[1][1]);
await ed.mouse.click(ax, ay);
await ed.mouse.click(bx, by);
await ed.waitForTimeout(150);
const m = await ed.evaluate(() => window.panel._editor.svg.querySelector("[data-measure]")?.textContent ?? null);
t.results.messen = m;
t.check(/^5,00 m · /.test(m ?? ""), `Messen: ${m}`);
await ed.locator("haus3d-panel .ed-bar button[data-act=cancel]").click();
await ed.waitForTimeout(200);
await ed.locator("haus3d-panel .confirm .yes").click().catch(() => {});
await ed.waitForTimeout(300);
// PV-Feld mit Kamin darin: weniger Module in 3D, Feld-Info nennt die verdeckten
const pv = await t.page("e15-pv", "?roof=gable&lhaus", { width: 1280, height: 800 });
const res = await pv.evaluate(async () => {
  const p = window.panel;
  const m = p._scene.roofModel;
  const fr = m.parts[0];
  // Stelle suchen, an der ein 3 × 2-Feld ganz aufs Dach passt
  const { pvLayout } = await import("/custom_components/haus3d/frontend/exterior.js");
  let at = null;
  for (const part of m.parts) {
    for (const sv of [0.25, -0.25, 0.15, -0.15]) {
      for (const su of [0, 0.2, -0.2]) {
        const q = { x: part.center[0] + part.v[0] * part.width * sv + part.u[0] * part.length * su, z: part.center[1] + part.v[1] * part.width * sv + part.u[1] * part.length * su };
        if (!at && pvLayout(m, { type: "pv", ...q, cols: 3, rows: 2 }).count === 6) at = q;
      }
    }
  }
  const count = () => {
    let n = 0;
    p._scene.roofHolder?.traverse((o) => { if (o.isInstancedMesh && Array.isArray(o.material)) n += o.count; });
    return n;
  };
  await p._saveBuildingSettings({ roof: { ...p._building.settings.roof, items: [{ id: "pv1", type: "pv", ...at, cols: 3, rows: 2 }] } }, "ok");
  const free = count();
  await p._saveBuildingSettings({ roof: { ...p._building.settings.roof, items: [{ id: "pv1", type: "pv", ...at, cols: 3, rows: 2 }, { id: "k1", type: "chimney", ...at }] } }, "ok");
  return { free, withChimney: count(), info: p._pvInfo.get("pv1") };
});
t.results.pv = res;
t.check(res.withChimney < res.free && res.info.blocked >= 1, `PV-Hindernis: ${JSON.stringify(res)}`);
await t.done();
