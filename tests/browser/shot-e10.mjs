// E10: PV je Dachfeld – Module als InstancedMesh (weniger Zeichenaufrufe), Schild mit Leistung, Infokarte
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("e10", "?roof=gable&lhaus&pvfield", { width: 1280, height: 800 });
// Zwei Felder auf die beiden Hauptflächen: eines mit eigenem Sensor, eines geschätzt
const setup = await pg.evaluate(async () => {
  const p = window.panel;
  const m = p._scene.roofModel;
  const fr = m.parts[0];
  const at = (sg) => ({ x: fr.center[0] + sg * fr.v[0] * fr.width * 0.25, z: fr.center[1] + sg * fr.v[1] * fr.width * 0.25 });
  const items = [
    { id: "pv_a", type: "pv", ...at(1), cols: 4, rows: 2, entity: "sensor.pv_feld_test", wp: 420 },
    { id: "pv_b", type: "pv", ...at(-1), cols: 3, rows: 2 },
  ];
  const calls0 = p._scene.renderer.info.render.calls;
  await p._saveBuildingSettings({ roof: { ...p._building.settings.roof, items } }, "ok");
  return { calls0 };
});
await pg.waitForTimeout(1200);
const res = await pg.evaluate(() => {
  const p = window.panel;
  const sc = p._scene;
  let inst = 0;
  let instCount = 0;
  let meshes = 0;
  sc.roofHolder?.traverse((o) => {
    if (o.isInstancedMesh) {
      inst++;
      instCount += o.count;
    } else if (o.isMesh && o.geometry?.parameters?.height === 0.04) meshes++;
  });
  const badge = (id) => p._overlays.get(`pv:${id}`)?.el;
  const b = (id) => ({ text: badge(id)?.innerText.replace(/\s+/g, " ") ?? null, shown: badge(id)?.style.display !== "none" });
  const info = [...p._pvInfo.values()].map((f) => [f.id, f.count]);
  return { inst, instCount, meshes, a: b("pv_a"), b: b("pv_b"), info, glow: sc.pvFields.get("pv_a")?.solar.emissiveIntensity };
});
t.results.pv = res;
const expected = res.info.reduce((s, [, n]) => s + n, 0);
t.check(res.inst >= 2 && res.instCount === expected && res.meshes === 0, `Instanzen: ${JSON.stringify(res)}`);
t.check(/4,2 kW/.test(res.a.text ?? "") && !/ca\./.test(res.a.text) && res.a.shown, `Schild eigenes Feld: ${JSON.stringify(res.a)}`);
t.check(/ca\. 1,8 kW/.test(res.b.text ?? ""), `Schild geschätzt (6000 − 4200 W): ${JSON.stringify(res.b)}`);
t.check(res.glow > 0.1, `Module glänzen nicht: ${res.glow}`);
await t.shot(pg, "pv-felder.png");
// Schild antippen → Infokarte
await pg.evaluate(() => window.panel._overlays.get("pv:pv_a").el.click());
await pg.waitForTimeout(300);
const card = await pg.evaluate(() => window.panel.shadowRoot.querySelector(".pvpop")?.innerText.replace(/\s+/g, " ") ?? null);
t.results.karte = card;
t.check(/PV-Feld/.test(card ?? "") && /kWp/.test(card) && /Ausrichtung/.test(card) && /4,2 kW/.test(card), `Infokarte: ${card}`);
await t.shot(pg, "pv-infokarte.png");
// Etage gewählt: Dach weg, Schilder weg
await pg.evaluate(() => window.panel._closePopup());
await pg.locator("haus3d-panel .floorbar button[data-floor='eg']").click();
await pg.waitForTimeout(400);
const hidden = await pg.evaluate(() => window.panel._overlays.get("pv:pv_a").el.style.display);
t.check(hidden === "none", `Schild bei Etagenwahl sichtbar: ${hidden}`);
// Zeichenaufrufe: Vergleich alte Bauweise (ein Mesh je Modul ~ 6 Aufrufe) mit Instanzen
await pg.locator("haus3d-panel .floorbar button[data-floor='all']").click();
await pg.waitForTimeout(400);
const calls = await pg.evaluate(() => {
  const p = window.panel;
  const sc = p._scene;
  const count = (solar) => {
    sc.setLayers({ ...p._settings.layers, solar });
    sc.renderer.render(sc.scene, sc.camera);
    return sc.renderer.info.render.calls;
  };
  const off = count(false);
  const on = count(true);
  let fields = 0;
  let modules = 0;
  sc.scene.traverse((o) => {
    if (o.isInstancedMesh && Array.isArray(o.material)) {
      fields++;
      modules += o.count;
    }
  });
  return { on, off, pv: on - off, fields, modules };
});
t.results.zeichenaufrufe = calls;
// je Feld ein InstancedMesh (6 Flächen-Gruppen) statt 6 Aufrufe je Modul
t.check(calls.pv <= 6 * calls.fields + 2 && calls.pv < 6 * calls.modules, `PV-Zeichenaufrufe: ${JSON.stringify(calls)}`);
await t.done();
