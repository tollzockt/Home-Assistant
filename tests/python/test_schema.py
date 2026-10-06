"""Schema: weiche Prüfung neuer Felder, keine privaten IDs im Paket, Version."""

from __future__ import annotations

import json
import re
from pathlib import Path

from custom_components.haus3d.const import VERSION
from custom_components.haus3d.schema import validate_building

ROOT = Path(__file__).parents[2]
PKG = ROOT / "custom_components/haus3d"
SEED = json.loads((PKG / "haus-daten.json").read_text(encoding="utf-8"))
# Sensor-Namen aus dem Haus des Nutzers dürfen nie im öffentlichen Paket stehen
PRIVATE = re.compile(r"anker_|solix|shelly|aktuell_pv", re.I)


def _building(**settings):
    return {"version": 1, "floors": [], "settings": settings}


# Produktlisten (Katalog, Gerätevorlagen) dürfen Hersteller und Integrationen nennen – aber nie
# Entitäts-IDs mit diesen Namen und nie die übrigen privaten Kennungen
VENDOR_LISTS = {"catalog-extra.js", "energytemplates.js"}
PRIVATE_IDS = re.compile(r"\b(sensor|switch|number|select|binary_sensor|button)\.\w*(anker|solix|shelly)|shelly|aktuell_pv", re.I)


def test_no_private_ids_in_package() -> None:
    files = [PKG / "const.py", PKG / "haus-daten.json", *sorted((PKG / "frontend").glob("*.js")), ROOT / "tests/browser/harness.html"]
    hits = [str(f.relative_to(ROOT)) for f in files if (PRIVATE_IDS if f.name in VENDOR_LISTS else PRIVATE).search(f.read_text(encoding="utf-8"))]
    assert hits == []


def test_energy_defaults_empty_and_saved_ids_kept() -> None:
    b = validate_building(_building())
    assert b["settings"]["energy"]["einspeisung"] is None
    b = validate_building(_building(energy={"einspeisung": "sensor.pv_einspeisung", "extra": [{"entity": "sensor.x"}]}))
    assert b["settings"]["energy"]["einspeisung"] == "sensor.pv_einspeisung"
    assert b["settings"]["energy"]["extra"] == [{"entity": "sensor.x"}]
    # ungültiger Wert wird zu None statt den Stand abzulehnen
    assert validate_building(_building(energy={"solar": 42}))["settings"]["energy"]["solar"] is None


def test_north_normalized_softly() -> None:
    assert validate_building(_building(north=450))["settings"]["north"] == 90
    assert validate_building(_building(north="-90"))["settings"]["north"] == 270
    assert validate_building(_building(north="abc"))["settings"]["north"] == 0


def test_unknown_new_keys_never_reject() -> None:
    b = validate_building(_building(alerts={"humidity_max": "x"}, functions_seen=["flow"], kiosk={"a": 1}))
    assert b["settings"]["functions_seen"] == ["flow"]


def test_seed_is_neutral_and_valid() -> None:
    b = validate_building(SEED)
    rooms = {r["id"]: r for f in b["floors"] for r in f["rooms"]}
    assert rooms["gartenhaus"]["energy_role"] == "balkonkraftwerk"
    assert all(v is None for v in b["settings"]["energy"].values() if not isinstance(v, list))


def test_manifest_version_matches() -> None:
    manifest = json.loads((PKG / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["version"] == VERSION


def test_frontend_files_stay_small() -> None:
    # über 128 KiB hängt die Auslieferung im Test-Webserver; große Teile in eigene Module auslagern
    big = {f.name: f.stat().st_size for f in (PKG / "frontend").glob("*.js") if f.stat().st_size > 125_000}
    assert big == {}


def test_energy_card_keys_kept_and_coerced() -> None:
    energy = {
        "netz": "sensor.netz_leistung",
        "netz_invert": "true",
        "akku_invert": True,
        "akku_kapazitaet": "1.6",
        "akku_reserve": 250,
        "kurz": "akku",
        "ueberschuss": {"hoch": "800", "mittel": "abc"},
        "pv_zaehler": 5,
    }
    e = validate_building(_building(energy=energy))["settings"]["energy"]
    assert e["netz"] == "sensor.netz_leistung"
    assert e["netz_invert"] is True and e["akku_invert"] is True
    assert e["akku_kapazitaet"] == 1.6
    assert e["akku_reserve"] == 10  # außerhalb 0..100 → Standard
    assert e["kurz"] == "akku"
    assert e["ueberschuss"] == {"hoch": 800.0, "mittel": 150}
    assert e["pv_zaehler"] is None
    assert validate_building(_building(energy={"kurz": "quatsch", "ueberschuss": 3}))["settings"]["energy"]["kurz"] == ""


def test_pipes_validated() -> None:
    raw = _building()
    raw["floors"] = [{"id": "eg", "name": "EG", "elevation": 0, "height": 2.5, "rooms": []}]
    raw["floors"][0]["pipes"] = [{"id": "leitung", "type": "strom", "points": [[0, 0], [1, 0]], "heights": [0.03, 0.3], "room": "r1"}]
    pipe = validate_building(raw)["floors"][0]["pipes"][0]
    assert pipe["entity"] is None and pipe["heights"] == [0.03, 0.3]
    raw["floors"][0]["pipes"] = [{"id": "x", "type": "gas", "points": [[0, 0], [1, 0]]}]
    try:
        validate_building(raw)
    except Exception:  # noqa: BLE001
        return
    raise AssertionError("unbekannter Leitungstyp angenommen")


def test_pipe_nodes_validated() -> None:
    raw = _building()
    raw["floors"] = [{"id": "eg", "name": "EG", "elevation": 0, "height": 2.5, "rooms": [],
                      "pipes": [{"id": "lan", "type": "netzwerk", "points": [[0, 0], [1, 0]], "device": "device_tracker.tv"}],
                      "nodes": [{"id": "hv", "kind": "hv", "x": 0, "z": 0}, {"id": "d", "kind": "durch", "x": 1, "z": 1, "link": "d2"}]}]
    floor = validate_building(raw)["floors"][0]
    assert floor["pipes"][0]["device"] == "device_tracker.tv"
    assert floor["nodes"][1]["link"] == "d2" and floor["nodes"][0]["entity"] is None
    raw["floors"][0]["nodes"] = [{"id": "x", "kind": "kraftwerk", "x": 0, "z": 0}]
    try:
        validate_building(raw)
    except Exception:  # noqa: BLE001
        return
    raise AssertionError("unbekannte Verteiler-Art angenommen")


def test_title_attic_and_frame_color_soft() -> None:
    raw = _building(title="Villa am See")
    raw["floors"] = [{"id": "dg", "name": "DG", "elevation": 2.75, "height": 2.4, "attic": True, "knee": 1.2,
                      "rooms": [{"id": "r", "name": "Zimmer", "points": [[0, 0], [4, 0], [4, 3], [0, 3]]}],
                      "openings": [{"id": "o", "room_id": "r", "edge": 0, "offset": 2, "width": 1, "height": 1.2, "type": "window", "frame_color": "#3a3a3a"}]}]
    out = validate_building(raw)
    floor = out["floors"][0]
    assert out["settings"]["title"] == "Villa am See"
    assert floor["attic"] is True and floor["knee"] == 1.2
    assert floor["openings"][0]["frame_color"] == "#3a3a3a"
    # ungültige Werte machen den Stand nicht kaputt, sie fallen auf den Standard zurück
    raw["settings"]["title"] = "x" * 200
    raw["floors"][0]["knee"] = 99
    raw["floors"][0]["openings"][0]["frame_color"] = "rot"
    out = validate_building(raw)
    assert out["settings"]["title"] is None
    assert out["floors"][0]["knee"] == 1.0
    assert out["floors"][0]["openings"][0]["frame_color"] is None
