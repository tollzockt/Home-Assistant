// I1: Haustür nur mit Tür-PIN entriegeln (falsche PIN: nichts), Abschließen ohne PIN, Tür-PIN im Admin
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("i1", "?lock");
const E = (fn, arg) => pg.evaluate(fn, arg);
const lockCalls = () => E(() => window.calls.filter((c) => c.domain === "lock" || c.type === "haus3d/lock/unlock").map((c) => c.type ?? `${c.service}${c.viaPin ? "+pin" : ""}`));

// Symbol antippen → PIN-Feld „Tür entriegeln“ statt sofort aufzuschließen
await E(() => {
  window.__r = window.panel._runAction("lock.haustuer", { source: "tap" });
});
await pg.waitForSelector("haus3d-panel .pinpad", { timeout: 5000 });
const pad = await E(() => window.panel.shadowRoot.querySelector(".pinpad").textContent.replace(/\s+/g, " "));
t.results.feld = pad;
t.check(/Tür entriegeln/.test(pad) && /Haustür/.test(pad), `PIN-Feld: ${pad}`);
await t.shot(pg, "i1-tuer-pin.png");
// falsche PIN: nichts passiert, Feld bleibt
await pg.keyboard.type("1234", { delay: 60 });
await pg.waitForTimeout(900);
const wrong = await E(() => !!window.panel.shadowRoot.querySelector(".pinpad"));
const after1 = await lockCalls();
t.check(wrong && !after1.some((c) => c.startsWith("unlock")), `falsche PIN: ${JSON.stringify({ wrong, after1 })}`);
for (let i = 0; i < 4; i++) await pg.keyboard.press("Backspace");
await pg.keyboard.type("0000", { delay: 60 });
await pg.waitForFunction(() => !window.panel.shadowRoot.querySelector(".pinpad"), null, { timeout: 5000 });
await E(() => window.__r);
const after2 = await lockCalls();
t.results.aufrufe = after2;
t.check(after2.includes("unlock+pin") && !after2.includes("unlock"), `richtige PIN: ${JSON.stringify(after2)}`);

// Abbrechen: keine Fehlermeldung, nichts entriegelt
await E(() => {
  window.__r = window.panel._hass.callService("lock", "open", { entity_id: "lock.haustuer" }).catch((e) => (window.__err = e.quiet ? "quiet" : String(e)));
});
await pg.waitForSelector("haus3d-panel .pinpad", { timeout: 5000 });
await pg.keyboard.press("Escape");
await E(() => window.__r);
t.check((await E(() => window.__err)) === "quiet", "Abbrechen soll still sein");

// Abschließen ohne PIN
await E(() => window.panel._hass.callService("lock", "lock", { entity_id: "lock.haustuer" }));
await pg.waitForTimeout(200);
const after3 = await lockCalls();
t.check(after3.at(-1) === "lock" && !(await E(() => !!window.panel.shadowRoot.querySelector(".pinpad"))), `Abschließen: ${JSON.stringify(after3)}`);

// Admin → PIN & Zugang: Tür-PIN ändern, alte gilt nicht mehr
await E(() => {
  window.__a = window.panel._openAdmin("pin");
});
await pg.waitForSelector("haus3d-panel .pinpad", { timeout: 5000 });
await pg.keyboard.type("0000", { delay: 60 });
await pg.waitForSelector('haus3d-panel .pinset[data-scope="door"]', { timeout: 5000 });
await pg.locator('haus3d-panel .pinset[data-scope="door"] .p1').fill("2468");
await pg.locator('haus3d-panel .pinset[data-scope="door"] .p2').fill("2468");
await pg.locator('haus3d-panel .pinset[data-scope="door"] .set').click();
await pg.waitForTimeout(400);
t.check((await E(() => window.pins.door)) === "2468", "Tür-PIN nicht geändert");
await t.shot(pg, "i1-admin-pin.png");
await E(() => window.panel._closeDialog());
await E(() => {
  window.__r = window.panel._hass.callService("lock", "unlock", { entity_id: "lock.haustuer" });
});
// wieder PIN-Feld; die alte PIN wirkt nicht mehr
await pg.waitForSelector("haus3d-panel .pinpad", { timeout: 5000 });
const before = (await lockCalls()).length;
await pg.keyboard.type("0000", { delay: 60 });
await pg.waitForTimeout(900);
t.check((await lockCalls()).length === before + 1 && (await E(() => !!window.panel.shadowRoot.querySelector(".pinpad"))), "alte Tür-PIN darf nicht mehr gehen");
for (let i = 0; i < 4; i++) await pg.keyboard.press("Backspace");
await pg.keyboard.type("2468", { delay: 60 });
await pg.waitForFunction(() => !window.panel.shadowRoot.querySelector(".pinpad"), null, { timeout: 5000 });
await t.done();
