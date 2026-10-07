// F3: Kamera (Sichtkegel, Kamerafenster, Klingel), Medien und Saugroboter im Raumfenster, Kurzwahl 2.0
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("f3", "?media", { width: 1280, height: 800 });
const E = (fn, arg) => pg.evaluate(fn, arg);

// Sichtkegel der fest platzierten Kamera
const cones = await E(() => window.panel._scene.conesGroup?.children.filter((o) => o.isMesh && o.userData.cone).length ?? 0);
t.check(cones === 1, `Sichtkegel: ${cones}`);
// eigener Schalter „Kamera-Sicht“: Kegel weg, Kamera-Symbol bleibt
const coneVis = (layers) => E((l) => {
  const s = window.panel._scene;
  s.setLayers({ ...s.layers, ...l });
  return s.conesGroup.visible;
}, layers);
t.check((await coneVis({ cameras: false })) === false, "Kamera-Sicht aus blendet die Kegel nicht aus");
t.check((await coneVis({ cameras: true })) === true, "Kamera-Sicht an zeigt die Kegel nicht");
t.check((await coneVis({ devices: false })) === false, "Kegel ohne Geräte sichtbar");
await coneVis({ devices: true });

// Klingel: neuer Zeitstempel am event-Element öffnet die Klingel-Kamera
await E(() => {
  const h = window.hass;
  const states = { ...h.states, "event.klingel": { ...h.states["event.klingel"], state: new Date().toISOString() } };
  window.hass = { ...h, states };
  window.panel.hass = window.hass;
});
await pg.waitForTimeout(300);
const ring = await E(() => {
  const d = window.panel.shadowRoot.querySelector(".camdlg");
  return { ring: d?.classList.contains("ring"), src: d?.querySelector("img")?.getAttribute("src")?.slice(0, 18), head: d?.querySelector(".dialog-head span")?.textContent };
});
t.results.klingel = ring;
t.check(ring.ring && ring.src === "data:image/svg+xml" && /klingelt/.test(ring.head ?? ""), `Klingel: ${JSON.stringify(ring)}`);
await t.shot(pg, "klingel.png");
await pg.locator("haus3d-panel .camdlg .close").click();

// Tipp auf die Kamera öffnet das Kamerafenster (nicht „Weitere Infos“)
await E(() => window.panel._runAction("camera.haustuer"));
const cam = await E(() => !!window.panel.shadowRoot.querySelector(".camdlg:not(.ring)"));
t.check(cam, "Kamerafenster per Tipp");
await pg.locator("haus3d-panel .camdlg .close").click();

// Raumfenster Wohnzimmer: Medienplayer
const roomOf = (area) => E((area) => {
  const f = window.panel._building.floors.find((x) => x.rooms.some((r) => r.area_id === area));
  const r = f.rooms.find((x) => x.area_id === area);
  window.panel._selectRoom({ floorId: f.id, roomId: r.id });
  return r.id;
}, area);
await roomOf("wohnzimmer");
await pg.waitForTimeout(300);
const mp = await E(() => {
  const el = window.panel.shadowRoot.querySelector(".rp-media .mp");
  return el && { title: el.querySelector(".mt b").textContent, sub: el.querySelector(".mt span").textContent, play: el.querySelector('[data-k="play"] ha-icon').getAttribute("icon"), vol: el.querySelector('input[data-k="volume"]').value, power: el.querySelector('[data-k="power"]').hidden };
});
t.results.medien = mp;
t.check(mp?.title === "Testlied" && /Band/.test(mp.sub) && mp.play === "mdi:pause" && mp.vol === "30" && mp.power, `Medien: ${JSON.stringify(mp)}`);
await pg.locator('haus3d-panel .rp-media .mp [data-k="next"]').click();
await pg.locator('haus3d-panel .rp-media .mp input[data-k="volume"]').fill("60");
await pg.locator('haus3d-panel .rp-media .mp input[data-k="volume"]').dispatchEvent("change");
const mcalls = await E(() => window.calls.filter((c) => c.domain === "media_player").map((c) => `${c.service}${c.volume_level != null ? `:${c.volume_level}` : ""}`));
t.check(mcalls.includes("media_next_track") && mcalls.includes("volume_set:0.6"), `Medien-Tasten: ${JSON.stringify(mcalls)}`);
await t.shot(pg, "raum-medien.png");

// Raumfenster Flur: Saugroboter und Kamera-Vorschau
await roomOf("flur");
await pg.waitForTimeout(300);
const vac = await E(() => {
  const panels = [...window.panel.shadowRoot.querySelectorAll(".rp-media")];
  const el = panels.map((b) => b.querySelector(".vac")).find(Boolean);
  return el && { sub: el.querySelector(".mt span").textContent, start: !el.querySelector('[data-k="start"]').hidden, home: !el.querySelector('[data-k="home"]').hidden, cam: !!el.parentElement.querySelector(".camthumb img[src]") };
});
t.results.sauger = vac;
t.check(vac && /in der Station/.test(vac.sub) && /87 %/.test(vac.sub) && vac.start && !vac.home && vac.cam, `Saugroboter: ${JSON.stringify(vac)}`);
await pg.locator('haus3d-panel .rp-media .vac [data-k="start"]').click();
const vcalls = await E(() => window.calls.filter((c) => c.domain === "vacuum").map((c) => c.service));
t.check(vcalls.includes("start"), `Saugen: ${JSON.stringify(vcalls)}`);
await t.shot(pg, "raum-sauger.png");

// Kurzwahl 2.0: läuft-Ring, „läuft …“, Langdruck → Ablauf-Fenster („Ablauf ansehen“ im Bearbeiten-Modus)
await unlock(pg);
await pg.locator("haus3d-panel .wheel.left .fab").click();
await pg.waitForTimeout(300);
const bub = await E(() => {
  const b = window.panel.shadowRoot.querySelector('.wheel.left .bub[data-i="0"]');
  return { run: b.classList.contains("run"), sub: b.querySelector(".sub")?.textContent };
});
t.check(bub.run && bub.sub === "läuft …", `Kurzwahl läuft: ${JSON.stringify(bub)}`);
await t.shot(pg, "kurzwahl-laeuft.png");
const box = await pg.locator('haus3d-panel .wheel.left .bub[data-i="0"]').boundingBox();
await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await pg.mouse.down();
await pg.waitForTimeout(700);
await pg.mouse.up();
await pg.waitForTimeout(200);
const sheet = await E(() => {
  const d = window.panel.shadowRoot.querySelector(".routine");
  return d && { stat: d.querySelector(".rstat span").textContent, btns: [...d.querySelectorAll("[data-r]")].map((b) => b.dataset.r) };
});
t.results.ablauf = sheet;
t.check(sheet && /läuft gerade · zuletzt vor 10 min/.test(sheet.stat) && sheet.btns.includes("trace"), `Ablauf-Fenster: ${JSON.stringify(sheet)}`);
await t.shot(pg, "kurzwahl-ablauf.png");
await pg.locator('haus3d-panel .routine [data-r="trace"]').click();
const path = await E(() => location.pathname);
t.check(path === "/config/automation/trace/1700", `Ablauf ansehen: ${path}`);
await E(() => history.back());

// Editor: Blickrichtung der Kamera, Kegel im Plan
const ed = await t.page("f3-editor", "?media", { width: 1280, height: 800 });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
const edr = await ed.evaluate(() => {
  const e = window.panel._editor;
  e.sel = { kind: "device", id: "camera.haustuer" };
  e.render();
  e.renderProps();
  return { cone: !!e.svg.querySelector("[data-cone]"), field: e.props.querySelector('[data-num="rotation"]')?.value };
});
t.check(edr.cone && edr.field === "270", `Editor Kamera: ${JSON.stringify(edr)}`);
await t.done();
