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
    module_url = panel.config["_panel_custom"]["module_url"]
    assert module_url.startswith("/haus3d_static/") and module_url.endswith("/haus3d-panel.js")
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
    module_url = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].config["_panel_custom"]["module_url"]
    base = module_url.rsplit("/", 1)[0]  # versionierter Pfad, gilt auch für die relativen Imports
    for path in ("haus3d-panel.js", "walls.js", "scene.js", "vendor/three.module.min.js", "vendor/OrbitControls.js"):
        resp = await client.get(f"{base}/{path}")
        assert resp.status == 200, path
        assert "max-age" in resp.headers.get("Cache-Control", ""), path


async def test_ws_get_and_save(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/building/get"})
    msg = await ws.receive_json()
    assert msg["success"]
    assert msg["result"]["revision"] == 1
    building = msg["result"]["building"]
    # Zusatzfelder (NeonPlan) bleiben erhalten, Standardwerte für energy sind gesetzt
    assert building["presence"] == []
    assert building["settings"]["energy"]["einspeisung"] is None  # keine Standard-IDs (Datenschutz)

    changed = copy.deepcopy(building)
    changed["floors"][0]["name"] = "Keller"
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "token": admin_token, "building": changed, "revision": 1})
    msg = await ws.receive_json()
    assert msg["success"], msg
    assert msg["result"]["revision"] == 2
    assert hass.data[DOMAIN].building["floors"][0]["name"] == "Keller"

    # veraltete Revision -> Konflikt
    await ws.send_json({"id": 3, "type": "haus3d/building/save", "token": admin_token, "building": changed, "revision": 1})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "conflict"


async def test_ws_save_accepts_neonplan_export(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    ws = await hass_ws_client(hass)
    export = {"format": "neonplan3d", "version": 1, "exported_at": "2026-01-01T00:00:00Z", "building": SEED}
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "token": admin_token, "building": export})
    msg = await ws.receive_json()
    assert msg["success"], msg
    assert len(msg["result"]["building"]["floors"]) == len(SEED["floors"])


async def test_ws_save_validates(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    ws = await hass_ws_client(hass)
    bad = copy.deepcopy(SEED)
    bad["floors"][1]["openings"].append(
        {"id": "o1", "room_id": "gibt_es_nicht", "edge": 0, "offset": 1, "width": 1, "type": "door", "sill": 0, "height": 2}
    )
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "token": admin_token, "building": bad})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"

    bad = copy.deepcopy(SEED)
    bad["floors"][0]["rooms"][0]["points"] = [[0, 0], [1, 1]]
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "token": admin_token, "building": bad})
    msg = await ws.receive_json()
    assert not msg["success"]

    await ws.send_json({"id": 3, "type": "haus3d/building/save", "token": admin_token, "building": {"version": 2, "floors": []}})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert hass.data[DOMAIN].revision == 1


async def test_ws_save_requires_pin(hass: HomeAssistant, setup_integration, hass_ws_client, hass_admin_user) -> None:
    """Ohne PIN-Freigabe kein Speichern, auch nicht als HA-Admin; mit PIN auch ohne HA-Admin."""
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "building": SEED})
    msg = await ws.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "locked"
    hass_admin_user.groups = []
    await ws.send_json({"id": 5, "type": "haus3d/pin/verify", "scope": "edit", "pin": "0000"})
    token = (await ws.receive_json())["result"]["token"]
    await ws.send_json({"id": 6, "type": "haus3d/building/save", "building": SEED, "token": token})
    res = await ws.receive_json()
    assert res["success"], res
    # Lesen geht ohne PIN
    await ws.send_json({"id": 7, "type": "haus3d/building/get"})
    msg = await ws.receive_json()
    assert msg["success"]


async def test_history_snapshot_restore_and_limit(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/history/snapshot", "token": admin_token})
    msg = await ws.receive_json()
    assert msg["success"]
    first_id = msg["result"]["id"]

    changed = copy.deepcopy(SEED)
    changed["floors"] = changed["floors"][:1]
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "token": admin_token, "building": changed})
    assert (await ws.receive_json())["success"]
    assert len(hass.data[DOMAIN].building["floors"]) == 1

    await ws.send_json({"id": 3, "type": "haus3d/history/restore", "token": admin_token, "history_id": first_id})
    msg = await ws.receive_json()
    assert msg["success"], msg
    assert len(msg["result"]["building"]["floors"]) == len(SEED["floors"])

    await ws.send_json({"id": 4, "type": "haus3d/history/restore", "token": admin_token, "history_id": 9999})
    msg = await ws.receive_json()
    assert msg["error"]["code"] == "not_found"

    for i in range(HISTORY_LIMIT + 5):
        await ws.send_json({"id": 10 + i, "type": "haus3d/history/snapshot", "token": admin_token})
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


async def test_concurrent_saves_conflict(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    """Zwei gleichzeitige Speichervorgänge mit derselben Revision: einer muss als Konflikt scheitern."""
    import asyncio
    from unittest.mock import patch

    from homeassistant.helpers.storage import Store

    original = Store._async_write_data

    async def slow_write(self, *args, **kwargs):
        await asyncio.sleep(0.01)  # wie das echte Schreiben im Executor: gibt die Schleife frei
        return await original(self, *args, **kwargs)

    ws1 = await hass_ws_client(hass)
    ws2 = await hass_ws_client(hass)
    a = copy.deepcopy(SEED)
    a["floors"][0]["name"] = "A"
    b = copy.deepcopy(SEED)
    b["floors"][0]["name"] = "B"
    with patch.object(Store, "_async_write_data", slow_write):
        await ws1.send_json({"id": 1, "type": "haus3d/building/save", "token": admin_token, "building": a, "revision": 1})
        await ws2.send_json({"id": 1, "type": "haus3d/building/save", "token": admin_token, "building": b, "revision": 1})
        r1 = await ws1.receive_json()
        r2 = await ws2.receive_json()
    assert sorted([r1["success"], r2["success"]]) == [False, True]
    failed = r1 if not r1["success"] else r2
    assert failed["error"]["code"] == "conflict"
    assert hass.data[DOMAIN].revision == 2


async def test_free_wall_opening_without_room(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    """NeonPlan: Öffnung in freistehender Wand außerhalb aller Räume hat room_id = Wand-ID."""
    building = copy.deepcopy(SEED)
    floor = building["floors"][1]
    floor["walls"] = [{"id": "wall_garden", "a": [-20, -20], "b": [-15, -20]}]
    floor["openings"].append(
        {"id": "o_garden", "room_id": "wall_garden", "wall": "wall_garden", "edge": 0, "offset": 2, "width": 1,
         "type": "door", "sill": 0, "height": 2}
    )
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "token": admin_token, "building": building})
    msg = await ws.receive_json()
    assert msg["success"], msg
    # unbekannte Wand bleibt ein Fehler
    floor["openings"][-1]["wall"] = "gibt_es_nicht"
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "token": admin_token, "building": building})
    msg = await ws.receive_json()
    assert msg["error"]["code"] == "invalid_format"


async def test_invalid_stored_state_is_backed_up(hass: HomeAssistant, hass_storage) -> None:
    broken = {"revision": 5, "building": {"version": 1, "floors": [{"id": "eg"}]}}
    hass_storage["haus3d.building"] = {"version": 1, "minor_version": 1, "key": "haus3d.building", "data": broken}
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN].building["floors"] == []
    assert hass_storage["haus3d.building_invalid"]["data"] == broken


async def test_balcony_roof_and_weather_settings(hass: HomeAssistant, setup_integration, hass_ws_client, admin_token) -> None:
    """Balkon als Gartenfläche, Dach- und Wettereinstellungen werden gespeichert und geprüft."""
    building = copy.deepcopy(SEED)
    floor = building["floors"][-1]
    floor.setdefault("outdoor", []).append(
        {"id": "balkon", "type": "balcony", "points": [[0, -1.5], [3, -1.5], [3, 0], [0, 0]], "railing": "bars"}
    )
    floor["outdoor"].append({"id": "kies", "type": "gravel", "points": [[20, 0], [22, 0], [22, 2]]})
    floor["rooms"][0]["wall_color"] = "#9cc0dc"
    building["settings"]["wall_colors"] = {"exterior": "#f3efe7"}
    building["settings"]["roof"] = {"type": "gable", "pitch": 30, "overhang": 0.5}
    building["settings"]["weather"] = "weather.zuhause"
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "token": admin_token, "building": building})
    msg = await ws.receive_json()
    assert msg["success"], msg
    saved = msg["result"]["building"]
    assert saved["settings"]["roof"]["type"] == "gable"
    assert saved["settings"]["roof"]["direction"] == "auto"
    assert saved["settings"]["weather"] == "weather.zuhause"
    assert saved["floors"][-1]["outdoor"][-2]["railing"] == "bars"
    assert saved["floors"][-1]["outdoor"][-1]["type"] == "gravel"
    assert saved["floors"][-1]["rooms"][0]["wall_color"] == "#9cc0dc"
    building["settings"]["roof"]["type"] = "kuppel"
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "token": admin_token, "building": building, "revision": msg["result"]["revision"]})
    msg = await ws.receive_json()
    assert msg["error"]["code"] == "invalid_format"
