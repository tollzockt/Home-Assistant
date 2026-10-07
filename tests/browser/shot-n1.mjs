// N1: Alltag – Waschmaschine fertig, Termine/Müll, Strompreis, Lüften-Timer, Heizung pausieren, Urlaub;
// Zeitstrahl (Verlauf + Vorhersage), Bodenfarbe CO₂/Energie heute, Raum-Szenen, Favoriten-Leiste
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("n1", "?daily&weather=sunny&quality=schoen", { width: 1280, height: 800 });
const E = (fn, arg) => pg.evaluate(fn, arg);
const R = (sel) => E((s) => !!window.panel.shadowRoot.querySelector(s), sel);
const setState = (id, state) => E(([i, s]) => {
  const p = window.panel;
  const h = p._realHass;
  p.hass = { ...h, states: { ...h.states, [i]: { ...h.states[i], state: s, last_changed: new Date().toISOString() } } };
}, [id, state]);

// Einstellungen „Alltag“ (wie im Admin gespeichert)
await E(() => {
  const p = window.panel;
  const b = structuredClone(p._building);
  b.settings.daily = { appliances: [{ id: "wm", name: "Waschmaschine", kind: "washer", power: "sensor.waschmaschine_leistung" }], calendars: ["calendar.abfall"], price_entity: "sensor.strompreis", kwp: 9.8, mold: true };
  p._setBuilding(b, p._revision, { keepCamera: true });
});
await pg.waitForTimeout(500);
const chips = () => E(() => [...window.panel.shadowRoot.querySelectorAll(".chips .chip")].map((c) => `${c.dataset.key}=${c.querySelector("span").textContent.trim()}`));

// Waschmaschine: läuft → fertig → Hinweis mit „Erledigt“
await setState("sensor.waschmaschine_leistung", "1850");
await pg.waitForTimeout(300);
let c = await chips();
t.check(c.some((x) => x.startsWith("ap:wm=Waschmaschine läuft")), `Chip läuft: ${c}`);
await E(() => {
  const p = window.panel;
  const now = Date.now();
  p._appl.set("wm", { phase: "running", startedAt: now - 70 * 60000, lowSince: now - 4 * 60000, doneAt: null });
});
await setState("sensor.waschmaschine_leistung", "1");
await pg.waitForTimeout(400);
const alerts = () => E(() => (window.panel._visibleAlerts ?? []).map((a) => `${a.rule}:${a.text}`));
t.results.alerts = await alerts();
t.check(t.results.alerts.some((a) => a === "appliance:Waschmaschine ist fertig"), `Fertig-Hinweis: ${t.results.alerts}`);
t.check((await chips()).some((x) => x === "ap:wm=Waschmaschine fertig"), "Chip fertig fehlt");
// Termin morgen als Chip
t.check((await chips()).some((x) => /^cal=morgen: Gelbe Tonne/.test(x)), `Termin-Chip: ${await chips()}`);
if (new Date().getHours() >= 16) t.check(t.results.alerts.some((a) => /Morgen: Gelbe Tonne rausstellen/.test(a)), "Müll-Erinnerung fehlt");
// Kosten in der Energie-Karte (dynamischer Preis, günstige Stunden)
const cost = await E(() => ({ cost: window.panel.shadowRoot.querySelector(".energy .row.cost b")?.textContent, cheap: window.panel.shadowRoot.querySelector(".energy .row.cheap b")?.textContent }));
t.results.kosten = cost;
t.check(/ct\/kWh/.test(cost.cost ?? "") && /Ø/.test(cost.cheap ?? ""), `Kosten: ${JSON.stringify(cost)}`);
await t.shot(pg, "n1-alltag.png");
// „Erledigt“ am Hinweis (Banner: wichtigster zuerst – ggf. über den Popup-Weg)
await E(() => {
  const p = window.panel;
  const a = p._visibleAlerts.find((x) => x.rule === "appliance");
  p._alertAction(a);
});
await pg.waitForTimeout(300);
t.check(!(await alerts()).some((a) => a.startsWith("appliance:")), "Fertig-Hinweis nach „Erledigt“ noch da");

// Lüften-Timer im Raumfenster
await E(() => window.panel._selectRoom({ floorId: "eg", roomId: "wohnzimmer" }));
await pg.waitForTimeout(300);
await pg.locator("haus3d-panel .roompanel .act-vent").click();
await pg.waitForTimeout(300);
t.check((await chips()).some((x) => /^vent:eg:wohnzimmer=Wohnzimmer \d+ min/.test(x)), `Lüften-Chip: ${await chips()}`);
const ventBtn = await E(() => window.panel.shadowRoot.querySelector(".roompanel .act-vent").textContent.trim());
t.check(/Lüften \d+ min/.test(ventBtn), `Lüften-Knopf: ${ventBtn}`);
// Schimmel (Wohnzimmer 21,4 °C / 48 %: ok) und Kosten des Raums stehen im Klima-Block
await E(() => {
  localStorage.setItem("haus3d.vent", JSON.stringify({ "eg:wohnzimmer": Date.now() - 1000 }));
  window.panel._alertSig = null;
  window.panel._updateStates();
});
await pg.waitForTimeout(300);
t.check((await alerts()).some((a) => a === "vent:Wohnzimmer: genug gelüftet – Fenster schließen"), `Lüften vorbei: ${await alerts()}`);
await t.shot(pg, "n1-lueften.png");
await E(() => window.panel._ventStart("eg", "wohnzimmer", null));

// Heizung pausieren (Knopf am Hinweis „Fenster offen, Heizung läuft“)
await E(() => window.panel._alertAction({ key: "x", action: { act: "heat:climate.bad:binary_sensor.bad_fenster" } }));
await pg.waitForTimeout(200);
const pause = await E(() => window.calls.find((m) => m.type === "haus3d/climate/pause"));
t.check(pause?.entity_id === "climate.bad" && pause.contacts.join() === "binary_sensor.bad_fenster", `Pause: ${JSON.stringify(pause)}`);

// Urlaub: Anwesenheit simulieren im „Haus verlassen“
await E(() => window.panel._checkSheet("leave"));
await pg.waitForTimeout(300);
await pg.locator("haus3d-panel [data-away]").check();
await pg.waitForTimeout(200);
t.check(await E(() => window.away === true), "Anwesenheitssimulation nicht eingeschaltet");
await E(() => window.panel._closeDialog());

// Bodenfarbe CO₂ und Energie heute
await E(() => {
  const p = window.panel;
  p._view = "co2";
  p._updateStates();
});
await pg.waitForTimeout(300);
t.check(await E(() => /CO₂/.test(window.panel._legend?.textContent ?? "")), "Legende CO₂ fehlt");
await t.shot(pg, "n1-co2.png");
await E(async () => {
  const p = window.panel;
  p._view = "power";
  p._cycleView(); // → Energie heute
  await new Promise((r) => setTimeout(r, 300));
});
const kwh = await E(() => ({ view: window.panel._view, wz: window.panel._roomKwh?.get("eg:wohnzimmer") }));
t.results.energieHeute = kwh;
t.check(kwh.view === "energy" && kwh.wz === 1.25, `Energie heute: ${JSON.stringify(kwh)}`);
await E(() => {
  const p = window.panel;
  p._view = "none";
  p._updateStates();
});

// Zeitstrahl: Verlauf (Licht vor 2 h an) und Vorhersage
await E(() => {
  const now = Date.now();
  window.historyData = { "light.wohnzimmer_decke": [{ s: "off", lu: (now - 5 * 3600000) / 1000 }, { s: "on", lu: (now - 3 * 3600000) / 1000 }, { s: "off", lu: (now - 1 * 3600000) / 1000 }] };
});
await E(() => window.panel._timelineOpen());
await pg.waitForFunction(() => window.panel._tl && !window.panel._tl.loading, null, { timeout: 5000 });
t.check(await R(".tlbar"), "Zeitstrahl-Leiste fehlt");
const at = (ms) => E((d) => {
  window.panel._tlSet(Date.now() + d);
  return { light: window.panel._hass.states["light.wohnzimmer_decke"].state, info: window.panel.shadowRoot.querySelector(".tlbar .tli").textContent, label: window.panel.shadowRoot.querySelector(".tlbar .tlt").textContent };
}, ms);
const past = await at(-2 * 3600000);
const later = await at(-0.5 * 3600000);
t.results.zeitstrahl = { past, later };
t.check(past.light === "on" && later.light === "off" && past.info === "Verlauf", `Verlauf: ${JSON.stringify({ past, later })}`);
await t.shot(pg, "n1-zeitstrahl-verlauf.png");
const fut = await at(2 * 3600000);
t.results.vorhersage = fut;
t.check(/% Wolken/.test(fut.info) && /erwartet/.test(fut.info), `Vorhersage: ${JSON.stringify(fut)}`);
// Schalten ist im Zeitstrahl gesperrt
const n0 = await E(() => window.calls.filter((x) => x.service).length);
await E(() => window.panel._hass.callService("light", "toggle", { entity_id: "light.wohnzimmer_decke" }));
t.check((await E(() => window.calls.filter((x) => x.service).length)) === n0, "Zeitstrahl hat geschaltet");
await t.shot(pg, "n1-zeitstrahl-vorhersage.png");
await E(() => window.panel._timelineClose());
t.check(!(await R(".tlbar")) && (await E(() => window.panel._hass.states["light.wohnzimmer_decke"].state)) === "on", "Zeitstrahl nicht sauber geschlossen");

// Favoriten-Leiste: drei Tipps → Favorit
await E(() => {
  localStorage.removeItem("haus3d.favs");
  for (let i = 0; i < 3; i++) window.panel._favCount("light.wohnzimmer_decke");
});
await pg.waitForTimeout(200);
const favs = await E(() => [...window.panel.shadowRoot.querySelectorAll(".favbar .fav")].map((b) => ({ id: b.dataset.id, on: b.classList.contains("on") })));
t.results.favoriten = favs;
t.check(favs.length === 1 && favs[0].id === "light.wohnzimmer_decke" && favs[0].on, `Favoriten: ${JSON.stringify(favs)}`);
await t.shot(pg, "n1-favoriten.png");

// Raum-Szenen: vorhandene Szene schalten, neue im Bearbeiten-Modus speichern
await E(() => {
  const p = window.panel;
  const b = structuredClone(p._building);
  b.floors.find((f) => f.id === "eg").rooms.find((r) => r.id === "wohnzimmer").scenes = [{ id: "haus3d_wohnzimmer_kino_x", name: "Kino", icon: "mdi:movie-open" }];
  p._setBuilding(b, p._revision, { keepCamera: true });
  p._selectRoom(null);
  p._selectRoom({ floorId: "eg", roomId: "wohnzimmer" });
});
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .roompanel .act-rscene").click();
await pg.waitForTimeout(200);
const sc = await E(() => window.calls.filter((x) => x.domain === "scene").at(-1));
t.check(sc?.service === "turn_on" && sc.entity_id === "scene.wohnzimmer_kino", `Szene: ${JSON.stringify(sc)}`);
await unlock(pg, "edit");
await E(() => {
  const p = window.panel;
  p._selectRoom(null);
  p._selectRoom({ floorId: "eg", roomId: "wohnzimmer" });
});
await pg.waitForTimeout(400);
await pg.locator("haus3d-panel .roompanel .act-addscene").click();
await pg.waitForSelector("haus3d-panel .scenedlg");
await pg.locator('haus3d-panel .scenedlg [data-ic="mdi:book-open-variant"]').click();
await t.shot(pg, "n1-szene.png");
await pg.locator("haus3d-panel .scenedlg .save").click();
await pg.waitForTimeout(600);
const api = await E(() => window.apiCalls?.at(-1));
const scenes = await E(() => window.panel._building.floors.find((f) => f.id === "eg").rooms.find((r) => r.id === "wohnzimmer").scenes);
t.results.szene = { api: api?.path, entities: Object.keys(api?.body?.entities ?? {}), scenes: scenes.map((s) => s.name) };
t.check(api?.method === "POST" && /^config\/scene\/config\/haus3d_wohnzimmer_lesen_/.test(api.path) && api.body.entities["light.wohnzimmer_decke"]?.state && scenes.map((s) => s.name).join() === "Kino,Lesen", `Szene speichern: ${JSON.stringify(t.results.szene)}`);
await E(() => window.panel._endEdit());

// Admin → Alltag: Vorschlag für die Waschmaschine (Leistungssensor nach Namen)
await unlock(pg, "admin", { cat: "daily" });
await pg.waitForTimeout(300);
t.check(await R(".catbox .drow"), "Gerätezeile fehlt");
t.check(await R(".catbox [data-kwp]") && await R(".catbox [data-wauto]"), "Felder kWp / Fenster-Automatik fehlen");
await t.shot(pg, "n1-admin-alltag.png");
await t.done();
