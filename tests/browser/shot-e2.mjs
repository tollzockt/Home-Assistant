// E2: Raumfenster 2.0 – Schnellaktionen, Thermostat-Stepper, Zeilen bleiben erhalten, Finger-Scrollen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e2", "?climate&quality=schoen", { width: 1024, height: 768, touch: true });
const services = () => pg.evaluate(() => window.calls.filter((c) => c.service));
const P = "haus3d-panel .roompanel";
await pg.evaluate(() => window.panel._selectRoom({ floorId: "eg", roomId: "wohnzimmer" }));
await pg.waitForTimeout(300);
t.results.lichtKnopf = await pg.locator(`${P} .act-light`).textContent();
t.check(/Licht aus \(1\)/.test(t.results.lichtKnopf), `Lichtknopf: ${t.results.lichtKnopf}`);
await pg.locator(`${P} .act-light`).tap();
await pg.waitForTimeout(200);
const off = (await services()).at(-1);
t.check(off?.service === "turn_off" && Array.isArray(off.entity_id) && off.entity_id.join() === "light.wohnzimmer_decke", `Licht aus: ${JSON.stringify(off)}`);
// Zeile bleibt dasselbe Element, zeigt aber den neuen Wert; Raumname ebenso
const same = await pg.evaluate(async () => {
  const p = window.panel;
  const row = p.shadowRoot.querySelector('.roompanel .rp-row[data-entity="sensor.wohnzimmer_temperatur"]');
  const label = p._overlays.get("room:eg:wohnzimmer").label.querySelector("b");
  const h = window.hass;
  const s = { ...h.states["sensor.wohnzimmer_temperatur"], state: "23.7" };
  p.hass = { ...h, states: { ...h.states, "sensor.wohnzimmer_temperatur": s } };
  await new Promise((r) => setTimeout(r, 300));
  const row2 = p.shadowRoot.querySelector('.roompanel .rp-row[data-entity="sensor.wohnzimmer_temperatur"]');
  return { sameRow: row === row2, text: row2.querySelector(".rp-state").textContent, sameLabel: label === p._overlays.get("room:eg:wohnzimmer").label.querySelector("b"), clim: p._overlays.get("room:eg:wohnzimmer").parts.clim.textContent };
});
t.results.zeile = same;
t.check(same.sameRow && same.text === "23.7" && same.sameLabel && same.clim.startsWith("23,7"), `Zeile/Name neu aufgebaut oder Wert alt: ${JSON.stringify(same)}`);
t.results.touchAction = await pg.evaluate(() => getComputedStyle(window.panel.shadowRoot.querySelector(".roompanel .rp-list")).touchAction);
t.check(t.results.touchAction === "pan-y", `Finger-Scrollen gesperrt: ${t.results.touchAction}`);
// 50 Aktualisierungen erzeugen keine neuen Zeilen
const nodes = await pg.evaluate(async () => {
  const p = window.panel;
  const count = () => p.shadowRoot.querySelectorAll(".roompanel *").length;
  const before = count();
  for (let i = 0; i < 50; i++) {
    const h = p._realHass ?? window.hass;
    p.hass = { ...h, states: { ...h.states, "sensor.wohnzimmer_feuchte": { ...h.states["sensor.wohnzimmer_feuchte"], state: String(40 + i) } } };
    await new Promise((r) => requestAnimationFrame(r));
  }
  await new Promise((r) => setTimeout(r, 300));
  return [before, count()];
});
t.results.knoten = nodes;
t.check(nodes[0] === nodes[1], `Raumfenster wächst bei Aktualisierungen: ${nodes}`);
// Thermostat im Bad: zweimal „+“ → ein Aufruf mit 23 °C
await pg.evaluate(() => window.panel._selectRoom({ floorId: "eg", roomId: "bad" }));
await pg.waitForTimeout(300);
const n0 = (await services()).length;
const bad = pg.locator(`${P}`).filter({ hasText: "Badezimmer" });
// zwei schnelle Tipps (direkt hintereinander, unabhängig von der Rechnerlast)
await bad.locator(".act-plus").evaluate((b) => {
  b.click();
  b.click();
});
t.results.sollAnzeige = await bad.locator(".stepper .target").textContent();
await pg.waitForTimeout(900);
const sets = (await services()).slice(n0).filter((c) => c.service === "set_temperature");
t.results.thermostat = sets;
t.check(sets.length === 1 && sets[0].temperature === 23, `Thermostat: ${JSON.stringify(sets)}`);
await t.shot(pg, "raumfenster-2.png");
// Geräte anpassen öffnen und abbrechen: Fenster baut sich wieder auf
await pg.evaluate(() => window.panel._selectRoom({ floorId: "eg", roomId: "wohnzimmer" }));
await pg.waitForTimeout(200);
const wz = pg.locator(`${P}`).filter({ hasText: "Wohnzimmer" });
await wz.locator(".cfg").tap();
await pg.waitForTimeout(200);
await wz.locator(".cancel").tap();
await pg.waitForTimeout(300);
t.check((await wz.locator(".rp-row").count()) > 3, "Raumfenster nach Abbrechen leer");
await t.done();
