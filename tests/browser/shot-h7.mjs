// H7: Netzwerkgeräte (UniFi Network): Symbole im Plan, Fenster mit IP/WLAN/Signal/Laufzeit, Neustart mit
// Nachfrage, Liste aller Geräte über das Funktionsrad
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("h7", "?lan");
const E = (fn, arg) => pg.evaluate(fn, arg);
const icons = await E(() => window.panel._iconEls.filter((x) => x.icon.kind === "network").map((x) => x.icon.entity_id).sort());
t.results.symbole = icons;
t.check(JSON.stringify(icons) === JSON.stringify(["device_tracker.ap_flur", "device_tracker.drucker", "device_tracker.fernseher"]), `Netzwerk-Symbole: ${JSON.stringify(icons)}`);
const gps = await E(() => window.panel._iconEls.some((x) => x.icon.entity_id === "device_tracker.handy_gps"));
t.check(!gps, "GPS-Tracker darf kein Netzwerk-Symbol sein");

// Antippen öffnet das Fenster (nicht schalten)
await E(() => window.panel._runAction("device_tracker.fernseher", { source: "tap" }));
await pg.waitForTimeout(200);
const tv = await E(() => {
  const el = window.panel.shadowRoot.querySelector(".netpop");
  return el && { text: el.textContent.replace(/\s+/g, " "), bars: el.querySelectorAll(".nbars i.on").length };
});
t.results.fernseher = tv;
t.check(tv && /online/.test(tv.text) && /192\.168\.1\.51/.test(tv.text) && /WLAN „Zuhause“/.test(tv.text) && /AP Flur/.test(tv.text) && tv.bars === 3, `Fenster Fernseher: ${JSON.stringify(tv)}`);
const calls0 = await E(() => window.calls.filter((c) => c.domain).length);
t.check(calls0 === 0, "Antippen hat einen Dienst aufgerufen");
await t.shot(pg, "h7-client.png");

// Access Point: Laufzeit, Clients, Neustart mit Nachfrage
await E(() => window.panel._runAction("device_tracker.ap_flur", { source: "tap" }));
await pg.waitForTimeout(200);
const ap = await E(() => window.panel.shadowRoot.querySelector(".netpop")?.textContent.replace(/\s+/g, " "));
t.results.ap = ap;
t.check(/3 T 4 h/.test(ap ?? "") && /Clients\s*7/.test(ap ?? "") && /U6 Lite/.test(ap ?? ""), `Fenster AP: ${ap}`);
await pg.locator("haus3d-panel .netpop .restart").click();
await pg.waitForTimeout(600);
await pg.locator("haus3d-panel .confirm .yes").click();
await pg.waitForTimeout(300);
const press = await E(() => window.calls.filter((c) => c.domain).map((c) => `${c.domain}.${c.service}:${c.entity_id}`));
t.results.neustart = press;
t.check(press.includes("button.press:button.ap_flur_restart"), `Neustart: ${JSON.stringify(press)}`);

// Liste über „Alle Netzwerkgeräte“
await E(() => window.panel._runAction("device_tracker.drucker", { source: "tap" }));
await pg.waitForTimeout(150);
const off = await E(() => window.panel.shadowRoot.querySelector(".netpop .nstate")?.className);
t.check(/off/.test(off ?? ""), `Drucker offline: ${off}`);
await pg.locator("haus3d-panel .netpop .all").click();
await pg.waitForTimeout(300);
const list = await E(() => {
  const d = window.panel.shadowRoot.querySelector(".netlist");
  return d && { hint: d.querySelector(".hint")?.textContent, items: [...d.querySelectorAll(".nitem")].map((b) => `${b.dataset.id}:${b.classList.contains("on") ? 1 : 0}`), heads: [...d.querySelectorAll("h4")].map((h) => h.textContent) };
});
t.results.liste = list;
t.check(/Flur/.test(await E(() => window.panel.shadowRoot.querySelector(".netlist .nitem small")?.textContent)), "Ort des AP über den Gerätebereich");
t.check(list?.hint === "2 von 3 online" && list.items[0] === "device_tracker.ap_flur:1" && list.items.at(-1) === "device_tracker.drucker:0" && list.heads.join() === "Infrastruktur,Clients", `Liste: ${JSON.stringify(list)}`);
await t.shot(pg, "h7-liste.png");
await pg.locator("haus3d-panel .netlist .nitem").first().click();
await pg.waitForTimeout(200);
t.check(await E(() => /AP Flur/.test(window.panel.shadowRoot.querySelector(".netpop .head")?.textContent ?? "")), "Liste → Fenster");
await E(() => window.panel._closePopup());

// Funktionsrad: „Netzwerk“
const inWheel = await E(() => window.panel._functionItems().some((f) => f.name === "Netzwerk"));
t.check(inWheel, "Netzwerk fehlt im Funktionsrad");
await E(() => window.panel._builtinFunctions().network.run());
await pg.waitForTimeout(300);
t.check(await E(() => !!window.panel.shadowRoot.querySelector(".netlist")), "Funktionsrad → Netzwerk");
await E(() => window.panel._closeDialog());

// als 3D-Objekte
await E(() => {
  window.panel._settings.deviceMode = "3d";
  window.panel._refreshEntities();
});
await pg.waitForTimeout(800);
const dev3d = await E(() => window.panel._scene._deviceList?.filter((d) => d.kind === "network").length ?? -1);
t.results.dev3d = dev3d;
t.check(dev3d === 3, `3D-Netzwerkgeräte: ${dev3d}`);
await t.shot(pg, "h7-3d.png");
await t.done();
