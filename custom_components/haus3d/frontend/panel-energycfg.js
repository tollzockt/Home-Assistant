// Admin → Energie (Mixin für Haus3DPanel): Basis (Hausverbrauch, Netz mit Vorzeichen oder Bezug und
// Einspeisung getrennt) und Erweiterungen (PV-Anlage, Balkonkraftwerk, AC-Speicher, beliebig viele).
// Unten die Summen, wie sie die Energie-Karte zeigt.

import { SURPLUS_DEFAULTS, SHORT_CHOICES, formatPower, suggestEnergy } from "./energy.js";
import { SOURCE_TYPES, energyTotals, newSource, normalizeEnergy } from "./energymodel.js";
import { DEVICE_TEMPLATES, applyTemplate, templatesFor } from "./energytemplates.js";
import { esc, fmt } from "./panel-util.js";

export const EnergyCfgMethods = {
  _renderEnergyConfig(box) {
    const hass = this._hass;
    const raw = this._building?.settings?.energy ?? {};
    const e = normalizeEnergy(raw);
    e.extra = e.extra.map((x) => (typeof x === "string" ? { entity: x } : x));
    e.ueberschuss = { ...SURPLUS_DEFAULTS, ...(raw.ueberschuss ?? {}) };
    let gridMode = e.netz_bezug || e.netz_einspeisung ? "two" : "one";
    let found = null;
    const tplMsg = new Map(); // Quelle → Hinweis nach Vorlagenwahl
    const lang = hass.locale?.language;
    const opts = `<datalist id="en-all">${Object.keys(hass.states).filter((id) => /^(sensor|input_number|number)\./.test(id)).sort().map((id) => `<option value="${esc(id)}">${esc(hass.states[id].attributes.friendly_name ?? "")}</option>`).join("")}</datalist>`;
    const field = (attr, label, v, hint = "") => `<label class="en-row"><span>${label}</span><input list="en-all" ${attr} value="${esc(v ?? "")}" placeholder="– keine –"></label>${hint ? `<p class="hint sub">${hint}</p>` : ""}`;
    const summary = () => {
      const t = energyTotals(this._energyDraft(e, gridMode), hass);
      const p = (v) => (Number.isFinite(v) ? formatPower(v, lang) : "–");
      const rows = [
        ["Hausverbrauch", `${p(t.verbrauch)}${t.verbrauchCalc && Number.isFinite(t.verbrauch) ? " (berechnet)" : ""}`],
        ["Netzbezug", p(t.bezug)],
        ["Einspeisung", p(t.einspeisung)],
        ["Erzeugung gesamt", p(t.erzeugung)],
        ["Ertrag heute gesamt", Number.isFinite(t.ertrag) ? `${fmt(t.ertrag, 2)} kWh` : "–"],
        ...(t.speicher ? [["Speicher", `${Number.isFinite(t.speicher.soc) ? `${fmt(t.speicher.soc, 0)} %` : "–"} · ${Number.isFinite(t.speicher.power) ? (t.speicher.power > 0 ? `lädt ${p(t.speicher.power)}` : t.speicher.power < 0 ? `entlädt ${p(-t.speicher.power)}` : "ruht") : "–"}`]] : []),
      ];
      const el = box.querySelector(".en-sum");
      if (el) el.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("");
    };
    const render = () => {
      box.innerHTML = `<div class="btns left"><button class="en-ha"><ha-icon icon="mdi:import"></ha-icon> Aus HA-Energie übernehmen</button></div>
        <div class="en-found"></div>
        <h4>Haus</h4>
        ${field('data-core="haus"', "Hausverbrauch", e.haus, "Leer = wird aus Erzeugung, Netz und Speicher berechnet.")}
        <h4>Netz</h4>
        <div class="seg en-grid"><button data-gm="one" class="${gridMode === "one" ? "sel" : ""}">Ein Sensor (±)</button><button data-gm="two" class="${gridMode === "two" ? "sel" : ""}">Bezug und Einspeisung getrennt</button></div>
        ${gridMode === "one" ? `${field('data-core="netz"', "Netz (+ Bezug / − Einspeisung)", e.netz)}<label class="chkrow"><input type="checkbox" data-inv="netz_invert"${e.netz_invert ? " checked" : ""}> Vorzeichen umkehren</label>` : `${field('data-core="netz_bezug"', "Netzbezug", e.netz_bezug)}${field('data-core="netz_einspeisung"', "Einspeisung", e.netz_einspeisung)}`}
        <h4>Erweiterungen</h4>
        ${e.sources.length ? "" : `<p class="hint">Noch keine – PV-Anlage, Balkonkraftwerk oder AC-Speicher hinzufügen. Alle Erzeuger werden zusammengerechnet.</p>`}
        ${e.sources.map((s, i) => `<div class="src" data-i="${i}">
          <div class="srchead"><ha-icon icon="${SOURCE_TYPES.find(([t]) => t === s.type)[2]}"></ha-icon><input class="sname" data-sf="name" value="${esc(s.name)}"><small>${SOURCE_TYPES.find(([t]) => t === s.type)[1]}</small><button class="icon" data-srm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>
          <label class="en-row"><span>Gerät</span><select data-tpl><option value="">– anderes / selbst eintragen –</option>${templatesFor(s.type).map((t) => `<option value="${t.id}"${s.template === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
          ${tplMsg.has(s.id) ? `<p class="hint sub tplmsg">${esc(tplMsg.get(s.id))}</p>` : ""}
          ${field('data-sf="power"', s.type === "speicher" ? "Leistung (+ laden / − entladen)" : "Leistung", s.power)}
          ${s.type === "speicher" ? `${field('data-sf="soc"', "Ladestand (%)", s.soc)}<div class="row3"><div><label class="en-row"><span>Kapazität (kWh)</span><input type="number" data-sn="capacity" min="0" step="0.1" value="${s.capacity ?? ""}"></label></div><div><label class="en-row"><span>Reserve (%)</span><input type="number" data-sn="reserve" min="0" max="100" step="1" value="${s.reserve ?? 10}"></label></div></div><label class="chkrow"><input type="checkbox" data-sinv${s.invert ? " checked" : ""}> Vorzeichen umkehren</label>` : field('data-sf="energy"', "Ertrag heute (kWh)", s.energy)}
        </div>`).join("")}
        <div class="btns left">${SOURCE_TYPES.map(([t, n, ic]) => `<button data-add="${t}"><ha-icon icon="${ic}"></ha-icon> + ${n}</button>`).join("")}</div>
        <h4>Summe (wie auf der Karte)</h4>
        <div class="en-sum"></div>
        <h4>Überschuss-Ampel</h4>
        <div class="row3"><div><label class="en-row"><span>gut ab (W)</span><input type="number" data-sur="hoch" min="0" step="10" value="${e.ueberschuss.hoch}"></label></div><div><label class="en-row"><span>etwas ab (W)</span><input type="number" data-sur="mittel" min="0" step="10" value="${e.ueberschuss.mittel}"></label></div></div>
        <label class="en-row"><span>Eingeklappt</span><select data-kurz>${SHORT_CHOICES.map(([k, n]) => `<option value="${k}"${(e.kurz ?? "") === k ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <h4>Weitere Werte</h4>
        ${e.extra.map((x, i) => `<div class="en-row"><input data-extra-name="${i}" value="${esc(x.name ?? "")}" placeholder="Name"><input list="en-all" data-extra="${i}" value="${esc(x.entity ?? "")}"><button class="icon" data-rm="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button></div>`).join("")}
        ${opts}
        <div class="btns"><button class="en-add">+ Wert hinzufügen</button><button class="en-save primary">Speichern</button></div>`;
      const val = (i) => i.value.trim() || null;
      box.querySelectorAll("[data-core]").forEach((i) => i.addEventListener("change", () => {
        e[i.dataset.core] = val(i);
        summary();
      }));
      box.querySelector('[data-inv="netz_invert"]')?.addEventListener("change", (ev) => {
        e.netz_invert = ev.target.checked;
        summary();
      });
      box.querySelectorAll("[data-gm]").forEach((b) => b.addEventListener("click", () => {
        gridMode = b.dataset.gm;
        render();
      }));
      box.querySelectorAll(".src").forEach((el) => {
        const s = e.sources[Number(el.dataset.i)];
        el.querySelectorAll("[data-sf]").forEach((i) => i.addEventListener("change", () => {
          s[i.dataset.sf] = i.dataset.sf === "name" ? i.value.trim() || s.name : val(i);
          summary();
        }));
        el.querySelectorAll("[data-sn]").forEach((i) => i.addEventListener("change", () => {
          s[i.dataset.sn] = i.value === "" ? null : Number(i.value);
        }));
        el.querySelector("[data-tpl]").addEventListener("change", (ev) => {
          const tpl = DEVICE_TEMPLATES.find((t) => t.id === ev.target.value);
          const i = Number(el.dataset.i);
          if (!tpl) {
            e.sources[i] = { ...s, template: null };
            tplMsg.delete(s.id);
            return render();
          }
          const isDefault = /^(PV-Anlage|Balkonkraftwerk|AC-Speicher)( \d+)?$/.test(s.name ?? "");
          const res = applyTemplate(s, tpl, hass, isDefault ? s.name : null);
          e.sources[i] = res.source;
          tplMsg.set(s.id, res.found ? `${res.found} passende Entität${res.found > 1 ? "en" : ""} vorgeschlagen – bitte prüfen.` : res.platformSeen ? "Integration gefunden, aber keine passenden Sensoren – bitte selbst wählen." : `Keine Entitäten der Integration „${tpl.platforms[0]}“ gefunden – ist sie in Home Assistant eingerichtet?`);
          render();
          summary();
        });
        el.querySelector("[data-sinv]")?.addEventListener("change", (ev) => {
          s.invert = ev.target.checked;
          summary();
        });
      });
      box.querySelectorAll("[data-srm]").forEach((b) => b.addEventListener("click", () => {
        e.sources.splice(Number(b.dataset.srm), 1);
        render();
      }));
      box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
        e.sources.push(newSource(b.dataset.add, e.sources));
        render();
      }));
      box.querySelectorAll("[data-sur]").forEach((i) => i.addEventListener("change", () => (e.ueberschuss[i.dataset.sur] = i.value === "" ? SURPLUS_DEFAULTS[i.dataset.sur] : Number(i.value))));
      box.querySelector("[data-kurz]").addEventListener("change", (ev) => (e.kurz = ev.target.value));
      box.querySelectorAll("[data-extra]").forEach((i) => i.addEventListener("change", () => (e.extra[Number(i.dataset.extra)].entity = i.value.trim())));
      box.querySelectorAll("[data-extra-name]").forEach((i) => i.addEventListener("change", () => (e.extra[Number(i.dataset.extraName)].name = i.value.trim() || undefined)));
      box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
        e.extra.splice(Number(b.dataset.rm), 1);
        render();
      }));
      box.querySelector(".en-add").addEventListener("click", () => {
        e.extra.push({ entity: "" });
        render();
      });
      box.querySelector(".en-ha").addEventListener("click", async () => {
        let prefs = null;
        try {
          prefs = await hass.callWS({ type: "energy/get_prefs" });
        } catch {
          prefs = null;
        }
        found = Object.entries(suggestEnergy(prefs, hass))
          .filter(([key]) => ["netz", "haus_pv", "pv_zaehler", "akku_leistung", "akku_ladestand", "verbrauch"].includes(key))
          .map(([key, v]) => ({ key, ...v, checked: true }));
        drawFound();
      });
      box.querySelector(".en-save").addEventListener("click", async () => {
        const energy = this._energyDraft(e, gridMode);
        await this._saveBuildingSettings({ energy }, "Energie gespeichert.");
      });
      drawFound();
      summary();
    };
    const drawFound = () => {
      const fb = box.querySelector(".en-found");
      if (!found) return (fb.innerHTML = "");
      if (!found.length) return (fb.innerHTML = `<p class="hint">Im HA-Energie-Dashboard ist nichts eingerichtet – Werte bitte von Hand wählen.</p>`);
      fb.innerHTML = `<h4>Gefunden</h4>${found.map((f, i) => `<label class="chkrow"><input type="checkbox" data-f="${i}"${f.checked ? " checked" : ""}><span class="fl"></span></label>`).join("")}
        <div class="btns"><button class="f-no">Abbrechen</button><button class="f-ok primary">Übernehmen</button></div>`;
      fb.querySelectorAll("[data-f]").forEach((c) => {
        const f = found[Number(c.dataset.f)];
        c.nextElementSibling.textContent = `${f.label}: ${f.entity}`;
        c.addEventListener("change", () => (f.checked = c.checked));
      });
      fb.querySelector(".f-no").addEventListener("click", () => {
        found = null;
        drawFound();
      });
      fb.querySelector(".f-ok").addEventListener("click", () => {
        const src = (type) => e.sources.find((s) => s.type === type) ?? (e.sources.push(newSource(type, e.sources)), e.sources.at(-1));
        for (const f of found.filter((x) => x.checked)) {
          if (f.key === "netz") {
            gridMode = "one";
            e.netz = f.entity;
          } else if (f.key === "verbrauch") e.haus = f.entity;
          else if (f.key === "haus_pv") src("pv").power = f.entity;
          else if (f.key === "pv_zaehler") src("pv").energy = f.entity;
          else if (f.key === "akku_leistung") src("speicher").power = f.entity;
          else if (f.key === "akku_ladestand") src("speicher").soc = f.entity;
        }
        found = null;
        render();
        this._toast("Übernommen – zum Behalten „Speichern“ tippen.");
      });
    };
    render();
  },

  /** Zu speicherndes Energie-Objekt (neues Format; alte Felder geleert, damit nichts doppelt zählt). */
  _energyDraft(e, gridMode) {
    return {
      solar: null,
      einspeisung: null,
      akku_ladestand: null,
      akku_leistung: null,
      ertrag_heute: null,
      haus_pv: null,
      verbrauch: null,
      haus: e.haus ?? null,
      netz: gridMode === "one" ? e.netz ?? null : null,
      netz_invert: gridMode === "one" ? !!e.netz_invert : false,
      netz_bezug: gridMode === "two" ? e.netz_bezug ?? null : null,
      netz_einspeisung: gridMode === "two" ? e.netz_einspeisung ?? null : null,
      sources: e.sources.map((s) => ({ ...s })),
      extra: (e.extra ?? []).filter((x) => x.entity),
      kurz: e.kurz ?? "",
      ueberschuss: e.ueberschuss,
    };
  },
};

export const ENERGYCFG_STYLE = `
.src { border: 1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius: 12px; padding: 8px 10px; margin-bottom: 8px; }
.src .srchead { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.src .srchead .sname { flex: 1; font: inherit; font-weight: 600; padding: 6px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: inherit; }
.src .srchead .sname:focus { border-color: var(--divider-color, rgba(127,127,127,.4)); }
.src .srchead small { color: var(--secondary-text-color); }
.hint.sub { margin-top: -4px; }
.tplmsg { color: var(--primary-color, #03a9f4); }
.src [data-tpl] { width: 100%; min-height: 34px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: var(--card-background-color, #fff); color: inherit; font: inherit; }
.en-sum { display: grid; gap: 2px; font-size: 14px; }
.en-sum div { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px dashed var(--divider-color, rgba(127,127,127,.25)); }
.en-sum span { color: var(--secondary-text-color); }
.en-grid { margin-bottom: 8px; }
`;
