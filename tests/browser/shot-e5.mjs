// E5: Bodenfarbe Temperatur/Feuchte/Leistung mit Legende, Heizkörper glüht, Klima-Zeile im Raumfenster
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e5", "?power&humid=72&climate&weather=cloudy", { width: 1280, height: 800 });
await pg.evaluate(() => window.panel._setFilter("eg"));
const legend = async () => pg.evaluate(() => window.panel.shadowRoot.querySelector(".legend .lt")?.textContent ?? null);
const out = {};
for (const [mode, file] of [["Temperatur", "boden-temperatur.png"], ["Feuchte", "boden-feuchte.png"], ["CO₂", "boden-co2.png"], ["Leistung", "boden-leistung.png"]]) {
  await t.fnToggle(pg, "Bodenfarbe");
  await pg.waitForTimeout(800);
  out[mode] = await legend();
  await t.shot(pg, file);
  t.check(out[mode] === `Bodenfarbe: ${mode}`, `Legende ${mode}: ${out[mode]}`);
}
// Leistung: Küche zeigt 320 W, Leistungssensor wird beobachtet
const power = await pg.evaluate(() => ({ label: window.panel._overlays.get("room:eg:kueche").parts.clim.textContent, watched: window.panel._watched.includes("sensor.kueche_steckdose_leistung") }));
out.leistung = power;
t.check(/320 W/.test(power.label) && power.watched, `Leistung Küche: ${JSON.stringify(power)}`);
await t.fnToggle(pg, "Bodenfarbe"); // Energie heute
await pg.waitForTimeout(400);
t.check((await legend()) === "Bodenfarbe: Energie heute", `Legende Energie heute: ${await legend()}`);
await t.fnToggle(pg, "Bodenfarbe"); // aus
await pg.waitForTimeout(400);
t.check((await legend()) === null, "Legende bleibt nach „aus“ stehen");
t.check(!(await pg.evaluate(() => window.panel._watched.includes("sensor.kueche_steckdose_leistung"))), "Leistungssensor bleibt beobachtet");
// Heizkörper glüht (climate.bad heizt)
const glow = await pg.evaluate(() => {
  const sc = window.panel._scene;
  const h = sc.heatParts.find((x) => x.entity === "climate.bad");
  return h ? h.meshes.every((m) => m.material === sc.furnMats.heatOn) && h.meshes.length > 3 : null;
});
out.heizkoerper = glow;
t.check(glow === true, `Heizkörper glüht nicht: ${glow}`);
// Raumfenster Bad: Klima-Zeile, Raumname „heizt“
await pg.evaluate(() => window.panel._selectRoom({ floorId: "eg", roomId: "bad" }));
await pg.waitForTimeout(300);
out.badKlima = await pg.evaluate(() => ({ clim: window.panel.shadowRoot.querySelector(".roompanel .rp-clim")?.textContent, heat: window.panel._overlays.get("room:eg:bad").parts.heat.textContent }));
t.check(/heizt/.test(out.badKlima.clim ?? "") && /heizt/.test(out.badKlima.heat), `Bad: ${JSON.stringify(out.badKlima)}`);
// Waschraum 72 %: Schimmel-Warnung
await pg.evaluate(() => window.panel._setFilter("kg"));
await pg.evaluate(() => window.panel._selectRoom({ floorId: "kg", roomId: "waschraum" }));
await pg.waitForTimeout(300);
out.waschraum = await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".roompanel .rp-clim")].map((e) => e.textContent).join(" | "));
t.check(/über 65 %/.test(out.waschraum), `Waschraum ohne Feuchte-Warnung: ${out.waschraum}`);
await t.shot(pg, "raumklima.png");
t.results.e5 = out;
await t.done();
