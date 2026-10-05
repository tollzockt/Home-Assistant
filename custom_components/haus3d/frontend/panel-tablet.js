// Tablet-Bedienung (Mixin für Haus3DPanel): Rad-Menüs mit Finger-Drehen, Ecken ohne Überdeckung,
// Blickwinkel je Etage, Wandtablet (Kiosk, Bildschirm anlassen), Ruhemodus und Dimmen.

import { VIEW_PRESETS, normalizeViews, poseInBox } from "./camera.js";
import { WHEEL_VISIBLE, labelPlace, pointerAngle, rotateWheel, wheelFling, wheelPlusAngle, wheelPositions } from "./hud.js";
import { idleState, inTimeRange, normalizeIdle } from "./perf.js";
import { LONG_PRESS_MS, esc } from "./panel-util.js";

export const TabletMethods = {
  /**
   * Rad-Menü: weißer Knopf, darüber 4 Bubbles im Viertelkreis und am Ende fest das „+“ zum Hinzufügen.
   * Mehr Einträge lassen sich wie ein Rad durchdrehen (Mausrad, Wischen oder die kleinen Pfeile).
   */
  _wheel(box, side, all, icon, title) {
    // während der Finger dreht, nicht neu aufbauen (sonst verschwindet das Element unter dem Finger)
    if (box._dragging) return;
    const key = `_wheel_${side}`;
    const st = (this[key] ??= { open: false, offset: 0 });
    const plus = all.find((it) => it.plus);
    const items = all.filter((it) => !it.plus);
    const n = items.length;
    st.offset = n > WHEEL_VISIBLE ? ((Math.round(st.offset) % n) + n) % n : 0;
    const R = 170;
    const pos = (angle) => {
      const a = (angle * Math.PI) / 180;
      return [(4 + Math.sin(a) * R).toFixed(1), (4 + Math.cos(a) * R).toFixed(1)];
    };
    const style = (angle, opacity = 1) => {
      const [x, y] = pos(angle);
      return `${side}:${x}px; bottom:${y}px; --o:${opacity}`;
    };
    const layout = wheelPositions(n, st.offset);
    const bubble = (it, attr, angle, opacity) => `<button class="bub${opacity > 0 ? " vis" : ""}${it.on ? " on" : ""}${it.plus ? " plus" : ""}" ${attr} title="${esc(it.name)}" style="${style(angle, opacity)}"><ha-icon icon="${esc(it.icon)}"></ha-icon><span class="lab ${labelPlace(angle)}">${esc(it.name)}</span></button>`;
    box.classList.toggle("open", st.open);
    box.classList.toggle("turnable", n > WHEEL_VISIBLE);
    box.innerHTML = `<button class="fab" title="${title}${n > WHEEL_VISIBLE ? ` – ${n} Einträge, mit dem Finger drehen` : ""}"><ha-icon icon="${st.open ? "mdi:close" : icon}"></ha-icon></button>` +
      items.map((it, i) => bubble(it, `data-i="${i}"`, layout[i].angle, layout[i].opacity)).join("") +
      (plus ? bubble(plus, "data-plus", wheelPlusAngle(n), 1) : "");
    const redraw = () => this._wheel(box, side, side === "right" ? this._functionItems() : this._quickItems(), icon, title);
    box.querySelector(".fab").addEventListener("click", () => {
      st.open = !st.open;
      // nur ein Rad gleichzeitig offen (auf schmalen Bildschirmen überlappen sie sonst)
      const other = side === "left" ? "right" : "left";
      if (st.open && this[`_wheel_${other}`]?.open) {
        this[`_wheel_${other}`].open = false;
        this._renderWheels();
      } else redraw();
    });
    box.querySelector("[data-plus]")?.addEventListener("click", () => {
      if (!this._wheelDragged) plus.run();
    });
    box.querySelectorAll(".bub[data-i]").forEach((b) => {
      let long = false;
      let start = null;
      const cancel = () => {
        clearTimeout(box._longTimer);
        box._longTimer = null;
      };
      b.addEventListener("pointerdown", (ev) => {
        long = false;
        start = [ev.clientX, ev.clientY];
        cancel();
        const it = items[Number(b.dataset.i)];
        if (it.entity) box._longTimer = setTimeout(() => {
          long = true;
          navigator.vibrate?.(15);
          this._moreInfo(it.entity);
        }, 550);
      });
      b.addEventListener("pointermove", (ev) => {
        if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 10) cancel();
      });
      b.addEventListener("pointerup", cancel);
      b.addEventListener("pointerleave", cancel);
      b.addEventListener("pointercancel", cancel);
      b.addEventListener("contextmenu", (ev) => ev.preventDefault());
      b.addEventListener("click", () => {
        if (long || this._wheelDragged) return;
        items[Number(b.dataset.i)].run();
        // Umschalter neu zeichnen (an/aus), das Rad bleibt offen
        if (side === "right") redraw();
      });
    });
    // Lage stufenlos setzen (beim Drehen), ohne neu aufzubauen
    box._place = (offset) => {
      const lay = wheelPositions(n, offset);
      box.querySelectorAll(".bub[data-i]").forEach((b) => {
        const p = lay[Number(b.dataset.i)];
        const [x, y] = pos(p.angle);
        b.style.setProperty(side, `${x}px`);
        b.style.bottom = `${y}px`;
        b.style.setProperty("--o", String(p.opacity));
        b.classList.toggle("vis", p.opacity > 0);
        b.querySelector(".lab").className = `lab ${labelPlace(p.angle)}`;
      });
    };
    box._ctx = { st, n, side, redraw };
    box._turn = (d) => {
      // Drehen bricht einen angefangenen Langdruck ab
      clearTimeout(box._longTimer);
      const next = rotateWheel(st.offset, d, n);
      if (next === st.offset) return;
      st.offset = next;
      redraw();
    };
    if (!box._wheelBound) {
      box._wheelBound = true;
      box.addEventListener("wheel", (ev) => {
        if (!box.classList.contains("open")) return;
        ev.preventDefault();
        const now = performance.now();
        if (now - (box._lastTurn ?? 0) < 120) return; // Touchpads liefern viele kleine Schritte
        box._lastTurn = now;
        box._turn?.(ev.deltaY > 0 ? 1 : -1);
      }, { passive: false });
      this._bindWheelDrag(box);
    }
  },

  /**
   * Rad mit dem Finger drehen: die Bubbles folgen dem Winkel des Fingers um den Knopf, nach dem Loslassen
   * läuft das Rad mit Schwung aus und rastet ein. Ein kurzer Tipp bleibt ein Tipp.
   */
  _bindWheelDrag(box) {
    const step = 90 / WHEEL_VISIBLE;
    let g = null;
    const center = () => {
      const r = box.getBoundingClientRect();
      return [box._ctx.side === "right" ? r.left - 32 : r.left + 32, r.top - 32];
    };
    box.addEventListener("pointerdown", (ev) => {
      const ctx = box._ctx;
      this._wheelDragged = false;
      if (!ctx || !box.classList.contains("open") || ctx.n <= WHEEL_VISIBLE || ev.target.closest(".fab")) return;
      const [cx, cy] = center();
      g = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, cx, cy, a0: pointerAngle(ctx.side, cx, cy, ev.clientX, ev.clientY), off0: ctx.st.offset, off: ctx.st.offset, samples: [], drag: false };
    });
    box.addEventListener("pointermove", (ev) => {
      if (!g || ev.pointerId !== g.id) return;
      if (!g.drag) {
        if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 6) return;
        g.drag = true;
        box._dragging = true;
        this._wheelDragged = true;
        clearTimeout(box._longTimer);
        box.classList.add("dragging");
        try {
          box.setPointerCapture(ev.pointerId);
        } catch {
          /* egal */
        }
      }
      const a = pointerAngle(box._ctx.side, g.cx, g.cy, ev.clientX, ev.clientY);
      g.off = g.off0 - (a - g.a0) / step;
      const now = performance.now();
      g.samples.push([now, g.off]);
      while (g.samples.length > 2 && now - g.samples[0][0] > 90) g.samples.shift();
      box._place(g.off);
    });
    const end = (ev) => {
      if (!g || ev.pointerId !== g.id) return;
      const gest = g;
      g = null;
      if (!gest.drag) return;
      const ctx = box._ctx;
      const s = gest.samples;
      const v = s.length > 1 ? (s.at(-1)[1] - s[0][1]) / Math.max(1, s.at(-1)[0] - s[0][0]) : 0;
      const target = ev.type === "pointercancel" ? Math.round(gest.off) : wheelFling(gest.off, v);
      // auslaufen lassen und einrasten
      const from = gest.off;
      const t0 = performance.now();
      const dur = Math.min(450, 160 + Math.abs(target - from) * 90);
      const anim = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = 1 - (1 - k) ** 3;
        box._place(from + (target - from) * e);
        if (k < 1) return requestAnimationFrame(anim);
        box.classList.remove("dragging");
        box._dragging = false;
        ctx.st.offset = ((target % ctx.n) + ctx.n) % ctx.n;
        ctx.redraw();
        setTimeout(() => (this._wheelDragged = false), 0);
      };
      requestAnimationFrame(anim);
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  },

  _queueLayout() {
    if (this._layoutQueued) return;
    this._layoutQueued = true;
    // Timer statt requestAnimationFrame: rAF ruht in manchen WebViews, solange nichts gezeichnet wird
    setTimeout(() => {
      this._layoutQueued = false;
      this._layoutCorners();
    }, 30);
  },

  /**
   * Etagenleiste unter die Karten schieben, wenn sie sich sonst überdecken; reicht der Platz bis zum
   * Funktionsrad nicht, wandert sie an den linken Rand.
   */
  _layoutCorners() {
    const bar = this._els?.floorbar;
    const cards = this._els?.cards;
    if (!bar || bar.hidden || !cards) return;
    bar.classList.remove("below", "leftside");
    bar.style.top = "";
    const stage = this._els.stage.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    let bottom = stage.top;
    for (const c of cards.children) {
      this._layoutObs?.observe(c); // Auf-/Zuklappen einer Karte meldet sich so selbst
      if (c.hidden || !c.offsetParent) continue;
      const r = c.getBoundingClientRect();
      // nur Karten, die horizontal über der Leiste liegen
      if (r.right > b.left - 4 && r.left < b.right + 4) bottom = Math.max(bottom, r.bottom);
    }
    if (bottom + 8 <= b.top) return;
    const top = bottom + 8 - stage.top;
    // Platz bis zum Bogen des aufgeklappten Funktionsrads (Radius 170 + Bubble) frei halten
    if (top + b.height <= stage.height - 250) {
      bar.classList.add("below");
      bar.style.top = `${top}px`;
    } else {
      // sonst oben links unter dem Hinweis-Banner
      bar.classList.add("leftside");
      bar.style.top = `${(this._els.stage.classList.contains("alerting") ? 76 : 12) + (this.hasAttribute("kiosk") ? 52 : 0)}px`;
    }
  },

  /** Ruhemodus und Dimmen (Wandtablet): Zeitgeber alle 5 s, nur wenn eingestellt. */
  _setupIdle() {
    this._idleCfg = normalizeIdle(this._settings.kiosk, { kiosk: this.hasAttribute("kiosk") });
    this._lastInput = this._lastInput ?? Date.now();
    const on = this._idleCfg.idleMs > 0 || this._idleCfg.dimFrom !== null;
    if (on && !this._idleTimer) this._idleTimer = setInterval(() => this._idleTick(), 5000);
    if (!on && this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
    if (!on) this._wake();
  },

  _idleTick(now = Date.now()) {
    const c = this._idleCfg;
    if (!c || !this._building) return;
    if (!this._idle && !this._editor && idleState(this._lastInput, now, c.idleMs) === "idle") this._goIdle();
    // Dimmen im Zeitraum, sobald eine Minute (bzw. die Ruhezeit) nichts berührt wurde
    const d = new Date(now);
    const quiet = now - this._lastInput >= Math.max(60000, c.idleMs || 0);
    const dim = inTimeRange(d.getHours() * 60 + d.getMinutes(), c.dimFrom, c.dimTo) && quiet && !this._editor;
    if (dim && !this._dimmer) {
      const el = document.createElement("div");
      el.className = "dimmer";
      el.style.opacity = String(c.dimLevel);
      // erster Tipp weckt nur den Bildschirm
      const wake = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        this._wake();
      };
      el.addEventListener("pointerdown", wake);
      el.addEventListener("click", wake);
      this.shadowRoot.appendChild(el);
      this._dimmer = el;
    } else if (!dim && this._dimmer && !quiet) this._wake();
  },

  /** In Ruhe: Fenster und Menüs schließen, Startetage mit ihrer Ansicht, Bild einfrieren. */
  _goIdle() {
    this._idle = true;
    this._closePopup();
    this._closeDialog();
    this._selectRoom(null);
    for (const side of ["left", "right"]) if (this[`_wheel_${side}`]) this[`_wheel_${side}`].open = false;
    this._renderWheels();
    const start = this._startFloor ?? this._settings.kiosk?.startFloor;
    if (start && start !== this._filter && (start === "all" || this._building.floors.some((f) => f.id === start))) this._setFilter(start);
    else {
      const saved = this._views()[this._filter];
      if (saved && this._scene && poseInBox(saved, this._scene.viewBox())) this._scene.setView(saved);
    }
    setTimeout(() => this._idle && this._scene?.setPerf({ frozen: true }), 600);
  },

  /** Aufwachen: Bild läuft wieder, Dimmen weg. */
  _wake() {
    this._lastInput = Date.now();
    if (this._idle) {
      this._idle = false;
      this._scene?.setPerf({ frozen: false });
    }
    this._dimmer?.remove();
    this._dimmer = null;
  },

  /** Gemerkte Ansicht je Etage (dieses Gerät): {floorId: {target, position}}. */
  _views() {
    try {
      const v = JSON.parse(localStorage.getItem("haus3d.views") ?? "{}");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  },

  _rememberView() {
    if (!this._scene || !this._building || this._editor) return;
    const v = this._views();
    v[this._filter] = this._scene.getView();
    this._store("haus3d.views", JSON.stringify(v));
  },

  _resetView() {
    const v = this._views();
    delete v[this._filter];
    this._store("haus3d.views", JSON.stringify(v));
    this._scene?.fitCamera();
    setTimeout(() => {
      clearTimeout(this._viewTimer);
      const w = this._views();
      delete w[this._filter];
      this._store("haus3d.views", JSON.stringify(w));
    }, 0);
  },

  /** Gespeicherte Blickwinkel (dieses Gerät, höchstens 6). */
  _savedViews(next) {
    if (next) this._store("haus3d.savedViews", JSON.stringify(normalizeViews(next)));
    try {
      return normalizeViews(JSON.parse(localStorage.getItem("haus3d.savedViews") ?? "[]"));
    } catch {
      return [];
    }
  },

  /** Chip-Leiste „Blickwinkel“ über dem Funktionsrad: feste Ansichten, gemerkte, „+ Merken“. */
  _viewChips() {
    this._closePopup();
    const el = document.createElement("div");
    el.className = "popup viewpop";
    const saved = this._savedViews();
    el.innerHTML = `<div class="head">Blickwinkel</div><div class="chiprow">${VIEW_PRESETS.map(([k, n]) => `<button data-preset="${k}">${n}</button>`).join("")}${saved.map((v, i) => `<button data-saved="${i}" class="saved"></button>`).join("")}<button class="add">+ Merken</button></div><div class="name" hidden><input maxlength="30" placeholder="Name der Ansicht"><button class="ok">Speichern</button></div>`;
    el.querySelectorAll("[data-saved]").forEach((b) => {
      const v = saved[Number(b.dataset.saved)];
      b.textContent = v.name;
      b.title = "Langes Drücken: löschen";
      let timer = null;
      b.addEventListener("pointerdown", () => {
        timer = setTimeout(() => {
          timer = null;
          this._savedViews(saved.filter((x) => x !== v));
          this._toast(`„${v.name}“ gelöscht`);
          this._viewChips();
        }, LONG_PRESS_MS);
      });
      b.addEventListener("pointerup", () => clearTimeout(timer));
      b.addEventListener("click", () => {
        if (timer === null && !b.isConnected) return;
        if (v.floor && v.floor !== this._filter) this._setFilter(v.floor);
        this._scene?.setView(v);
      });
    });
    el.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => this._scene?.viewPreset(b.dataset.preset, Number(this._building?.settings?.north) || 0)));
    const box = el.querySelector(".name");
    el.querySelector(".add").addEventListener("click", () => {
      box.hidden = false;
      box.querySelector("input").focus();
    });
    const save = () => {
      const name = box.querySelector("input").value.trim() || `Ansicht ${saved.length + 1}`;
      this._savedViews([...saved, { name, floor: this._filter, ...this._scene.getView() }]);
      this._toast(`Ansicht „${name}“ gemerkt`);
      this._viewChips();
    };
    box.querySelector(".ok").addEventListener("click", save);
    box.querySelector("input").addEventListener("keydown", (ev) => ev.key === "Enter" && save());
    el.addEventListener("click", (ev) => ev.stopPropagation());
    this._els.stage.appendChild(el);
    this._popup = el;
  },

  /** Vollbild umschalten (braucht einen Tipp, gibt es nicht überall). */
  _toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else (document.documentElement.requestFullscreen?.() ?? Promise.reject(new Error("nicht unterstützt"))).catch((err) => this._toast(`Vollbild nicht möglich: ${err.message ?? err}`));
  },

  /** Wandtablet: Kopfzeile, Bildschirm anlassen (nur über https), Startetage. */
  _applyKiosk() {
    const k = this._settings.kiosk ?? {};
    this.toggleAttribute("kiosk", this._kioskUrl || k.hideHeader === true);
    const want = k.wakeLock === true && "wakeLock" in navigator && window.isSecureContext && !document.hidden;
    if (want && !this._wakeLock) {
      navigator.wakeLock.request("screen").then((l) => {
        this._wakeLock = l;
        l.addEventListener?.("release", () => (this._wakeLock = null));
      }).catch(() => {});
    } else if (!want && this._wakeLock) {
      this._wakeLock.release().catch(() => {});
      this._wakeLock = null;
    }
  },
};
