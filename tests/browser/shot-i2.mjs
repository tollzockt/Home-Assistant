// I2/I3: erweiterter Möbelkatalog (IKEA, Gaming, Wallbox, Solar) im Editor und Gerätevorlagen in der
// Energie-Einrichtung (Entitäten der Integration vorschlagen)
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const ed = await t.page("i2", "", { width: 1280, height: 800 });
const E = (fn, arg) => ed.evaluate(fn, arg);
await E(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
await ed.waitForTimeout(3000); // Vorschaubilder
const cats = await E(() => [...window.panel._editor.props.querySelectorAll(".cat")].map((h) => h.textContent.trim()));
t.results.kategorien = cats;
for (const c of ["IKEA", "LED", "Gaming", "Wallbox & E-Auto", "Wechselrichter & Speicher", "Solar-Aufständerung"]) t.check(cats.some((x) => x.startsWith(c)), `Kategorie fehlt: ${c}`);
await ed.locator("haus3d-panel .ed-props .search").fill("kallax");
const hits = await ed.locator("haus3d-panel .ed-props .tile").count();
t.check(hits === 4, `Suche KALLAX: ${hits}`);
const plan = (x, z) => E(([x, z]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
const place = async (type, x, z, q) => {
  await ed.locator("haus3d-panel .ed-bar button[data-tool=furniture]").click();
  await ed.locator("haus3d-panel .ed-props .search").fill(q);
  await ed.locator(`haus3d-panel .ed-props .tile[data-furn=${type}]`).click();
  const [px, py] = await plan(x, z);
  await ed.mouse.click(px, py);
  await ed.waitForTimeout(150);
};
await place("ikea_kallax_2x4", 2, 2, "kallax");
await place("gaming_desk", 8.5, 2, "gaming");
await place("monitor_34", 8.5, 1.8, "monitor");
await place("wallbox_goe", 9.6, 0.4, "go-e");
const placed = await E(() => window.panel._editor.floor.furniture.slice(-4).map((m) => ({ type: m.type, w: m.w, h: m.h })));
t.results.platziert = placed;
t.check(placed.map((m) => m.type).join() === "ikea_kallax_2x4,gaming_desk,monitor_34,wallbox_goe" && placed[0].w === 0.77 && placed[0].h === 1.47, `Platziert: ${JSON.stringify(placed)}`);
await t.shot(ed, "i2-katalog.png");
await ed.locator('haus3d-panel .ed [data-act="save"]').click();
await ed.waitForTimeout(1500);
// 3D: Monitor steht auf Tischhöhe, Wallbox hängt an der Wand
const ys = await E(() => {
  const sc = window.panel._scene;
  const out = {};
  sc.root.traverse((o) => {
    const f = o.userData.furniture;
    if (!f || o.parent?.userData.furniture === f) return;
    const m = window.panel._building.floors.find((x) => x.id === "eg").furniture.find((x) => x.id === f);
    if (m && ["monitor_34", "wallbox_goe", "ikea_kallax_2x4"].includes(m.type)) out[m.type] = Math.round(o.position.y * 100) / 100;
  });
  return out;
});
t.results.hoehen = ys;
t.check(ys.monitor_34 === 0.75 && ys.wallbox_goe === 1 && ys.ikea_kallax_2x4 === 0, `Höhen: ${JSON.stringify(ys)}`);

// Energie: PV-Anlage mit Vorlage „Fronius“ → Entitäten der Integration
await E(() => {
  const h = window.panel._realHass;
  const add = (id, state, unit, platform) => {
    h.states[id] = { entity_id: id, state, attributes: { unit_of_measurement: unit, friendly_name: id } };
    h.entities[id] = { entity_id: id, platform };
  };
  add("sensor.wr_power_photovoltaics", "2800", "W", "fronius");
  add("sensor.wr_energy_day", "9.5", "kWh", "fronius");
});
await unlock(ed, "admin", { cat: "energy" });
await ed.waitForSelector("haus3d-panel .catbox [data-add=pv]");
await ed.locator('haus3d-panel .catbox [data-add="pv"]').click();
const n = await E(() => window.panel.shadowRoot.querySelectorAll(".catbox .src").length);
await ed.locator(`haus3d-panel .catbox .src[data-i="${n - 1}"] [data-tpl]`).selectOption("fronius");
await ed.waitForTimeout(200);
const card = await E((i) => {
  const el = window.panel.shadowRoot.querySelector(`.catbox .src[data-i="${i}"]`);
  return { power: el.querySelector('[data-sf="power"]').value, energy: el.querySelector('[data-sf="energy"]').value, name: el.querySelector(".sname").value, msg: el.querySelector(".tplmsg")?.textContent };
}, n - 1);
t.results.vorlage = card;
t.check(card.power === "sensor.wr_power_photovoltaics" && card.energy === "sensor.wr_energy_day" && card.name === "Fronius" && /2 passende/.test(card.msg ?? ""), `Vorlage: ${JSON.stringify(card)}`);
// eigener Speicher an der PV-Anlage
await E(() => {
  const h = window.panel._realHass;
  for (const [id, v, u] of [["sensor.wr_bat_soc", "64", "%"], ["sensor.wr_bat_power", "500", "W"]]) {
    h.states[id] = { entity_id: id, state: v, attributes: { unit_of_measurement: u, friendly_name: id } };
  }
});
const pvCard = (sel) => `haus3d-panel .catbox .src[data-i="${n - 1}"] ${sel}`;
await ed.locator(pvCard("[data-ownbat]")).check();
await ed.waitForTimeout(150);
for (const [f, v] of [["soc", "sensor.wr_bat_soc"], ["bat_power", "sensor.wr_bat_power"]]) {
  await ed.locator(pvCard(`[data-sf="${f}"]`)).fill(v);
  await ed.locator(pvCard(`[data-sf="${f}"]`)).dispatchEvent("change");
}
await ed.locator(pvCard('[data-sn="capacity"]')).fill("10");
await ed.locator(pvCard('[data-sn="capacity"]')).dispatchEvent("change");
const sumOwn = await E(() => window.panel.shadowRoot.querySelector(".catbox .en-sum").textContent.replace(/\s+/g, " "));
t.results.eigenerSpeicher = sumOwn;
t.check(/lädt/.test(sumOwn), `Summe mit eigenem Speicher: ${sumOwn}`);
await E((i) => window.panel.shadowRoot.querySelector(`.catbox .src[data-i="${i}"]`).scrollIntoView(), n - 1);
await t.shot(ed, "i3-vorlage.png");
await ed.locator("haus3d-panel .catbox .en-save").click();
await ed.waitForTimeout(500);
const saved = await E(() => window.panel._building.settings.energy.sources.at(-1));
t.check(saved.template === "fronius" && saved.power === "sensor.wr_power_photovoltaics" && saved.bat_power === "sensor.wr_bat_power" && saved.soc === "sensor.wr_bat_soc" && saved.capacity === 10, `gespeichert: ${JSON.stringify(saved)}`);
await t.done();
