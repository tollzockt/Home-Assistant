// E17: Garten-Linien – Zaun mit drei Tipps (Mittellinie bleibt), Mauer aus zwei Abschnitten, Hecke mit Höhe
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const ed = await t.page("e17", "?garden", { width: 1280, height: 800 });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(400);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.waitForTimeout(300);
const toScreen = (x, z) => ed.evaluate(([x, z]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
const tapAll = async (list) => {
  for (const [x, z] of list) {
    const [sx, sy] = await toScreen(x, z);
    await ed.mouse.click(sx, sy);
    await ed.waitForTimeout(60);
  }
};
// Zaun: drei Punkte, Fertig
await ed.locator("haus3d-panel .ed-bar button[data-tool=line]").click();
await ed.locator('haus3d-panel .ed-props [data-linekind] [data-k="fence"]').click();
await ed.locator('haus3d-panel .ed-props select[data-lo="fence_style"]').selectOption("bars");
await tapAll([[-1, -1], [12, -1], [12, 9]]);
const len = await ed.evaluate(() => window.panel._editor.svg.querySelector("[data-linelen]")?.textContent ?? null);
await t.shot(ed, "garten-linie-entwurf.png");
await ed.locator("haus3d-panel .ed-draftbar [data-d=done]").click();
await ed.waitForTimeout(200);
const fence = await ed.evaluate(() => (window.panel._editor.floor.outdoor ?? []).find((o) => o.type === "fence" && o.line));
t.results.zaun = { len, line: fence?.line, n: fence?.points.length, style: fence?.fence_style };
t.check(fence?.line?.points.length === 3 && fence.points.length === 6 && fence.fence_style === "bars" && /^23,00 m$/.test(len ?? ""), `Zaun: ${JSON.stringify(t.results.zaun)}`);
// Mauer: zwei Abschnitte → zwei Wände
await ed.locator("haus3d-panel .ed-bar button[data-tool=line]").click();
await ed.locator('haus3d-panel .ed-props [data-linekind] [data-k="wall"]').click();
const walls0 = await ed.evaluate(() => (window.panel._editor.floor.walls ?? []).length);
await tapAll([[-2, 10], [5, 10], [5, 13]]);
await ed.locator("haus3d-panel .ed-draftbar [data-d=done]").click();
await ed.waitForTimeout(200);
const walls1 = await ed.evaluate(() => (window.panel._editor.floor.walls ?? []).filter((w) => /^mauer/.test(w.id)).map((w) => ({ t: w.thickness, tex: w.texture })));
t.check(walls1.length === 2 && walls1.every((w) => w.t === 0.25 && w.tex === "stone"), `Mauer: ${walls0} → ${JSON.stringify(walls1)}`);
// Hecke mit Höhe 1,6
await ed.locator("haus3d-panel .ed-bar button[data-tool=line]").click();
await ed.locator('haus3d-panel .ed-props [data-linekind] [data-k="hedge"]').click();
await ed.locator('haus3d-panel .ed-props [data-lo="height"]').fill("1.6");
await ed.locator('haus3d-panel .ed-props [data-lo="height"]').dispatchEvent("change");
await tapAll([[13, -2], [13, 6]]);
await ed.locator("haus3d-panel .ed-draftbar [data-d=done]").click();
await ed.waitForTimeout(200);
// Breite der Hecke ändern baut die Fläche neu
await ed.locator('haus3d-panel .ed-props [data-la="width"]').fill("1");
await ed.locator('haus3d-panel .ed-props [data-la="width"]').dispatchEvent("change");
await ed.waitForTimeout(150);
const hedge = await ed.evaluate(() => (window.panel._editor.floor.outdoor ?? []).find((o) => o.type === "hedge" && o.line));
const xs = hedge.points.map((p) => p[0]);
t.check(hedge.height === 1.6 && Math.abs(Math.max(...xs) - Math.min(...xs) - 1) < 1e-6, `Hecke: ${JSON.stringify(hedge)}`);
// speichern und 3D: Zaun aus Pfosten/Stäben (instanziert)
await ed.locator("haus3d-panel .ed-bar button[data-act=save]").click();
await ed.waitForTimeout(1500);
const fence3d = await ed.evaluate(() => {
  let inst = 0;
  window.panel._scene.root.traverse((o) => {
    if (o.isInstancedMesh && o.parent?.userData?.layer === "garden" && o.count > 10) inst++;
  });
  return inst;
});
t.check(fence3d >= 2, `Zaun in 3D: ${fence3d} InstancedMesh`);
await t.shot(ed, "garten-zaun.png");
await t.done();
