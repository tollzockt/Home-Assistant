// E0: Meldungen liegen über der Simulationsleiste, die Hauptansicht ruht im Editor, Gartenhaus = Balkonkraftwerk
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e0", "?quality=schoen");
await pg.evaluate(() => window.panel._setSim(true));
await pg.waitForTimeout(500);
await pg.evaluate(() => window.panel._toast("Test-Meldung"));
const boxes = await pg.evaluate(() => {
  const r = (sel) => window.panel.shadowRoot.querySelector(sel)?.getBoundingClientRect();
  const a = r(".toast");
  const b = r(".simbar");
  return { a: a && [a.top, a.bottom], b: b && [b.top, b.bottom] };
});
t.results.toastVsSimbar = boxes;
t.check(boxes.a && boxes.b && boxes.a[1] <= boxes.b[0], `Meldung verdeckt durch Simbar: ${JSON.stringify(boxes)}`);
await t.shot(pg, "e0-simbar-meldung.png");
await pg.evaluate(() => window.panel._setSim(false));
await pg.waitForTimeout(500);
await unlock(pg);
await pg.locator("haus3d-panel .edit").click();
await pg.waitForTimeout(500);
const running = await pg.evaluate(() => window.panel._scene._running);
await pg.locator("haus3d-panel .ed-bar button[data-act=cancel]").click();
await pg.waitForTimeout(300);
const after = await pg.evaluate(() => window.panel._scene._running);
t.results.mainScene = { imEditor: running, danach: after };
t.check(running === false && after === true, `Hauptansicht im Editor: ${running}, danach: ${after}`);
const shed = await pg.evaluate(() => !!window.panel._scene.flow);
t.results.gartenhausFluss = shed;
t.check(shed, "Gartenhaus wird nicht als Balkonkraftwerk erkannt (kein Energiefluss)");
await t.done();
