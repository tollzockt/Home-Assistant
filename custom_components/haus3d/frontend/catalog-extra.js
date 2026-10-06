// Erweiterter Möbelkatalog (ohne Three.js, mit node testbar): IKEA-Klassiker, weitere Lampen und LEDs,
// Gaming, Wallboxen, Wechselrichter, Speicher, Mikrowechselrichter und Solar-Aufständerungen.
// Maße (w × d × h in m, Breite × Tiefe × Höhe) nach Hersteller- bzw. Händlerangaben; einige sind
// gerundet. Produktnamen dienen nur der Wiedererkennung, die Modelle sind vereinfacht.

/** Typ → [Name, w, d, h] */
export const EXTRA = {
  // IKEA (Maße wie auf den Produktseiten)
  ikea_kallax_1x4: ["KALLAX Regal 1×4", 0.42, 0.39, 1.47],
  ikea_kallax_2x2: ["KALLAX Regal 2×2", 0.77, 0.39, 0.77],
  ikea_kallax_2x4: ["KALLAX Regal 2×4", 0.77, 0.39, 1.47],
  ikea_kallax_4x4: ["KALLAX Regal 4×4", 1.47, 0.39, 1.47],
  ikea_billy_80: ["BILLY Bücherregal 80", 0.8, 0.28, 2.02],
  ikea_billy_40: ["BILLY Bücherregal 40", 0.4, 0.28, 2.02],
  ikea_ivar: ["IVAR Regal", 0.89, 0.3, 1.79],
  ikea_pax_100: ["PAX Kleiderschrank 100", 1.0, 0.58, 2.36],
  ikea_pax_50: ["PAX Kleiderschrank 50", 0.5, 0.58, 2.36],
  ikea_brimnes_3: ["BRIMNES Kleiderschrank 3 Türen", 1.17, 0.5, 1.9],
  ikea_malm_chest6: ["MALM Kommode 6 Schubladen", 1.6, 0.48, 0.78],
  ikea_hemnes_chest8: ["HEMNES Kommode 8 Schubladen", 1.6, 0.5, 0.96],
  ikea_malm_dressing: ["MALM Frisiertisch", 1.2, 0.41, 0.78],
  ikea_malm_bed160: ["MALM Bett 160×200", 1.76, 2.09, 1.0],
  ikea_ektorp_3: ["EKTORP 3er-Sofa", 2.18, 0.88, 0.88],
  ikea_kivik_3: ["KIVIK 3er-Sofa", 2.28, 0.95, 0.83],
  ikea_soderhamn_3: ["SÖDERHAMN 3er-Sofa", 1.98, 0.99, 0.83],
  ikea_friheten: ["FRIHETEN Ecksofa", 2.3, 1.51, 0.66],
  ikea_poang: ["POÄNG Sessel", 0.68, 0.82, 1.0],
  ikea_strandmon: ["STRANDMON Ohrensessel", 0.82, 0.96, 1.01],
  ikea_lack_coffee: ["LACK Couchtisch", 1.18, 0.78, 0.45],
  ikea_lack_side: ["LACK Beistelltisch", 0.55, 0.55, 0.45],
  ikea_besta_tv: ["BESTÅ TV-Bank 180", 1.8, 0.42, 0.39],
  ikea_micke: ["MICKE Schreibtisch", 1.05, 0.5, 0.75],
  ikea_alex: ["ALEX Schreibtisch", 1.31, 0.6, 0.76],
  ikea_bekant: ["BEKANT Schreibtisch 160×80", 1.6, 0.8, 0.75],
  ikea_linnmon_100: ["LINNMON/ADILS Tisch 100×60", 1.0, 0.6, 0.74],
  ikea_linnmon_150: ["LINNMON/ADILS Tisch 150×75", 1.5, 0.75, 0.74],
  ikea_markus: ["MARKUS Bürostuhl", 0.62, 0.6, 1.35],
  ikea_nordviken: ["NORDVIKEN Esstisch", 1.52, 0.95, 0.75],
  ikea_ekedalen: ["EKEDALEN Esstisch", 1.2, 0.8, 0.75],
  // weitere Lampen
  lamp_arc: ["Bogenlampe", 1.6, 0.4, 2.0],
  lamp_tripod: ["Dreibein-Stehlampe", 0.6, 0.6, 1.55],
  lamp_globe: ["Kugel-Pendelleuchte", 0.35, 0.35, 0.6],
  lamp_chandelier: ["Kronleuchter", 0.7, 0.7, 0.7],
  lamp_ring: ["Ring-Pendelleuchte (LED)", 0.6, 0.6, 0.5],
  lamp_cluster: ["Mehrfach-Pendel (3 Birnen)", 0.8, 0.25, 0.8],
  lamp_edison: ["Glühbirne am Kabel", 0.12, 0.12, 0.8],
  lamp_track: ["Schienensystem (3 Spots)", 1.5, 0.08, 0.15],
  lamp_desk: ["Schreibtischleuchte", 0.2, 0.4, 0.45],
  lamp_mushroom: ["Pilzleuchte", 0.3, 0.3, 0.35],
  lamp_neon: ["Neon-Schild", 0.6, 0.03, 0.3],
  // LEDs
  led_cove: ["LED-Deckenvoute (indirekt)", 3.0, 0.1, 0.04],
  led_profile: ["LED-Alu-Profil", 1.0, 0.02, 0.02],
  led_bar: ["LED-Lichtleiste (Play-Bar)", 0.08, 0.08, 0.27],
  led_corner: ["LED-Eckleuchte (Stab)", 0.15, 0.15, 1.4],
  led_tv: ["TV-Hintergrundbeleuchtung", 1.2, 0.02, 0.7],
  led_hex: ["Hexagon-Lichtpanels", 0.9, 0.02, 0.6],
  led_lines: ["LED-Lichtlinien (Wand)", 1.0, 0.02, 0.6],
  led_bed: ["LED-Bettunterleuchte", 1.8, 2.0, 0.02],
  led_stairs: ["LED-Treppenstufen", 1.0, 3.0, 0.02],
  // Gaming
  gaming_pc: ["Gaming-PC (Midi-Tower)", 0.23, 0.45, 0.46],
  gaming_pc_showcase: ["Gaming-PC (Glas, O11-Stil)", 0.29, 0.47, 0.46],
  gaming_desk: ["Gaming-Schreibtisch", 1.6, 0.8, 0.75],
  gaming_chair: ["Gaming-Stuhl", 0.7, 0.7, 1.35],
  monitor_27: ["Monitor 27″", 0.61, 0.22, 0.5],
  monitor_34: ["Monitor 34″ curved", 0.81, 0.25, 0.52],
  monitor_49: ["Monitor 49″ super-ultrawide", 1.2, 0.3, 0.56],
  monitor_dual: ["Zwei Monitore 27″", 1.25, 0.25, 0.5],
  keyboard_mouse: ["Tastatur & Maus", 0.65, 0.22, 0.04],
  pc_speakers: ["PC-Lautsprecher (Paar)", 0.6, 0.15, 0.2],
  headset_stand: ["Headset-Ständer", 0.12, 0.12, 0.27],
  streaming_mic: ["Mikrofon am Arm", 0.2, 0.25, 0.5],
  console_ps5: ["PlayStation 5 Slim", 0.096, 0.216, 0.358],
  console_ps5_pro: ["PlayStation 5 Pro", 0.089, 0.216, 0.388],
  console_xbox_x: ["Xbox Series X", 0.151, 0.151, 0.301],
  console_xbox_s: ["Xbox Series S", 0.064, 0.151, 0.275],
  console_switch: ["Nintendo Switch (im Dock)", 0.27, 0.06, 0.17],
  steam_deck: ["Steam Deck", 0.3, 0.12, 0.05],
  gamepad: ["Controller", 0.16, 0.11, 0.06],
  vr_headset: ["VR-Brille", 0.18, 0.16, 0.1],
  racing_cockpit: ["Rennsitz (Sim-Racing)", 0.6, 1.4, 1.0],
  // Wallboxen und E-Auto
  wallbox: ["Wallbox (allgemein)", 0.2, 0.12, 0.35],
  wallbox_goe: ["go-e Charger Gemini", 0.155, 0.11, 0.26],
  wallbox_tesla: ["Tesla Wall Connector", 0.155, 0.11, 0.345],
  wallbox_easee: ["Easee Charge", 0.193, 0.106, 0.256],
  wallbox_pulsar: ["Wallbox Pulsar Plus", 0.163, 0.082, 0.166],
  wallbox_keba: ["KEBA KeContact P30", 0.24, 0.14, 0.643],
  wallbox_zaptec: ["Zaptec Go", 0.18, 0.075, 0.242],
  wallbox_heidelberg: ["Heidelberg Energy Control", 0.386, 0.112, 0.295],
  ev_car: ["E-Auto", 1.85, 4.7, 1.5],
  // Wechselrichter
  inv_fronius_gen24: ["Fronius Symo GEN24 Plus", 0.527, 0.18, 0.594],
  inv_sma_stp_se: ["SMA Sunny Tripower Smart Energy", 0.5, 0.173, 0.598],
  inv_huawei_sun2000: ["Huawei SUN2000-KTL-M1", 0.525, 0.147, 0.47],
  inv_kostal_plenticore: ["Kostal PLENTICORE plus G2", 0.405, 0.233, 0.563],
  inv_solaredge_hub: ["SolarEdge Home Hub", 0.317, 0.192, 0.907],
  inv_victron_mp2: ["Victron MultiPlus-II 48/5000", 0.323, 0.148, 0.565],
  inv_growatt_mod: ["Growatt MOD-XH", 0.425, 0.178, 0.387],
  inv_sungrow_sh: ["Sungrow SH-RT", 0.46, 0.17, 0.54],
  inv_goodwe_et: ["GoodWe ET", 0.516, 0.18, 0.415],
  inv_deye_hybrid: ["Deye SUN-SG04LP3", 0.422, 0.279, 0.699],
  // Speicher
  bat_byd_hvs: ["BYD Battery-Box HVS/HVM", 0.585, 0.298, 1.178],
  bat_tesla_pw3: ["Tesla Powerwall 3", 0.609, 0.193, 1.105],
  bat_huawei_luna10: ["Huawei LUNA2000 10 kWh", 0.67, 0.15, 0.96],
  bat_huawei_luna15: ["Huawei LUNA2000 15 kWh", 0.67, 0.15, 1.32],
  bat_sonnen10: ["sonnenBatterie 10", 0.69, 0.27, 1.8],
  bat_e3dc: ["E3/DC Hauskraftwerk", 1.03, 0.446, 1.81],
  bat_sma_home: ["SMA Home Storage", 0.61, 0.215, 1.455],
  bat_pylontech: ["Pylontech US5000 (Rack)", 0.442, 0.42, 0.161],
  bat_zendure_sf800: ["Zendure SolarFlow 800 Pro", 0.35, 0.202, 0.34],
  bat_zendure_hyper: ["Zendure Hyper 2000 + 2 Akkus", 0.35, 0.202, 0.52],
  bat_ecoflow_stream: ["EcoFlow STREAM", 0.255, 0.284, 0.458],
  bat_ecoflow_delta: ["EcoFlow Delta 2", 0.4, 0.21, 0.28],
  bat_marstek_venus: ["Marstek Venus E (AC-Speicher)", 0.48, 0.153, 0.624],
  bat_growatt_noah: ["Growatt NOAH 2000", 0.406, 0.235, 0.27],
  bat_senec_v3: ["SENEC.Home V3 hybrid", 0.535, 0.535, 1.135],
  bat_anker_solarbank: ["Anker SOLIX Solarbank 2 E1600 Pro", 0.46, 0.249, 0.254],
  // Mikrowechselrichter (Balkonkraftwerk)
  micro_hoymiles: ["Hoymiles HMS-800W-2T", 0.261, 0.035, 0.18],
  micro_deye: ["Deye SUN-M80G4", 0.281, 0.04, 0.19],
  micro_apsystems: ["APsystems EZ1-M", 0.263, 0.037, 0.218],
  micro_ecoflow: ["EcoFlow PowerStream 800", 0.242, 0.033, 0.169],
  // Solar-Aufständerungen (Module ca. 1,72 × 1,13 m)
  pv_flat_south: ["PV Flachdach Süd (15°)", 2.3, 1.7, 0.55],
  pv_flat_ew: ["PV Flachdach Ost-West (10°)", 2.3, 3.4, 0.35],
  pv_ground: ["PV Gartenständer (30°)", 2.3, 1.55, 1.0],
  pv_balcony: ["PV Balkongeländer (senkrecht)", 3.45, 0.08, 1.15],
  pv_balcony_tilt: ["PV Balkon mit Neigung (30°)", 1.72, 1.0, 0.65],
  pv_facade: ["PV Fassade (Wand)", 1.13, 0.05, 1.72],
  pv_carport: ["Solar-Carport", 3.0, 5.0, 2.5],
  pv_pergola: ["Solarterrasse / Pergola", 3.4, 3.4, 2.5],
};

/** Neue Kategorien (Lampen gehen zusätzlich in „Licht“, siehe furniture.js). */
export const EXTRA_CATEGORIES = [
  ["IKEA", Object.keys(EXTRA).filter((k) => k.startsWith("ikea_"))],
  ["LED", Object.keys(EXTRA).filter((k) => k.startsWith("led_"))],
  ["Gaming", ["gaming_pc", "gaming_pc_showcase", "gaming_desk", "gaming_chair", "monitor_27", "monitor_34", "monitor_49", "monitor_dual", "keyboard_mouse", "pc_speakers", "headset_stand", "streaming_mic", "console_ps5", "console_ps5_pro", "console_xbox_x", "console_xbox_s", "console_switch", "steam_deck", "gamepad", "vr_headset", "racing_cockpit"]],
  ["Wallbox & E-Auto", Object.keys(EXTRA).filter((k) => k.startsWith("wallbox") || k === "ev_car")],
  ["Wechselrichter & Speicher", Object.keys(EXTRA).filter((k) => /^(inv|bat|micro)_/.test(k))],
  ["Solar-Aufständerung", Object.keys(EXTRA).filter((k) => k.startsWith("pv_"))],
];
export const EXTRA_LAMPS = Object.keys(EXTRA).filter((k) => k.startsWith("lamp_"));

const DESK = 0.75; // auf dem Schreibtisch
const BOARD = 0.5; // auf dem TV-Board
/** Standardhöhe über dem Boden: "ceiling" = unter der Decke, Zahl = Montagehöhe (m). */
export const EXTRA_MOUNT = {
  lamp_globe: "ceiling", lamp_chandelier: "ceiling", lamp_ring: "ceiling", lamp_cluster: "ceiling", lamp_edison: "ceiling", lamp_track: "ceiling", led_cove: "ceiling",
  lamp_neon: 1.5, led_tv: 1.0, led_hex: 1.4, led_lines: 1.3, led_profile: 0.3, lamp_desk: DESK, lamp_mushroom: DESK,
  monitor_27: DESK, monitor_34: DESK, monitor_49: DESK, monitor_dual: DESK, keyboard_mouse: DESK, pc_speakers: DESK, headset_stand: DESK, streaming_mic: DESK, steam_deck: DESK, gamepad: DESK, vr_headset: DESK,
  console_ps5: BOARD, console_ps5_pro: BOARD, console_xbox_x: BOARD, console_xbox_s: BOARD, console_switch: BOARD, led_bar: BOARD,
  wallbox: 1.0, wallbox_goe: 1.0, wallbox_tesla: 1.0, wallbox_easee: 1.0, wallbox_pulsar: 1.1, wallbox_keba: 0.8, wallbox_zaptec: 1.0, wallbox_heidelberg: 1.0,
  inv_fronius_gen24: 1.0, inv_sma_stp_se: 1.0, inv_huawei_sun2000: 1.1, inv_kostal_plenticore: 1.0, inv_solaredge_hub: 0.8, inv_victron_mp2: 1.0, inv_growatt_mod: 1.1, inv_sungrow_sh: 1.0, inv_goodwe_et: 1.1, inv_deye_hybrid: 0.9,
  bat_huawei_luna10: 0.1, micro_hoymiles: 0.6, micro_deye: 0.6, micro_apsystems: 0.6, micro_ecoflow: 0.6, pv_facade: 0.8,
};

/** Typen, die nicht an Wänden einrasten (stehen frei, liegen auf dem Tisch oder hängen an der Decke). */
export const EXTRA_FREE = [
  "ikea_lack_coffee", "ikea_lack_side", "ikea_nordviken", "ikea_ekedalen", "ikea_linnmon_100", "ikea_linnmon_150", "ikea_markus", "ikea_poang", "ikea_strandmon",
  "lamp_arc", "lamp_tripod", "lamp_globe", "lamp_chandelier", "lamp_ring", "lamp_cluster", "lamp_edison", "lamp_track", "lamp_desk", "lamp_mushroom", "led_cove", "led_bar", "led_bed", "led_stairs",
  "gaming_chair", "monitor_27", "monitor_34", "monitor_49", "monitor_dual", "keyboard_mouse", "pc_speakers", "headset_stand", "streaming_mic", "console_ps5", "console_ps5_pro", "console_xbox_x", "console_xbox_s", "console_switch", "steam_deck", "gamepad", "vr_headset", "racing_cockpit",
  "ev_car", "pv_flat_south", "pv_flat_ew", "pv_ground", "pv_balcony_tilt", "pv_carport", "pv_pergola",
];

/** Anzahl PV-Module einer Aufständerung (aus der Breite bzw. Tiefe). */
export function pvModules(type, w, d) {
  const across = Math.max(1, Math.round(w / 1.15));
  if (type === "pv_flat_ew") return { across, rows: Math.max(1, Math.round(d / 1.7)) * 2 };
  if (type === "pv_balcony") return { across: Math.max(1, Math.round(w / 1.73)), rows: 1 };
  if (type === "pv_carport" || type === "pv_pergola") return { across: Math.max(1, Math.round(w / 1.15)), rows: Math.max(1, Math.round(d / 1.75)) };
  return { across, rows: 1 };
}
