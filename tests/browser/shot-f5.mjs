// F5: Ansicht je Benutzer, Dienste (show/notify/highlight/reload mit Ziel), Begehen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("f5", "?userdata&schatten=aus", { width: 1280, height: 800 });
const E = (fn, arg) => pg.evaluate(fn, arg);

// Benutzerdaten übernommen (Stil Nacht, Raster aus, gemerkte Ansicht „Garten“)
const ud = await E(() => ({ style: window.panel._settings.style, grid: window.panel._settings.layers.grid, views: window.panel._savedViews().map((v) => v.name), sub: window.calls.some((c) => c.type === "haus3d/subscribe") }));
t.results.benutzer = ud;
t.check(ud.style === "night" && ud.grid === false && ud.views.includes("Garten") && ud.sub, `Benutzerdaten: ${JSON.stringify(ud)}`);
// Änderung landet (gebündelt) in den Benutzerdaten
await E(() => {
  window.panel._settings.layers.grid = true;
  window.panel._saveSettings();
});
await pg.waitForTimeout(1900);
const pushed = await E(() => window.userData?.settings?.layers?.grid);
t.check(pushed === true, `Benutzerdaten gespeichert: ${pushed}`);

// Dienste
await E(() => window.sendCommand({ service: "notify", message: "Waschmaschine fertig", level: "info", room: "kueche" }));
await pg.waitForTimeout(200);
const note = await E(() => {
  const n = window.panel.shadowRoot.querySelector(".notice");
  return n && { text: n.querySelector("span").textContent, show: !!n.querySelector(".show"), info: n.classList.contains("info") };
});
t.check(note?.text === "Waschmaschine fertig" && note.show && note.info, `notify: ${JSON.stringify(note)}`);
await t.shot(pg, "dienst-notify.png");
await pg.locator("haus3d-panel .notice .show").click();
await pg.waitForTimeout(300);
const shown = await E(() => (window.panel._panels ?? []).map((p) => p.roomId));
t.check(shown.length >= 1, `Zeigen öffnet Raum: ${JSON.stringify(shown)}`);
// Ziel: anderes Tablet → nichts; eigener Name → ausgeführt
await E(() => window.sendCommand({ service: "show", floor: "kg", target: "anderes-tablet" }));
const f1 = await E(() => window.panel._filter);
await E(() => {
  window.panel._settings.kiosk = { ...(window.panel._settings.kiosk ?? {}), name: "Flur-Tablet" };
  window.sendCommand({ service: "show", floor: "kg", view: "oben", target: "flur-tablet" });
});
await pg.waitForTimeout(300);
const f2 = await E(() => window.panel._filter);
t.check(f1 !== "kg" && f2 === "kg", `show mit Ziel: ${JSON.stringify({ f1, f2 })}`);
await E(() => window.sendCommand({ service: "show", floor: "all" }));
// highlight blinkt
await E(() => window.sendCommand({ service: "highlight", room: "wohnzimmer", seconds: 3 }));
await pg.waitForTimeout(100);
const hl = await E(() => window.panel._highlight?.key);
t.check(/wohnzimmer/.test(hl ?? ""), `highlight: ${hl}`);
await t.shot(pg, "dienst-highlight.png");
// reload holt den Grundriss neu
const n0 = await E(() => window.calls.filter((c) => c.type === "haus3d/building/get").length);
await E(() => window.sendCommand({ service: "reload" }));
await pg.waitForTimeout(600);
const n1 = await E(() => window.calls.filter((c) => c.type === "haus3d/building/get").length);
t.check(n1 === n0 + 1, `reload: ${n0} → ${n1}`);

// Begehen: Augenhöhe, Gehen per Tasten, Wand hält auf, Verlassen stellt die Ansicht wieder her
const before = await E(() => window.panel._scene.getView());
await E(() => window.panel._startWalk());
await pg.waitForTimeout(400);
const w0 = await E(() => {
  const sc = window.panel._scene;
  return { walking: sc.isWalking(), y: sc.camera.position.y, ui: !!window.panel.shadowRoot.querySelector(".walkui .joy"), floor: window.panel._filter };
});
t.results.begehen = w0;
t.check(w0.walking && w0.ui && Math.abs(w0.y - 1.6) < 0.05, `Begehen: ${JSON.stringify(w0)}`);
await t.shot(pg, "begehen.png");
// lange geradeaus: muss vor einer Wand stehen bleiben
const walked = await E(() => {
  const sc = window.panel._scene;
  const p0 = sc.camera.position.clone();
  let moved = 0;
  for (let i = 0; i < 200; i++) if (sc.walkStep(0.1, 0)) moved++;
  return { moved, dist: Math.round(sc.camera.position.distanceTo(p0) * 100) / 100 };
});
t.results.wand = walked;
t.check(walked.moved < 200 && walked.dist < 19, `Wand hält auf: ${JSON.stringify(walked)}`);
await pg.keyboard.down("ArrowLeft");
await pg.keyboard.up("ArrowLeft");
await pg.locator("haus3d-panel .walkui .exit").click();
const after = await E(() => ({ walking: window.panel._scene.isWalking(), view: window.panel._scene.getView(), ui: !!window.panel.shadowRoot.querySelector(".walkui") }));
const same = after.view.position.every((v, i) => Math.abs(v - before.position[i]) < 0.05);
t.check(!after.walking && !after.ui && same, `Begehen verlassen: ${JSON.stringify({ after, before })}`);
await t.done();
