// G1: schlichtes Zahnrad, PIN (falsch = nichts), Bearbeiten/Beenden, Admin-Kategorien, Karten als Tabs,
// Energie-Karte anpassen, PIN ändern, Rad ohne Anzeige-Schalter; Speichern nur mit Freigabe (?pinlock)
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("g1", "?pinlock&netz", { width: 1280, height: 800 });
const E = (fn, arg) => pg.evaluate(fn, arg);
const q = (sel) => E((s) => !!window.panel.shadowRoot.querySelector(s), sel);

// Gesperrt: keine Stifte, kein Editor-Knopf, kein „+“ an den Rädern
const locked = await E(() => {
  const r = window.panel.shadowRoot;
  return { cedit: r.querySelectorAll(".cedit").length, edit: !r.querySelector(".edit").hidden, more: !r.querySelector(".more").hidden, plus: window.panel._quickItems().some((i) => i.plus) };
});
t.check(!locked.cedit && !locked.edit && !locked.more && !locked.plus, `Gesperrt ohne Bearbeiten-Knöpfe: ${JSON.stringify(locked)}`);
// Speichern ohne Freigabe scheitert
const blocked = await E(async () => {
  try {
    await window.panel._hass.callWS({ type: "haus3d/building/save", building: window.panel._building });
    return "gespeichert";
  } catch (e) {
    return e.code;
  }
});
t.check(blocked === "locked", `Speichern ohne PIN: ${blocked}`);

// Zahnrad: Basics, Kacheln, zwei große Felder
await pg.locator("haus3d-panel .gear").click();
await pg.waitForTimeout(300);
const basics = await E(() => {
  const d = window.panel.shadowRoot.querySelector(".dialog.basics");
  return { segs: [...d.querySelectorAll(".seg")].map((s) => s.dataset.key), tiles: [...d.querySelectorAll(".qtile span")].map((s) => s.textContent), big: [...d.querySelectorAll(".bigtile span")].map((s) => s.textContent), h4: d.querySelectorAll("h4").length };
});
t.results.zahnrad = basics;
t.check(basics.segs.join() === "style,quality,deviceMode" && basics.tiles.length === 11 && basics.tiles.includes("Leitungen") && basics.big.join() === "Bearbeiten,Admin-Einstellungen", `Zahnrad: ${JSON.stringify(basics)}`);
await t.shot(pg, "zahnrad.png");
// Kachel Raster schaltet um
const g0 = await E(() => window.panel._settings.layers.grid !== false);
await pg.locator('haus3d-panel .qtile[data-layer="grid"]').click();
const g1 = await E(() => window.panel._settings.layers.grid !== false);
t.check(g0 !== g1, "Kachel Raster schaltet");
await pg.locator('haus3d-panel .qtile[data-layer="grid"]').click();

// Bearbeiten: falsche PIN → nichts; richtige → frei
await pg.locator("haus3d-panel .bigtile.edit").click();
await pg.waitForSelector("haus3d-panel .pinpad");
await t.shot(pg, "pin-feld.png");
await pg.keyboard.type("1234", { delay: 60 });
await pg.waitForTimeout(900);
const wrong = await E(() => ({ pad: !!window.panel.shadowRoot.querySelector(".pinpad"), dots: window.panel.shadowRoot.querySelectorAll(".pinpad .dots i.on").length, toast: window.panel.shadowRoot.querySelector(".toast")?.textContent ?? "", editing: window.panel._editing() }));
t.check(wrong.pad && wrong.dots === 4 && !wrong.editing && !/falsch|PIN/i.test(wrong.toast), `Falsche PIN: nichts passiert ${JSON.stringify(wrong)}`);
for (let i = 0; i < 4; i++) await pg.keyboard.press("Backspace");
await pg.keyboard.type("0000", { delay: 60 });
await pg.waitForFunction(() => window.panel._editing(), null, { timeout: 5000 });
await pg.waitForTimeout(300);
const ed = await E(() => {
  const r = window.panel.shadowRoot;
  return { band: !!r.querySelector(".modes .mode.m-edit"), edit: !r.querySelector(".edit").hidden, cedit: r.querySelectorAll(".cedit").length, plus: window.panel._quickItems().some((i) => i.plus) };
});
t.results.bearbeiten = ed;
t.check(ed.band && ed.edit && ed.cedit >= 1 && ed.plus, `Bearbeiten frei: ${JSON.stringify(ed)}`);
await t.shot(pg, "bearbeiten-aktiv.png");
// Zahnrad zeigt „Beenden“
await pg.locator("haus3d-panel .gear").click();
const endTxt = await E(() => window.panel.shadowRoot.querySelector(".bigtile.edit span").textContent);
t.check(endTxt === "Beenden", `Feld zeigt Beenden: ${endTxt}`);
await pg.locator("haus3d-panel .dialog .close").click();

// Stift an der Energie-Karte → Admin → Karten, Tab Energie (ohne Admin-PIN)
await pg.locator("haus3d-panel .energy .cedit").click();
await pg.waitForTimeout(300);
const tabs = await E(() => {
  const d = window.panel.shadowRoot.querySelector(".dialog.admin");
  return d && { title: d.querySelector(".ttl").textContent, tabs: [...d.querySelectorAll(".ctabs button")].map((b) => b.textContent), sel: d.querySelector(".ctabs .sel")?.textContent, pin: !!window.panel.shadowRoot.querySelector(".pinpad") };
});
t.results.kartenTabs = tabs;
t.check(tabs?.title === "Karten" && tabs.sel === "Energie" && tabs.tabs.at(-1) === "+" && !tabs.pin, `Energie-Stift öffnet Karten-Tab: ${JSON.stringify(tabs)}`);
// Energie-Karte: Ertrag ausblenden, Speicher nach oben, Titel ändern
await E(() => {
  const f = window.panel.shadowRoot.querySelector(".cform");
  const rows = [...f.querySelectorAll(".erow")];
  const idx = (name) => rows.findIndex((r) => r.querySelector(".nm").placeholder === name);
  f.querySelector(`[data-vis="${idx("Ertrag heute")}"]`).click();
});
const akkuIdx = await E(() => [...window.panel.shadowRoot.querySelectorAll(".cform .erow")].findIndex((r) => r.querySelector(".nm").placeholder === "Speicher"));
for (let i = akkuIdx; i > 0; i--) await pg.locator(`haus3d-panel .cform [data-up="${i}"]`).click();
await pg.locator("haus3d-panel .cform .ttl").fill("Strom");
await t.shot(pg, "karten-energie.png");
await pg.locator("haus3d-panel .cform .save").click();
await pg.waitForTimeout(500);
const ecard = await E(() => {
  const el = window.panel.shadowRoot.querySelector(".energy");
  return { title: el.querySelector("h3 span").textContent, rows: [...el.querySelectorAll(".row span")].map((s) => s.textContent) };
});
t.results.energieKarte = ecard;
t.check(ecard.title === "Strom" && ecard.rows[0] === "Speicher" && !ecard.rows.includes("Ertrag heute"), `Energie-Karte angepasst: ${JSON.stringify(ecard)}`);
// Tab „+“: Karte anlegen, dann „Entfernen“
await pg.locator('haus3d-panel .ctabs [data-tab="+"]').click();
await pg.locator("haus3d-panel .cform .ttl").fill("Wasser");
await pg.locator("haus3d-panel .cform .add").click();
await pg.waitForTimeout(400);
const added = await E(() => ({ tab: window.panel.shadowRoot.querySelector(".ctabs .sel")?.textContent, cards: (window.panel._building.settings.cards ?? []).map((c) => c.title) }));
await pg.locator("haus3d-panel .cform .del").click();
await pg.waitForTimeout(600); // Nachfrage nimmt Tipps erst nach 0,4 s an
await pg.locator("haus3d-panel .confirm .yes").click();
await pg.waitForTimeout(400);
const removed = await E(() => (window.panel._building.settings.cards ?? []).map((c) => c.title));
t.check(added.tab === "Wasser" && added.cards.includes("Wasser") && !removed.includes("Wasser"), `Karte anlegen/entfernen: ${JSON.stringify({ added, removed })}`);
await pg.locator("haus3d-panel .dialog .close").click();

// Beenden: Knöpfe wieder weg, Speichern wieder gesperrt
await pg.locator("haus3d-panel .modes [data-end=edit]").click();
await pg.waitForTimeout(300);
const ended = await E(async () => {
  const r = window.panel.shadowRoot;
  let code = null;
  try {
    await window.panel._hass.callWS({ type: "haus3d/building/save", building: window.panel._building, token: Object.keys(window.tokens)[0] });
  } catch (e) {
    code = e.code;
  }
  return { band: !!r.querySelector(".modes .mode.m-edit"), cedit: r.querySelectorAll(".cedit").length, tokens: Object.keys(window.tokens).length };
});
t.check(!ended.band && !ended.cedit && ended.tokens === 0, `Beenden: ${JSON.stringify(ended)}`);

// Admin-Einstellungen: Kategorien, Bereich öffnen, PIN ändern
await unlock(pg, "admin");
const cats = await E(() => [...window.panel.shadowRoot.querySelectorAll(".cats .cat b")].map((b) => b.textContent));
t.results.kategorien = cats;
t.check(cats.length === 10 && cats.includes("PIN & Zugang") && cats.includes("Daten & Verlauf"), `Kategorien: ${JSON.stringify(cats)}`);
await t.shot(pg, "admin-kategorien.png");
await pg.locator('haus3d-panel .cat[data-cat="house"]').click();
const house = await q(".catbox .house-save");
t.check(house, "Bereich Haus & Wetter");
await pg.locator("haus3d-panel .dialog .back").click();
await pg.locator('haus3d-panel .cat[data-cat="pin"]').click();
await pg.waitForTimeout(300);
const warn = await E(() => window.panel.shadowRoot.querySelectorAll(".pinset .warn").length);
await pg.locator('haus3d-panel .pinset[data-scope="edit"] .p1').fill("4711");
await pg.locator('haus3d-panel .pinset[data-scope="edit"] .p2').fill("4711");
await pg.locator('haus3d-panel .pinset[data-scope="edit"] .set').click();
await pg.waitForTimeout(400);
const pins = await E(() => window.pins);
t.check(warn === 3 && pins.edit === "4711", `PIN ändern: ${JSON.stringify({ warn, pins })}`);
await t.shot(pg, "admin-pin.png");
await pg.locator("haus3d-panel .dialog .close").click();
// Admin bleibt aktiv (oben „Admin · Beenden“), bis man es beendet
const adminBar = await E(() => !!window.panel.shadowRoot.querySelector(".modes .mode.m-admin"));
await t.shot(pg, "admin-aktiv.png");
await pg.locator("haus3d-panel .modes [data-end=admin]").click();
const adminOff = await E(() => !window.panel.shadowRoot.querySelector(".modes .mode.m-admin") && !Object.keys(window.tokens).length);
t.check(adminBar && adminOff, `Admin-Modus oben mit Beenden: ${JSON.stringify({ adminBar, adminOff })}`);
// alte PIN öffnet Bearbeiten nicht mehr, neue schon
await E(() => {
  window.__e = window.panel._startEdit();
});
await pg.waitForSelector("haus3d-panel .pinpad");
await pg.keyboard.type("0000", { delay: 60 });
await pg.waitForTimeout(900);
const still = await E(() => !window.panel._editing());
for (let i = 0; i < 4; i++) await pg.keyboard.press("Backspace");
await pg.keyboard.type("4711", { delay: 60 });
await pg.waitForFunction(() => window.panel._editing(), null, { timeout: 5000 });
t.check(still, "alte PIN gilt nicht mehr");
await E(() => window.panel._endEdit());

// Funktionsrad ohne Anzeige-Schalter
const wheel = await E(() => window.panel._functionItems().map((i) => i.name));
t.results.rad = wheel;
t.check(!wheel.some((n) => /^Stil|Raster|Dach|Wetter|Raumnamen|Möbel|Anwesenheit|Vollbild|Schatten/.test(n)), `Rad entschlackt: ${JSON.stringify(wheel)}`);

// Tablet: Zahnrad als Blatt
const tab = await t.page("g1-tablet", "", { width: 800, height: 1280, touch: true });
await tab.locator("haus3d-panel .gear").click();
await tab.waitForTimeout(400);
await t.shot(tab, "zahnrad-tablet.png");
await tab.locator("haus3d-panel .bigtile.admin").click();
await tab.waitForSelector("haus3d-panel .pinpad");
await t.shot(tab, "pin-tablet.png");
await t.done();
