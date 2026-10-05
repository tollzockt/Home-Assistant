// E8: Energie-Karte 2.0 – Akku-Richtung, Netz-Zeile, Überschuss-Punkt, HA-Energie übernehmen, Umkehr mit Vorschau
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const card = (pg) =>
  pg.evaluate(() => {
    const el = window.panel.shadowRoot.querySelector(".energy");
    const row = (k) => el?.querySelector(`.row[data-k="${k}"]`);
    return {
      netz: row("netz")?.querySelector("b").textContent ?? null,
      netzClass: row("netz")?.className ?? null,
      akku: row("akku_leistung")?.querySelector("b").textContent ?? null,
      bar: row("akku_ladestand")?.querySelector(".bbar > i")?.style.width ?? null,
      dot: el?.querySelector(".sdot")?.className ?? null,
      dotHidden: el?.querySelector(".sdot")?.hidden ?? null,
      solar: row("solar")?.querySelector("b").textContent ?? null,
    };
  });
const pg = await t.page("e8", "?netz=450", { width: 1280, height: 800 });
const c1 = await card(pg);
t.results.karte = c1;
t.check(c1.netz === "Bezug 450 W" && /import/.test(c1.netzClass), `Netz-Zeile: ${JSON.stringify(c1)}`);
t.check(c1.akku === "entlädt 32 W" && c1.bar === "76%", `Akku: ${JSON.stringify(c1)}`);
// Netz bezieht → kein Überschuss
t.check(/niedrig/.test(c1.dot) && !c1.dotHidden, `Punkt: ${c1.dot}`);
await t.shot(pg, "energie-karte.png");
// Simulation: Solar 1200 W → Einspeisung → Punkt „hoch“
await pg.evaluate(() => window.panel._setSim(true));
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .simbar [data-sim=solar]").fill("1200");
await pg.waitForTimeout(600);
const c2 = await card(pg);
t.results.simulation = c2;
t.check(/hoch/.test(c2.dot) && c2.solar === "1,2 kW" && /^Einspeisung/.test(c2.netz), `Simulation 1200 W: ${JSON.stringify(c2)}`);
await pg.evaluate(() => window.panel._setSim(false));
await pg.waitForTimeout(300);
// Einstellungen: HA-Energie übernehmen füllt nur die Felder, gespeichert wird erst mit „Speichern“
await unlock(pg, "admin", { cat: "energy" });
await pg.waitForTimeout(300);
const saves = () => pg.evaluate(() => window.calls.filter((c) => c.type === "haus3d/building/save").length);
const s0 = await saves();
await pg.locator("haus3d-panel .catbox .en-ha").click();
await pg.waitForTimeout(300);
const found = await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".catbox .en-found .fl")].map((x) => x.textContent));
t.results.gefunden = found;
t.check(found.some((f) => /sensor\.zaehler_leistung/.test(f)) && found.some((f) => /sensor\.akku_ladestand/.test(f)), `Vorschläge: ${JSON.stringify(found)}`);
await pg.locator("haus3d-panel .catbox .f-ok").click();
await pg.waitForTimeout(300);
const filled = await pg.evaluate(() => window.panel.shadowRoot.querySelector('.catbox [data-core="netz"]').value);
t.check(filled === "sensor.zaehler_leistung" && (await saves()) === s0, `Übernehmen: ${filled}, Speichern ${(await saves()) - s0}×`);
// Umkehr: Vorschau wechselt sofort
const prev1 = await pg.evaluate(() => window.panel.shadowRoot.querySelector(".catbox .pv-akku").textContent);
await pg.locator('haus3d-panel .catbox [data-inv="akku_invert"]').check();
const prev2 = await pg.evaluate(() => window.panel.shadowRoot.querySelector(".catbox .pv-akku").textContent);
t.results.vorschau = [prev1, prev2];
t.check(prev1 === "aktuell: entlädt 32 W" && prev2 === "aktuell: lädt 32 W", `Vorschau: ${prev1} / ${prev2}`);
await pg.evaluate(() => window.panel.shadowRoot.querySelector(".catbox").scrollIntoView());
await t.shot(pg, "energie-einstellungen.png");
await pg.locator("haus3d-panel .catbox .en-save").click();
await pg.waitForTimeout(500);
const saved = await pg.evaluate(() => window.panel._building.settings.energy);
t.check(saved.netz === "sensor.zaehler_leistung" && saved.akku_invert === true, `Gespeichert: ${JSON.stringify(saved)}`);
// Handy und Tablet
for (const [name, w, h, touch] of [["energie-handy.png", 390, 844, true], ["energie-tablet.png", 1024, 768, true]]) {
  const p = await t.page(name, "?netz=-1200", { width: w, height: h, touch });
  await p.evaluate(() => {
    const el = window.panel.shadowRoot.querySelector(".energy");
    if (el.classList.contains("collapsed")) el.querySelector("h3").click();
  });
  await p.waitForTimeout(200);
  const c = await card(p);
  t.check(c.netz === "Einspeisung 1,2 kW" && /hoch/.test(c.dot), `${name}: ${JSON.stringify(c)}`);
  await t.shot(p, name);
}
await t.done();
