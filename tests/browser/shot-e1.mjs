// E1: heikle Aktionen fragen nach (eigener Dialog), Licht schaltet sofort, Automation-Tipp = Details,
// keine Browser-Dialoge (window.confirm) mehr, Wischen über die Kurzwahl löst nichts aus
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e1", "?lock&siren&quality=schoen", { width: 1024, height: 768, touch: true });
let nativeDialogs = 0;
pg.on("dialog", (d) => {
  nativeDialogs++;
  d.dismiss();
});
const services = () => pg.evaluate(() => window.calls.filter((c) => c.service));
const row = (id) => pg.locator(`haus3d-panel .roompanel .rp-row[data-entity="${id}"]`);
await pg.evaluate(() => window.panel._selectRoom({ floorId: "eg", roomId: "flur" }));
await pg.waitForTimeout(300);
await row("lock.haustuer").tap();
await pg.waitForTimeout(300);
// Schloss: seit 0.18 fragt die Tür-PIN (statt Ja/Nein), vorher passiert nichts
const asked = await pg.locator("haus3d-panel .pinpad").count();
t.check(asked === 1 && (await services()).length === 0, `Schloss: Tür-PIN erwartet, keine Aktion (PIN-Feld ${asked}, Aufrufe ${(await services()).length})`);
await t.shot(pg, "bestaetigung.png");
t.results.frage = await pg.locator("haus3d-panel .pinpad .ptitle").textContent();
for (const k of "0000") await pg.locator(`haus3d-panel .pinpad [data-k="${k}"]`).tap();
await pg.waitForFunction(() => !window.panel.shadowRoot.querySelector(".pinpad"), null, { timeout: 5000 });
await pg.waitForTimeout(300);
const afterYes = (await services()).at(-1);
t.check(afterYes?.domain === "lock" && afterYes.service === "unlock" && afterYes.viaPin, `Aufschließen nicht ausgeführt: ${JSON.stringify(afterYes)}`);
// Garagentor: Abbrechen → nichts
await pg.evaluate(() => window.panel._selectRoom({ floorId: "kg", roomId: "garage" }));
await pg.waitForTimeout(300);
const before = (await services()).length;
await row("cover.garagentor").tap();
await pg.waitForTimeout(200);
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .confirm .no").tap();
await pg.waitForTimeout(200);
t.check((await services()).length === before, "Garage trotz Abbrechen bewegt");
// Licht: sofort
await pg.evaluate(() => window.panel._selectRoom({ floorId: "eg", roomId: "wohnzimmer" }));
await pg.waitForTimeout(300);
await row("light.wohnzimmer_decke").tap();
await pg.waitForTimeout(300);
const light = (await services()).at(-1);
t.check(light?.entity_id === "light.wohnzimmer_decke" && !(await pg.locator("haus3d-panel .confirm").count()), `Licht nicht sofort geschaltet: ${JSON.stringify(light)}`);
// Automation per Tipp im Haus: Details statt Ausschalten
const n0 = (await services()).length;
await pg.evaluate(() => window.panel._activate("automation.abend"));
await pg.waitForTimeout(200);
const ev = await pg.evaluate(() => window.events.at(-1));
t.check((await services()).length === n0 && ev === "automation.abend", `Automation-Tipp: ${ev}`);
// Wischen über die Kurzwahl: keine Aktion, kein Details-Dialog
await pg.evaluate(async () => {
  await window.panel._saveBuildingSettings({ quick: ["script.garage", "scene.kino", "button.klingel", "light.hobbyraum", "light.kueche", "automation.abend"].map((entity) => ({ entity })) }, "ok");
});
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .wheel.left .fab").tap();
await pg.waitForTimeout(300);
const b = await pg.locator("haus3d-panel .wheel.left .bub.vis[data-i]").first().boundingBox();
const evBefore = await pg.evaluate(() => window.events.length);
const nBefore = (await services()).length;
await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await pg.mouse.down();
await pg.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 60, { steps: 6 });
await pg.waitForTimeout(700);
await pg.mouse.up();
await pg.waitForTimeout(200);
const evAfter = await pg.evaluate(() => window.events.length);
t.check(evAfter === evBefore && (await services()).length === nBefore, `Wischen löste etwas aus (Details ${evAfter - evBefore}, Aufrufe ${(await services()).length - nBefore})`);
// Import-Nachfrage ist der eigene Dialog
pg.evaluate(() => window.panel._confirm("Grundriss importieren?", "Importieren")).catch(() => {});
await pg.waitForTimeout(200);
t.check((await pg.locator("haus3d-panel .confirm").count()) === 1, "eigener Dialog fehlt");
t.results.nativeDialogs = nativeDialogs;
t.check(nativeDialogs === 0, `window.confirm benutzt: ${nativeDialogs}`);
await t.done();
