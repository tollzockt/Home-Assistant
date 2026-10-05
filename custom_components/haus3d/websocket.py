"""WebSocket-Befehle von Haus 3D."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import BACKGROUND_MAX_CHARS, DOMAIN, SIGNAL_COMMAND
from .schema import validate_building
from .storage import Haus3DData, RevisionConflict


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Registriert die Befehle (nur einmal pro HA-Lauf, siehe __init__.py)."""
    for command in (ws_get, ws_save, ws_history_list, ws_history_snapshot, ws_history_restore, ws_background_get, ws_background_set, ws_subscribe):
        websocket_api.async_register_command(hass, command)


def _data(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> Haus3DData | None:
    data: Haus3DData | None = hass.data.get(DOMAIN)
    if data is None:
        connection.send_error(msg["id"], "not_loaded", "Haus 3D ist nicht geladen")
    return data


@websocket_api.websocket_command({vol.Required("type"): "haus3d/building/get"})
@callback
def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Liefert Gebäude und Revision."""
    if (data := _data(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"building": data.building, "revision": data.revision})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haus3d/building/save",
        vol.Required("building"): dict,
        vol.Optional("revision"): vol.Any(None, int),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Prüft und speichert ein Gebäude. Mit `revision` wird ein zwischenzeitlicher Stand erkannt."""
    if (data := _data(hass, connection, msg)) is None:
        return
    try:
        building = validate_building(msg["building"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    try:
        revision = await data.async_save(building, msg.get("revision"))
    except RevisionConflict:
        connection.send_error(msg["id"], "conflict", "Der Stand wurde inzwischen geändert")
        return
    connection.send_result(msg["id"], {"revision": revision, "building": data.building})


@websocket_api.websocket_command({vol.Required("type"): "haus3d/history/list"})
@websocket_api.require_admin
@callback
def ws_history_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Listet die aufgehobenen Stände."""
    if (data := _data(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"items": data.history_summary()})


@websocket_api.websocket_command({vol.Required("type"): "haus3d/history/snapshot"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_history_snapshot(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Hebt den aktuellen Stand im Verlauf auf."""
    if (data := _data(hass, connection, msg)) is None:
        return
    item = await data.async_snapshot("manual")
    connection.send_result(msg["id"], {"id": item["id"], "items": data.history_summary()})


@websocket_api.websocket_command({vol.Required("type"): "haus3d/history/restore", vol.Required("history_id"): int})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_history_restore(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Stellt einen aufgehobenen Stand wieder her."""
    if (data := _data(hass, connection, msg)) is None:
        return
    try:
        revision = await data.async_restore(msg["history_id"])
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Diesen Stand gibt es nicht")
        return
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    connection.send_result(msg["id"], {"revision": revision, "building": data.building})


@websocket_api.websocket_command({vol.Required("type"): "haus3d/background/get", vol.Required("floor_id"): str})
@websocket_api.async_response
async def ws_background_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Liefert das Bauplan-Foto bzw. Luftbild einer Etage (Daten-URL) oder None."""
    if (data := _data(hass, connection, msg)) is None:
        return
    connection.send_result(msg["id"], {"image": await data.async_get_background(msg["floor_id"])})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haus3d/background/set",
        vol.Required("floor_id"): str,
        vol.Required("image"): vol.Any(None, vol.All(str, vol.Match(r"^data:image/(jpeg|png|webp);base64,"))),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_background_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Speichert (oder entfernt) das Bild einer Etage."""
    if (data := _data(hass, connection, msg)) is None:
        return
    image = msg["image"]
    if image and len(image) > BACKGROUND_MAX_CHARS:
        connection.send_error(msg["id"], "too_large", "Bild ist zu groß (höchstens etwa 2 MB)")
        return
    await data.async_set_background(msg["floor_id"], image)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): "haus3d/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Offene Panels hören auf Befehle der Dienste (Etage zeigen, Hinweis, Raum hervorheben …)."""

    @callback
    def forward(command: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], command))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_COMMAND, forward)
    connection.send_result(msg["id"])
