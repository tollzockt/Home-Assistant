// I3: Spenden im Zahnrad (Links in neuem Tab), einmaliger Hinweis nach 14 Tagen, Entwickler-Instanz über
// das Haus-Symbol in den Admin-Einstellungen (blendet Spenden aus, Kategorie „Entwickler“)
import { start, unlock } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("i3", "");
const E = (fn, arg) => pg.evaluate(fn, arg);
const R = (sel) => E((s) => !!window.panel.shadowRoot.querySelector(s), sel);

// Zahnrad: Spendenzeile → Fenster mit Links (neuer Tab)
await E(() => window.panel._openSettings());
await pg.waitForTimeout(400);
t.check(await R(".basics .supportrow"), "Spendenzeile fehlt");
await pg.locator("haus3d-panel .supportrow").click();
const links = await E(() => [...window.panel.shadowRoot.querySelectorAll(".supportdlg .slink")].map((a) => ({ k: a.dataset.k, target: a.target, rel: a.rel, href: a.href })));
t.results.links = links;
t.check(links.length >= 1 && links.every((l) => l.target === "_blank" && /noopener/.test(l.rel) && l.href.startsWith("https://")), `Links: ${JSON.stringify(links)}`);
await t.shot(pg, "i3-spenden.png");
await E(() => window.panel._closeDialog());

// Hinweis: erst nach 14 Tagen, genau einmal
const hint = async (daysAgo) => {
  await E((d) => {
    localStorage.setItem("haus3d.firstSeen", String(Date.now() - d * 86400000));
    localStorage.removeItem("haus3d.supportHinted");
    window.panel.shadowRoot.querySelectorAll(".toast").forEach((x) => x.remove());
    return window.panel._supportHintCheck();
  }, daysAgo);
  await pg.waitForTimeout(200);
  return E(() => [...window.panel.shadowRoot.querySelectorAll(".toast")].map((x) => x.textContent).join(" "));
};
t.check(!/Spende/.test(await hint(3)), "Hinweis zu früh");
const h15 = await hint(15);
t.check(/Spende/.test(h15), `Hinweis nach 15 Tagen fehlt: ${h15}`);
const again = await E(async () => {
  window.panel.shadowRoot.querySelectorAll(".toast").forEach((x) => x.remove());
  await window.panel._supportHintCheck();
  return [...window.panel.shadowRoot.querySelectorAll(".toast")].map((x) => x.textContent).join(" ");
});
t.check(!/Spende/.test(again), "Hinweis kam zweimal");

// Entwickler-Instanz: Admin → Haus-Symbol → Code
await unlock(pg, "admin");
await pg.waitForSelector("haus3d-panel .admin .devbtn");
await t.shot(pg, "i3-admin-haus.png");
await pg.locator("haus3d-panel .admin .devbtn").click();
await pg.waitForSelector("haus3d-panel .pinpad");
const title = await E(() => window.panel.shadowRoot.querySelector(".pinpad .ptitle").textContent);
t.check(/Entwickler-Instanz/.test(title), `Titel: ${title}`);
await pg.keyboard.type("1111", { delay: 60 });
await pg.waitForTimeout(900);
t.check((await R(".pinpad")) && !(await E(() => window.devInstance)), "falscher Code darf nichts tun");
for (let i = 0; i < 4; i++) await pg.keyboard.press("Backspace");
await pg.keyboard.type("4242", { delay: 60 });
await pg.waitForFunction(() => !window.panel.shadowRoot.querySelector(".pinpad"), null, { timeout: 5000 });
await pg.waitForTimeout(300);
const dev = await E(() => ({ inst: window.devInstance, on: !!window.panel.shadowRoot.querySelector(".admin .devbtn.on"), cat: !!window.panel.shadowRoot.querySelector('.admin .cat[data-cat="dev"]') }));
t.check(dev.inst && dev.on && dev.cat, `Entwickler: ${JSON.stringify(dev)}`);
await pg.locator('haus3d-panel .admin .cat[data-cat="dev"]').click();
await pg.waitForTimeout(200);
t.check(await R(".devinfo"), "Entwickler-Infos fehlen");
await t.shot(pg, "i3-entwickler.png");
await E(() => window.panel._closeDialog());
// Zahnrad ohne Spendenzeile, Hinweis kommt nicht
await E(() => window.panel._openSettings());
await pg.waitForTimeout(300);
t.check(!(await R(".basics .supportrow")), "Spendenzeile trotz Entwickler-Instanz");
await E(() => window.panel._closeDialog());
t.check(!/Spende/.test(await hint(30)), "Hinweis trotz Entwickler-Instanz");
// neue Seite: Status kommt vom Backend
await E(() => {
  window.panel._devLoaded = false;
  window.panel._dev = undefined;
  window.panel._openSettings();
});
await pg.waitForTimeout(500);
t.check(!(await R(".basics .supportrow")), "nach Neuladen Spendenzeile sichtbar");
await t.done();
