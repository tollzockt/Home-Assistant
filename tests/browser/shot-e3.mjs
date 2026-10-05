// E3: gedrosselter Hintergrund-Takt, Fluss-Ebene aus = Ruhe, verborgen = Ruhe, Qualitätsstufen, Schnee auf Texturen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const renders = (pg, ms) =>
  pg.evaluate(async (ms) => {
    const sc = window.panel._scene;
    sc.controls.update(); // Dämpfung auslaufen lassen
    await new Promise((r) => setTimeout(r, 600));
    // SwiftShader stockt nach dem Laden teils Sekunden: erst messen, wenn wieder Bilder kommen
    await new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (++n >= 3 || performance.now() - t0 > 8000 ? res() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    });
    const a = sc.stats.renders;
    await new Promise((r) => setTimeout(r, ms));
    return sc.stats.renders - a;
  }, ms);

// Einspeisung > 0 (Energiefluss läuft), Kamera ruht: höchstens 24 Bilder/s bei „ausgewogen“
const pg = await t.page("e3", "?quality=ausgewogen", { width: 1024, height: 700 });
const flowing = await pg.evaluate(() => !!window.panel._scene.flow && window.panel._scene.flow.speed > 0);
t.check(flowing, "Energiefluss läuft im Test nicht (Einspeisung fehlt?)");
const n1 = await renders(pg, 2000);
t.results.flussRenders2s = n1;
t.check(n1 <= 2 * 24 + 5 && n1 > 5, `Energiefluss: ${n1} Bilder in 2 s (erwartet ≤ 53, > 5)`);
// Fluss-Ebene aus: nichts mehr zeichnen
await pg.evaluate(() => {
  const p = window.panel;
  p._settings.layers.flow = false;
  p._scene.setLayers(p._settings.layers);
});
const n2 = await renders(pg, 2000);
t.results.flussAusRenders2s = n2;
t.check(n2 <= 2, `Fluss-Ebene aus, trotzdem ${n2} Bilder`);
await pg.evaluate(() => {
  const p = window.panel;
  p._settings.layers.flow = true;
  p._scene.setLayers(p._settings.layers);
});
// verborgen: Szene steht
await pg.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const n3 = await renders(pg, 1500);
t.results.verborgenRenders = n3;
t.check(n3 === 0, `verborgen trotzdem ${n3} Bilder`);
await pg.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new Event("visibilitychange"));
});
t.check(await pg.evaluate(() => window.panel._scene._running), "nach Rückkehr läuft die Szene nicht");

// Akku: Auflösung 1, kein Glühen; Schön: mehr Bilder als Akku
const akku = await t.page("e3-akku", "?quality=akku", { width: 1024, height: 700, scale: 2 });
const a = await akku.evaluate(() => {
  const sc = window.panel._scene;
  let glow = 0;
  for (const e of sc.floors.values()) for (const r of e.rooms.values()) if (r.glow.visible) glow++;
  return { dpr: sc.renderer.getPixelRatio(), glow, perf: !!window.panel._quality };
});
t.results.akku = a;
t.check(a.dpr === 1 && a.glow === 0, `Akku: ${JSON.stringify(a)}`);
const na = await renders(akku, 2000);
t.results.akkuBilder2s = na;
t.check(na <= 2 * 12 + 3, `Akku: ${na} Bilder in 2 s (erwartet ≤ 27)`);
// Draufsicht mit Dach: Akku blendet Möbel innen aus → deutlich weniger Zeichenaufrufe als „Schön“
const calls = async (q) => {
  const pg2 = await t.page(`e3-${q}`, `?quality=${q}&roof=gable`, { width: 1024, height: 700 });
  return pg2.evaluate(async () => {
    const sc = window.panel._scene;
    sc.camera.position.set(sc.controls.target.x, sc.controls.target.y + 30, sc.controls.target.z + 3);
    sc.controls.update();
    sc._lodCheck(true);
    sc.invalidate();
    await new Promise((r) => setTimeout(r, 400));
    sc.renderer.info.autoReset = true;
    sc.renderer.render(sc.scene, sc.camera);
    const hidden = [...sc.floors.values()].every((e) => !e.furn || e.furn.visible === false);
    return { calls: sc.renderer.info.render.calls, hidden };
  });
};
const ca = await calls("akku");
const cs = await calls("schoen");
t.results.zeichenaufrufe = { akku: ca, schoen: cs };
t.check(ca.hidden && !cs.hidden && ca.calls < 0.7 * cs.calls, `Zeichenaufrufe: ${JSON.stringify(t.results.zeichenaufrufe)}`);

// Schnee: texturierter Rasen wird heller
const snow = async (w) => {
  const pg2 = await t.page(`e3-${w}`, `?garden&weather=${w}`, { width: 900, height: 600, wait: 3500 });
  return pg2.evaluate(() => {
    const sc = window.panel._scene;
    const m = [...sc.texMats.entries()].find(([k]) => k.startsWith("ground:lawn"))?.[1];
    return m ? m.color.r + m.color.g + m.color.b : null;
  });
};
const sunny = await snow("sunny");
const snowy = await snow("snowy");
t.results.rasenHelligkeit = { sunny, snowy };
t.check(sunny != null && snowy > sunny + 0.3, `Schnee erreicht den texturierten Rasen nicht: ${sunny} → ${snowy}`);
await t.done();
