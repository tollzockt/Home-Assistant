// Dach-Ebene im Editor: Dach von oben (Flächen, First, Himmelsrichtung), Dinge auf dem Dach (Kamin,
// Dachfenster, PV-Felder) setzen und verschieben, Dach-Einstellungen. Wird von FloorEditor benutzt.

import { allIds, newId } from "./edit-ops.js";
import { ROOF_ITEMS, ROOF_TYPES, legacyPvItems, pvLayout, roofModel, roofSettings, roofSurfaceAt } from "./exterior.js";
import { COLOR_SWATCHES, textureOptions } from "./model.js";

export const ROOF_TOOLS = [
  ["select", "mdi:cursor-default-outline", "Auswählen"],
  ["chimney", "mdi:home-roof", "Kamin"],
  ["skylight", "mdi:window-closed-variant", "Dachfenster"],
  ["pv", "mdi:solar-panel", "PV-Feld"],
];

export const ROOF_HINTS = {
  select: "Dach-Ebene: Kamin, Dachfenster und PV-Felder antippen und ziehen. PV-Felder richten sich nach der Dachfläche unter ihrer Mitte. Pfeiltasten schieben, Entf löscht.",
  chimney: "Auf das Dach tippen: Kamin setzen.",
  skylight: "Auf das Dach tippen: Dachfenster setzen.",
  pv: "Auf das Dach tippen: PV-Feld setzen (Spalten × Reihen rechts einstellen).",
};

const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v ?? "");

/** Auswahlfeld für eine Textur (data-tex=key). kind: w (Wand), f (Boden), r (Dach), g (Gelände). */
export function textureField(key, label, value, kind) {
  return `<label>${label}</label><select data-tex="${key}">${textureOptions(kind).map(([k, n]) => `<option value="${k}"${k === (value ?? "") ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
}

function colorField(key, label, value) {
  const v = isHex(value) ? value.toLowerCase() : "";
  return `<label>${label}</label><div class="colorrow"><input type="color" data-rcolor="${key}" value="${v || "#cccccc"}"><button data-rcolor-reset="${key}">Standard</button><span class="muted">${v ? esc(v) : "Standard"}</span></div>
    <div class="swatches">${COLOR_SWATCHES.map((c) => `<button data-rswatch="${key}" data-c="${c}" style="background:${c}" class="${c === v ? "sel" : ""}" title="${c}"></button>`).join("")}</div>`;
}

/** Grundriss-Ecken eines gedrehten Rechtecks (Mitte, Achse along, Breite w entlang, Tiefe d quer). */
function rectCorners([x, z], along, w, d) {
  const n = [-along[1], along[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => [x + (along[0] * i * w) / 2 + (n[0] * k * d) / 2, z + (along[1] * i * w) / 2 + (n[1] * k * d) / 2]);
}

/** Richtung (Grundriss) eines Kamins/Dachfensters: Dachfenster folgen der Fläche, Kamine ihrer Drehung. */
function itemAxis(model, it) {
  if (it.type === "skylight") {
    const out = roofSurfaceAt(model, [it.x, it.z])?.out;
    if (out) return [out[1], -out[0]];
  }
  const a = ((it.rotation || 0) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** SVG-Teile der Dach-Ebene (Maßstab: Meter, px() = Bildschirmpixel). */
export function roofSvg(ed, px) {
  const P = ([x, z]) => `${r3(x)},${r3(z)}`;
  const parts = [];
  const model = roofModel(ed.b);
  const roof = roofSettings(ed.b.settings);
  const floor = model?.floor ?? ed.floor;
  // Etage unter dem Dach blass als Orientierung
  parts.push(`<g fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-opacity=".35" stroke-width="${px(1)}" pointer-events="none">${(floor?.rooms ?? []).map((r) => `<polygon points="${r.points.map(P).join(" ")}"/>`).join("")}</g>`);
  if (!model) {
    parts.push(`<text x="${r3((ed.view.x0 + ed.view.x1) / 2)}" y="${r3(ed.view.z0 + 1)}" text-anchor="middle" font-size="${px(14)}" fill="currentColor">Kein Dach – rechts eine Dachform wählen.</text>`);
    return parts.join("");
  }
  const col = isHex(roof.color) ? roof.color : "#9a4a36";
  // Dachflächen: je Teil (niedrige zuerst), Seiten unterschiedlich hell
  const sorted = [...model.parts].sort((a, b) => a.width - b.width);
  for (const fr of sorted) {
    const L = fr.length / 2;
    const W = fr.width / 2;
    const Q = (s, t) => [fr.center[0] + s * fr.u[0] + t * fr.v[0], fr.center[1] + s * fr.u[1] + t * fr.v[1]];
    const [hipLo, hipHi] = fr.hipEnds;
    const rLo = hipLo ? Math.max(0, L - W) : L;
    const rHi = hipHi ? Math.max(0, L - W) : L;
    const faces = [];
    if (roof.type === "gable" || roof.type === "hip") {
      faces.push([[Q(-L, -W), Q(L, -W), Q(rHi, 0), Q(-rLo, 0)], 0.55]);
      faces.push([[Q(-L, W), Q(L, W), Q(rHi, 0), Q(-rLo, 0)], 0.75]);
      if (hipLo) faces.push([[Q(-L, -W), Q(-L, W), Q(-rLo, 0)], 0.65]);
      if (hipHi) faces.push([[Q(L, -W), Q(L, W), Q(rHi, 0)], 0.65]);
    } else faces.push([[Q(-L, -W), Q(L, -W), Q(L, W), Q(-L, W)], 0.6]);
    for (const [poly, op] of faces) parts.push(`<polygon data-kind="roofface" points="${poly.map(P).join(" ")}" fill="${col}" fill-opacity="${op}" stroke="${col}" stroke-width="${px(1.5)}"/>`);
    if (roof.type === "gable" || roof.type === "hip") parts.push(`<line x1="${P(Q(-rLo, 0)).split(",")[0]}" y1="${P(Q(-rLo, 0)).split(",")[1]}" x2="${P(Q(rHi, 0)).split(",")[0]}" y2="${P(Q(rHi, 0)).split(",")[1]}" stroke="#fff" stroke-opacity=".95" stroke-width="${px(2.5)}" pointer-events="none"/>`);
  }
  // Himmelsrichtung
  const north = ((Number(ed.b.settings?.north) || 0) * Math.PI) / 180;
  const xs = model.parts.flatMap((fr) => [fr.center[0] - fr.length, fr.center[0] + fr.length]);
  const zs = model.parts.flatMap((fr) => [fr.center[1] - fr.length, fr.center[1] + fr.length]);
  const nc = [Math.min(...xs) + 0.3, Math.min(...zs) + 0.3];
  const nd = [Math.sin(north), -Math.cos(north)];
  const tip = [nc[0] + nd[0] * 0.9, nc[1] + nd[1] * 0.9];
  parts.push(`<g pointer-events="none"><line x1="${r3(nc[0])}" y1="${r3(nc[1])}" x2="${r3(tip[0])}" y2="${r3(tip[1])}" stroke="#e53935" stroke-width="${px(3)}"/><circle cx="${r3(tip[0])}" cy="${r3(tip[1])}" r="${px(4)}" fill="#e53935"/><text x="${r3(tip[0] + nd[0] * 0.4)}" y="${r3(tip[1] + nd[1] * 0.4 + px(4))}" text-anchor="middle" font-size="${px(13)}" font-weight="700" fill="#e53935">N</text></g>`);
  // Dinge auf dem Dach
  for (const it of roof.items ?? []) {
    const sel = ed.sel?.kind === "roofitem" && ed.sel.id === it.id;
    const stroke = sel ? "#03a9f4" : "#fff";
    if (it.type === "pv") {
      const lay = pvLayout(model, it);
      // Module, die nicht auf die Fläche passen (über First/Kehle/Rand), rot
      const cell = lay.panels.map((p, i) => `<polygon points="${rectCorners(p, lay.along, lay.w, lay.l * lay.cos).map(P).join(" ")}" fill="${lay.fits[i] ? "#1c3a6b" : "#e53935"}" fill-opacity="${lay.fits[i] ? 1 : 0.45}" stroke="#8fb3e8" stroke-width="${px(0.8)}"/>`).join("");
      parts.push(`<g data-kind="roofitem" data-id="${esc(it.id)}" style="cursor:move">${cell}<polygon points="${rectCorners(lay.center, lay.along, lay.size[0] + 0.1, lay.size[1] + 0.1).map(P).join(" ")}" fill="transparent" stroke="${stroke}" stroke-opacity="${sel ? 1 : 0.5}" stroke-width="${px(sel ? 3 : 1)}"/></g>`);
      if (sel) parts.push(`<text x="${r3(it.x)}" y="${r3(it.z - lay.size[1] / 2 - px(8))}" text-anchor="middle" font-size="${px(12)}" fill="#03a9f4">${lay.count} von ${lay.panels.length} Modulen passen</text>`);
    } else {
      const def = ROOF_ITEMS[it.type] ?? ROOF_ITEMS.chimney;
      const w = Number(it.w) || def.w;
      const d = it.type === "skylight" ? (Number(it.l) || def.l) * (model ? Math.cos(Math.atan(model.tan)) : 1) : Number(it.d) || def.d;
      const fill = it.type === "chimney" ? (isHex(it.color) ? it.color : "#9c5a44") : "#9fd3f0";
      parts.push(`<polygon data-kind="roofitem" data-id="${esc(it.id)}" points="${rectCorners([it.x, it.z], itemAxis(model, it), w, d).map(P).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${px(sel ? 3 : 1.5)}" style="cursor:move"/>`);
    }
  }
  return parts.join("");
}

/** Zeiger gedrückt in der Dach-Ebene. Gibt einen Ziehvorgang zurück (oder null). */
export function roofStartDrag(ed, ev, p) {
  const t = ev.target.closest("[data-kind]");
  const tool = ed.tool;
  if (tool !== "select") {
    const model = roofModel(ed.b);
    if (!roofSurfaceAt(model, p)) {
      ed._toast("Dort ist kein Dach – auf eine Dachfläche tippen.");
      return null;
    }
    const grid = ed.b.settings?.grid ?? 0.05;
    const q = [r3(Math.round(p[0] / grid) * grid), r3(Math.round(p[1] / grid) * grid)];
    const def = ROOF_ITEMS[tool];
    const it = { id: newId(tool === "pv" ? "pv" : tool, allIds(ed.b)), type: tool, x: q[0], z: q[1], ...(tool === "pv" ? { cols: def.cols, rows: def.rows, orient: def.orient } : tool === "chimney" ? { w: def.w, d: def.d, h: def.h, rotation: 0 } : { w: def.w, l: def.l }) };
    ed.changeRoof((roof) => {
      roof.items = [...(roof.items ?? []), it];
    });
    ed.sel = { kind: "roofitem", id: it.id };
    ed.tool = "select";
    ed.renderBar();
    ed.renderProps();
    ed.render();
    return { mode: "roofitem", id: it.id, off: [0, 0], first: false };
  }
  if (t?.dataset.kind === "roofitem") {
    const it = (ed.b.settings.roof?.items ?? []).find((x) => x.id === t.dataset.id);
    ed.sel = { kind: "roofitem", id: it.id };
    ed.renderProps();
    ed.render();
    return { mode: "roofitem", id: it.id, off: [p[0] - it.x, p[1] - it.z], first: true };
  }
  if (ed.sel) {
    ed.sel = null;
    ed.renderProps();
    ed.render();
  }
  return { mode: "pan", sx: ev.clientX, sz: ev.clientY, tx: ed.tx, tz: ed.tz };
}

/** Ziehen eines Dach-Elements (aufs Raster). */
export function roofMoveDrag(ed, drag, p) {
  const grid = ed.b.settings?.grid ?? 0.05;
  const x = r3(Math.round((p[0] - drag.off[0]) / grid) * grid);
  const z = r3(Math.round((p[1] - drag.off[1]) / grid) * grid);
  const it = (ed.b.settings.roof?.items ?? []).find((y) => y.id === drag.id);
  if (!it || (it.x === x && it.z === z)) return;
  ed.changeRoof((roof) => Object.assign(roof.items.find((y) => y.id === drag.id), { x, z }), { merge: !drag.first });
  drag.first = false;
}

/** Eigenschaften rechts: Dach (nichts gewählt) oder das gewählte Element. */
export function roofProps(ed, el, pad, bindPad) {
  const roof = roofSettings(ed.b.settings);
  const raw = ed.b.settings.roof ?? {};
  const model = roofModel(ed.b);
  const sel = ed.sel?.kind === "roofitem" ? (raw.items ?? []).find((x) => x.id === ed.sel.id) : null;
  const num = (key, label, value, step = 0.05, extra = "") => `<div><label>${label}</label><input type="number" step="${step}" data-rn="${key}" value="${value ?? ""}"${extra}></div>`;
  const bindColor = (apply) => {
    const set = (key, v) => {
      ed.changeRoof((r) => apply(r, key, v));
      ed.renderProps();
    };
    el.querySelectorAll("[data-rcolor]").forEach((inp) => inp.addEventListener("change", () => set(inp.dataset.rcolor, inp.value)));
    el.querySelectorAll("[data-rcolor-reset]").forEach((b) => b.addEventListener("click", () => set(b.dataset.rcolorReset, null)));
    el.querySelectorAll("[data-rswatch]").forEach((b) => b.addEventListener("click", () => set(b.dataset.rswatch, b.dataset.c)));
  };
  const setKey = (obj, k, v) => {
    if (v === null || v === "" || v === undefined) delete obj[k];
    else obj[k] = v;
  };
  if (sel) {
    const name = ROOF_ITEMS[sel.type]?.name ?? sel.type;
    const flat = !roofSurfaceAt(model, [sel.x, sel.z])?.out;
    let body = "";
    if (sel.type === "pv") {
      const lay = pvLayout(model, sel);
      const n = lay.count < lay.panels.length ? `${lay.count} von ${lay.panels.length} Modulen passen (rot = über First, Kehle oder Rand – Feld verschieben)` : `${lay.count} Module`;
      body = `<div class="row2">${num("cols", "Spalten (nebeneinander)", sel.cols ?? 1, 1, ' min="1" max="30"')}${num("rows", "Reihen (die Neigung hinauf)", sel.rows ?? 1, 1, ' min="1" max="15"')}</div>
        <label>Module</label><select data-rs="orient"><option value="portrait"${sel.orient !== "landscape" ? " selected" : ""}>hochkant (1,0 × 1,7 m)</option><option value="landscape"${sel.orient === "landscape" ? " selected" : ""}>quer (1,7 × 1,0 m)</option></select>
        ${flat ? num("rotation", "Drehung (°) auf dem Flachdach", sel.rotation ?? 0, 15) : ""}
        <p class="muted">${n} · richtet sich nach der Dachfläche unter der Mitte, Reihe 1 unten an der Traufe.</p>`;
    } else if (sel.type === "chimney") {
      body = `<div class="row3">${num("w", "Breite", sel.w)}${num("d", "Tiefe", sel.d)}${num("h", "über Dach", sel.h ?? ROOF_ITEMS.chimney.h)}</div>
        ${num("rotation", "Drehung (°)", sel.rotation ?? 0, 15)}
        ${colorField("color", "Farbe", sel.color)}
        ${textureField("texture", "Textur", sel.texture, "w")}`;
    } else {
      body = `<div class="row2">${num("w", "Breite (m)", sel.w)}${num("l", "Länge die Neigung hinauf (m)", sel.l)}</div>`;
    }
    el.innerHTML = `<h3>${esc(name)}</h3>${body}<p class="muted">Ziehen verschiebt, Pfeiltasten schieben (Umschalt = 1 cm).</p>${pad()}
      <div class="btns"><button data-ract="dup">Duplizieren</button><button data-ract="del" class="danger">Löschen</button></div>`;
    const upd = (fn) => {
      ed.changeRoof((r) => fn(r.items.find((y) => y.id === sel.id)));
      ed.renderProps();
    };
    el.querySelectorAll("[data-rn]").forEach((inp) => inp.addEventListener("change", () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      const k = inp.dataset.rn;
      upd((it) => (it[k] = k === "cols" || k === "rows" ? Math.max(1, Math.round(v)) : k === "rotation" ? ((v % 360) + 360) % 360 : Math.max(0, v)));
    }));
    el.querySelectorAll("[data-rs]").forEach((inp) => inp.addEventListener("change", () => upd((it) => (it[inp.dataset.rs] = inp.value))));
    el.querySelectorAll("[data-tex]").forEach((inp) => inp.addEventListener("change", () => upd((it) => setKey(it, "texture", inp.value))));
    bindColor((r, key, v) => setKey(r.items.find((y) => y.id === sel.id), key, v));
    el.querySelector("[data-ract=del]").addEventListener("click", () => ed.deleteSelection());
    el.querySelector("[data-ract=dup]").addEventListener("click", () => {
      const copy = { ...structuredClone(sel), id: newId(sel.type, allIds(ed.b)), x: r3(sel.x + 0.5), z: r3(sel.z + 0.5) };
      ed.changeRoof((r) => r.items.push(copy));
      ed.sel = { kind: "roofitem", id: copy.id };
      ed.renderProps();
    });
    bindPad();
    return;
  }
  const items = raw.items ?? [];
  const legacy = !items.some((x) => x.type === "pv") && (raw.solar_arrays?.length || Object.values(raw.solar ?? {}).some((v) => Number(v) > 0));
  const count = (type) => items.filter((x) => x.type === type).length;
  el.innerHTML = `<h3>Dach</h3>
    <label>Dachform</label><select data-rr="type">${ROOF_TYPES.map(([k, n]) => `<option value="${k}"${k === roof.type ? " selected" : ""}>${n}</option>`).join("")}</select>
    <div class="row2">${num("pitch", "Neigung (°)", roof.pitch, 1, ' min="5" max="60"')}${num("overhang", "Überstand (m)", roof.overhang, 0.05, ' min="0" max="1.5"')}</div>
    <div class="row2"><div><label>First</label><select data-rr="direction">${[["auto", "lange Seite"], ["x", "Ost–West im Plan"], ["z", "Nord–Süd im Plan"]].map(([k, n]) => `<option value="${k}"${k === roof.direction ? " selected" : ""}>${n}</option>`).join("")}</select></div>
      <div><label>Flügel-Ende</label><select data-rr="wing_end"><option value="gable"${roof.wing_end !== "hip" ? " selected" : ""}>Giebel</option><option value="hip"${roof.wing_end === "hip" ? " selected" : ""}>Walm</option></select></div></div>
    <label>Norden im Plan</label><select data-north>${[[0, "oben"], [90, "rechts"], [180, "unten"], [270, "links"]].map(([v, n]) => `<option value="${v}"${v === (Number(ed.b.settings?.north) || 0) ? " selected" : ""}>${n}</option>`).join("")}</select>
    ${colorField("color", "Dachfarbe", roof.color)}
    ${textureField("texture", "Dachdeckung (Textur)", roof.texture, "r")}
    ${colorField("gable_color", "Giebel: Farbe (Standard = Außenwand)", roof.gable_color)}
    ${textureField("gable_texture", "Giebel: Textur", roof.gable_texture, "w")}
    <p class="muted">Auf dem Dach: ${count("pv")} PV-Felder · ${count("chimney")} Kamine · ${count("skylight")} Dachfenster. Werkzeug oben wählen und aufs Dach tippen.</p>
    ${legacy ? `<p class="muted">PV ist noch nach Himmelsrichtung eingetragen (Zahnrad → Haus &amp; Wetter).</p><div class="btns"><button data-ract="legacy">Bisherige PV hier verschiebbar machen</button></div>` : ""}`;
  const save = (fn) => {
    ed.changeRoof(fn);
    ed.renderProps();
  };
  el.querySelectorAll("[data-rr]").forEach((inp) => inp.addEventListener("change", () => save((r) => (r[inp.dataset.rr] = inp.value))));
  el.querySelectorAll("[data-rn]").forEach((inp) => inp.addEventListener("change", () => {
    const v = Number(inp.value);
    if (Number.isFinite(v)) save((r) => (r[inp.dataset.rn] = v));
  }));
  el.querySelectorAll("[data-tex]").forEach((inp) => inp.addEventListener("change", () => save((r) => setKey(r, inp.dataset.tex, inp.value))));
  el.querySelector("[data-north]").addEventListener("change", (ev) => {
    ed.undoStack.push(JSON.stringify(ed.b));
    ed.b.settings.north = Number(ev.target.value);
    ed.dirty = true;
    ed.render();
    ed.renderBar();
    ed._sync3d();
  });
  bindColor((r, key, v) => setKey(r, key, v));
  el.querySelector("[data-ract=legacy]")?.addEventListener("click", () => {
    const list = legacyPvItems(model, Number(ed.b.settings?.north) || 0);
    if (!list.length) return ed._toast("Keine PV-Module gefunden, die aufs Dach passen.");
    const ids = allIds(ed.b);
    save((r) => {
      r.items = [...(r.items ?? []), ...list.map((it) => {
        const id = newId("pv", ids);
        ids.add(id);
        return { id, ...it };
      })];
      delete r.solar;
      delete r.solar_arrays;
    });
    ed._toast(`${list.length} PV-Felder übernommen – jetzt einzeln verschiebbar.`);
  });
}
