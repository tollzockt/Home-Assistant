// E6: Hinweise am Modell – Regen bei offenem Fenster, Wassermelder, Garage lange offen, Ausblenden
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e6", "?weather=rainy", { width: 1280, height: 800, wait: 3500 });
const state = () =>
  pg.evaluate(() => {
    const p = window.panel;
    return {
      bar: p.shadowRoot.querySelector(".alertbar")?.textContent ?? null,
      alerts: (p._visibleAlerts ?? []).map((a) => [a.rule, a.text]),
      bell: p.shadowRoot.querySelector(".status .bell span")?.textContent ?? null,
    };
  });
const s1 = await state();
t.results.regen = s1;
const rain = s1.alerts.find(([r]) => r === "rain_open");
t.check(rain && /Wohnzimmer/.test(rain[1]), `Regen-Hinweis fehlt: ${JSON.stringify(s1)}`);
t.check(s1.alerts.some(([r]) => r === "garage_open"), `Garage seit 60 min offen fehlt: ${JSON.stringify(s1.alerts)}`);
t.check(Number(s1.bell) === s1.alerts.length, `Glocke ${s1.bell} ≠ ${s1.alerts.length}`);
// Raumboden eingefärbt, Raumname mit Hinweis
const room = await pg.evaluate(() => {
  const p = window.panel;
  const r = p._scene.floors.get("eg").rooms.get("wohnzimmer");
  return { emissive: r.mesh.material.emissive.getHexString(), label: p._overlays.get("room:eg:wohnzimmer").parts.alarm.textContent };
});
t.results.raum = room;
t.check(room.emissive === "ff8f00" && /offen/.test(room.label) && /\+1/.test(room.label), `Raum nicht markiert: ${JSON.stringify(room)}`);
await t.shot(pg, "hinweise-regen.png");
// „Zeigen“ beim Regen-Hinweis (über die Liste) → EG und Raumfenster
await pg.locator("haus3d-panel .status .bell").click();
await pg.waitForTimeout(200);
const idx = s1.alerts.findIndex(([r]) => r === "rain_open");
await pg.locator(`haus3d-panel .alertpop [data-show="${idx}"]`).click();
await pg.waitForTimeout(400);
const shown = await pg.evaluate(() => ({ filter: window.panel._filter, panels: (window.panel._panels ?? []).map((p) => p.roomId) }));
t.results.zeigen = shown;
t.check(shown.filter === "eg" && shown.panels.includes("wohnzimmer"), `Zeigen: ${JSON.stringify(shown)}`);
// Ausblenden: Regen-Hinweis verschwindet
await pg.locator("haus3d-panel .status .bell").click();
await pg.waitForTimeout(200);
await pg.locator(`haus3d-panel .alertpop [data-ack="${idx}"]`).click();
await pg.waitForTimeout(400);
const s2 = await state();
t.check(!s2.alerts.some(([r]) => r === "rain_open"), `Ausblenden wirkt nicht: ${JSON.stringify(s2.alerts)}`);
// Wassermelder: kritisch, zuerst
const w = await t.page("e6-wasser", "?moisture", { width: 1024, height: 700 });
const crit = await w.evaluate(() => ({ cls: window.panel.shadowRoot.querySelector(".alertbar")?.className, text: window.panel.shadowRoot.querySelector(".alertbar .at")?.textContent }));
t.results.wasser = crit;
t.check(/critical/.test(crit.cls ?? "") && /Wassermelder/.test(crit.text ?? ""), `Wassermelder: ${JSON.stringify(crit)}`);
await t.shot(w, "hinweise-wasser.png");
// Simulation: Wetter „Regen“ → Hinweis, keine echten Aufrufe
const sim = await t.page("e6-sim", "", { width: 1024, height: 700 });
await sim.evaluate(() => window.panel._setSim(true));
await sim.waitForTimeout(400);
await sim.locator('haus3d-panel .simbar select[data-sim="weather"]').selectOption("rainy");
await sim.waitForTimeout(800);
const simRain = await sim.evaluate(() => ({ rain: (window.panel._visibleAlerts ?? []).some((a) => a.rule === "rain_open"), calls: window.calls.filter((c) => c.service).length }));
t.results.simulation = simRain;
t.check(simRain.rain && simRain.calls === 0, `Simulation Regen: ${JSON.stringify(simRain)}`);
await t.done();
