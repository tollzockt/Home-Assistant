// E11: Tagesverlauf – Mini-Kurven in der Energie-Karte, Dialog mit Wischen, Gestern/Heute, Summen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e11", "", { width: 1280, height: 800 });
await pg.evaluate(() => {
  const el = window.panel.shadowRoot.querySelector(".energy");
  if (el.classList.contains("collapsed")) el.querySelector("h3").click();
});
await pg.waitForTimeout(600);
const sparks = await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".energy .spark")].filter((s) => !s.hidden && s.querySelector("path").getAttribute("d")).length);
const fetches = await pg.evaluate(() => window.calls.filter((c) => c.type === "recorder/statistics_during_period").length);
t.results.minikurven = { sparks, fetches };
t.check(sparks >= 3, `Mini-Kurven: ${sparks}`);
// Zustandsänderungen holen nicht neu (5 min zwischengespeichert)
await pg.evaluate(() => window.panel._updateStates());
const fetches2 = await pg.evaluate(() => window.calls.filter((c) => c.type === "recorder/statistics_during_period").length);
t.check(fetches2 === fetches, `neu geholt: ${fetches} → ${fetches2}`);
// Dialog (Knopf im Kopf), dann „Gestern“ – heute kurz nach Mitternacht gäbe es kaum Daten
await pg.locator("haus3d-panel .energy h3 .chart").click();
await pg.waitForTimeout(400);
t.check(await pg.locator("haus3d-panel .dialog.chart").count() === 1, "Dialog fehlt");
await pg.locator('haus3d-panel .dialog.chart [data-day="-1"]').click();
await pg.waitForTimeout(600);
const dlg = await pg.evaluate(() => {
  const d = window.panel.shadowRoot.querySelector(".dialog.chart");
  return { paths: d?.querySelectorAll(".chartsvg path").length ?? 0, sums: d?.querySelector(".sums")?.textContent ?? null, legend: d?.querySelector(".clegend")?.textContent ?? null };
});
t.results.dialog = dlg;
t.check(dlg.paths >= 3 && /kWh/.test(dlg.sums ?? ""), `Dialog: ${JSON.stringify(dlg)}`);
// Wischen
const box = await pg.locator("haus3d-panel .chartsvg").boundingBox();
await pg.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
await pg.mouse.down();
await pg.mouse.move(box.x + box.width * 0.52, box.y + box.height / 2);
await pg.mouse.up();
const read = await pg.evaluate(() => window.panel.shadowRoot.querySelector(".chartbox .readout").textContent);
t.results.wischen = read;
t.check(/^\d\d:\d\d · /.test(read) && /Speicher %/.test(read), `Wischen: ${read}`);
await t.shot(pg, "verlauf.png");
// Heute: Knopf gewählt, Diagramm oder (kurz nach Mitternacht) Hinweis
await pg.locator('haus3d-panel .dialog.chart [data-day="0"]').click();
await pg.waitForTimeout(600);
const y = await pg.evaluate(() => window.panel.shadowRoot.querySelector('.dialog.chart [data-day="0"]').classList.contains("sel") && (window.panel.shadowRoot.querySelectorAll(".dialog.chart .chartsvg path").length || window.panel.shadowRoot.querySelector(".dialog.chart .hint")?.textContent));
t.check(!!y, `Heute: ${y}`);
// Tablet mit Touch
const tb = await t.page("e11-tablet", "", { width: 1024, height: 768, touch: true });
await tb.evaluate(() => window.panel._energyChart(-1));
await tb.waitForTimeout(600);
await t.shot(tb, "verlauf-tablet.png");
// keine Daten
const no = await t.page("e11-leer", "?nohistory", { width: 1024, height: 700 });
await no.evaluate(() => window.panel._energyChart(0));
await no.waitForTimeout(500);
const empty = await no.evaluate(() => window.panel.shadowRoot.querySelector(".dialog.chart .hint")?.textContent ?? "");
t.check(/Keine Verlaufsdaten/.test(empty), `leer: ${empty}`);
// Simulation: Dialog ohne Fehler
await no.evaluate(() => (window.panel._adminMode = true, window.panel._setSim(true)));
await no.waitForTimeout(300);
await no.evaluate(() => window.panel._energyChart(-1));
await no.waitForTimeout(500);
await t.done();
