// Bedienelemente über der 3D-Ansicht ohne DOM (mit node testbar): Rad-Menüs, Kurzwahl, Karten.

import { entityAction } from "./actions.js";

/** Höchstens so viele Zusatzkarten neben „Energie“. */
export const MAX_CARDS = 5;
/** Sichtbare Einträge je Rad-Menü; mehr lassen sich durchdrehen. Dahinter sitzt fest der „+“-Knopf. */
export const WHEEL_VISIBLE = 4;

/**
 * Lage der Bubbles eines Rad-Menüs in der Ecke: Viertelkreis über dem Knopf. Die sichtbaren Einträge
 * stehen auf den ersten Plätzen, der letzte Platz (90°) gehört dem „+“. Ausgeblendete Einträge warten
 * vor dem ersten bzw. hinter dem letzten Platz, damit sie beim Drehen hinein- und hinausgleiten.
 * @param {number} n Anzahl Einträge (ohne „+“)
 * @param {number} offset Drehung (Einträge)
 * @returns {{i:number, angle:number, visible:boolean}[]} angle in Grad, 0 = senkrecht über dem Knopf, 90 = waagerecht
 */
export function wheelLayout(n, offset = 0, visible = WHEEL_VISIBLE) {
  const shown = Math.min(n, visible);
  const step = 90 / visible;
  const out = [];
  for (let i = 0; i < n; i++) {
    let k = i - offset;
    if (n > visible) k = ((k % n) + n) % n;
    const vis = k >= 0 && k < shown;
    out.push({ i, angle: vis ? k * step : k === n - 1 ? -step : visible * step, visible: vis });
  }
  return out;
}

/** Platz des „+“-Knopfs: direkt hinter dem letzten sichtbaren Eintrag. */
export function wheelPlusAngle(n, visible = WHEEL_VISIBLE) {
  return (Math.min(n, visible) * 90) / visible;
}

/** Drehung eines Rads um delta Einträge (ringförmig). */
export function rotateWheel(offset, delta, n, visible = WHEEL_VISIBLE) {
  if (n <= visible) return 0;
  return (((offset + delta) % n) + n) % n;
}

/**
 * Lage der Beschriftung einer Bubble: immer nach außen (weg vom Knopf), damit sie keine Nachbar-Bubble
 * verdeckt: ganz oben darüber, ganz waagerecht zur Seite, dazwischen schräg nach außen.
 */
export function labelPlace(angle) {
  if (angle < 5) return "top";
  if (angle > 80) return "side";
  return "diag";
}

/** Eingebaute Funktionen bis 0.13 (wer sie ausgeblendet hat, soll sie nicht wiederbekommen). */
export const LEGACY_FUNCTION_KEYS = ["flow", "temp", "style", "roof", "grid", "weather", "labels", "devices", "furniture", "fit"];
/** Eingebaute Funktionen des Funktionsrads (Reihenfolge = Standard). */
export const FUNCTION_KEYS = [...LEGACY_FUNCTION_KEYS, "presence"];

/**
 * Einträge des Funktionsrads aus den Einstellungen: eingebaute (key) und eigene (entity), ohne Doppelte.
 * seen: eingebaute Schlüssel, die der Nutzer beim Speichern schon kannte (settings.functions_seen).
 * Neue Schlüssel, die er noch nicht gesehen hat, kommen einmal ans Ende.
 */
export function normalizeFunctions(list, seen = FUNCTION_KEYS) {
  if (!Array.isArray(list)) return FUNCTION_KEYS.map((key) => ({ key }));
  const seen_ = new Set();
  const out = [];
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    if (FUNCTION_KEYS.includes(f.key)) {
      if (seen_.has(f.key)) continue;
      seen_.add(f.key);
      out.push({ key: f.key });
    } else if (typeof f.entity === "string" && f.entity.includes(".")) {
      out.push({ entity: f.entity, ...(f.name ? { name: String(f.name) } : {}), ...(f.confirm ? { confirm: true } : {}) });
    }
  }
  const known = new Set(Array.isArray(seen) ? seen : FUNCTION_KEYS);
  for (const key of FUNCTION_KEYS) if (!known.has(key) && !seen_.has(key)) out.push({ key });
  return out;
}

/** Dienst für einen Kurzwahl-Eintrag (siehe actions.js): Automation auslösen, Skript/Szene starten, Taster drücken, sonst umschalten. */
export function quickService(entityId, stateObj) {
  return entityAction(entityId, stateObj, { source: "wheel", safety: false }).call ?? [entityId.split(".")[0], "toggle"];
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
