// Alle Browser-Tests nacheinander: shot.mjs (Gesamtlauf) und shot-<etappe>.mjs.
// NODE_PATH="$(npm root -g)" node tests/browser/run.mjs <ausgabeordner> [filter]
import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] ?? "/tmp/haus3d-shots";
const filter = process.argv[3] ?? "";
mkdirSync(out, { recursive: true });
const files = ["shot.mjs", ...readdirSync(here).filter((f) => /^shot-.+\.mjs$/.test(f)).sort()].filter((f) => f.includes(filter));
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(here, f), out], { encoding: "utf8", env: process.env, timeout: 900000 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // nur die Fehlerliste zeigen (die Ergebnisse stehen in der vollen Ausgabe)
  const m = text.match(/"errors": \[[\s\S]*?\]/g);
  const errs = m ? m[m.length - 1] : "(keine Fehlerliste – Abbruch?)";
  const ok = r.status === 0 && /"errors": \[\]/.test(errs);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FEHL"} ${f}${ok ? "" : `\n${errs}\n${text.slice(-1500)}`}`);
}
process.exitCode = failed ? 1 : 0;
