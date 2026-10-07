// N2: Begehen am Tablet – links Joystick gehen, rechts Joystick umsehen (beide gleichzeitig mit zwei Fingern),
// beleuchtete Räume halten nicht mehr auf (nur Wände)
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("n2", "", { width: 1024, height: 768, touch: true });
const E = (fn, arg) => pg.evaluate(fn, arg);

await E(() => {
  const p = window.panel;
  p._setFilter("eg");
  p._selectRoom({ floorId: "eg", roomId: "wohnzimmer" }); // Wohnzimmer: Licht an (Lichtschein sichtbar)
});
await pg.waitForTimeout(600);
await E(() => window.panel._startWalk());
await pg.waitForTimeout(500);
const ui = await E(() => ({ move: !!window.panel.shadowRoot.querySelector(".walkui .joy.move"), look: !!window.panel.shadowRoot.querySelector(".walkui .joy.look") }));
t.check(ui.move && ui.look, `Joysticks: ${JSON.stringify(ui)}`);
await t.shot(pg, "n2-begehen-joysticks.png");

// im beleuchteten Raum frei gehen: kurze Schritte in alle Richtungen bewegen sich
const free = await E(() => {
  const sc = window.panel._scene;
  const res = [];
  for (const [f, s] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) res.push(sc.walkStep(f, s));
  return res;
});
t.results.frei = free;
t.check(free.filter(Boolean).length >= 3, `im Raum blockiert: ${free}`);
// Wand hält weiterhin auf
const wall = await E(() => {
  const sc = window.panel._scene;
  let moved = 0;
  for (let i = 0; i < 300; i++) if (sc.walkStep(0.1, 0)) moved++;
  return moved;
});
t.check(wall < 300, `Wand hält nicht auf: ${wall}`);

// zwei Finger: links nach oben (vor), rechts nach rechts (drehen)
const box = (sel) => pg.locator(`haus3d-panel ${sel}`).boundingBox();
const bm = await box(".walkui .joy.move");
const bl = await box(".walkui .joy.look");
const c = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const before = await E(() => {
  const sc = window.panel._scene;
  sc.camera.position.set(sc.camera.position.x, sc.camera.position.y, sc.camera.position.z);
  return { pos: sc.camera.position.toArray(), yaw: sc._walk.yaw };
});
// erst zurück in die Raummitte, damit vorn Platz ist
await E(() => {
  const sc = window.panel._scene;
  sc._walk.yaw += Math.PI; // umdrehen (weg von der Wand)
  sc._walkLook();
});
const start0 = await E(() => ({ pos: window.panel._scene.camera.position.toArray(), yaw: window.panel._scene._walk.yaw }));
const cdp = await pg.context().newCDPSession(pg);
const m = c(bm);
const l = c(bl);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: m.x, y: m.y, id: 1 }, { x: l.x, y: l.y, id: 2 }] });
for (let i = 1; i <= 6; i++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: m.x, y: m.y - i * 10, id: 1 }, { x: l.x + i * 6, y: l.y, id: 2 }] });
  await pg.waitForTimeout(30);
}
await pg.waitForTimeout(900);
const mid = await E(() => ({ pos: window.panel._scene.camera.position.toArray(), yaw: window.panel._scene._walk.yaw, held: [...window.panel.shadowRoot.querySelectorAll(".walkui .joy.held")].length }));
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await pg.waitForTimeout(100);
const released = await E(() => window.panel._scene._walk.yaw);
await pg.waitForTimeout(400);
const after = await E(() => ({ pos: window.panel._scene.camera.position.toArray(), yaw: window.panel._scene._walk.yaw, timer: !!window.panel._scene._walkTimer }));
const dist = Math.hypot(mid.pos[0] - start0.pos[0], mid.pos[2] - start0.pos[2]);
t.results.joystick = { before, start0, mid, after, dist };
t.check(mid.held === 2, `nicht beide Joysticks gehalten: ${mid.held}`);
t.check(dist > 0.3, `Gehen per Joystick: ${dist.toFixed(2)} m`);
t.check(mid.yaw < start0.yaw - 0.1, `Umsehen nach rechts: ${start0.yaw} → ${mid.yaw}`);
t.check(!after.timer && Math.abs(after.yaw - released) < 1e-6, `nach dem Loslassen läuft es weiter: ${released} → ${after.yaw}`);
await t.shot(pg, "n2-begehen-nach.png");
await pg.locator("haus3d-panel .walkui .exit").tap();
await pg.waitForTimeout(500);
t.check(!(await E(() => window.panel._scene.isWalking())), "Begehen nicht verlassen");
await t.done();
