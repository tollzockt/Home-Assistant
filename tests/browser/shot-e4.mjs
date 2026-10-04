// E4: Statusleiste (Chips, Liste, alle Lichter aus, Etagen-Zahlen), Personen, Bewegung am Raumnamen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e4", "?person&motion&lock=unlocked", { width: 1280, height: 800 });
const info = await pg.evaluate(async () => {
  const p = window.panel;
  const { houseStatus, statusChips } = await import("/custom_components/haus3d/frontend/status.js");
  const st = houseStatus(p._building, p._hass, p._byArea, p._links, p._places);
  const expected = statusChips(st).map((c) => c.text);
  const shown = [...p.shadowRoot.querySelectorAll(".status .chips .chip span")].map((s) => s.textContent);
  const badges = Object.fromEntries([...p.shadowRoot.querySelectorAll(".floorbar [data-floor]")].map((b) => [b.dataset.floor, b.querySelector(".badge")?.textContent ?? null]));
  return { expected, shown, badges, lights: st.lights.map((l) => l.entity_id) };
});
t.results.status = info;
t.check(JSON.stringify(info.expected) === JSON.stringify(info.shown) && info.shown.length >= 3, `Chips: ${JSON.stringify(info)}`);
t.check(info.badges.eg && info.badges.kg, `Etagen-Zahlen fehlen: ${JSON.stringify(info.badges)}`);
await t.shot(pg, "status-leiste.png");
// Lichter-Liste: „Alle Lichter aus“ = genau ein Aufruf
await pg.locator('haus3d-panel .status .chip[data-key="lights"]').click();
await pg.waitForTimeout(200);
const rows = await pg.locator("haus3d-panel .statuspop [data-entity]").count();
const n0 = await pg.evaluate(() => window.calls.filter((c) => c.service).length);
await pg.locator("haus3d-panel .statuspop .alloff").click();
await pg.waitForTimeout(200);
const calls = await pg.evaluate((n0) => window.calls.filter((c) => c.service).slice(n0), n0);
t.results.alleAus = { rows, calls };
t.check(calls.length === 1 && calls[0].service === "turn_off" && calls[0].entity_id.length === info.lights.length, `Alle Lichter aus: ${JSON.stringify(calls)}`);
// offen-Liste: Tipp springt zum Raum
await pg.locator('haus3d-panel .status .chip[data-key="open"]').click();
await pg.waitForTimeout(200);
await pg.locator("haus3d-panel .statuspop [data-entity]").first().click();
await pg.waitForTimeout(400);
const jumped = await pg.evaluate(() => ({ filter: window.panel._filter, panels: (window.panel._panels ?? []).map((p) => p.roomId) }));
t.results.sprung = jumped;
t.check(jumped.filter !== "all" && jumped.panels.length === 1, `Sprung zum Raum: ${JSON.stringify(jumped)}`);
await pg.evaluate(() => window.panel._selectRoom(null));
await pg.evaluate(() => window.panel._setFilter("all"));
// Personen
const people = await pg.evaluate(() => [...window.panel.shadowRoot.querySelectorAll(".status .avatar")].map((a) => ({ id: a.dataset.entity, away: a.classList.contains("away"), img: !!a.querySelector("img") })));
t.results.personen = people;
t.check(people.length === 2 && people.find((p) => p.id === "person.ben")?.away && people.find((p) => p.id === "person.anna")?.img, `Personen: ${JSON.stringify(people)}`);
// Bewegung am Raumnamen
const occ = await pg.evaluate(() => {
  const ov = window.panel._overlays;
  return { kueche: ov.get("room:eg:kueche")?.parts.occ.textContent, bad: ov.get("room:eg:bad")?.parts.occ.textContent, tick: [...(window.panel._tickers ?? [])] };
});
t.results.bewegung = occ;
t.check(occ.kueche === "● Bewegung" && /^Bewegung vor 2 min$/.test(occ.bad ?? "") && occ.tick.includes("presence"), `Bewegung: ${JSON.stringify(occ)}`);
// Statusleiste ausblenden
await pg.evaluate(() => {
  const p = window.panel;
  p._settings.layers.status = false;
  p._applyOverlayLayers();
});
t.check(await pg.evaluate(() => window.panel.shadowRoot.querySelector(".status .chips").hidden), "Statusleiste lässt sich nicht ausblenden");
// Tablet hochkant
const tab = await t.page("e4-tablet", "?person&motion&lock=unlocked", { width: 800, height: 1280, touch: true });
await t.shot(tab, "status-leiste-tablet.png");
await t.done();
