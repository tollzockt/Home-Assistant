// Update ohne Neuladen: HA lädt das Panel-Modul unter neuer Adresse, während das alte Element noch
// registriert ist – das Modul muss trotzdem fehlerfrei laden
import { start } from "./lib.mjs";

const t = await start(process.argv[2]);
const pg = await t.page("update", "", { width: 1024, height: 700 });
const res = await pg.evaluate(async () => {
  try {
    await import(`/custom_components/haus3d/frontend/haus3d-panel.js?neu=${Date.now()}`);
    return { ok: true, panel: !!window.panel?.shadowRoot };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
t.results.update = res;
t.check(res.ok && res.panel, `zweites Laden des Panels: ${JSON.stringify(res)}`);
await t.done();
