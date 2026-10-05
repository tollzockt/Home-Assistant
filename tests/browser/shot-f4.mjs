// F4: echte Schatten, Kontaktschatten, Jahreszeit, Energiefluss im Haus, PV-Verschattung und Zeitraffer
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("f4", "?roof=gable&lhaus&power&netz=600&sun=200,25&schatten=an", { width: 1280, height: 800 });
const E = (fn, arg) => pg.evaluate(fn, arg);

const sh = await E(() => {
  const sc = window.panel._scene;
  let cast = 0;
  let blobs = 0;
  sc.root.traverse((o) => {
    if (o.castShadow) cast++;
    if (o.userData.blob) blobs++;
  });
  return { map: sc.renderer.shadowMap.enabled, sun: sc.sun.castShadow, cast, blobs };
});
t.results.schatten = sh;
t.check(sh.map && sh.sun && sh.cast > 20 && sh.blobs > 5, `Schatten: ${JSON.stringify(sh)}`);
await t.shot(pg, "schatten.png");

// Ebene „Schatten“ aus
const off = await E(() => {
  const p = window.panel;
  p._settings.layers.shadows = false;
  p._scene.setLayers(p._settings.layers);
  const r = p._scene.renderer.shadowMap.enabled;
  p._settings.layers.shadows = true;
  p._scene.setLayers(p._settings.layers);
  return r;
});
t.check(off === false, "Ebene Schatten aus");

// Energiefluss im Haus: keine Luftlinien mehr (läuft in den Leitungen, siehe shot-h6)
const hf = await E(() => window.panel._scene._houseFlow?.list.length ?? 0);
t.results.hausfluss = hf;
t.check(hf === 0, `Luftlinien im Haus: ${hf}`);

// Jahreszeit: Winter macht den Rasen blasser, Herbst das Laub orange
const season = await E(async () => {
  const p = window.panel;
  const sc = p._scene;
  const hex = () => ({ lawn: sc.outdoorMats.lawn.color.getHexString(), leaf: sc.furnMats.leaf.color.getHexString() });
  await p._saveBuildingSettings({ season: "summer" }, "ok");
  const summer = hex();
  await p._saveBuildingSettings({ season: "autumn" }, "ok");
  const autumn = hex();
  await p._saveBuildingSettings({ season: "winter" }, "ok");
  const winter = hex();
  return { summer, autumn, winter, now: sc._season };
});
t.results.jahreszeit = season;
t.check(season.now === "winter" && season.summer.lawn !== season.winter.lawn && season.summer.leaf !== season.autumn.leaf, `Jahreszeit: ${JSON.stringify(season)}`);
await t.shot(pg, "winter.png");
await E(() => window.panel._saveBuildingSettings({ season: "autumn" }, "ok"));
await t.shot(pg, "herbst.png");

// PV-Feld nach Süden, hoher Baum davor: Verschattung im Winter
const pv = await E(async () => {
  const p = window.panel;
  const m = p._scene.roofModel;
  const { pvLayout, roofSurfaceAt } = await import("/custom_components/haus3d/frontend/exterior.js");
  let at = null;
  for (const part of m.parts) {
    for (const sv of [0.3, -0.3, 0.25, -0.25, 0.2, -0.2, 0.15, -0.15]) {
      for (const su of [0, 0.15, -0.15, 0.3, -0.3]) {
        const q = { x: part.center[0] + part.v[0] * part.width * sv + part.u[0] * part.length * su, z: part.center[1] + part.v[1] * part.width * sv + part.u[1] * part.length * su };
        const hit = roofSurfaceAt(m, [q.x, q.z]);
        if (!at && hit?.out?.[1] > 0.5 && pvLayout(m, { type: "pv", ...q, cols: 2, rows: 2 }).count === 4) at = q;
      }
    }
  }
  if (!at) return { at };
  await p._saveBuildingSettings({ roof: { ...p._building.settings.roof, items: [{ id: "pv_sued", type: "pv", ...at, cols: 2, rows: 2, name: "Süd" }] } }, "ok");
  const { daySamples } = await import("/custom_components/haus3d/frontend/fx.js");
  const samples = daySamples(new Date(2026, 11, 21, 12), 51, 10);
  const free = p._scene.pvShadingRows(samples, 0).get("pv_sued");
  // Baum 7 m südlich, 14 m hoch
  const b = structuredClone(p._building);
  const eg = b.floors.find((f) => f.id === "eg");
  eg.furniture = [...(eg.furniture ?? []), { id: "baum_test", type: "tree", x: at.x, z: at.z + 7, rotation: 0, w: 5, d: 5, h: 14 }];
  p._setBuilding(b, p._revision, { keepCamera: true });
  const shaded = p._scene.pvShadingRows(samples, 0).get("pv_sued");
  const sum = (rows) => rows.reduce((s, r) => s + r.shaded, 0);
  return { at, samples: samples.length, free: sum(free), shaded: sum(shaded), total: shaded.reduce((s, r) => s + r.total, 0) };
});
t.results.verschattung = pv;
t.check(pv.at && pv.total > 0 && pv.shaded > pv.free, `PV-Verschattung: ${JSON.stringify(pv)}`);

// Dialog über die PV-Karte
const pvKeys = await E(() => {
  window.panel._pvInfo = window.panel._pvFieldInfo();
  window.panel._pvCard("pv_sued");
  return [...window.panel._pvInfo.keys()];
});
t.results.pvKeys = pvKeys;
if (!pvKeys.includes("pv_sued")) {
  t.check(false, `PV-Feld fehlt: ${JSON.stringify(pvKeys)}`);
  await t.done();
}
await pg.locator("haus3d-panel .pvpop .shade").click();
await pg.waitForSelector("haus3d-panel .pvshade .shrow", { timeout: 20000 });
await pg.locator("haus3d-panel .pvshade [data-day]").fill("2026-12-21");
await pg.locator("haus3d-panel .pvshade [data-day]").dispatchEvent("change");
await pg.waitForTimeout(1500);
const dlg = await E(() => {
  const d = window.panel.shadowRoot.querySelector(".pvshade");
  return { rows: d.querySelectorAll(".shrow").length, head: d.querySelector(".shhead span")?.textContent, bars: d.querySelectorAll(".shchart rect").length };
});
t.results.dialog = dlg;
t.check(dlg.rows === 1 && /Verlust/.test(dlg.head ?? "") && dlg.bars > 5, `Verschattungs-Dialog: ${JSON.stringify(dlg)}`);
await t.shot(pg, "pv-verschattung.png");

// Zeitraffer: Sonne läuft, danach zurück
await pg.locator('haus3d-panel .pvshade [data-act="play"]').click();
await pg.waitForTimeout(1500);
const lapse = await E(() => ({ chip: window.panel.shadowRoot.querySelector(".lapsechip span")?.textContent, sun: window.panel._scene._sunPos }));
await t.shot(pg, "zeitraffer.png");
await pg.locator("haus3d-panel .lapsechip button").click();
const after = await E(() => ({ chip: !!window.panel.shadowRoot.querySelector(".lapsechip"), sun: window.panel._scene._sunPos }));
t.results.zeitraffer = { lapse, after };
t.check(/\d\d:\d\d/.test(lapse.chip ?? "") && !after.chip && Math.round(after.sun?.azimuth) === 200, `Zeitraffer: ${JSON.stringify({ lapse, after })}`);
await t.done();
