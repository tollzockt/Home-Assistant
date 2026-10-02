"""Tests für Einrichtung, Panel, Speicherung und WebSocket-Befehle."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from homeassistant import config_entries
from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.haus3d.const import DOMAIN, HISTORY_LIMIT, PANEL_URL_PATH

SEED = json.loads((Path(__file__).parents[2] / "custom_components/haus3d/haus-daten.json").read_text(encoding="utf-8"))


async def test_config_flow_single_instance(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Haus 3D"

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_setup_registers_panel_and_seeds(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    assert setup_integration.state is ConfigEntryState.LOADED
    panels = hass.data[frontend.DATA_PANELS]
    assert PANEL_URL_PATH in panels
    panel = panels[PANEL_URL_PATH]
    assert panel.sidebar_title == "Haus 3D"
    assert panel.sidebar_icon == "mdi:home-floor-3"
    assert panel.config["_panel_custom"]["module_url"].startswith("/haus3d_static/haus3d-panel.js?v=")
    assert [f["id"] for f in hass.data[DOMAIN].building["floors"]] == [f["id"] for f in SEED["floors"]]
    assert hass.data[DOMAIN].revision == 1


async def test_reload_and_unload(hass: HomeAssistant, setup_integration: MockConfigEntry) -> None:
    # Reload darf weder an Panel noch an statischen Pfaden scheitern
    assert await hass.config_entries.async_reload(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert setup_integration.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH in hass.data[frontend.DATA_PANELS]

    assert await hass.config_entries.async_unload(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]
    assert DOMAIN not in hass.data

    # und wieder laden: der gespeicherte Stand bleibt
    assert await hass.config_entries.async_setup(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert PANEL_URL_PATH in hass.data[frontend.DATA_PANELS]


async def test_static_frontend_served(hass: HomeAssistant, setup_integration, hass_client) -> None:
    client = await hass_client()
    for path in ("haus3d-panel.js", "walls.js", "vendor/three.module.min.js", "vendor/OrbitControls.js"):
        resp = await client.get(f"/haus3d_static/{path}")
        assert resp.status == 200, path


async def test_ws_get_and_save(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/building/get"})
    msg = await ws.receive_json()
    assert msg["success"]
    assert msg["result"]["revision"] == 1
    building = msg["result"]["building"]
    # Zusatzfelder (NeonPlan) bleiben erhalten, Standardwerte für energy sind gesetzt
    assert building["presence"] == []
    assert building["settings"]["energy"]["einspeisung"] == "sensor.pv_einspeisung"

    changed = copy.deepcopy(building)
    changed["floors"][0]["name"] = "Keller"
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "building": changed, "revision": 1})
    msg = await ws.receive_json()
    assert msg["success"], msg
    assert msg["result"]["revision"] == 2
    assert hass.data[DOMAIN].building["floors"][0]["name"] == "Keller"

    # veraltete Revision -> Konflikt
    await ws.send_json({"id": 3, "type": "haus3d/building/save", "building": changed, "revision": 1})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "conflict"


async def test_ws_save_accepts_neonplan_export(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    ws = await hass_ws_client(hass)
    export = {"format": "neonplan3d", "version": 1, "exported_at": "2026-01-01T00:00:00Z", "building": SEED}
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "building": export})
    msg = await ws.receive_json()
    assert msg["success"], msg
    assert len(msg["result"]["building"]["floors"]) == len(SEED["floors"])


async def test_ws_save_validates(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    ws = await hass_ws_client(hass)
    bad = copy.deepcopy(SEED)
    bad["floors"][1]["openings"][0]["room_id"] = "gibt_es_nicht"
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "building": bad})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"

    bad = copy.deepcopy(SEED)
    bad["floors"][0]["rooms"][0]["points"] = [[0, 0], [1, 1]]
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "building": bad})
    msg = await ws.receive_json()
    assert not msg["success"]

    await ws.send_json({"id": 3, "type": "haus3d/building/save", "building": {"version": 2, "floors": []}})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert hass.data[DOMAIN].revision == 1


async def test_ws_save_requires_admin(hass: HomeAssistant, setup_integration, hass_ws_client, hass_admin_user) -> None:
    hass_admin_user.groups = []
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "building": SEED})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "unauthorized"
    # Lesen geht weiterhin
    await ws.send_json({"id": 2, "type": "haus3d/building/get"})
    msg = await ws.receive_json()
    assert msg["success"]


async def test_history_snapshot_restore_and_limit(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/history/snapshot"})
    msg = await ws.receive_json()
    assert msg["success"]
    first_id = msg["result"]["id"]

    changed = copy.deepcopy(SEED)
    changed["floors"] = changed["floors"][:1]
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "building": changed})
    assert (await ws.receive_json())["success"]
    assert len(hass.data[DOMAIN].building["floors"]) == 1

    await ws.send_json({"id": 3, "type": "haus3d/history/restore", "history_id": first_id})
    msg = await ws.receive_json()
    assert msg["success"], msg
    assert len(msg["result"]["building"]["floors"]) == len(SEED["floors"])

    await ws.send_json({"id": 4, "type": "haus3d/history/restore", "history_id": 9999})
    msg = await ws.receive_json()
    assert msg["error"]["code"] == "not_found"

    for i in range(HISTORY_LIMIT + 5):
        await ws.send_json({"id": 10 + i, "type": "haus3d/history/snapshot"})
        assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 100, "type": "haus3d/history/list"})
    msg = await ws.receive_json()
    items = msg["result"]["items"]
    assert len(items) == HISTORY_LIMIT
    assert items[0]["id"] > items[-1]["id"]  # neueste zuerst
    assert "building" not in items[0]


async def test_stored_state_survives_restart(hass: HomeAssistant, hass_storage) -> None:
    hass_storage["haus3d.building"] = {
        "version": 1,
        "minor_version": 1,
        "key": "haus3d.building",
        "data": {"revision": 7, "building": {"version": 1, "floors": [], "settings": {}}},
    }
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    # kein Überschreiben mit dem Startstand, wenn schon etwas gespeichert ist
    assert hass.data[DOMAIN].revision == 7
    assert hass.data[DOMAIN].building["floors"] == []
