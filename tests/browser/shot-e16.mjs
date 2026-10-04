// E16: Treppe aus dem KG mit Deckenloch im EG, Treppenform und „Bis zur nächsten Etage“
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e16", "?stairs", { width: 1280, height: 800 });
const holes = await pg.evaluate(() => {
  const sc = window.panel._scene;
  const out = {};
  for (const [fid, entry] of sc.floors) {
    entry.group.traverse((o) => {
      if (o.userData?.holes) out[fid] = (out[fid] ?? 0) + o.userData.holes;
    });
  }
  return out;
});
t.results.loecher = holes;
t.check(holes.eg === 1 && !holes.kg, `Deckenloch: ${JSON.stringify(holes)}`);
await pg.locator("haus3d-panel .floorbar button[data-floor='eg']").click();
await pg.waitForTimeout(600);
await t.shot(pg, "treppe-eg.png");
// Editor: Treppe im KG wählen, Form ändern, bis zur nächsten Etage
await pg.evaluate(() => window.panel._openEditor());
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .floorsel").selectOption("kg");
await pg.waitForTimeout(300);
await pg.evaluate(() => {
  const e = window.panel._editor;
  e.sel = { kind: "furniture", id: "treppe_kg" };
  e.render();
  e.renderProps();
});
await pg.locator('haus3d-panel .ed-props select[data-stair="stair_shape"]').selectOption("l_left");
await pg.waitForTimeout(200);
await pg.locator("haus3d-panel .ed-props [data-act=stairnext]").click();
await pg.waitForTimeout(200);
const m = await pg.evaluate(() => window.panel._editor.floor.furniture.find((x) => x.id === "treppe_kg"));
const info = await pg.evaluate(() => [...window.panel._editor.props.querySelectorAll(".muted")].map((p) => p.textContent).find((x) => /Stufen/.test(x)));
t.results.editor = { m, info };
t.check(m.stair_shape === "l_left" && m.h === 2.8 && /Stufen · Steigung/.test(info ?? ""), `Treppe im Editor: ${JSON.stringify({ m, info })}`);
// EG im Editor zeigt die Öffnung gestrichelt
await pg.locator("haus3d-panel .floorsel").selectOption("eg");
await pg.waitForTimeout(300);
const dashed = await pg.evaluate(() => window.panel._editor.svg.querySelector("[data-slabhole] text")?.textContent ?? null);
t.check(dashed === "Treppe von KG", `Öffnung im Plan: ${dashed}`);
await t.done();
