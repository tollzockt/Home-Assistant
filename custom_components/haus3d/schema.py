"""Validierung des Gebäudeformats (kompatibel mit NeonPlan 3D).

Die Felder, die Haus 3D selbst benutzt, werden geprüft; alle anderen Felder bleiben
erhalten (extra=ALLOW_EXTRA), damit NeonPlan-Exporte ohne Verlust durchgereicht werden.
"""

from __future__ import annotations

import copy
from typing import Any

import voluptuous as vol

from .const import DEFAULT_ENERGY, NEONPLAN_BACKUP_FORMAT, NEONPLAN_EXPORT_FORMAT

MAX_FLOORS = 20
MAX_ROOMS = 200
MAX_POINTS = 200
MAX_ITEMS = 1000

_ID = vol.All(str, vol.Length(min=1, max=64))
_NAME = vol.All(str, vol.Length(max=100))
_COORD = vol.All(vol.Coerce(float), vol.Range(min=-1000, max=1000))
_LENGTH = vol.All(vol.Coerce(float), vol.Range(min=0, max=100))
_POINT = vol.All([_COORD], vol.Length(min=2, max=2))
_ENTITY = vol.Any(None, vol.All(str, vol.Length(max=255)))


def _soft(validator: Any, default: Any) -> Any:
    """Weiche Prüfung: ungültige Werte werden durch den Standard ersetzt statt abgelehnt.

    Ein abgelehnter Wert würde den ganzen gespeicherten Stand ungültig machen, deshalb gilt das
    für alle neueren, optionalen Einstellungen.
    """

    def check(value: Any) -> Any:
        try:
            return validator(value)
        except (vol.Invalid, ValueError, TypeError):
            return default() if callable(default) else default

    return check


def _north(value: Any) -> float:
    return round(float(value) % 360, 3)

OPENING_TYPES = ["window", "door", "garage"]
OPENING_STYLES = [
    "interior",
    "front",
    "front_glass",
    "sidelight",
    "sidelights",
    "glass",
    "sliding",
    "passage",
    "standard",
    "bars",
]
OUTDOOR_TYPES = ["lawn", "terrace", "path", "driveway", "pool", "bed", "hedge", "fence", "balcony", "gravel", "paving", "rockery"]
ROOF_TYPES = ["none", "flat", "gable", "hip", "shed"]

ROOF_SCHEMA = vol.Schema(
    {
        vol.Optional("type", default="none"): vol.In(ROOF_TYPES),
        vol.Optional("pitch", default=35): vol.All(vol.Coerce(float), vol.Range(min=5, max=60)),
        vol.Optional("overhang", default=0.4): vol.All(vol.Coerce(float), vol.Range(min=0, max=1.5)),
        vol.Optional("direction", default="auto"): vol.In(["auto", "x", "z"]),
    },
    extra=vol.ALLOW_EXTRA,
)

ROOM_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _ID,
        vol.Required("name"): _NAME,
        vol.Optional("area_id", default=None): _ENTITY,
        vol.Required("points"): vol.All([_POINT], vol.Length(min=3, max=MAX_POINTS)),
        vol.Optional("floor_material", default="wood"): vol.All(str, vol.Length(max=32)),
    },
    extra=vol.ALLOW_EXTRA,
)

OPENING_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _ID,
        vol.Required("room_id"): _ID,
        vol.Required("edge"): vol.All(int, vol.Range(min=0, max=MAX_POINTS)),
        # Abstand der Mitte der Öffnung vom Punkt points[edge]
        vol.Required("offset"): _LENGTH,
        vol.Required("width"): _LENGTH,
        vol.Required("type"): vol.In(OPENING_TYPES),
        vol.Optional("sill", default=0.0): _LENGTH,
        vol.Required("height"): _LENGTH,
        vol.Optional("hinge", default="left"): vol.In(["left", "right"]),
        vol.Optional("swing", default="in"): vol.In(["in", "out"]),
        vol.Optional("style", default=None): vol.Any(None, vol.In(OPENING_STYLES)),
        vol.Optional("cover", default=None): _ENTITY,
        vol.Optional("contact", default=None): _ENTITY,
        vol.Optional("tilt", default=None): _soft(_ENTITY, None),
    },
    extra=vol.ALLOW_EXTRA,
)

PLACEMENT_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): vol.All(str, vol.Length(max=255)),
        vol.Required("x"): _COORD,
        vol.Required("z"): _COORD,
        vol.Optional("y", default=None): vol.Any(None, _LENGTH),
    },
    extra=vol.ALLOW_EXTRA,
)

OUTDOOR_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _ID,
        vol.Required("type"): vol.In(OUTDOOR_TYPES),
        vol.Required("points"): vol.All([_POINT], vol.Length(min=3, max=MAX_POINTS)),
    },
    extra=vol.ALLOW_EXTRA,
)

PIPE_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _ID,
        vol.Required("type"): vol.In(["strom", "wasser_kalt", "wasser_warm", "netzwerk"]),
        vol.Required("points"): vol.All([_POINT], vol.Length(min=2, max=MAX_POINTS)),
        vol.Optional("heights", default=None): vol.Any(None, vol.All([vol.Coerce(float)], vol.Length(max=MAX_POINTS))),
        vol.Optional("entity", default=None): vol.Any(None, vol.All(str, vol.Length(max=255))),
        vol.Optional("room", default=None): vol.Any(None, _ID),
        vol.Optional("device", default=None): vol.Any(None, vol.All(str, vol.Length(max=255))),
    },
    extra=vol.ALLOW_EXTRA,
)

# Verteiler im Leitungsnetz (Hauptverteilung, Unterverteilung, Router, Hausanschluss, Durchführung …)
NODE_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _ID,
        vol.Required("kind"): vol.In(["hv", "uv", "einspeisung", "router", "switch", "wasser_in", "warm_in", "durch"]),
        vol.Required("x"): _COORD,
        vol.Required("z"): _COORD,
        vol.Optional("y", default=None): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0, max=20))),
        vol.Optional("name", default=None): vol.Any(None, vol.All(str, vol.Length(max=80))),
        vol.Optional("entity", default=None): vol.Any(None, vol.All(str, vol.Length(max=255))),
        vol.Optional("link", default=None): vol.Any(None, _ID),
    },
    extra=vol.ALLOW_EXTRA,
)

FLOOR_SCHEMA = vol.Schema(
    {
        vol.Required("id"): _ID,
        vol.Required("name"): _NAME,
        vol.Required("elevation"): vol.All(vol.Coerce(float), vol.Range(min=-100, max=500)),
        vol.Required("height"): vol.All(vol.Coerce(float), vol.Range(min=1, max=20)),
        vol.Optional("cut_height", default=1.15): vol.All(vol.Coerce(float), vol.Range(min=0.2, max=20)),
        vol.Required("rooms"): vol.All([ROOM_SCHEMA], vol.Length(max=MAX_ROOMS)),
        vol.Optional("openings", default=list): vol.All([OPENING_SCHEMA], vol.Length(max=MAX_ITEMS)),
        vol.Optional("furniture", default=list): vol.All([dict], vol.Length(max=MAX_ITEMS)),
        vol.Optional("placements", default=list): vol.All([PLACEMENT_SCHEMA], vol.Length(max=MAX_ITEMS)),
        vol.Optional("background", default=None): vol.Any(None, dict),
        vol.Optional("outdoor", default=list): vol.All([OUTDOOR_SCHEMA], vol.Length(max=MAX_ITEMS)),
        vol.Optional("pipes", default=list): vol.All([PIPE_SCHEMA], vol.Length(max=MAX_ITEMS)),
        vol.Optional("nodes", default=list): vol.All([NODE_SCHEMA], vol.Length(max=MAX_ITEMS)),
    },
    extra=vol.ALLOW_EXTRA,
)

_SURPLUS = vol.Schema(
    {
        vol.Optional("hoch"): _soft(vol.All(vol.Coerce(float), vol.Range(min=0, max=100000)), 600),
        vol.Optional("mittel"): _soft(vol.All(vol.Coerce(float), vol.Range(min=0, max=100000)), 150),
    },
    extra=vol.ALLOW_EXTRA,
)

ENERGY_SCHEMA = vol.Schema(
    {
        **{vol.Optional(key, default=value): _soft(_ENTITY, None) for key, value in DEFAULT_ENERGY.items()},
        # Energie-Karte 2.0: ohne Standardwert, damit der Startstand nur leere IDs enthält
        vol.Optional("netz_invert"): _soft(vol.Boolean(), False),
        vol.Optional("akku_invert"): _soft(vol.Boolean(), False),
        vol.Optional("akku_kapazitaet"): _soft(vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0, max=1000))), None),
        vol.Optional("akku_reserve"): _soft(vol.All(vol.Coerce(float), vol.Range(min=0, max=100)), 10),
        vol.Optional("kurz"): _soft(vol.In(["", "akku", "solar", "netz", "verbrauch", "ueberschuss"]), ""),
        vol.Optional("ueberschuss"): _soft(_SURPLUS, dict),
        vol.Optional("pv_zaehler"): _soft(_ENTITY, None),
        vol.Optional("bezug_zaehler"): _soft(_ENTITY, None),
        vol.Optional("einspeise_zaehler"): _soft(_ENTITY, None),
        # 0.17: Basis (Haus, Netz getrennt) und Quellen (PV, Balkonkraftwerk, AC-Speicher)
        vol.Optional("haus"): _soft(_ENTITY, None),
        vol.Optional("netz_bezug"): _soft(_ENTITY, None),
        vol.Optional("netz_einspeisung"): _soft(_ENTITY, None),
        vol.Optional("sources"): _soft(vol.All([dict], vol.Length(max=20)), list),
    },
    extra=vol.ALLOW_EXTRA,
)

SETTINGS_SCHEMA = vol.Schema(
    {
        vol.Optional("wall_exterior", default=0.24): vol.All(vol.Coerce(float), vol.Range(min=0.02, max=1)),
        vol.Optional("wall_interior", default=0.12): vol.All(vol.Coerce(float), vol.Range(min=0.02, max=1)),
        vol.Optional("grid", default=0.05): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1)),
        vol.Optional("energy", default=lambda: dict(DEFAULT_ENERGY)): ENERGY_SCHEMA,
        vol.Optional("roof"): ROOF_SCHEMA,
        vol.Optional("weather"): vol.Any(None, str),
        vol.Optional("north"): _soft(_north, 0),
    },
    extra=vol.ALLOW_EXTRA,
)


def _unique_ids(building: dict[str, Any]) -> dict[str, Any]:
    """Prüft Querbezüge: eindeutige Etagen-IDs, Öffnungen an existierenden Räumen und Kanten."""
    floor_ids = [f["id"] for f in building["floors"]]
    if len(floor_ids) != len(set(floor_ids)):
        raise vol.Invalid("Etagen-IDs sind nicht eindeutig")
    for floor in building["floors"]:
        rooms = {r["id"]: r for r in floor["rooms"]}
        if len(rooms) != len(floor["rooms"]):
            raise vol.Invalid(f"Raum-IDs auf Etage {floor['id']} sind nicht eindeutig")
        wall_ids = {w.get("id") for w in floor.get("walls") or [] if isinstance(w, dict)}
        for opening in floor["openings"]:
            if opening.get("wall"):
                # Öffnung in einer freistehenden Wand: NeonPlan setzt room_id dann auch auf die Wand-ID
                # oder lässt sie nach dem Löschen des Raums stehen – maßgeblich ist nur die Wand
                if opening["wall"] not in wall_ids:
                    raise vol.Invalid(f"Öffnung {opening['id']}: Wand {opening['wall']} fehlt")
                continue
            room = rooms.get(opening["room_id"])
            if room is None:
                raise vol.Invalid(f"Öffnung {opening['id']}: Raum {opening['room_id']} fehlt")
            if opening["edge"] >= len(room["points"]):
                raise vol.Invalid(f"Öffnung {opening['id']}: Kante {opening['edge']} gibt es nicht")
    return building


BUILDING_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Required("version"): 1,
            vol.Required("floors"): vol.All([FLOOR_SCHEMA], vol.Length(max=MAX_FLOORS)),
            vol.Optional("settings", default=dict): SETTINGS_SCHEMA,
        },
        extra=vol.ALLOW_EXTRA,
    ),
    _unique_ids,
)


def unwrap_export(data: Any) -> Any:
    """Gibt das Gebäude aus einem NeonPlan-Export/Backup zurück, sonst die Daten unverändert."""
    if isinstance(data, dict) and data.get("format") in (NEONPLAN_EXPORT_FORMAT, NEONPLAN_BACKUP_FORMAT):
        return data.get("building")
    return data


def validate_building(data: Any) -> dict[str, Any]:
    """Validiert ein Gebäude (oder einen NeonPlan-Export) und liefert eine bereinigte Kopie."""
    return BUILDING_SCHEMA(copy.deepcopy(unwrap_export(data)))


def empty_building() -> dict[str, Any]:
    """Ein Gebäude ohne Etagen."""
    return validate_building({"version": 1, "floors": [], "settings": {}})
