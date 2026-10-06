import { test } from "node:test";
import assert from "node:assert/strict";
import { supportHintDue, supportLinks } from "../../custom_components/haus3d/frontend/panel-support.js";

const DAY = 86400000;
const links = [["a", "A", "https://x.example", "mdi:x"]];

test("Spenden: nur Links mit https-URL", () => {
  assert.deepEqual(supportLinks([["a", "A", "", "i"], ["b", "B", "https://b.example", "i"], ["c", "C", "javascript:alert(1)", "i"]]).map((l) => l[0]), ["b"]);
});

test("Spenden-Hinweis: frühestens nach 14 Tagen, einmal, nie im Kiosk/Entwickler/ohne Links", () => {
  const base = { firstSeen: 0, hinted: false, links };
  assert.equal(supportHintDue({ ...base, now: 13 * DAY }), false);
  assert.equal(supportHintDue({ ...base, now: 14 * DAY }), true);
  assert.equal(supportHintDue({ ...base, now: 20 * DAY, hinted: true }), false);
  assert.equal(supportHintDue({ ...base, now: 20 * DAY, kiosk: true }), false);
  assert.equal(supportHintDue({ ...base, now: 20 * DAY, dev: true }), false);
  assert.equal(supportHintDue({ ...base, now: 20 * DAY, links: [] }), false);
  assert.equal(supportHintDue({ ...base, firstSeen: NaN, now: 20 * DAY }), false);
});
