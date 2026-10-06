// Leitungsnetz (ohne DOM, mit node testbar): Leitungen und Verteiler je Medium zu einem Netz verbinden und
// für jedes Stück die Menge berechnen, die hindurchfließt – von der Wurzel (Hauptverteilung, Hausanschluss,
// Router) zu den Verbrauchern an den Leitungsenden. Abzweige entstehen, wo ein Leitungsende oder ein
// Verteiler auf einer anderen Leitung liegt; Durchführungen verbinden Etagen.

const TOL = 0.05; // m: so nah = verbunden

/** Medien: Leitungstyp → {Verteiler-Arten, Wurzel-Arten, Einheit}. */
export const MEDIA = {
  strom: { kinds: ["hv", "uv", "einspeisung", "durch"], roots: ["hv"], unit: "W" },
  wasser_kalt: { kinds: ["wasser_in", "durch"], roots: ["wasser_in"], unit: "l/min" },
  wasser_warm: { kinds: ["warm_in", "durch"], roots: ["warm_in"], unit: "l/min" },
  netzwerk: { kinds: ["router", "switch", "durch"], roots: ["router"], unit: "Mbit/s" },
};

/** Arten von Verteilern (Editor und 3D): [kind, Name, Symbol, Medium]. */
export const NODE_KINDS = [
  ["hv", "Hauptverteilung", "mdi:home-lightning-bolt", "strom"],
  ["uv", "Unterverteilung", "mdi:fuse", "strom"],
  ["einspeisung", "Einspeisung (PV/BKW/Speicher)", "mdi:solar-power-variant", "strom"],
  ["router", "Router", "mdi:router-network", "netzwerk"],
  ["switch", "Switch / Netzwerk-Verteiler", "mdi:switch", "netzwerk"],
  ["wasser_in", "Wasser-Hausanschluss", "mdi:water-pump", "wasser_kalt"],
  ["warm_in", "Warmwasser (Boiler/Wärmepumpe)", "mdi:water-boiler", "wasser_warm"],
  ["durch", "Durchführung (Etage)", "mdi:arrow-up-down", null],
];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Nächster Punkt einer Strecke: {t (0..1), d}. */
function onSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return { t, d: dist(p, [a[0] + dx * t, a[1] + dz * t]) };
}

/** Stelle auf einer Leitung als Zahl: Segmentnummer + Anteil (z. B. 1.5 = Mitte des 2. Segments). */
const posOf = (seg, t) => seg + t;

class DSU {
  constructor() {
    this.p = new Map();
  }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r);
    this.p.set(x, r);
    return r;
  }
  union(a, b) {
    this.p.set(this.find(a), this.find(b));
  }
}

/**
 * Netz eines Hauses berechnen.
 * @param {object} building {floors: [{id, pipes, nodes}]}
 * @param {object} o
 * @param {(pipe) => number|null} o.load Verbrauch am Ende einer Leitung (W, l/min, Mbit/s) oder null
 * @param {(node) => number|null} o.nodeValue Zählerwert eines Verteilers (bei Einspeisung: Erzeugung)
 * @returns {{edges: object[], nodes: Map, details: (edgeId) => object|null}}
 */
export function computeNet(building, { load = () => null, nodeValue = () => null } = {}) {
  const edges = [];
  const nodeInfo = new Map();
  const detailFns = new Map();
  for (const [medium, cfg] of Object.entries(MEDIA)) {
    const pipes = [];
    const nodes = [];
    for (const f of building?.floors ?? []) {
      for (const p of f.pipes ?? []) if (p.type === medium && (p.points?.length ?? 0) >= 2) pipes.push({ ...p, floorId: f.id });
      for (const n of f.nodes ?? []) if (cfg.kinds.includes(n.kind) && Number.isFinite(n.x) && Number.isFinite(n.z)) nodes.push({ ...n, floorId: f.id });
    }
    if (!pipes.length) continue;
    // 1) Schnittstellen je Leitung: Enden, plus Stellen, an denen andere Enden oder Verteiler liegen
    const cuts = new Map(pipes.map((p) => [p.id, new Map([[0, `${p.id}@0`], [p.points.length - 1, `${p.id}@end`]])]));
    const dsu = new DSU();
    const where = new Map(); // Punkt-Schlüssel → {floorId, xz}
    const key = (p, pos) => `${p.id}~${pos}`;
    const pointAt = (p, pos) => {
      const i = Math.min(Math.floor(pos), p.points.length - 2);
      const t = pos - i;
      const a = p.points[i];
      const b = p.points[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const addCut = (p, pos) => {
      const k = key(p, pos);
      cuts.get(p.id).set(pos, k);
      where.set(k, { floorId: p.floorId, xz: pointAt(p, pos) });
      return k;
    };
    for (const p of pipes) {
      addCut(p, 0);
      addCut(p, p.points.length - 1);
    }
    // Punkte, die andere Leitungen berühren können: Enden aller Leitungen und alle Verteiler
    const probes = [
      ...pipes.flatMap((p) => [
        { k: key(p, 0), floorId: p.floorId, xz: p.points[0], own: p.id },
        { k: key(p, p.points.length - 1), floorId: p.floorId, xz: p.points.at(-1), own: p.id },
      ]),
      ...nodes.map((n) => ({ k: `node:${n.id}`, floorId: n.floorId, xz: [n.x, n.z], own: null })),
    ];
    for (const n of nodes) where.set(`node:${n.id}`, { floorId: n.floorId, xz: [n.x, n.z] });
    for (const pr of probes) {
      dsu.find(pr.k);
      for (const q of pipes) {
        if (q.floorId !== pr.floorId) continue;
        for (let i = 0; i < q.points.length - 1; i++) {
          if (q.id === pr.own) continue;
          const { t, d } = onSegment(pr.xz, q.points[i], q.points[i + 1]);
          if (d > TOL) continue;
          const pos = Math.abs(t - 1) < 1e-6 ? i + 1 : posOf(i, t);
          dsu.union(pr.k, addCut(q, pos));
          break;
        }
      }
    }
    // Enden/Verteiler nah beieinander verbinden (auch ohne Strecke dazwischen)
    for (let i = 0; i < probes.length; i++) for (let j = i + 1; j < probes.length; j++) {
      const a = probes[i];
      const b = probes[j];
      if (a.floorId === b.floorId && dist(a.xz, b.xz) <= TOL) dsu.union(a.k, b.k);
    }
    // Durchführungen: Gegenstück auf der anderen Etage
    for (const n of nodes) if (n.kind === "durch" && n.link && nodes.some((m) => m.id === n.link)) dsu.union(`node:${n.id}`, `node:${n.link}`);
    // 2) Stücke (Kanten) zwischen aufeinanderfolgenden Schnittstellen
    const adj = new Map();
    const link = (a, b, e) => {
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!adj.has(x)) adj.set(x, []);
        adj.get(x).push({ to: y, e });
      }
    };
    const mine = [];
    for (const p of pipes) {
      const list = [...cuts.get(p.id).entries()].sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < list.length - 1; i++) {
        const [s0, k0] = list[i];
        const [s1, k1] = list[i + 1];
        if (s1 - s0 < 1e-6) {
          dsu.union(k0, k1);
          continue;
        }
        const e = { id: `${p.id}#${i}`, pipeId: p.id, floorId: p.floorId, medium, unit: cfg.unit, s0, s1, a: k0, b: k1, value: 0, reverse: false };
        mine.push(e);
      }
    }
    for (const e of mine) link(dsu.find(e.a), dsu.find(e.b), e);
    // 3) Lasten an Leitungsenden und Verteilern
    const loads = new Map();
    const sinks = new Map(); // Knoten → [{name, value, pipeId|nodeId}]
    const addLoad = (k, v, info) => {
      const r = dsu.find(k);
      loads.set(r, (loads.get(r) ?? 0) + v);
      if (!sinks.has(r)) sinks.set(r, []);
      sinks.get(r).push({ ...info, value: v });
    };
    for (const p of pipes) {
      const v = load(p);
      if (Number.isFinite(v)) addLoad(key(p, p.points.length - 1), v, { name: p.name || p.room || p.device || p.entity || "Leitung", pipeId: p.id });
    }
    const meters = new Map(); // Knoten → gemessener Wert (Unterverteilung, Wurzel)
    for (const n of nodes) {
      const v = nodeValue(n);
      if (!Number.isFinite(v)) continue;
      if (n.kind === "einspeisung") addLoad(`node:${n.id}`, -Math.abs(v), { name: n.name || "Einspeisung", nodeId: n.id });
      else if (n.kind !== "durch") meters.set(dsu.find(`node:${n.id}`), { value: v, node: n });
    }
    // 4) Wurzel und Baum (Breitensuche); ohne Wurzel: Anfang der ersten Leitung
    const rootNode = nodes.find((n) => cfg.roots.includes(n.kind));
    const rootKeys = rootNode ? [dsu.find(`node:${rootNode.id}`)] : [];
    const seen = new Set();
    const parentEdge = new Map();
    const children = new Map();
    const order = [];
    const visit = (start) => {
      if (seen.has(start)) return;
      seen.add(start);
      const queue = [start];
      while (queue.length) {
        const x = queue.shift();
        order.push(x);
        for (const { to, e } of adj.get(x) ?? []) {
          if (seen.has(to)) continue;
          seen.add(to);
          parentEdge.set(to, { e, from: x });
          if (!children.has(x)) children.set(x, []);
          children.get(x).push(to);
          queue.push(to);
        }
      }
    };
    for (const r of rootKeys) visit(r);
    // nicht verbundene Teile: jeweils ab dem Anfang ihrer ersten Leitung
    for (const p of pipes) visit(dsu.find(key(p, 0)));
    // 5) Summen von den Blättern zur Wurzel
    const sum = new Map();
    const unknown = new Map();
    for (const x of [...order].reverse()) {
      let s = loads.get(x) ?? 0;
      for (const c of children.get(x) ?? []) s += sum.get(c) ?? 0;
      const m = meters.get(x);
      if (m && !rootKeys.includes(x)) {
        unknown.set(x, m.value - s);
        s = m.value;
      }
      sum.set(x, s);
    }
    for (const r of rootKeys) {
      const m = meters.get(r);
      if (m) unknown.set(r, m.value - (sum.get(r) ?? 0));
    }
    // 6) Kanten: Menge = Summe des Teilbaums am fernen Ende; Richtung relativ zur Zeichenrichtung
    for (const [child, { e, from }] of parentEdge) {
      const v = sum.get(child) ?? 0;
      const downstreamIsB = dsu.find(e.b) === child && dsu.find(e.a) === from;
      // positiv: fließt vom Elternknoten zum Kind
      const towardB = v >= 0 ? downstreamIsB : !downstreamIsB;
      e.value = Math.abs(v);
      e.reverse = !towardB;
      e.child = child;
    }
    for (const e of mine) edges.push(e);
    for (const n of nodes) {
      const k = dsu.find(`node:${n.id}`);
      nodeInfo.set(n.id, { medium, value: rootKeys.includes(k) ? Math.abs(sum.get(k) ?? 0) : Math.abs(sum.get(k) ?? 0), unit: cfg.unit, unknown: unknown.get(k) ?? null, meter: meters.get(k)?.value ?? null });
    }
    // Details: Verbraucher im Teilbaum eines Stücks
    const subtreeSinks = (x) => {
      const out = [];
      const stack = [x];
      while (stack.length) {
        const y = stack.pop();
        for (const s of sinks.get(y) ?? []) out.push(s);
        if (unknown.has(y) && Math.abs(unknown.get(y)) > 0.5 && !rootKeys.includes(y)) out.push({ name: `${meters.get(y)?.node?.name || "Verteiler"}: nicht zugeordnet`, value: unknown.get(y) });
        stack.push(...(children.get(y) ?? []));
      }
      return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    };
    for (const e of mine) detailFns.set(e.id, () => (e.child ? { ...e, sinks: subtreeSinks(e.child) } : { ...e, sinks: [] }));
  }
  return { edges, nodes: nodeInfo, details: (id) => detailFns.get(id)?.() ?? null };
}

/** Menge → Punkte je Meter und Tempo (m/s) für die Darstellung. */
export function flowLook(value, unit) {
  const full = unit === "W" ? 3000 : unit === "l/min" ? 15 : 100;
  const min = unit === "W" ? 5 : unit === "l/min" ? 0.1 : 0.05;
  if (!Number.isFinite(value) || value < min) return { active: false, perMeter: 0, speed: 0 };
  const k = Math.min(1, Math.sqrt(value / full));
  return { active: true, perMeter: 0.8 + k * 3.2, speed: 0.25 + k * 1.35 };
}

/** Wert mit Einheit lesbar (Deutsch). */
export function fmtFlow(value, unit) {
  if (!Number.isFinite(value)) return "–";
  const de = (v, d) => v.toLocaleString("de-DE", { maximumFractionDigits: d });
  if (unit === "W") return Math.abs(value) >= 1000 ? `${de(value / 1000, 2)} kW` : `${de(value, 0)} W`;
  return `${de(value, 1)} ${unit}`;
}
