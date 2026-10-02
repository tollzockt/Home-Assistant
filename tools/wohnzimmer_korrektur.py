#!/usr/bin/env python3
"""Ersetzt im Raum "Wohnzimmer" (EG) auf Kante 0 das alte einzelne Fenster.

Neu: zwei Fenster (Breite 1.25, Brüstung 0.3, Höhe 1.9) bei 0.55 und 2.1 sowie eine Glastür
(Breite 1.0, Höhe 2.2, Anschlag rechts, öffnet nach außen) bei 4.9.

Im NeonPlan-Format ist `offset` der Abstand der MITTE der Öffnung vom Kantenanfang. Ob die Werte
oben den linken Rand oder die Mitte meinen, ist noch offen, daher muss es angegeben werden:

    python3 tools/wohnzimmer_korrektur.py --offset rand  custom_components/haus3d/haus-daten.json
    python3 tools/wohnzimmer_korrektur.py --offset mitte custom_components/haus3d/haus-daten.json

`rand` rechnet um (Mitte = Wert + Breite/2), `mitte` übernimmt die Werte unverändert.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

NEW_OPENINGS = [
    # id, Typ, Wert, Breite, Brüstung, Höhe, Extras
    ("wohnzimmer_fenster_1", "window", 0.55, 1.25, 0.3, 1.9, {}),
    ("wohnzimmer_fenster_2", "window", 2.1, 1.25, 0.3, 1.9, {}),
    ("wohnzimmer_terrassentuer", "door", 4.9, 1.0, 0.0, 2.2, {"hinge": "right", "swing": "out", "style": "glass"}),
]


def _opening(room_id: str, oid: str, typ: str, offset: float, width: float, sill: float, height: float, extra: dict) -> dict:
    data = {
        "id": oid,
        "room_id": room_id,
        "edge": 0,
        "offset": round(offset, 4),
        "width": width,
        "type": typ,
        "sill": sill,
        "height": height,
        "hinge": "left",
        "leaves": 1,
        "swing": "in",
        "style": None,
        "contact2": None,
        "cover": None,
        "contact": None,
        "tilt": None,
    }
    data.update(extra)
    return data


def apply(building: dict, offset_mode: str, force: bool = False) -> list[str]:
    """Wendet die Korrektur an und gibt eine Beschreibung der Änderungen zurück."""
    log: list[str] = []
    candidates = [
        (floor, room)
        for floor in building["floors"]
        for room in floor["rooms"]
        if room["name"].strip().lower() == "wohnzimmer"
    ]
    if len(candidates) != 1:
        raise SystemExit(f"Erwartet genau einen Raum 'Wohnzimmer', gefunden: {len(candidates)}")
    floor, room = candidates[0]
    if floor["name"].strip().upper() != "EG":
        log.append(f"Hinweis: Wohnzimmer liegt auf Etage '{floor['name']}', nicht 'EG'")

    pts = room["points"]
    edge_len = ((pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2) ** 0.5
    on_edge = [o for o in floor["openings"] if o["room_id"] == room["id"] and o["edge"] == 0 and not o.get("wall")]
    if any(o["id"] in {n[0] for n in NEW_OPENINGS} for o in on_edge):
        raise SystemExit("Korrektur ist bereits angewendet")
    windows = [o for o in on_edge if o["type"] == "window"]
    if len(windows) != 1:
        raise SystemExit(f"Erwartet genau ein altes Fenster auf Kante 0, gefunden: {len(windows)} – bitte prüfen")
    old = windows[0]

    # erst alles prüfen, dann ändern: ragt eine Öffnung über die Kante, bleibt die Datei unverändert
    new = []
    problems = []
    for oid, typ, value, width, sill, height, extra in NEW_OPENINGS:
        centre = value + width / 2 if offset_mode == "rand" else value
        start, end = centre - width / 2, centre + width / 2
        if start < -1e-9 or end > edge_len + 1e-9:
            problems.append(f"{oid} ({start:.3f}–{end:.3f} m) liegt nicht ganz auf der Kante (Länge {edge_len:.3f} m)")
        new.append((_opening(room["id"], oid, typ, centre, width, sill, height, extra), start, end))
    if problems and not force:
        raise SystemExit("Abbruch, nichts geändert:\n  " + "\n  ".join(problems) + "\n(--force schreibt trotzdem)")
    log.extend(f"WARNUNG: {p}" for p in problems)

    floor["openings"].remove(old)
    log.append(f"entfernt: {old['id']} (Mitte {old['offset']}, Breite {old['width']})")
    for opening, start, end in new:
        floor["openings"].append(opening)
        log.append(f"neu: {opening['id']} {opening['type']} Mitte {opening['offset']:.3f} m ({start:.3f}–{end:.3f} m)")
    return log


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offset", choices=["rand", "mitte"], required=True, help="Bedeutung der Offset-Werte")
    parser.add_argument("--force", action="store_true", help="auch schreiben, wenn eine Öffnung über die Kante ragt")
    parser.add_argument("datei", type=Path)
    args = parser.parse_args()

    raw = json.loads(args.datei.read_text(encoding="utf-8"))
    building = raw.get("building", raw) if isinstance(raw, dict) and "format" in raw else raw
    for line in apply(building, args.offset, args.force):
        print(line)
    args.datei.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"gespeichert: {args.datei}", file=sys.stderr)


if __name__ == "__main__":
    main()
