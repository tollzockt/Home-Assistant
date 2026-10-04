// E7: Sicherheitsansicht und Gute-Nacht-Check – zu = grün, Sammel-Aktionen nur für Angehaktes, Ablauf-Skript
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e7", "?lock=unlocked", { width: 800, height: 1280, touch: true, wait: 3500 });
// Sicherheitsansicht über das Funktionsrad
await pg.evaluate(() => window.panel._builtinFunctions().security.run());
await pg.waitForTimeout(500);
const sec = await pg.evaluate(() => {
  const p = window.panel;
  const item = p._scene.floors.get("eg").openings.get("flur_haustuer");
  const wz = p._scene.floors.get("eg").openings.get("wz_fenster_west");
  return { on: p._securityView, tuer: item.frames[0]?.material === p._scene.mats.frameOk, fenster: wz.frames[0]?.material === p._scene.mats.frameAlert };
});
t.results.sicherheit = sec;
t.check(sec.on && sec.tuer && sec.fenster, `Sicherheitsansicht: ${JSON.stringify(sec)}`);
await t.shot(pg, "sicherheit.png");
await pg.evaluate(() => window.panel._builtinFunctions().security.run());
// Gute-Nacht-Check mit Ablauf-Skript
await pg.evaluate(() => {
  window.panel._building.settings.routines = { goodnight: "script.garage" };
  window.panel._checkSheet("goodnight");
});
await pg.waitForTimeout(400);
const sheet = await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".sheet h4")].map((h) => h.textContent));
t.results.abschnitte = sheet;
t.check(sheet.some((h) => /^Offen/.test(h)) && sheet.some((h) => /^Licht an/.test(h)) && sheet.some((h) => /^Nicht abgeschlossen/.test(h)), `Abschnitte: ${JSON.stringify(sheet)}`);
await t.shot(pg, "gute-nacht.png");
// Hobbyraum-Licht abwählen, dann „Lichter aus“ → ein Aufruf nur fürs Wohnzimmer
await pg.evaluate(() => {
  const root = window.panel.shadowRoot;
  const row = [...root.querySelectorAll(".sheet .crow")].find((r) => /Hobbyraum/.test(r.textContent) && r.querySelector("input"));
  row.querySelector("input").click();
});
const before = await pg.evaluate(() => window.calls.length);
await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".sheet .secrun")].find((b) => b.textContent === "Lichter aus").click());
await pg.waitForTimeout(400);
const lights = await pg.evaluate((n) => window.calls.slice(n), before);
t.results.lichter = lights;
t.check(lights.length === 1 && lights[0].service === "turn_off" && JSON.stringify(lights[0].entity_id) === '["light.wohnzimmer_decke"]', `Lichter aus: ${JSON.stringify(lights)}`);
// Fertig: Tor fragt nach, danach Rest und Skript
const before2 = await pg.evaluate(() => window.calls.length);
await pg.locator("haus3d-panel .sheet .finish").tap();
await pg.waitForTimeout(600);
const asked = await pg.locator("haus3d-panel .confirm").count();
t.check(asked === 1, "Tor-Nachfrage fehlt");
await pg.locator("haus3d-panel .confirm .yes").tap();
await pg.waitForTimeout(600);
const fin = await pg.evaluate((n) => window.calls.slice(n).map((c) => `${c.domain}.${c.service}:${[].concat(c.entity_id).join(",")}`), before2);
t.results.fertig = fin;
t.check(fin.includes("cover.close_cover:cover.garagentor,cover.wohnzimmer_rollladen") && fin.includes("lock.lock:lock.haustuer") && fin.at(-1) === "script.turn_on:script.garage", `Fertig: ${JSON.stringify(fin)}`);
t.check(!(await pg.locator("haus3d-panel .sheet").count()), "Blatt bleibt offen");
await t.done();
