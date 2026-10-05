// Jedes Frontend-Modul lässt sich als ES-Modul laden (findet Syntaxfehler wie ein vergessenes Komma
// im eingemischten Dialog-Modul, die `node --check` bei .js ohne "type": "module" übersieht).
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

const dir = new URL("../../custom_components/haus3d/frontend/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));

test("Frontend-Module laden", async () => {
  // Module mit DOM-Klassen (HTMLElement) nur auf Syntax prüfen
  const domOnly = new Set(["haus3d-panel.js"]);
  for (const f of files) {
    if (domOnly.has(f)) continue;
    await import(new URL(f, dir).href).catch((e) => assert.fail(`${f}: ${e.message}`));
  }
  for (const f of domOnly) {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: `${await (await import("node:fs/promises")).readFile(new URL(f, dir), "utf8")}`, encoding: "utf8" });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test("Element nur registrieren, wenn noch nicht vorhanden (Update ohne Neuladen)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../../custom_components/haus3d/frontend/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    for (const line of readFileSync(new URL(f, dir), "utf8").split("\n")) {
      if (line.includes("customElements.define(")) assert.match(line, /^if \(!customElements\.get\(/, `${f}: ${line.trim()}`);
    }
  }
});
