// E8: Energie-Karte 2.0 – Akku-Richtung, Netz-Zeile, Überschuss-Punkt, HA-Energie übernehmen, Umkehr mit Vorschau
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const card = (pg) =>
  pg.evaluate(() => {
    const el = window.panel.shadowRoot.querySelector(".energy");
    const row = (k) => el?.querySelector(`.row[data-k="${k}"]`);
    return {
      bezug: row("bezug")?.querySelector("b").textContent ?? null,
      bezugClass: row("bezug")?.className ?? null,
      einsp: row("einspeisung")?.querySelector("b").textContent ?? null,
      haus: row("verbrauch")?.querySelector("b").textContent ?? null,
      akku: row("akku_leistung")?.querySelector("b").textContent ?? null,
      bar: row("akku_ladestand")?.querySelector(".bbar > i")?.style.width ?? null,
      dot: el?.querySelector(".sdot")?.className ?? null,
      dotHidden: el?.querySelector(".sdot")?.hidden ?? null,
      solar: row("erzeugung")?.querySelector("b").textContent ?? null,
    };
  });
const pg = await t.page("e8", "?netz=450", { width: 1280, height: 800 });
const c1 = await card(pg);
t.results.karte = c1;
t.check(c1.bezug === "450 W" && /import/.test(c1.bezugClass) && c1.einsp === "0 W" && c1.solar === "412 W", `Netz-Zeilen: ${JSON.stringify(c1)}`);
// Haus berechnet: 412 Erzeugung + 450 Bezug + 32 aus dem Speicher
t.check(c1.haus === "894 W", `Hausverbrauch berechnet: ${JSON.stringify(c1)}`);
t.check(c1.akku === "entlädt 32 W" && c1.bar === "76%", `Akku: ${JSON.stringify(c1)}`);
// Netz bezieht → kein Überschuss
t.check(/niedrig/.test(c1.dot) && !c1.dotHidden, `Punkt: ${c1.dot}`);
await t.shot(pg, "energie-karte.png");
// Simulation: Solar 1200 W → Speicher lädt
await pg.evaluate(() => (window.panel._adminMode = true, window.panel._setSim(true)));
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .simbar [data-sim=solar]").fill("1200");
await pg.waitForTimeout(600);
const c2 = await card(pg);
t.results.simulation = c2;
// Bilanz wie echt: 400 W Haus, der Speicher lädt mit dem Überschuss (800 W), nichts geht ins Netz
t.check(c2.solar === "1,2 kW" && c2.haus === "400 W" && c2.akku === "lädt 800 W" && c2.bezug === "0 W" && c2.einsp === "0 W", `Simulation 1200 W: ${JSON.stringify(c2)}`);
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
// Umkehr beim Speicher: Summe wechselt sofort
const sumText = () => pg.evaluate(() => window.panel.shadowRoot.querySelector(".catbox .en-sum").textContent);
const prev1 = await sumText();
await pg.locator("haus3d-panel .catbox .src [data-sinv]").first().check();
const prev2 = await sumText();
t.results.vorschau = [prev1, prev2];
t.check(/entlädt 32 W/.test(prev1) && /lädt 32 W/.test(prev2) && !/entlädt/.test(prev2), `Vorschau: ${prev1} / ${prev2}`);
// Erweiterung hinzufügen: zweite PV-Anlage wird mitgerechnet
const srcBefore = await pg.evaluate(() => window.panel.shadowRoot.querySelectorAll(".catbox .src").length);
await pg.locator('haus3d-panel .catbox [data-add="pv"]').click();
const srcAfter = await pg.evaluate(() => window.panel.shadowRoot.querySelectorAll(".catbox .src").length);
await pg.locator(`haus3d-panel .catbox .src[data-i="${srcAfter - 1}"] [data-sf="power"]`).fill("sensor.pv_einspeisung");
await pg.locator(`haus3d-panel .catbox .src[data-i="${srcAfter - 1}"] [data-sf="power"]`).dispatchEvent("change");
const sum2 = await sumText();
t.check(srcAfter === srcBefore + 1 && /Erzeugung gesamt\s*792 W/.test(sum2), `Erweiterung summiert: ${JSON.stringify({ srcBefore, srcAfter, sum2 })}`);
await pg.evaluate(() => window.panel.shadowRoot.querySelector(".catbox").scrollIntoView());
await t.shot(pg, "energie-einstellungen.png");
await pg.locator("haus3d-panel .catbox .en-save").click();
await pg.waitForTimeout(500);
const saved = await pg.evaluate(() => window.panel._building.settings.energy);
t.check(saved.netz === "sensor.zaehler_leistung" && saved.sources.find((x) => x.type === "speicher")?.invert === true && saved.sources.filter((x) => x.type === "pv").length === 1 && saved.solar === null, `Gespeichert: ${JSON.stringify(saved)}`);
// Handy und Tablet
for (const [name, w, h, touch] of [["energie-handy.png", 390, 844, true], ["energie-tablet.png", 1024, 768, true]]) {
  const p = await t.page(name, "?netz=-1200", { width: w, height: h, touch });
  await p.evaluate(() => {
    const el = window.panel.shadowRoot.querySelector(".energy");
    if (el.classList.contains("collapsed")) el.querySelector("h3").click();
  });
  await p.waitForTimeout(200);
  const c = await card(p);
  t.check(c.einsp === "1,2 kW" && /hoch/.test(c.dot), `${name}: ${JSON.stringify(c)}`);
  await t.shot(p, name);
}
await t.done();
