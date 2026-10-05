// Energie-Modell (ohne DOM, mit node testbar):
// Basis = Hausverbrauch, Netzbezug und Einspeisung (ein Netz-Sensor mit Vorzeichen ODER zwei Sensoren),
// Erweiterungen = Quellen: PV-Anlage, Balkonkraftwerk, AC-Speicher (beliebig viele). Alle Erzeuger
// werden zusammengerechnet (Leistung und Ertrag heute), Speicher ebenso (Ladestand gewichtet).
// Alte Einstellungen (solar, haus_pv, akku_* …) werden beim Lesen in Quellen umgewandelt.

export const SOURCE_TYPES = [
  ["pv", "PV-Anlage", "mdi:solar-power-variant"],
  ["bkw", "Balkonkraftwerk", "mdi:solar-panel"],
  ["speicher", "AC-Speicher", "mdi:home-battery-outline"],
];

const isId = (v) => typeof v === "string" && v.includes(".");
const num = (st) => {
  if (!st || st.state === "unavailable" || st.state === "unknown") return null;
  const v = Number(st.state);
  return Number.isFinite(v) ? v : null;
};
/** Leistung in W (kW-Sensoren umgerechnet). */
export function watt(st) {
  const v = num(st);
  if (v === null) return null;
  const u = String(st.attributes?.unit_of_measurement ?? "W").toLowerCase();
  return u === "kw" ? v * 1000 : u === "mw" ? v * 1e6 : v;
}
/** Energie in kWh (Wh-Sensoren umgerechnet). */
export function kwh(st) {
  const v = num(st);
  if (v === null) return null;
  const u = String(st.attributes?.unit_of_measurement ?? "kWh").toLowerCase();
  return u === "wh" ? v / 1000 : u === "mwh" ? v * 1000 : v;
}

/**
 * Einstellungen vereinheitlichen. Neues Format: {haus, netz, netz_invert, netz_bezug, netz_einspeisung,
 * sources: [{id, type, name, power, energy, soc, invert, capacity, reserve}], …}. Fehlt `sources`, werden
 * die alten Felder umgewandelt (Balkonkraftwerk: solar/einspeisung/ertrag_heute, PV: haus_pv,
 * Speicher: akku_*).
 */
export function normalizeEnergy(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const out = {
    haus: isId(c.haus) ? c.haus : isId(c.verbrauch) ? c.verbrauch : null,
    netz: isId(c.netz) ? c.netz : null,
    netz_invert: !!c.netz_invert,
    netz_bezug: isId(c.netz_bezug) ? c.netz_bezug : null,
    netz_einspeisung: isId(c.netz_einspeisung) ? c.netz_einspeisung : null,
    extra: Array.isArray(c.extra) ? c.extra : [],
    kurz: c.kurz ?? "",
    ueberschuss: c.ueberschuss,
    sources: [],
  };
  if (Array.isArray(c.sources)) {
    out.sources = c.sources
      .filter((s) => s && SOURCE_TYPES.some(([t]) => t === s.type))
      .map((s, i) => ({
        id: typeof s.id === "string" && s.id ? s.id : `${s.type}_${i + 1}`,
        type: s.type,
        name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : SOURCE_TYPES.find(([t]) => t === s.type)[1],
        power: isId(s.power) ? s.power : null,
        energy: isId(s.energy) ? s.energy : null,
        soc: isId(s.soc) ? s.soc : null,
        invert: !!s.invert,
        capacity: Number(s.capacity) > 0 ? Number(s.capacity) : null,
        reserve: Number.isFinite(Number(s.reserve)) && s.reserve !== null && s.reserve !== "" ? Number(s.reserve) : 10,
      }));
    return out;
  }
  // altes Format → Quellen
  if (isId(c.solar) || isId(c.einspeisung) || isId(c.ertrag_heute)) {
    out.sources.push({ id: "bkw_1", type: "bkw", name: "Balkonkraftwerk", power: isId(c.solar) ? c.solar : c.einspeisung ?? null, energy: isId(c.ertrag_heute) ? c.ertrag_heute : null, soc: null, invert: false, capacity: null, reserve: 10 });
  }
  if (isId(c.haus_pv)) out.sources.push({ id: "pv_1", type: "pv", name: "PV-Anlage", power: c.haus_pv, energy: isId(c.pv_zaehler) ? c.pv_zaehler : null, soc: null, invert: false, capacity: null, reserve: 10 });
  if (isId(c.akku_ladestand) || isId(c.akku_leistung)) {
    out.sources.push({ id: "speicher_1", type: "speicher", name: "Speicher", power: isId(c.akku_leistung) ? c.akku_leistung : null, energy: null, soc: isId(c.akku_ladestand) ? c.akku_ladestand : null, invert: !!c.akku_invert, capacity: Number(c.akku_kapazitaet) > 0 ? Number(c.akku_kapazitaet) : null, reserve: Number.isFinite(Number(c.akku_reserve)) ? Number(c.akku_reserve) : 10 });
  }
  return out;
}

/** Alle Entitäten des Modells (zum Beobachten und als Ausschluss beim Raumverbrauch). */
export function energyEntities(cfg) {
  const e = normalizeEnergy(cfg);
  const ids = [e.haus, e.netz, e.netz_bezug, e.netz_einspeisung];
  for (const s of e.sources) ids.push(s.power, s.energy, s.soc);
  for (const x of e.extra) ids.push(typeof x === "string" ? x : x?.entity);
  return [...new Set(ids.filter(isId))];
}

const sum = (list) => {
  const vals = list.filter((v) => Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

/**
 * Summen aus dem Modell.
 * netz: + Bezug / − Einspeisung (Vorzeichen korrigiert); bezug/einspeisung ≥ 0;
 * erzeugung/ertrag: Summe aller PV und Balkonkraftwerke; speicher.power: + laden / − entladen;
 * verbrauch: Sensor, sonst berechnet (Erzeugung + Bezug − Einspeisung − Laden + Entladen).
 */
export function energyTotals(cfg, hass) {
  const e = normalizeEnergy(cfg);
  const st = (id) => (id ? hass?.states?.[id] : undefined);
  let netz = null;
  if (e.netz) {
    const v = watt(st(e.netz));
    netz = v === null ? null : e.netz_invert ? -v : v;
  } else if (e.netz_bezug || e.netz_einspeisung) {
    const b = watt(st(e.netz_bezug));
    const f = watt(st(e.netz_einspeisung));
    netz = b === null && f === null ? null : Math.max(0, b ?? 0) - Math.max(0, f ?? 0);
  }
  const per = e.sources.map((s) => {
    let power = watt(st(s.power));
    if (power !== null && s.type === "speicher" && s.invert) power = -power;
    return { ...s, value: power, today: kwh(st(s.energy)), level: s.soc ? num(st(s.soc)) : null };
  });
  const gens = per.filter((s) => s.type !== "speicher");
  const stores = per.filter((s) => s.type === "speicher");
  const erzeugung = sum(gens.map((s) => (s.value === null ? null : Math.max(0, s.value))));
  const ertrag = sum(gens.map((s) => s.today));
  const sPower = sum(stores.map((s) => s.value));
  // Ladestand: nach Kapazität gewichtet, sonst Mittelwert
  const withSoc = stores.filter((s) => Number.isFinite(s.level));
  let soc = null;
  if (withSoc.length) {
    const w = withSoc.map((s) => s.capacity ?? 1);
    soc = withSoc.reduce((a, s, i) => a + s.level * w[i], 0) / w.reduce((a, b) => a + b, 0);
  }
  const cap = sum(stores.map((s) => s.capacity));
  let verbrauch = watt(st(e.haus));
  let verbrauchCalc = false;
  if (verbrauch === null && (erzeugung !== null || netz !== null)) {
    verbrauch = Math.max(0, (erzeugung ?? 0) + (netz ?? 0) - (sPower ?? 0));
    verbrauchCalc = true;
  }
  return {
    netz,
    bezug: netz === null ? null : Math.max(0, netz),
    einspeisung: netz === null ? null : Math.max(0, -netz),
    erzeugung,
    ertrag,
    verbrauch,
    verbrauchCalc,
    speicher: stores.length ? { soc, power: sPower, capacity: cap, reserve: stores[0].reserve } : null,
    sources: per,
    hasGrid: !!(e.netz || e.netz_bezug || e.netz_einspeisung),
  };
}

/** Zeilen der Energie-Karte (Schlüssel, Symbol, Name) – feste Summen, dann je Quelle eine Zeile. */
export const ENERGY_ROWS = [
  ["verbrauch", "mdi:home-lightning-bolt-outline", "Hausverbrauch"],
  ["bezug", "mdi:transmission-tower-import", "Netzbezug"],
  ["einspeisung", "mdi:transmission-tower-export", "Einspeisung"],
  ["erzeugung", "mdi:solar-power-variant", "Erzeugung gesamt"],
  ["akku_ladestand", "mdi:battery", "Speicher"],
  ["akku_leistung", "mdi:battery-charging", "Speicherleistung"],
  ["ertrag_heute", "mdi:counter", "Ertrag heute"],
];

/**
 * Verfügbare Zeilen: [{id, key, icon, base, entity}] – entity für „Weitere Infos“ (bei Summen die erste
 * passende Entität). Quellen-Zeilen (key src:…) nur, wenn es mehr als einen Erzeuger gibt.
 */
export function energyRowSpecs(cfg, hass) {
  const e = normalizeEnergy(cfg);
  const has = (id) => !!(id && hass?.states?.[id]);
  const gens = e.sources.filter((s) => s.type !== "speicher" && has(s.power));
  const stores = e.sources.filter((s) => s.type === "speicher");
  const grid = has(e.netz) || has(e.netz_bezug) || has(e.netz_einspeisung);
  const avail = {
    verbrauch: has(e.haus) ? e.haus : grid || gens.length ? e.haus ?? e.netz ?? e.netz_bezug ?? gens[0]?.power : null,
    bezug: grid ? e.netz_bezug ?? e.netz : null,
    einspeisung: grid ? e.netz_einspeisung ?? e.netz : null,
    erzeugung: gens.length ? gens[0].power : null,
    akku_ladestand: stores.find((s) => has(s.soc))?.soc ?? null,
    akku_leistung: stores.find((s) => has(s.power))?.power ?? null,
    ertrag_heute: e.sources.find((s) => s.type !== "speicher" && has(s.energy))?.energy ?? null,
  };
  const rows = ENERGY_ROWS.filter(([k]) => avail[k] || (k === "verbrauch" && (grid || gens.length))).map(([key, icon, base]) => ({ id: key, key, icon, base, entity: avail[key] ?? null }));
  if (gens.length > 1) for (const s of gens) rows.push({ id: `src:${s.id}`, key: `src:${s.id}`, icon: SOURCE_TYPES.find(([t]) => t === s.type)[2], base: s.name, entity: s.power });
  return rows;
}

/**
 * Werte im bisherigen Format für vorhandene Funktionen (Fluss, Ampel, Hinweise, Simulation …):
 * solar = Erzeugung, einspeisung = Erzeugung (Leistung ins Haus), netz korrigiert, Akku korrigiert.
 */
export function legacyValues(t) {
  return {
    solar: t.erzeugung,
    einspeisung: t.erzeugung,
    haus_pv: t.sources.filter((s) => s.type === "pv").reduce((a, s) => (Number.isFinite(s.value) ? (a ?? 0) + Math.max(0, s.value) : a), null),
    netz: t.netz,
    verbrauch: t.verbrauch,
    akku_ladestand: t.speicher?.soc ?? null,
    akku_leistung: t.speicher?.power ?? null,
    ertrag_heute: t.ertrag,
    bezug: t.bezug,
    einspeisung_netz: t.einspeisung,
    erzeugung: t.erzeugung,
  };
}

/** Neue Quelle mit freier ID. */
export function newSource(type, sources) {
  const n = sources.filter((s) => s.type === type).length + 1;
  const ids = new Set(sources.map((s) => s.id));
  let i = n;
  while (ids.has(`${type}_${i}`)) i++;
  return { id: `${type}_${i}`, type, name: `${SOURCE_TYPES.find(([t]) => t === type)[1]}${n > 1 ? ` ${n}` : ""}`, power: null, energy: null, soc: null, invert: false, capacity: null, reserve: 10 };
}
