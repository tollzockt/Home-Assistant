// F2: Bauplan-Foto (laden, Maßstab aus zwei Punkten), Fang-Hilfen (Fluchtlinie, Länge eintippen),
// Mehrfachauswahl (Rahmen, Kopieren/Einfügen, Duplizieren, Löschen) und Vorlagen
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const ed = await t.page("f2", "", { width: 1280, height: 800 });
await ed.evaluate(() => window.panel._openEditor());
await ed.waitForTimeout(500);
await ed.locator("haus3d-panel .floorsel").selectOption("eg");
await ed.waitForTimeout(300);
const toScreen = (x, z) => ed.evaluate(([x, z]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return [r.left + e.tx + x * e.scale, r.top + e.tz + z * e.scale];
}, [x, z]);
const click = async (x, z, opts) => {
  const [sx, sy] = await toScreen(x, z);
  await ed.mouse.click(sx, sy, opts);
  await ed.waitForTimeout(60);
};
const E = (fn, arg) => ed.evaluate(fn, arg);
// Planpunkt an relativer Stelle der sichtbaren Zeichenfläche
const at = (fx, fy) => E(([fx, fy]) => {
  const e = window.panel._editor;
  const r = e.svg.getBoundingClientRect();
  return e.toPlan(r.left + r.width * fx, r.top + r.height * fy).map((v) => Math.round(v * 20) / 20);
}, [fx, fy]);

// --- Länge eintippen: Wand 3,65 m nach rechts
await ed.locator("haus3d-panel .ed-bar button[data-tool=wall]").click();
const w0 = await at(0.6, 0.08);
await click(...w0);
await ed.locator("haus3d-panel .ed-draftbar [data-dlen]").fill("3,65");
await ed.locator("haus3d-panel .ed-draftbar [data-ddeg]").fill("0");
await ed.locator("haus3d-panel .ed-draftbar [data-dlen]").press("Enter");
const wall = await E(() => {
  const w = window.panel._editor.floor.walls.at(-1);
  return { len: Math.round(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * 1000) / 1000, dz: w.b[1] - w.a[1] };
});
t.results.laenge = wall;
t.check(wall.len === 3.65 && wall.dz === 0, `Länge eintippen: ${JSON.stringify(wall)}`);
await E(() => window.panel._editor._draftAction("cancel"));

// --- Fluchtlinie: Vieleck-Punkt knapp neben der x-Koordinate einer Raumecke rastet ein
const corner = await E(() => window.panel._editor.floor.rooms[0].points[1]);
await ed.locator("haus3d-panel .ed-bar button[data-tool=poly]").click();
await click(corner[0] + 3, corner[1] + 6);
const [hx, hy] = await toScreen(corner[0] + 0.04, corner[1] + 9);
await ed.mouse.move(hx, hy);
await ed.waitForTimeout(100);
const guide = await E(() => ({ n: window.panel._editor.svg.querySelectorAll("[data-guide]").length, hover: window.panel._editor.draft.hover }));
t.results.flucht = { corner, guide };
t.check(guide.n >= 1 && Math.abs(guide.hover[0] - corner[0]) < 1e-6, `Fluchtlinie: ${JSON.stringify({ corner, guide })}`);
await t.shot(ed, "fang-hilfe.png");
await ed.keyboard.press("Escape");

// --- Mehrfachauswahl per Rahmen (Schalter „Mehrfach“), Kopieren/Einfügen, Duplizieren, Löschen
await ed.locator("haus3d-panel .ed-bar button[data-tool=select]").click();
await ed.locator("haus3d-panel .ed-mods [data-mod=multi]").click();
const box = await E(() => {
  const f = window.panel._editor.floor;
  const pts = f.rooms.flatMap((r) => r.points);
  return [Math.min(...pts.map((p) => p[0])) - 0.5, Math.min(...pts.map((p) => p[1])) - 0.5, Math.max(...pts.map((p) => p[0])) + 0.5, Math.max(...pts.map((p) => p[1])) + 0.5];
});
// Rahmen auf freier Fläche oberhalb links beginnen
const [ax, ay] = await toScreen(box[0], box[1]);
const [bx, by] = await toScreen(box[2], box[3]);
await ed.mouse.move(ax, ay);
await ed.mouse.down();
await ed.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 });
await ed.mouse.move(bx, by, { steps: 4 });
await ed.mouse.up();
await ed.waitForTimeout(150);
const sel = await E(() => {
  const e = window.panel._editor;
  return { multi: e.multi.length, rooms: e.floor.rooms.length, head: e.props.querySelector("h3")?.textContent, marks: e.svg.querySelectorAll("[data-multi]").length };
});
t.results.rahmen = sel;
t.check(sel.multi >= sel.rooms && /Teile gewählt/.test(sel.head ?? "") && sel.marks === sel.multi, `Rahmen: ${JSON.stringify(sel)}`);
await t.shot(ed, "mehrfach.png");
// Tipp auf einen gewählten Raum nimmt ihn heraus, nochmal Tipp nimmt ihn wieder auf
const rc = await E(() => {
  // Punkt im Raum abseits von Namen, Möbeln und Symbolen: ein Stück von einer Ecke nach innen
  const e = window.panel._editor;
  const svg = e.svg.getBoundingClientRect();
  for (const r of e.floor.rooms) {
    const c = [r.points.reduce((t, q) => t + q[0], 0) / r.points.length, r.points.reduce((t, q) => t + q[1], 0) / r.points.length];
    for (const v of r.points) {
      const p = [v[0] + (c[0] - v[0]) * 0.15, v[1] + (c[1] - v[1]) * 0.15];
      const el = e.root.getRootNode().elementFromPoint(svg.left + e.tx + p[0] * e.scale, svg.top + e.tz + p[1] * e.scale);
      if (el?.dataset?.kind === "room") return p;
    }
  }
  return null;
});
await click(...rc);
const off = await E(() => window.panel._editor.multi.length);
await click(...rc);
const on = await E(() => window.panel._editor.multi.length);
t.check(off === sel.multi - 1 && on === sel.multi, `Mehrfach antippen: ${JSON.stringify({ was: sel.multi, off, on })}`);
// nur zwei Räume behalten (Umschalt-Klick nimmt einen weg)
await ed.locator("haus3d-panel .ed-mods [data-mod=multi]").click();
await E(() => {
  const e = window.panel._editor;
  e.multi = e.floor.rooms.slice(0, 2).map((r) => ({ kind: "room", id: r.id }));
  e.render();
  e.renderProps();
});
const before = await E(() => ({ rooms: window.panel._editor.floor.rooms.length, ops: window.panel._editor.floor.openings.length }));
await ed.keyboard.press("Control+c");
await click(...(await at(0.9, 0.9))); // Einfügepunkt (hebt die Auswahl auf)
await ed.keyboard.press("Control+v");
await ed.waitForTimeout(100);
const pasted = await E(() => {
  const e = window.panel._editor;
  const ids = [...e.floor.rooms, ...e.floor.openings].map((x) => x.id);
  return { rooms: e.floor.rooms.length, ops: e.floor.openings.length, multi: e.multi.length, unique: new Set(ids).size === ids.length };
});
t.results.einfuegen = { before, pasted };
t.check(pasted.rooms === before.rooms + 2 && pasted.ops > before.ops && pasted.multi === 2 && pasted.unique, `Einfügen: ${JSON.stringify({ before, pasted })}`);
// verschieben per Ziehen
const r0 = await E(() => {
  const e = window.panel._editor;
  const r = e.floor.rooms.find((x) => x.id === e.multi[0].id);
  return { id: r.id, p: r.points[0], c: [r.points.reduce((t, q) => t + q[0], 0) / r.points.length, r.points.reduce((t, q) => t + q[1], 0) / r.points.length] };
});
const [cx, cy] = await toScreen(...r0.c);
await ed.mouse.move(cx, cy);
await ed.mouse.down();
const [dx, dy] = await toScreen(r0.c[0] + 2, r0.c[1] + 1);
await ed.mouse.move(dx, dy, { steps: 5 });
await ed.mouse.up();
const moved = await E((id) => window.panel._editor.floor.rooms.find((x) => x.id === id).points[0], r0.id);
t.results.ziehen = { from: r0.p, to: moved };
t.check(Math.abs(moved[0] - r0.p[0] - 2) < 0.06 && Math.abs(moved[1] - r0.p[1] - 1) < 0.06, `Mehrfach ziehen: ${JSON.stringify({ from: r0.p, to: moved })}`);
// Vorlage speichern
await ed.locator("haus3d-panel .ed-props [data-tplname]").fill("Bad Standard");
await ed.locator('haus3d-panel .ed-props [data-m="tpl"]').click();
// Duplizieren, dann löschen
await ed.keyboard.press("Control+d");
const dup = await E(() => window.panel._editor.floor.rooms.length);
await ed.keyboard.press("Delete");
const del = await E(() => window.panel._editor.floor.rooms.length);
t.results.dupDel = { dup, del };
t.check(dup === before.rooms + 4 && del === before.rooms + 2, `Duplizieren/Löschen: ${JSON.stringify({ dup, del })}`);
// Vorlage im Etagen-Fenster einfügen
await ed.keyboard.press("Escape");
await ed.waitForTimeout(100);
const tpl = await E(() => {
  const e = window.panel._editor;
  return { list: e.b.settings.templates.map((x) => x.name), button: !!e.props.querySelector("[data-tpl]") };
});
await ed.locator("haus3d-panel .ed-props [data-tpl]").first().click();
const afterTpl = await E(() => window.panel._editor.floor.rooms.length);
t.results.vorlage = { tpl, afterTpl };
t.check(tpl.list[0] === "Bad Standard" && tpl.button && afterTpl === del + 2, `Vorlage: ${JSON.stringify({ tpl, afterTpl })}`);
await ed.keyboard.press("Escape");

// --- Bauplan-Foto laden (Bild aus Canvas), Maßstab aus zwei Punkten
const bg = await E(async () => {
  const e = window.panel._editor;
  e.sel = null;
  e.multi = [];
  const c = document.createElement("canvas");
  c.width = 2000;
  c.height = 1000;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 2000, 1000);
  g.strokeStyle = "#000";
  g.lineWidth = 12;
  g.strokeRect(200, 200, 1600, 600);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  await e._loadBackground(new File([blob], "plan.png", { type: "image/png" }));
  await new Promise((r) => setTimeout(r, 100));
  return { bg: e.floor.background, img: !!e.svg.querySelector("image[data-bg]"), stored: (window.bgImages?.eg ?? "").slice(0, 23), href: e.svg.querySelector("image[data-bg]")?.getAttribute("href")?.slice(0, 5) };
});
t.results.foto = bg;
t.check(bg.img && bg.bg?.aspect === 0.5 && bg.stored === "data:image/jpeg;base64," && bg.href === "blob:", `Foto laden: ${JSON.stringify(bg)}`);
await ed.locator('haus3d-panel .ed-props [data-bg="scale"]').click();
await click(bg.bg.x + 1, bg.bg.z + 1);
await click(bg.bg.x + 3, bg.bg.z + 1);
await ed.locator("haus3d-panel .ed-props [data-bgreal]").fill("6");
await ed.locator('haus3d-panel .ed-props [data-bg="apply"]').click();
const scaled = await E(() => ({ bg: window.panel._editor.floor.background, tool: window.panel._editor.tool }));
t.results.massstab = scaled;
// zwei Punkte im Abstand ~2 m sollen 6 m sein → Breite ×3 (Klick rastet nicht ein)
const k = scaled.bg.width / bg.bg.width;
t.check(Math.abs(k - 3) < 0.1 && scaled.tool === "select", `Maßstab: ${JSON.stringify({ k, scaled })}`);
await E(() => window.panel._editor.fit());
await E(() => window.panel._editor.render());
await t.shot(ed, "bauplan-foto.png");
// gespeicherter Grundriss behält background (nur Lage, nicht das Bild)
const saved = await E(() => JSON.stringify(window.panel._editor.b).length < 200000 && !!window.panel._editor.floor.background && !JSON.stringify(window.panel._editor.b).includes("base64"));
t.check(saved, "Grundriss bleibt klein (Bild separat gespeichert)");

// --- Tablet: Längenfeld in der Zeichen-Leiste
const tab = await t.page("f2-tablet", "", { width: 1024, height: 768, touch: true });
await tab.evaluate(() => window.panel._openEditor());
await tab.waitForTimeout(500);
await tab.evaluate(() => {
  const e = window.panel._editor;
  e.tool = "poly";
  e.draft = { points: [[1, 1]], kind: "poly", hover: [4, 1] };
  e.render();
});
const lenBar = await tab.evaluate(() => {
  const bar = window.panel._editor._touchEl.querySelector(".ed-draftbar");
  const inp = bar.querySelector("[data-dlen]");
  return { hidden: bar.hidden, ph: inp.placeholder, h: inp.getBoundingClientRect().height };
});
t.results.tablet = lenBar;
t.check(!lenBar.hidden && /3,00 m/.test(lenBar.ph) && lenBar.h >= 40, `Längenfeld am Tablet: ${JSON.stringify(lenBar)}`);
await t.shot(tab, "laenge-tablet.png");
await t.done();
