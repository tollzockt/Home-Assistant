// Leitungen (ohne DOM, mit node testbar): Strom, Wasser kalt, Wasser warm – je Etage in floor.pipes als
// Linie am Boden/an der Wand mit Höhe je Punkt. Fluss nach Leistung bzw. Durchfluss.

export const PIPE_TYPES = [
  ["strom", "Strom", "#fbc02d", "mdi:flash"],
  ["wasser_kalt", "Wasser kalt", "#1e88e5", "mdi:water"],
  ["wasser_warm", "Wasser warm", "#e53935", "mdi:water-thermometer"],
];

/** Höhen-Vorgaben beim Zeichnen (m über dem Boden der Etage). */
export const PIPE_HEIGHTS = [
  [0.03, "Boden"],
  [0.15, "Sockelleiste"],
  [0.3, "Steckdose"],
  [1.1, "Schalter"],
  [2.3, "Decke"],
];

export const pipeColor = (type) => (PIPE_TYPES.find((t) => t[0] === type) ?? PIPE_TYPES[0])[2];

/**
 * 3D-Weg einer Leitung: [x, y, z]-Punkte (y relativ zum Boden). Wechselt die Höhe zwischen zwei Punkten,
 * geht es erst senkrecht am Punkt hoch/runter, dann waagerecht weiter (wie an der Wand verlegt).
 */
export function pipePath(pipe) {
  const pts = pipe.points ?? [];
  const h = (i) => {
    const v = Number(pipe.heights?.[i]);
    return Number.isFinite(v) ? v : Number(pipe.height) || 0.03;
  };
  const out = [];
  pts.forEach((p, i) => {
    const y = h(i);
    if (i > 0) {
      const prev = out.at(-1);
      if (Math.abs(prev[1] - y) > 1e-6) out.push([pts[i - 1][0], y, pts[i - 1][1]]);
    }
    out.push([p[0], y, p[1]]);
  });
  return out;
}

/** Länge (m) eines 3D-Wegs. */
export function pathLength(path) {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  return l;
}

const num = (st) => {
  if (!st || st.state === "unavailable" || st.state === "unknown") return null;
  const v = Number(st.state);
  return Number.isFinite(v) ? v : null;
};

/**
 * Fluss einer Leitung: {active, speed (Umläufe/s ~ m/s), reverse}.
 * Strom: Sensor in W/kW (negativ = Gegenrichtung), sonst Leistung des Zielraums (roomW).
 * Wasser: Durchfluss (> 0) oder Schalter/Ventil/Binärsensor an.
 */
export function pipeFlow(pipe, hass, roomW = null) {
  const st = pipe.entity ? hass?.states?.[pipe.entity] : null;
  if (pipe.type === "strom") {
    let w = null;
    if (st) {
      const v = num(st);
      const u = String(st.attributes?.unit_of_measurement ?? "W").toLowerCase();
      w = v === null ? null : u === "kw" ? v * 1000 : v;
    } else if (Number.isFinite(roomW)) w = roomW;
    if (w === null || Math.abs(w) < 3) return { active: false, speed: 0, reverse: false };
    return { active: true, speed: Math.min(1.6, 0.25 + Math.abs(w) / 1500), reverse: w < 0 };
  }
  if (!st) return { active: false, speed: 0, reverse: false };
  if (["on", "open", "opening"].includes(st.state)) return { active: true, speed: 0.6, reverse: false };
  const v = num(st);
  if (v === null || v <= 0) return { active: false, speed: 0, reverse: false };
  return { active: true, speed: Math.min(1.5, 0.2 + v / 15), reverse: false };
}
