// Bedienelemente über der 3D-Ansicht ohne DOM (mit node testbar): Rad-Menüs, Kurzwahl, Karten.

/** Höchstens so viele Zusatzkarten neben „Energie“. */
export const MAX_CARDS = 5;
/** Sichtbare Bubbles je Rad-Menü; mehr lassen sich durchdrehen. */
export const WHEEL_VISIBLE = 5;

/**
 * Lage der Bubbles eines Rad-Menüs in der Ecke: Viertelkreis über dem Knopf.
 * @param {number} n Anzahl Einträge
 * @param {number} offset Drehung (Einträge)
 * @returns {{i:number, angle:number, visible:boolean}[]} angle in Grad, 0 = senkrecht über dem Knopf, 90 = waagerecht
 */
export function wheelLayout(n, offset = 0, visible = WHEEL_VISIBLE) {
  const shown = Math.min(n, visible);
  const step = shown > 1 ? 90 / (shown - 1) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    // Position relativ zur Drehung, ringförmig (bei mehr Einträgen als Plätzen)
    let k = i - offset;
    if (n > visible) k = ((k % n) + n) % n;
    out.push({ i, angle: k * step, visible: k >= 0 && k < shown });
  }
  return out;
}

/** Drehung eines Rads um delta Einträge (ringförmig). */
export function rotateWheel(offset, delta, n, visible = WHEEL_VISIBLE) {
  if (n <= visible) return 0;
  return (((offset + delta) % n) + n) % n;
}

/** Dienst für einen Kurzwahl-Eintrag: Automation auslösen, Skript/Szene starten, Taster drücken, sonst umschalten. */
export function quickService(entityId, stateObj) {
  const domain = entityId.split(".")[0];
  if (domain === "automation") return ["automation", "trigger"];
  if (domain === "script" || domain === "scene") return [domain, "turn_on"];
  if (domain === "button" || domain === "input_button") return [domain, "press"];
  if (domain === "lock") return ["lock", stateObj?.state === "locked" ? "unlock" : "lock"];
  if (domain === "cover") return ["cover", "toggle"];
  return [domain, "toggle"];
}

/** Zusatzkarten aus den Einstellungen (höchstens MAX_CARDS, Einträge bereinigt). */
export function normalizeCards(cards) {
  return (Array.isArray(cards) ? cards : [])
    .filter((c) => c && typeof c === "object")
    .slice(0, MAX_CARDS)
    .map((c, i) => ({
      id: String(c.id || `karte_${i + 1}`),
      title: String(c.title || `Karte ${i + 1}`),
      icon: /^mdi:[a-z0-9-]+$/.test(c.icon ?? "") ? c.icon : "mdi:card-text-outline",
      entities: (Array.isArray(c.entities) ? c.entities : [])
        .map((e) => (typeof e === "string" ? { entity: e } : e))
        .filter((e) => e && typeof e.entity === "string" && e.entity.includes("."))
        .slice(0, 12),
    }));
}

/** Stil durchschalten: Auto → Tag → Nacht → Cyberpunk → Auto. */
export function nextStyle(style) {
  const order = ["auto", "day", "night", "cyber"];
  return order[(order.indexOf(style) + 1) % order.length];
}
