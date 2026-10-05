"""Dienste, Abo für offene Panels und Bauplan-Fotos."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from custom_components.haus3d.const import DOMAIN

IMG = "data:image/jpeg;base64,/9j/AAAA"


async def test_services_reach_subscribed_panels(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    for name in ("show", "notify", "highlight", "reload"):
        assert hass.services.has_service(DOMAIN, name)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/subscribe"})
    assert (await ws.receive_json())["success"]
    await hass.services.async_call(DOMAIN, "notify", {"message": "Waschmaschine fertig", "target": "flur"}, blocking=True)
    msg = await ws.receive_json()
    assert msg["type"] == "event"
    assert msg["event"] == {"service": "notify", "message": "Waschmaschine fertig", "level": "warn", "target": "flur"}
    await hass.services.async_call(DOMAIN, "highlight", {"room": "kueche"}, blocking=True)
    msg = await ws.receive_json()
    assert msg["event"]["seconds"] == 10


async def test_services_removed_on_unload(hass: HomeAssistant, setup_integration) -> None:
    await hass.config_entries.async_unload(setup_integration.entry_id)
    await hass.async_block_till_done()
    assert not hass.services.has_service(DOMAIN, "show")


async def test_background_roundtrip(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/background/get", "floor_id": "eg"})
    assert (await ws.receive_json())["result"] == {"image": None}
    await ws.send_json({"id": 2, "type": "haus3d/background/set", "floor_id": "eg", "image": IMG})
    assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 3, "type": "haus3d/background/get", "floor_id": "eg"})
    assert (await ws.receive_json())["result"] == {"image": IMG}
    await ws.send_json({"id": 4, "type": "haus3d/background/set", "floor_id": "eg", "image": "javascript:x"})
    assert not (await ws.receive_json())["success"]
    await ws.send_json({"id": 5, "type": "haus3d/background/set", "floor_id": "eg", "image": IMG + "A" * 3_000_001})
    res = await ws.receive_json()
    assert res["error"]["code"] == "too_large"
    await ws.send_json({"id": 6, "type": "haus3d/background/set", "floor_id": "eg", "image": None})
    assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 7, "type": "haus3d/background/get", "floor_id": "eg"})
    assert (await ws.receive_json())["result"] == {"image": None}
