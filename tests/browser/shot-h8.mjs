// H2–H4: Raum antippen = Kamera fährt hin (Raumfenster erst per Gedrückthalten), größere Trefferflächen,
// Heizkörper antippen = Thermostat-Fenster, Kamera im Editor am Griff drehen und neigen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("h8", "?climate");
const E = (fn, arg) => pg.evaluate(fn, arg);

// Bildschirmpunkt in der Küche, an dem kein Gerät liegt
const spot = async (floorId, roomId) => E(([floorId, roomId]) => {
  const p = window.panel;
  const sc = p._scene;
  const r = sc.renderer.domElement.getBoundingClientRect();
  for (let y = r.top + 60; y < r.bottom - 60; y += 12) {
    for (let x = r.left + 60; x < r.right - 300; x += 12) {
      const h = sc.pick(x, y);
      if (h && !h.entity_id && h.roomId === roomId && h.floorId === floorId) return [x, y];
    }
  }
  return null;
}, [floorId, roomId]);
const kueche = await E(() => {
  for (const f of window.panel._building.floors) for (const r of f.rooms) if (r.area_id === "kueche") return { floorId: f.id, roomId: r.id };
});
let at = await spot(kueche.floorId, kueche.roomId);
t.check(!!at, "kein freier Punkt in der Küche");
if (at) {
  await pg.mouse.click(...at);
  await pg.waitForTimeout(400);
  const tap = await E(() => ({ panels: (window.panel._panels ?? []).length, filter: window.panel._filter, toast: window.panel.shadowRoot.querySelector(".toast")?.textContent ?? "" }));
  t.results.tippen = tap;
  t.check(tap.panels === 0 && tap.filter === "eg" && /gedrückt halten/.test(tap.toast), `Tippen: ${JSON.stringify(tap)}`);
  await pg.waitForTimeout(1500); // Kamerafahrt
  await t.shot(pg, "h8-raum-tippen.png");
  at = await spot(kueche.floorId, kueche.roomId);
  await pg.mouse.move(...at);
  await pg.mouse.down();
  await pg.waitForTimeout(900);
  await pg.mouse.up();
  await pg.waitForTimeout(300);
  const lp = await E(() => (window.panel._panels ?? []).map((p) => p.roomId));
  t.results.halten = lp;
  t.check(lp.length === 1 && lp[0] === kueche.roomId, `Gedrückt halten: ${JSON.stringify(lp)}`);
  await E(() => window.panel._selectRoom(null));
}

// Trefferfläche: knapp neben dem Heizkörper im Bad trifft trotzdem
await E(() => window.panel._setFilter("eg"));
await pg.waitForTimeout(1500);
const near = await E(() => {
  const sc = window.panel._scene;
  let obj = null;
  sc.root.traverse((o) => {
    if (!obj && o.isMesh && o.userData.entity === "climate.bad") obj = o;
  });
  if (!obj) return { err: "kein Heizkörper-Mesh" };
  const THREE = obj.position.constructor;
  const v = new THREE();
  obj.getWorldPosition(v);
  const s = sc.project(v);
  if (!s) return { err: "nicht sichtbar" };
  const r = sc.renderer.domElement.getBoundingClientRect();
  const x = (s.x ?? s[0]) + r.left;
  const y = (s.y ?? s[1]) + r.top;
  // 22 px daneben (Richtung, in der kein anderes Gerät liegt)
  const tries = [[22, 0], [-22, 0], [0, 22], [0, -22]].map(([dx, dy]) => sc.pick(x + dx, y + dy)?.entity_id ?? null);
  return { tries };
});
t.results.treffer = near;
t.check(near.tries?.includes("climate.bad"), `Trefferfläche Heizkörper: ${JSON.stringify(near)}`);

// Heizkörper antippen: Thermostat-Fenster, + zweimal → ein gesammelter Aufruf
await E(() => window.panel._runAction("climate.bad", { source: "tap" }));
await pg.waitForTimeout(200);
const pop = await E(() => window.panel.shadowRoot.querySelector(".climpop")?.textContent.replace(/\s+/g, " "));
t.results.thermostat = pop;
t.check(/Heizung Bad/.test(pop ?? "") && /22 °C/.test(pop ?? "") && /21,2 °C/.test(pop ?? ""), `Thermostat-Fenster: ${pop}`);
await t.shot(pg, "h8-thermostat.png");
await pg.locator("haus3d-panel .climpop .plus").click();
await pg.locator("haus3d-panel .climpop .plus").click();
await pg.waitForTimeout(1000);
const set = await E(() => window.calls.filter((c) => c.domain === "climate").map((c) => `${c.service}:${c.temperature ?? c.hvac_mode}`));
t.results.setzen = set;
t.check(set.length === 1 && set[0] === "set_temperature:23", `Soll setzen: ${JSON.stringify(set)}`);
await E(() => window.panel._closePopup());

// Editor: Kamera am Griff drehen, Neigung ändert den Kegel
const ed = await t.page("h8-editor", "?media", { width: 1280, height: 800 });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.evaluate(() => {
  const e = window.panel._editor;
  e.sel = { kind: "device", id: "camera.haustuer" };
  e.render();
  e.renderProps();
});
const handle = await ed.locator('haus3d-panel [data-kind="camrot"]').boundingBox();
t.check(!!handle, "kein Dreh-Griff");
if (handle) {
  const cam = await ed.evaluate(() => {
    const e = window.panel._editor;
    const r = e.svg.getBoundingClientRect();
    return [r.left + e.tx + 6 * e.scale, r.top + e.tz + 9 * e.scale];
  });
  const hx = handle.x + handle.width / 2;
  const hy = handle.y + handle.height / 2;
  await ed.mouse.move(hx, hy);
  await ed.mouse.down();
  // Griff um 90° um die Kamera schwenken
  const rx = hx - cam[0];
  const ry = hy - cam[1];
  await ed.mouse.move(cam[0] - ry, cam[1] + rx, { steps: 6 });
  await ed.mouse.up();
  await ed.waitForTimeout(200);
  const rot = await ed.evaluate(() => window.panel._editor.floor.placements.find((p) => p.entity_id === "camera.haustuer").rotation);
  t.results.drehung = rot;
  const diff = (((rot - 270) % 360) + 360) % 360;
  t.check(Number.isInteger(rot) && (Math.abs(diff - 90) <= 3 || Math.abs(diff - 270) <= 3), `Drehen am Griff: ${rot}`);
  await t.shot(ed, "h8-kamera.png");
}
const cone = (sel) => ed.evaluate((s) => window.panel._editor.svg.querySelector(s)?.getAttribute("points") ?? window.panel._editor.svg.querySelector(s)?.getAttribute("d"), sel);
const before = await cone("[data-cone]");
await ed.locator('haus3d-panel .ed-props [data-num="tilt"]').fill("45");
await ed.locator('haus3d-panel .ed-props [data-num="tilt"]').dispatchEvent("change");
await ed.waitForTimeout(200);
const after = await cone("[data-cone]");
const tilt = await ed.evaluate(() => window.panel._editor.floor.placements.find((p) => p.entity_id === "camera.haustuer").tilt);
t.check(tilt === 45 && before && after && before !== after, `Neigung: ${JSON.stringify({ tilt, changed: before !== after })}`);
await t.done();
