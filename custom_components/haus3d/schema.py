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
OUTDOOR_TYPES = ["lawn", "terrace", "path", "driveway", "pool", "bed", "hedge", "fence"]

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
    },
    extra=vol.ALLOW_EXTRA,
)

ENERGY_SCHEMA = vol.Schema(
    {vol.Optional(key, default=value): _ENTITY for key, value in DEFAULT_ENERGY.items()},
    extra=vol.ALLOW_EXTRA,
)

SETTINGS_SCHEMA = vol.Schema(
    {
        vol.Optional("wall_exterior", default=0.24): vol.All(vol.Coerce(float), vol.Range(min=0.02, max=1)),
        vol.Optional("wall_interior", default=0.12): vol.All(vol.Coerce(float), vol.Range(min=0.02, max=1)),
        vol.Optional("grid", default=0.05): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=1)),
        vol.Optional("energy", default=lambda: dict(DEFAULT_ENERGY)): ENERGY_SCHEMA,
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
        for opening in floor["openings"]:
            room = rooms.get(opening["room_id"])
            if room is None:
                raise vol.Invalid(f"Öffnung {opening['id']}: Raum {opening['room_id']} fehlt")
            if not opening.get("wall") and opening["edge"] >= len(room["points"]):
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
