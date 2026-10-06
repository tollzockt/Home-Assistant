// E9: Sonnenstand und echtes Licht – Licht aus Osten am Morgen, blaue Lampe färbt das Glühen, Fenster leuchten nachts
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const sunInfo = (pg) =>
  pg.evaluate(() => {
    const s = window.panel._scene;
    return { x: s.sun.position.x - s.sun.target.position.x, y: s.sun.position.y - s.sun.target.position.y, z: s.sun.position.z - s.sun.target.position.z, color: s.sun.color.getHexString(), intensity: s.sun.intensity };
  });
// Morgens (Osten, 20° hoch) bei Norden oben: Licht kommt von +x
const am = await t.page("e9-morgen", "?sun=90,20", { width: 1280, height: 800 });
const s1 = await sunInfo(am);
t.results.morgen = s1;
t.check(s1.x > 0 && Math.abs(s1.z) < s1.x * 0.2 && s1.y > 0, `Morgensonne: ${JSON.stringify(s1)}`);
await t.shot(am, "sonne-morgen.png");
// Sonnenwechsel baut nichts neu
const rebuilt = await am.evaluate(() => {
  const p = window.panel;
  let n = 0;
  const orig = p._scene.setBuilding.bind(p._scene);
  p._scene.setBuilding = (...a) => {
    n++;
    return orig(...a);
  };
  const st = { ...p._realHass.states, "sun.sun": { entity_id: "sun.sun", state: "above_horizon", attributes: { azimuth: 180, elevation: 55 } } };
  p.hass = { ...p._realHass, states: st };
  return n;
});
await am.waitForTimeout(300);
const s2 = await sunInfo(am);
t.results.mittag = s2;
t.check(rebuilt === 0 && s2.z > 0 && s2.y > Math.abs(s2.z) && s2.intensity > s1.intensity, `Mittag: ${JSON.stringify(s2)} (neu gebaut ${rebuilt}×)`);
await t.shot(am, "sonne-mittag.png");
// Nordrichtung gedreht (90° = Norden rechts im Plan): Mittagssonne aus -x
await am.evaluate(() => {
  window.panel._building.settings.north = 90;
  window.panel._applySun();
});
const s3 = await sunInfo(am);
t.check(s3.x < 0 && Math.abs(s3.z) < Math.abs(s3.x) * 0.2, `Norden 90°: ${JSON.stringify(s3)}`);
// Blaue Lampe im Wohnzimmer, Nacht: Glühen blau, geschlossene Fenster leuchten, offene bleiben rot
const nt = await t.page("e9-nacht", "?light=rgb&sun=0,-20", { width: 1280, height: 800 });
await nt.evaluate(() => {
  window.panel._settings.style = "night";
  window.panel._applyStyle();
  window.panel._updateStates();
});
await nt.waitForTimeout(400);
const night = await nt.evaluate(() => {
  const p = window.panel;
  const s = p._scene;
  const r = s.floors.get("eg").rooms.get("wohnzimmer");
  const pane = (f, id) => s.floors.get(f).openings.get(id)?.panes[0]?.material;
  const glassLit = [...s._lightCache.entries()].filter(([k]) => k.startsWith("glass:")).map(([, m]) => m);
  return {
    glow: { r: r.glow.material.color.r, b: r.glow.material.color.b, visible: r.glow.visible },
    hobby: glassLit.includes(pane("kg", "hobby_fenster")),
    offen: pane("eg", "wz_fenster_alt") === s.mats.glassAlert,
    dunkel: pane("eg", "ku_fenster_nord") === s.mats.glass,
    style: s.style,
  };
});
t.results.nacht = night;
t.check(night.style === "night" && night.glow.visible && night.glow.b > night.glow.r, `Glühen: ${JSON.stringify(night)}`);
t.check(night.hobby && night.offen && night.dunkel, `Fenster: ${JSON.stringify(night)}`);
await t.shot(nt, "nacht-licht.png");
// Simulation: Uhrzeit-Regler setzt sun.sun
await nt.evaluate(() => (window.panel._adminMode = true, window.panel._setSim(true)));
await nt.waitForTimeout(300);
await nt.locator("haus3d-panel .simbar [data-sim=time]").fill("720");
await nt.waitForTimeout(300);
const simSun = await nt.evaluate(() => ({ label: window.panel.shadowRoot.querySelector(".simbar .tv").textContent, el: window.panel._hass.states["sun.sun"].attributes.elevation }));
t.check(simSun.label === "12:00" && simSun.el > 0, `Uhrzeit: ${JSON.stringify(simSun)}`);
await t.done();
