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


def test_no_private_ids_in_package() -> None:
    files = [PKG / "const.py", PKG / "haus-daten.json", *sorted((PKG / "frontend").glob("*.js")), ROOT / "tests/browser/harness.html"]
    hits = [str(f.relative_to(ROOT)) for f in files if PRIVATE.search(f.read_text(encoding="utf-8"))]
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
