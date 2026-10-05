// Zugang per PIN (ohne DOM, mit node testbar): aktuelle Freigabe (Token vom Server), Token an
// schreibende Befehle hängen, Eingabe im PIN-Feld. Falsche PINs lösen nichts aus.

let current = null; // {token, scope, at}

export const IDLE_MS = 10 * 60000;
export const PIN_MIN = 4;
export const PIN_MAX = 8;

export function setAccess(token, scope, now = Date.now()) {
  current = token ? { token, scope, at: now } : null;
}

export function clearAccess() {
  current = null;
}

/** Freigabe noch gültig? (10 min ohne Nutzung → weg) */
export function accessScope(now = Date.now()) {
  if (!current) return null;
  if (now - current.at > IDLE_MS) {
    current = null;
    return null;
  }
  return current.scope;
}

export function touchAccess(now = Date.now()) {
  if (current) current.at = now;
}

export const canEdit = (now) => ["edit", "admin"].includes(accessScope(now));
export const canAdmin = (now) => accessScope(now) === "admin";

/** Befehl mit Token (schreibende haus3d-Befehle). */
export function withToken(msg) {
  if (!current) return msg;
  touchAccess();
  return { ...msg, token: current.token };
}

export function currentToken() {
  return current?.token ?? null;
}

/**
 * PIN-Feld: Taste anwenden. key: "0".."9", "back", "clear".
 * @returns {{pin: string, check: boolean}} check = jetzt prüfen lassen (ab 4 Ziffern)
 */
export function pinKey(pin, key) {
  if (key === "clear") return { pin: "", check: false };
  if (key === "back") return { pin: pin.slice(0, -1), check: false };
  if (!/^[0-9]$/.test(key) || pin.length >= PIN_MAX) return { pin, check: false };
  const next = pin + key;
  return { pin: next, check: next.length >= PIN_MIN };
}

/** Neue PIN gültig? (4–8 Ziffern, beide Eingaben gleich) */
export function newPinError(a, b) {
  if (!/^[0-9]{4,8}$/.test(a ?? "")) return "4 bis 8 Ziffern";
  if (a !== b) return "Die beiden Eingaben stimmen nicht überein";
  return null;
}

/** Einstellungen, die nur mit der Admin-PIN gespeichert werden (wie ADMIN_SETTINGS in access.py). */
export const ADMIN_KEYS = ["energy", "alerts", "routines", "security", "safety", "doorbell", "weather", "climate", "season", "house_flow", "presence", "north"];
