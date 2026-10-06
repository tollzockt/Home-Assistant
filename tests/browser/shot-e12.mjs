// E12/E13: Blickwinkel je Etage, feste Ansichten, Wandtablet (Kiosk), Ruhemodus und Dimmen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e12", "", { width: 1280, height: 800 });
const view = () => pg.evaluate(() => window.panel._scene.getView());
// EG drehen, KG, zurück: Ansicht bleibt
await pg.locator("haus3d-panel .floorbar button[data-floor='eg']").click();
await pg.waitForTimeout(300);
await pg.evaluate(() => {
  const s = window.panel._scene;
  s.camera.position.set(s.controls.target.x + 9, s.camera.position.y * 0.8, s.controls.target.z - 7);
  s.controls.update();
  s._cameraMoved();
});
await pg.waitForTimeout(1000); // 800 ms bis zum Merken
const eg1 = await view();
await pg.locator("haus3d-panel .floorbar button[data-floor='kg']").click();
await pg.waitForTimeout(1000);
await pg.locator("haus3d-panel .floorbar button[data-floor='eg']").click();
await pg.waitForTimeout(300);
const eg2 = await view();
const diff = Math.max(...eg1.position.map((v, i) => Math.abs(v - eg2.position[i])), ...eg1.target.map((v, i) => Math.abs(v - eg2.target[i])));
t.results.etage = { eg1, eg2, diff };
t.check(diff < 0.02, `Ansicht der Etage nicht wiederhergestellt: ${diff}`);
// Doppeltipp auf EG: einpassen und vergessen
// zwei Tipps direkt hintereinander (unabhängig von der Rechnerlast)
await pg.locator("haus3d-panel .floorbar button[data-floor='eg']").evaluate((b) => {
  b.click();
  b.click();
});
await pg.waitForTimeout(300);
const eg3 = await view();
const reset = await pg.evaluate(() => !JSON.parse(localStorage.getItem("haus3d.views") ?? "{}").eg);
t.check(reset && Math.abs(eg3.position[0] - eg1.position[0]) > 0.5, `Doppeltipp: ${JSON.stringify({ reset, eg3 })}`);
// Blickwinkel-Chips: Oben, Süd, Merken
await pg.locator("haus3d-panel .floorbar button[data-floor='all']").click();
await pg.waitForTimeout(300);
await pg.evaluate(() => window.panel._builtinFunctions().view.run());
await pg.waitForTimeout(200);
await pg.locator('haus3d-panel .viewpop [data-preset="oben"]').click();
await pg.waitForTimeout(700);
const top = await view();
t.check(top.position[1] - top.target[1] > 0.99 * Math.hypot(...top.position.map((v, i) => v - top.target[i])), `Oben: ${JSON.stringify(top)}`);
await t.shot(pg, "ansicht-oben.png");
await pg.locator('haus3d-panel .viewpop [data-preset="sued"]').click();
await pg.waitForTimeout(700);
const south = await view();
t.check(south.position[2] > south.target[2] + 5, `Süd: ${JSON.stringify(south)}`);
await t.shot(pg, "ansicht-sued.png");
await pg.locator("haus3d-panel .viewpop .add").click();
await pg.locator("haus3d-panel .viewpop .name input").fill("Terrasse");
await pg.locator("haus3d-panel .viewpop .name .ok").click();
await pg.waitForTimeout(200);
const chips = await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".viewpop .saved")].map((b) => b.textContent));
t.check(chips.includes("Terrasse"), `gemerkt: ${chips}`);
// Kiosk: Kopfzeile weg, Startetage
const k = await t.page("e12-kiosk", "?kiosk&etage=eg", { width: 1024, height: 768, touch: true });
const kio = await k.evaluate(() => ({ header: getComputedStyle(window.panel.shadowRoot.querySelector("header")).display, filter: window.panel._filter, gear: getComputedStyle(window.panel.shadowRoot.querySelector(".kgear")).display }));
t.results.kiosk = kio;
t.check(kio.header === "none" && kio.filter === "eg" && kio.gear !== "none", `Kiosk: ${JSON.stringify(kio)}`);
await t.shot(k, "wandtablet.png");
// Simulation startet nie von selbst (nur im Admin-Modus), auch nicht nach dem Neuladen
await k.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("haus3d.settings") ?? "{}");
  localStorage.setItem("haus3d.settings", JSON.stringify({ ...s, sim: true }));
});
await k.reload();
await k.waitForTimeout(2500);
const sim = await k.evaluate(() => ({ bar: !!window.panel.shadowRoot.querySelector(".simbar"), sim: !!window.panel._sim, saved: JSON.parse(localStorage.getItem("haus3d.settings") ?? "{}").sim }));
t.check(!sim.bar && !sim.sim && !sim.saved, `Simulation im Kiosk: ${JSON.stringify(sim)}`);
// Ruhemodus: nach 5 min ohne Eingabe Fenster zu, Startetage, Bild eingefroren
await k.evaluate(() => {
  const p = window.panel;
  p._setFilter("kg");
  p._selectRoom({ floorId: "kg", roomId: "garage" });
  p._lastInput = Date.now() - 5 * 60000 - 5000;
  p._idleTick();
});
await k.waitForTimeout(900);
const idle = await k.evaluate(() => ({ idle: window.panel._idle, filter: window.panel._filter, panels: (window.panel._panels ?? []).length, frozen: window.panel._scene._frozen }));
t.results.ruhe = idle;
t.check(idle.idle && idle.filter === "eg" && idle.panels === 0 && idle.frozen, `Ruhemodus: ${JSON.stringify(idle)}`);
const r0 = await k.evaluate(() => window.panel._scene.stats?.renders ?? 0);
await k.waitForTimeout(2000);
const r1 = await k.evaluate(() => window.panel._scene.stats?.renders ?? 0);
t.check(r1 - r0 <= 2, `eingefroren, trotzdem ${r1 - r0} Bilder`);
// Dimmen: Zeitraum um jetzt; erster Tipp weckt nur
await k.evaluate(() => {
  const p = window.panel;
  const d = new Date();
  const hm = (m) => `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m + 1440) % 1440) % 60).padStart(2, "0")}`;
  const now = d.getHours() * 60 + d.getMinutes();
  p._settings.kiosk = { ...(p._settings.kiosk ?? {}), dimFrom: hm(now - 30), dimTo: hm(now + 30) };
  p._setupIdle();
  p._lastInput = Date.now() - 6 * 60000;
  p._idleTick();
});
await k.waitForTimeout(200);
const dimmed = await k.evaluate(() => !!window.panel.shadowRoot.querySelector(".dimmer"));
t.check(dimmed, "Dimmen fehlt");
await t.shot(k, "gedimmt.png");
const calls0 = await k.evaluate(() => window.calls.filter((c) => c.service).length);
await k.mouse.click(400, 400);
await k.waitForTimeout(300);
const after = await k.evaluate(() => ({ dimmer: !!window.panel.shadowRoot.querySelector(".dimmer"), idle: window.panel._idle, calls: window.calls.filter((c) => c.service).length }));
t.check(!after.dimmer && !after.idle && after.calls === calls0, `erster Tipp: ${JSON.stringify(after)}`);
await t.done();
