"""PIN-Zugang: Standard 0000, eigene PINs je Bereich, stille Drosselung, Ablauf, geschützte Einstellungen."""

from __future__ import annotations

import copy

from homeassistant.core import HomeAssistant

from custom_components.haus3d.access import TOKEN_IDLE_S, keep_admin_settings
from custom_components.haus3d.const import DOMAIN


async def test_default_pin_and_scopes(hass: HomeAssistant, setup_integration) -> None:
    acc = hass.data[DOMAIN].access
    assert acc.is_default("edit") and acc.is_default("admin")
    edit = await acc.async_verify("edit", "0000", "u1", now=100.0)
    assert edit and acc.allows(edit, "edit", now=101.0) and not acc.allows(edit, "admin", now=101.0)
    admin = await acc.async_verify("admin", "0000", "u2", now=100.0)
    assert acc.allows(admin, "edit", now=101.0) and acc.allows(admin, "admin", now=101.0)
    # Ablauf nach 10 min ohne Nutzung, Nutzung verlängert
    assert acc.allows(edit, "edit", now=101.0 + TOKEN_IDLE_S - 1)
    assert not acc.allows(admin, "admin", now=102.0 + TOKEN_IDLE_S + 5)


async def test_wrong_pin_is_silent_and_throttled(hass: HomeAssistant, setup_integration) -> None:
    acc = hass.data[DOMAIN].access
    t = 1000.0
    for _ in range(10):
        assert await acc.async_verify("admin", "1234", "x", now=t) is None
        t += 2
    # 10 Fehlversuche: 30 s lang hilft auch die richtige PIN nicht
    assert await acc.async_verify("admin", "0000", "x", now=t) is None
    assert await acc.async_verify("admin", "0000", "x", now=t + 31) is not None
    # zu schnell hintereinander: abgewiesen
    assert await acc.async_verify("edit", "0000", "y", now=5.0)
    assert await acc.async_verify("edit", "0000", "y", now=5.1) is None


async def test_set_pin_via_ws(hass: HomeAssistant, setup_integration, hass_ws_client, hass_storage) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/pin/status"})
    assert (await ws.receive_json())["result"] == {"edit_default": True, "admin_default": True, "door_default": True}
    await ws.send_json({"id": 2, "type": "haus3d/pin/verify", "scope": "admin", "pin": "9999"})
    assert (await ws.receive_json())["result"] == {"ok": False}
    hass.data[DOMAIN].access._tries.clear()
    await ws.send_json({"id": 3, "type": "haus3d/pin/verify", "scope": "admin", "pin": "0000"})
    token = (await ws.receive_json())["result"]["token"]
    # ohne Admin-Freigabe keine neue PIN
    await ws.send_json({"id": 4, "type": "haus3d/pin/set", "scope": "edit", "pin": "4711"})
    assert (await ws.receive_json())["error"]["code"] == "locked"
    await ws.send_json({"id": 5, "type": "haus3d/pin/set", "scope": "edit", "pin": "12", "token": token})
    assert (await ws.receive_json())["error"]["code"] == "invalid_pin"
    await ws.send_json({"id": 6, "type": "haus3d/pin/set", "scope": "edit", "pin": "4711", "token": token})
    assert (await ws.receive_json())["success"]
    await hass.async_block_till_done()
    stored = hass_storage["haus3d.access"]["data"]["pins"]["edit"]
    assert "4711" not in str(stored) and len(stored["hash"]) == 64
    acc = hass.data[DOMAIN].access
    acc._tries.clear()
    assert await acc.async_verify("edit", "0000", "z", now=50.0) is None
    assert await acc.async_verify("edit", "4711", "z", now=52.0)
    assert acc.is_default("admin") and not acc.is_default("edit")
    # Beenden
    await ws.send_json({"id": 7, "type": "haus3d/pin/lock", "token": token})
    assert (await ws.receive_json())["success"]
    assert not acc.allows(token, "edit")


async def test_edit_pin_keeps_admin_settings(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    data = hass.data[DOMAIN]
    acc = data.access
    admin = await acc.async_verify("admin", "0000", "a")
    ws = await hass_ws_client(hass)
    b = copy.deepcopy(data.building)
    b["settings"]["alerts"] = {"rain": False}
    await ws.send_json({"id": 1, "type": "haus3d/building/save", "building": b, "token": admin})
    assert (await ws.receive_json())["success"]
    edit = await acc.async_verify("edit", "0000", "e")
    b2 = copy.deepcopy(data.building)
    b2["settings"]["alerts"] = {"rain": True}
    b2["settings"]["cards"] = [{"id": "k1", "title": "Test", "entities": []}]
    b2["floors"][0]["name"] = "Neu"
    await ws.send_json({"id": 2, "type": "haus3d/building/save", "building": b2, "token": edit})
    res = await ws.receive_json()
    assert res["success"]
    s = data.building["settings"]
    assert s["alerts"] == {"rain": False}  # geschützt
    assert s["cards"][0]["title"] == "Test"  # Karten darf „Bearbeiten“
    assert data.building["floors"][0]["name"] == "Neu"


def test_keep_admin_settings_removes_new_keys() -> None:
    out = keep_admin_settings({"settings": {"energy": {"solar": "sensor.x"}, "grid": 0.1}}, {"settings": {}})
    assert out["settings"] == {"grid": 0.1}


async def test_door_pin_unlocks_only_with_pin(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    """Tür-PIN: falsche PIN → nichts passiert, richtige → lock.unlock wird ausgeführt; kein Token."""
    calls = []

    async def fake(call) -> None:
        calls.append((call.service, call.data["entity_id"]))

    hass.services.async_register("lock", "unlock", fake)
    hass.services.async_register("lock", "open", fake)
    hass.states.async_set("lock.haustuer", "locked")
    acc = hass.data[DOMAIN].access
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/lock/unlock", "entity_id": "lock.haustuer", "pin": "1234"})
    assert (await ws.receive_json())["result"] == {"ok": False}
    assert calls == []
    acc._tries.clear()
    await ws.send_json({"id": 2, "type": "haus3d/lock/unlock", "entity_id": "lock.haustuer", "pin": "0000", "service": "open"})
    assert (await ws.receive_json())["result"] == {"ok": True}
    assert calls == [("open", ["lock.haustuer"])]
    # nur Schlösser
    acc._tries.clear()
    await ws.send_json({"id": 3, "type": "haus3d/lock/unlock", "entity_id": "switch.tor", "pin": "0000"})
    assert (await ws.receive_json())["error"]["code"] == "invalid_entity"
    # die Tür-PIN schaltet weder Bearbeiten noch Admin frei
    acc._tries.clear()
    await ws.send_json({"id": 4, "type": "haus3d/pin/verify", "scope": "door", "pin": "0000"})
    assert not (await ws.receive_json())["success"]
    assert await acc.async_verify("door", "0000", "q", now=1.0) is None
    # eigene Tür-PIN
    await acc.async_set_pin("door", "2468")
    acc._tries.clear()
    assert not await acc.async_check("door", "0000", "q", now=10.0)
    assert await acc.async_check("door", "2468", "q", now=20.0)
