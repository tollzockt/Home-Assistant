// Aussehen des Panels (CSS im Shadow DOM). Eigene Datei, damit haus3d-panel.js übersichtlich bleibt.

export const PANEL_STYLE = `
:host {
  display: block;
  /* HA gibt dem Panel-Container keine Höhe vor: volle Fensterhöhe (dvh: mobile Adressleiste) */
  height: 100vh;
  height: 100dvh;
  background: var(--primary-background-color);
  color: var(--primary-text-color);
  font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
  -webkit-tap-highlight-color: transparent;
}
[hidden] { display: none !important; }
.hide-labels .label, .hide-devices .devs, .hide-devices .dev.free, .hide-climate .label .clim { display: none !important; }
.confirm-backdrop { position: absolute; inset: 0; z-index: 12; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
.confirm { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 16px; padding: 18px; width: min(380px, 100%); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.confirm .ct { font-size: 17px; font-weight: 600; line-height: 1.35; }
.confirm .cs { margin-top: 4px; font-size: 13px; color: var(--secondary-text-color); }
.confirm .cb { display: flex; gap: 10px; margin-top: 18px; }
.confirm .cb button { flex: 1; min-height: 56px; border-radius: 12px; border: none; font: inherit; font-size: 16px; cursor: pointer; background: var(--secondary-background-color, #eee); color: inherit; }
.confirm .cb .yes { background: var(--primary-color, #03a9f4); color: #fff; }
.confirm .cb .yes.danger { background: #d32f2f; }
.dialog-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.35); z-index: 10; display: flex; align-items: flex-start; justify-content: flex-end; padding: 8px; }
.dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; width: min(440px, 100%); max-height: calc(100% - 16px); overflow: auto; box-shadow: 0 8px 28px rgba(0,0,0,.4); }
.dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 6px 6px 16px; font-size: 17px; font-weight: 500; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.2)); }
.dialog-body { padding: 4px 16px 16px; }
.dialog h4 { margin: 14px 0 6px; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
.seg { display: flex; background: rgba(127,127,127,.15); border-radius: 10px; padding: 3px; gap: 3px; }
.seg button { flex: 1; border: none; background: none; color: inherit; font: inherit; padding: 8px; border-radius: 8px; cursor: pointer; min-height: 38px; }
.seg button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
.toggles label { display: flex; align-items: center; gap: 8px; min-height: 36px; cursor: pointer; font-size: 14px; }
.toggles input { width: 18px; height: 18px; accent-color: var(--primary-color, #03a9f4); }
.en-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 13px; }
.en-row span { width: 90px; flex: none; color: var(--secondary-text-color); }
.en-row input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.en-row input[data-extra-name] { flex: 0 0 90px; }
.dialog .btns { display: flex; gap: 8px; margin-top: 10px; }
.dialog .btns button { flex: 1; font: inherit; padding: 9px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; }
.dialog .btns .primary { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
.en-row .nstep { flex: none; min-width: 48px; min-height: 40px; font: inherit; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; }
.btns.left { justify-content: flex-start; }
.btns.left button { display: inline-flex; align-items: center; gap: 6px; }
.energy-cfg .row3 { display: flex; gap: 8px; }
.energy-cfg .row3 > div { flex: 1; min-width: 0; }
.energy-cfg .row3 .en-row span { width: auto; }
.chkrow small { margin-left: auto; color: var(--secondary-text-color); font-size: 12px; }
.chkrow .fl { overflow-wrap: anywhere; }
.sheet-backdrop { align-items: flex-end; justify-content: center; }
.dialog.sheet { width: min(520px, 100%); border-radius: 16px 16px 0 0; }
.sheet .dialog-head .seg { flex: 1; margin-right: 8px; }
.crow { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.crow input { width: 20px; height: 20px; margin: 0; flex: none; }
.crow ha-icon { --mdc-icon-size: 20px; color: var(--warning-color, #ff9800); flex: none; }
.crow .go { flex: 1; text-align: left; border: none; background: none; color: inherit; font: inherit; padding: 8px 0; cursor: pointer; }
.allok { display: flex; align-items: center; gap: 8px; color: var(--success-color, #43a047); font-weight: 500; }
.hint { font-size: 12px; color: var(--secondary-text-color); margin: 14px 0 0; }
.roompanel { position: absolute; left: 12px; top: 12px; width: min(320px, calc(100% - 24px)); max-height: 60%; overflow: auto; z-index: 4; touch-action: pan-y; overscroll-behavior: contain;
  background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.rp-head { display: flex; align-items: center; gap: 4px; padding: 4px 4px 0 8px; font-size: 16px; cursor: grab; user-select: none; touch-action: none; position: sticky; top: 0; z-index: 1; background: inherit; }
.rp-list { touch-action: pan-y; }
.rp-group { padding: 8px 14px 2px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary-text-color); }
.rp-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 12px 8px; }
.rp-actions button { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 12px; border-radius: 22px; border: 1px solid var(--divider-color, rgba(127,127,127,.35)); background: var(--secondary-background-color, rgba(127,127,127,.08)); color: inherit; font: inherit; font-size: 13px; cursor: pointer; --mdc-icon-size: 18px; }
.rp-actions button.on { background: #ffc107; color: #3b2a00; border-color: transparent; }
.rp-actions .seg { display: inline-flex; }
.rp-actions .seg button { border-radius: 0; padding: 0 10px; }
.rp-actions .seg button:first-child { border-radius: 22px 0 0 22px; }
.rp-actions .seg button:last-child { border-radius: 0 22px 22px 0; }
.rp-actions .seg button span { display: none; }
.rp-actions .stepper { display: inline-flex; align-items: center; gap: 4px; }
.rp-actions .stepper button { width: 44px; justify-content: center; padding: 0; font-size: 20px; }
.rp-actions .stepper .target { min-width: 64px; text-align: center; font-weight: 600; font-size: 15px; }
.rp-actions .stepper .target.pending { color: var(--primary-color, #03a9f4); }
.rp-actions .stepper .target.heating { color: #e65100; }
.rp-head b { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-head .grip { color: var(--secondary-text-color); --mdc-icon-size: 18px; }
.rp-check { display: flex; align-items: center; gap: 10px; padding: 6px 14px; min-height: 40px; font-size: 14px; }
.rp-check span { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.rp-check small { color: var(--secondary-text-color); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
.rp-check input { width: 20px; height: 20px; accent-color: var(--primary-color, #03a9f4); }
.rp-add { display: flex; gap: 6px; padding: 6px 14px; }
.rp-add input { flex: 1; min-width: 0; font: inherit; padding: 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.rp-add button, .rp-btns button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; min-height: 40px; }
.rp-btns { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 14px 14px; }
.rp-btns .primary { background: var(--primary-color, #03a9f4); color: #fff; border-color: transparent; }
/* Tablet und Touch: größere Ziele */
@media (pointer: coarse) {
  button.icon { width: 48px; height: 48px; }
  .floors button { min-height: 40px; padding: 8px 16px; font-size: 15px; }
  .dev { width: 42px; height: 42px; --mdc-icon-size: 22px; }
  .rp-row { min-height: 52px; }
  .rp-icon { width: 38px; height: 38px; }
  .toggles label { min-height: 44px; }
  .seg button { min-height: 44px; }
  .energy { font-size: 14px; }
  .energy .row { padding: 5px 0; }
}
.rp-sub { padding: 0 14px 6px; font-size: 12px; color: var(--secondary-text-color); }
.rp-row { display: flex; align-items: center; gap: 10px; padding: 6px 14px; min-height: 44px; cursor: pointer; user-select: none; --mdc-icon-size: 20px; }
.rp-row:hover { background: rgba(127,127,127,.1); }
.rp-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(127,127,127,.15); flex: none; }
.rp-icon.active { background: #ffc107; color: #3b2a00; }
.rp-icon.alert { background: var(--error-color, #db4437); color: #fff; }
.rp-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-state { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; }
.rp-empty { padding: 8px 14px 14px; color: var(--secondary-text-color); font-size: 13px; }
.wrap { display: flex; flex-direction: column; height: 100%; }
header {
  display: flex; align-items: center; gap: 8px;
  min-height: 56px; padding: 0 8px 0 4px;
  padding-top: env(safe-area-inset-top);
  background: var(--app-header-background-color, var(--primary-color));
  color: var(--app-header-text-color, #fff);
  border-bottom: var(--app-header-border-bottom, none);
  box-sizing: border-box; flex-wrap: wrap;
}
header .title { font-size: 20px; font-weight: 400; padding-left: 8px; white-space: nowrap; }
/* Statusleiste: Personen und Chips (Licht an, offen, Schlösser, Alarm, Alles zu) */
header .status { display: flex; align-items: center; gap: 6px; margin-right: auto; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 4px 0; }
header .status::-webkit-scrollbar { display: none; }
.status .chips, .status .people { display: flex; gap: 6px; align-items: center; }
.status .chip { display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 12px; border-radius: 18px; border: none; cursor: pointer; font: inherit; font-size: 13px; white-space: nowrap; background: rgba(255,255,255,.18); color: inherit; --mdc-icon-size: 18px; }
.status .chip.warn { background: #f57c00; color: #fff; }
.status .chip.crit { background: #d32f2f; color: #fff; }
.status .chip.ok { background: rgba(76,175,80,.85); color: #fff; }
.status .avatar { position: relative; width: 36px; height: 36px; padding: 0; border-radius: 50%; border: 2px solid rgba(255,255,255,.6); background: rgba(255,255,255,.25); color: inherit; cursor: pointer; overflow: visible; flex: none; }
.status .avatar img, .status .avatar .ini { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
.status .avatar.home::after { content: ""; position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 50%; background: #43a047; border: 2px solid var(--app-header-background-color, var(--primary-color, #03a9f4)); }
.status .avatar.away { filter: grayscale(1); opacity: .7; }
.status .avatar small { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); font-size: 9px; white-space: nowrap; line-height: 1; margin-top: 1px; }
@media (pointer: coarse) { .status .chip { height: 44px; } .status .avatar { width: 44px; height: 44px; } }
@media (max-width: 600px) { .status .chip span { display: none; } .status .chip.ok span, .status .chip.warn span { display: inline; } }
.floorbar button { position: relative; }
.floorbar .badge { position: absolute; right: -4px; top: -2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #ffc107; color: #3b2a00; font-size: 10px; line-height: 16px; box-sizing: border-box; }
.floorbar .badge.warn { background: #f57c00; color: #fff; }
.statuspop .sub { padding: 6px 16px 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--secondary-text-color); }
.statuspop .foot { border-top: 1px solid var(--divider-color, rgba(127,127,127,.25)); margin-top: 4px; }
button.icon {
  background: none; border: none; color: inherit; cursor: pointer;
  width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
}
button.icon:hover, button.icon:focus-visible { background: rgba(127,127,127,.2); outline: none; }
button.icon.on { background: rgba(255,255,255,.25); }
button.icon.menu { display: none; }
:host([narrow]) button.icon.menu { display: inline-flex; }
.floors { display: inline-flex; background: rgba(0,0,0,.18); border-radius: 18px; padding: 3px; gap: 2px; overflow-x: auto; max-width: 100%; }
.floors button {
  border: none; background: none; color: inherit; font: inherit; font-size: 14px; cursor: pointer;
  padding: 6px 14px; border-radius: 15px; min-height: 32px; white-space: nowrap;
}
.floors button.sel { background: var(--card-background-color, #fff); color: var(--primary-text-color); }
.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
header .floors, header .temp, header .fit { display: none; }
/* Kartenleiste oben rechts: Energie + bis zu 5 eigene Karten, jede einzeln aufklappbar */
.cards { position: absolute; top: 10px; right: 10px; left: 60px; display: flex; flex-direction: row-reverse; flex-wrap: wrap; align-items: flex-start; gap: 8px; pointer-events: none; z-index: 4; }
.cards > * { pointer-events: auto; }
.cards .energy, .cards .card { position: static; }
.card { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: var(--ha-card-border-radius, 12px); padding: 10px 12px; font-size: 13px; min-width: 170px; max-width: 260px; box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.25)); --mdc-icon-size: 18px; }
.card h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; min-height: 32px; }
.card h3 span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card h3 .cedit { opacity: .55; }
.card h3 .cedit:hover { opacity: 1; }
.card .chev, .energy .chev { transition: transform .2s; }
.card.collapsed h3 { margin: 0; }
.card.collapsed .chev { transform: rotate(-90deg); }
.card.collapsed .row { display: none; }
.card .row { display: flex; align-items: center; gap: 8px; padding: 2px 0; cursor: pointer; }
.card .row span { margin-right: auto; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .row b { font-weight: 500; white-space: nowrap; }
.card .short, .energy .short { display: none; font-weight: 500; margin-left: 4px; }
.card.collapsed .short, .energy.collapsed .short { display: inline; }
.cards .addcard { width: 44px; height: 44px; border-radius: 12px; border: 2px dashed var(--primary-color, #03a9f4); background: color-mix(in srgb, var(--card-background-color, #fff) 70%, transparent); color: var(--primary-color, #03a9f4); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
/* Etagen-Leiste rechts */
.floorbar { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 5px; border-radius: 24px; background: color-mix(in srgb, var(--card-background-color, #fff) 92%, transparent); color: var(--primary-text-color); box-shadow: 0 2px 10px rgba(0,0,0,.25); }
.floorbar button { border: none; background: none; color: inherit; font: inherit; font-size: 12px; font-weight: 600; min-width: 46px; min-height: 36px; border-radius: 14px; cursor: pointer; padding: 0 6px; }
.floorbar button.sel { background: var(--primary-color, #03a9f4); color: #fff; }
.floorbar button.arrow { min-height: 28px; opacity: .65; --mdc-icon-size: 20px; }
.floorbar button:disabled { opacity: .25; cursor: default; }
/* Rad-Menüs unten links (Kurzwahl) und unten rechts (Funktionen) */
.wheel { position: absolute; bottom: 14px; width: 0; height: 0; z-index: 5; }
.wheel.left { left: 14px; } .wheel.right { right: 14px; }
.wheel .fab { position: absolute; bottom: 0; width: 56px; height: 56px; border-radius: 50%; border: none; background: #fff; color: #222; box-shadow: 0 4px 16px rgba(0,0,0,.35); cursor: pointer; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 26px; }
.wheel.left .fab { left: 0; } .wheel.right .fab { right: 0; }
.wheel .bub { position: absolute; width: 48px; height: 48px; margin: 4px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: var(--card-background-color, #fff); color: var(--primary-text-color); box-shadow: 0 3px 10px rgba(0,0,0,.3); --mdc-icon-size: 22px; transition: left .25s, right .25s, bottom .25s, opacity .25s, transform .25s; opacity: 0; transform: scale(.4); pointer-events: none; }
.wheel.open .bub.vis { opacity: 1; transform: scale(1); pointer-events: auto; }
.wheel .bub.on { background: var(--primary-color, #03a9f4); color: #fff; }
.wheel .bub .lab { position: absolute; white-space: nowrap; font-size: 11px; padding: 2px 7px; border-radius: 8px; background: rgba(0,0,0,.72); color: #fff; pointer-events: none; z-index: 1; }
.wheel .bub .lab.top { bottom: 52px; }
.wheel.left .bub .lab.top { left: 0; } .wheel.right .bub .lab.top { right: 0; }
.wheel .bub .lab.diag { bottom: 44px; }
.wheel.left .bub .lab.diag { left: 36px; } .wheel.right .bub .lab.diag { right: 36px; }
.wheel .bub .lab.side { top: 14px; }
.wheel.left .bub .lab.side { left: 54px; } .wheel.right .bub .lab.side { right: 54px; }
.wheel .bub.plus { border: 2px dashed var(--primary-color, #03a9f4); background: var(--card-background-color, #fff); color: var(--primary-color, #03a9f4); }
.wheel .spin { position: absolute; bottom: 64px; width: 26px; height: 26px; padding: 0; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); color: #fff; --mdc-icon-size: 18px; opacity: 0; pointer-events: none; transition: opacity .2s; }
.wheel.open .spin { opacity: .9; pointer-events: auto; }
.wheel.left .spin.up { left: 70px; bottom: 70px; } .wheel.left .spin.down { left: 100px; bottom: 40px; }
.wheel.right .spin.up { right: 70px; bottom: 70px; } .wheel.right .spin.down { right: 100px; bottom: 40px; }
.qedit .qrow .fixed { flex: 1; font-size: 13px; }
.qedit select.addkey { flex: 1; font: inherit; font-size: 13px; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.legend { left: 50% !important; transform: translateX(-50%); bottom: 80px !important; }
.qedit .qrow { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
.qedit .qrow input { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.qedit .qrow input.nm { flex: 0 0 110px; }
.qedit .qrow .qc { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; }
.qedit .qrow .qc input { flex: none; width: auto; }
.pvarr { display: grid; grid-template-columns: 62px 1fr 1fr 66px 1fr 1fr 30px; gap: 4px; align-items: center; font-size: 12px; margin: 3px 0; }
.pvarr input, .pvarr select { font: inherit; font-size: 12px; padding: 5px 3px; border-radius: 6px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: var(--primary-text-color); min-width: 0; }
.pvarr.head { color: var(--secondary-text-color); }
.house-cfg .swatches { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px 96px; }
.house-cfg .swatches button { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(127,127,127,.5); padding: 0; cursor: pointer; }
.house-cfg .rc-reset { font: inherit; font-size: 12px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: none; color: inherit; cursor: pointer; }
.house-cfg input[type=color] { width: 44px; height: 30px; padding: 2px; flex: none; }
.pvrow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.pvrow label { display: flex; flex-direction: column; font-size: 12px; color: var(--secondary-text-color); }
.pvrow input { font: inherit; padding: 6px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: var(--primary-text-color); }
.simbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; max-width: calc(100% - 24px); padding: 6px 10px; border-radius: 12px; background: repeating-linear-gradient(135deg, #ff9800 0 12px, #fb8c00 12px 24px); color: #1b1b1b; font-size: 13px; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
.simbar b { letter-spacing: .08em; }
.simbar select, .simbar input[type=range] { font: inherit; font-size: 12px; border-radius: 6px; border: none; padding: 3px; max-width: 130px; }
.simbar label { display: inline-flex; align-items: center; gap: 4px; }
.simbar button { font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 7px; border: none; background: rgba(0,0,0,.75); color: #fff; cursor: pointer; }
.simdlg .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.simdlg input[type=number], .simdlg input[type=text] { flex: 1; min-width: 0; font: inherit; padding: 7px; border-radius: 8px; border: 1px solid var(--divider-color, rgba(127,127,127,.4)); background: var(--primary-background-color, #fff); color: inherit; }
.simdlg input[type=range] { flex: 1; }
.canvas { position: absolute; inset: 0; }
.overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.room {
  position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: opacity .2s;
}
.devs { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 168px; }
.label {
  background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent);
  color: var(--primary-text-color); border-radius: 8px; padding: 3px 8px;
  font-size: 12px; line-height: 1.3; text-align: center; white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: opacity .2s;
}
.label b { font-weight: 500; font-size: 13px; }
.label .clim { color: var(--secondary-text-color); }
.label .warn { color: var(--error-color, #db4437); font-weight: 500; }
.label .occ { color: #00897b; font-size: 11px; }
.label .heat { color: #e65100; font-size: 11px; font-weight: 600; }
/* Hinweise: Banner oben mittig, Zeile am Raumnamen, Glocke */
.alertbar { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 6; display: flex; align-items: center; gap: 8px; max-width: min(640px, calc(100% - 24px)); padding: 6px 6px 6px 12px; border-radius: 14px; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.35); font-size: 14px; --mdc-icon-size: 22px; }
.alertbar.critical { background: #c62828; }
.alertbar.warn { background: #ef6c00; }
.alertbar.info { background: #1565c0; }
.alertbar .at { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.alertbar button { flex: none; min-height: 40px; padding: 0 12px; border-radius: 10px; border: none; background: rgba(255,255,255,.22); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.alertbar button.show { background: #fff; color: #333; }
.label.alarm { outline: 2px solid #ff8f00; }
.label.alarm.crit { outline-color: #e53935; animation: haus3d-pulse 1.6s ease-in-out infinite; }
.label .alarmtext { color: #e65100; font-size: 11px; font-weight: 600; }
.label.crit .alarmtext { color: #c62828; }
@keyframes haus3d-pulse { 50% { outline-color: rgba(229,57,53,.25); } }
@media (prefers-reduced-motion: reduce) { .label.alarm.crit { animation: none; } }
.status .chip.bell { background: #ef6c00; color: #fff; }
.status .chip.bell.crit { background: #c62828; }
.alertpop .item { padding: 6px 8px 6px 12px; --mdc-icon-size: 20px; }
.alertpop .item.critical ha-icon { color: #c62828; }
.alertpop .item.warn ha-icon { color: #ef6c00; }
.rp-clim { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; padding: 0 14px 8px; font-size: 12px; color: var(--secondary-text-color); }
.rp-clim .vent { padding: 3px 8px; border-radius: 10px; font-weight: 500; }
.rp-clim .vent.good { background: rgba(67,160,71,.18); color: #2e7d32; }
.rp-clim .vent.bad { background: rgba(255,179,0,.2); color: #8d6e00; }
.rp-clim .vent.mold { background: rgba(211,47,47,.16); color: #c62828; }
.rp-clim .vent.neutral { background: rgba(127,127,127,.12); }
.legend .lt { font-weight: 600; }
.legend .lwarn { margin-top: 2px; font-size: 11px; color: #8e24aa; }
.label .occ.now { font-weight: 600; }
.dev {
  position: relative; width: 36px; height: 36px; flex: none;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--card-background-color, #fff); color: var(--secondary-text-color);
  box-shadow: 0 1px 4px rgba(0,0,0,.35); pointer-events: auto; cursor: pointer;
  touch-action: none; user-select: none; -webkit-user-select: none; transition: opacity .2s;
  --mdc-icon-size: 20px;
}
.dev.free { position: absolute; left: 0; top: 0; }
.dev.active { background: #ffc107; color: #3b2a00; }
.dev.alert { background: var(--error-color, #db4437); color: #fff; }
.dev.unavailable { opacity: .45; }
.hidden-behind { opacity: .15 !important; }
.hidden-behind, .hidden-behind .dev { pointer-events: none !important; }
.energy {
  position: absolute; right: 12px; top: 12px; min-width: 180px;
  background: var(--card-background-color, #fff); color: var(--primary-text-color);
  border-radius: var(--ha-card-border-radius, 12px); padding: 10px 12px; font-size: 13px;
  box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.25));
  --mdc-icon-size: 18px;
}
.energy h3 { margin: 0 0 6px; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; min-height: 32px; }
.energy h3 span { flex: 1; }
.energy .chev { transition: transform .2s; }
.energy.collapsed h3 { margin: 0; }
.energy.collapsed .chev { transform: rotate(-90deg); }
.energy .row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.energy .row span:nth-child(2) { margin-right: auto; color: var(--secondary-text-color); }
.energy .row b { font-weight: 500; }
.energy.collapsed .row { display: none; }
.energy .row { flex-wrap: wrap; }
.energy .row.import b { color: var(--error-color, #e53935); }
.energy .row.export b { color: var(--success-color, #43a047); }
.energy .bbar { flex-basis: 100%; height: 5px; border-radius: 3px; background: rgba(127,127,127,.25); overflow: hidden; margin: 2px 0 2px 26px; }
.energy .bbar > i { display: block; height: 100%; background: var(--success-color, #43a047); transition: width .4s; }
.energy .bbar.mid > i { background: #fbc02d; }
.energy .bbar.low > i { background: var(--error-color, #e53935); }
.energy .sdot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: #9e9e9e; }
.energy .sdot.hoch { background: #43a047; box-shadow: 0 0 6px #43a047; }
.energy .sdot.mittel { background: #fbc02d; }
.energy.setup h3 { margin: 0; color: var(--primary-color, #03a9f4); }
.energy.setup .x { --mdc-icon-size: 16px; opacity: .6; }
@media (pointer: coarse) { .energy .row { min-height: 34px; } }
@media (max-width: 1100px) { .alerting .cards { top: 66px; } }
.legend {
  position: absolute; left: 12px; bottom: 12px; padding: 8px 10px; border-radius: 10px; font-size: 12px;
  background: var(--card-background-color, #fff); box-shadow: 0 1px 4px rgba(0,0,0,.25);
}
.legend .bar { width: 160px; height: 10px; border-radius: 5px; margin: 4px 0 2px; }
.legend .ticks { display: flex; justify-content: space-between; color: var(--secondary-text-color); }
.perfhud { position: absolute; left: 12px; top: 12px; z-index: 6; padding: 4px 8px; border-radius: 8px; background: rgba(0,0,0,.6); color: #fff; font: 12px/1.3 monospace; pointer-events: none; }
.chkrow { display: flex; align-items: center; gap: 8px; margin: 8px 0 2px; font-size: 14px; }
.toast {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  background: #323232; color: #fff; padding: 10px 16px; border-radius: 6px; font-size: 14px;
  max-width: calc(100% - 32px); box-shadow: 0 2px 8px rgba(0,0,0,.4); z-index: 7;
}
/* in der Simulation liegt die Simbar unten: Meldungen darüber */
.stage.has-simbar .toast { bottom: 72px; }
.msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; color: var(--secondary-text-color); }
.popup {
  position: absolute; right: 8px; top: 8px; z-index: 6; min-width: 220px;
  background: var(--card-background-color, #fff); color: var(--primary-text-color);
  border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.35); padding: 6px 0; font-size: 14px;
}
.popup button {
  display: flex; align-items: center; gap: 12px; width: 100%; border: none; background: none; color: inherit;
  font: inherit; text-align: left; padding: 10px 16px; cursor: pointer; min-height: 44px;
}
.popup button:hover { background: rgba(127,127,127,.15); }
.popup .head { padding: 8px 16px; font-weight: 500; }
.popup .item { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 16px; }
.popup .item span { margin-right: auto; font-size: 13px; }
.popup .item button { width: auto; padding: 6px 10px; min-height: 36px; color: var(--primary-color); }
.popup .scroll { max-height: 50vh; overflow-y: auto; }
:host([night]) .label { background: rgba(14,20,44,.85); color: #e3e8ff; }
:host([night]) .label .clim { color: #aab4e8; }
:host([cyber]) { background: #07030f; }
:host([cyber]) header { background: linear-gradient(90deg, #12052a, #07030f 60%, #1a0630); color: #e0f7ff; border-bottom: 1px solid #ff2bd6; box-shadow: 0 0 12px rgba(255,43,214,.35); }
:host([cyber]) header .title { font-family: "Orbitron", "Rajdhani", var(--paper-font-body1_-_font-family, sans-serif); letter-spacing: .12em; text-transform: uppercase; text-shadow: 0 0 8px #00e5ff; }
:host([cyber]) .floors { background: rgba(0,229,255,.08); border: 1px solid rgba(0,229,255,.35); }
:host([cyber]) .floors button.sel { background: #00e5ff; color: #07030f; box-shadow: 0 0 10px #00e5ff; }
:host([cyber]) button.icon.on { background: rgba(255,43,214,.3); box-shadow: 0 0 10px #ff2bd6; }
:host([cyber]) .label { background: rgba(10,4,25,.85); color: #e0f7ff; border: 1px solid #00e5ff; box-shadow: 0 0 8px rgba(0,229,255,.55); text-shadow: 0 0 6px rgba(0,229,255,.8); }
:host([cyber]) .label .clim { color: #ff8af0; }
:host([cyber]) .dev { background: #12082a; color: #ff8af0; border: 1px solid #ff2bd6; box-shadow: 0 0 8px rgba(255,43,214,.6); }
:host([cyber]) .dev.active { background: #ffd000; color: #1a0630; border-color: #fff176; box-shadow: 0 0 14px #ffd000; }
:host([cyber]) .dev.alert { background: #ff1744; color: #fff; box-shadow: 0 0 14px #ff1744; }
:host([cyber]) .dialog, :host([cyber]) .roompanel { background: rgba(10,4,25,.95); color: #e0f7ff; border: 1px solid #00e5ff; box-shadow: 0 0 18px rgba(0,229,255,.4); }
:host([cyber]) .seg button.sel { background: #ff2bd6; box-shadow: 0 0 10px #ff2bd6; }
:host([cyber]) .rp-icon.active { background: #ffd000; box-shadow: 0 0 10px #ffd000; }
:host([cyber]) .energy, :host([cyber]) .legend, :host([cyber]) .popup { background: rgba(10,4,25,.92); color: #e0f7ff; border: 1px solid #ff2bd6; box-shadow: 0 0 14px rgba(255,43,214,.45); }
:host([cyber]) .energy .row span:nth-child(2) { color: #8f7dff; }
:host([cyber]) .energy .row b { color: #00e5ff; text-shadow: 0 0 6px #00e5ff; }
@media (max-width: 600px) {
  header .title { display: none; }
  .label { font-size: 11px; padding: 2px 6px; }
  .label b { font-size: 12px; }
  .dev { width: 32px; height: 32px; --mdc-icon-size: 18px; }
  .devs { max-width: 140px; gap: 3px; }
  .energy { right: 8px; top: 8px; min-width: 0; padding: 8px 10px; }
  .floors { order: 0; }
}
`;
