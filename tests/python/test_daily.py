"""Alltag im Hintergrund: Heizung bei offenem Fenster pausieren und wiederherstellen, Anwesenheit simulieren."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import async_fire_time_changed, async_mock_service

from custom_components.haus3d.const import DOMAIN


async def _house(hass: HomeAssistant, *, auto: bool = False) -> None:
    """Raum „Bad“ mit Bereich, Fensterkontakt, Thermostat und Licht."""
    area = ar.async_get(hass).async_create("Bad")
    reg = er.async_get(hass)
    for domain, uid, cls in (("binary_sensor", "fenster", "window"), ("climate", "heizung", None), ("light", "decke", None)):
        e = reg.async_get_or_create(domain, "test", uid, suggested_object_id=f"bad_{uid}", original_device_class=cls)
        reg.async_update_entity(e.entity_id, area_id=area.id)
    data = hass.data[DOMAIN]
    data.building = {"version": 1, "floors": [{"id": "eg", "name": "EG", "elevation": 0, "height": 2.5, "rooms": [{"id": "bad", "name": "Bad", "area_id": area.id, "points": [[0, 0], [3, 0], [3, 3], [0, 3]]}]}],
                     "settings": {"daily": {"window_heat": {"auto": auto, "minutes": 2}}}}
    data.revision += 1
    hass.states.async_set("binary_sensor.bad_fenster", "off", {"device_class": "window"})
    hass.states.async_set("climate.bad_heizung", "heat", {"hvac_modes": ["off", "heat"], "hvac_action": "heating", "temperature": 21.5})
    hass.states.async_set("light.bad_decke", "off")
    await hass.async_block_till_done()


async def test_pause_by_button_and_resume_when_closed(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    await _house(hass)
    modes = async_mock_service(hass, "climate", "set_hvac_mode")
    temps = async_mock_service(hass, "climate", "set_temperature")
    ws = await hass_ws_client(hass)
    # Fenster zu: nichts zu pausieren
    await ws.send_json({"id": 1, "type": "haus3d/climate/pause", "entity_id": "climate.bad_heizung"})
    assert (await ws.receive_json())["result"] == {"ok": False}
    hass.states.async_set("binary_sensor.bad_fenster", "on", {"device_class": "window"})
    await ws.send_json({"id": 2, "type": "haus3d/climate/pause", "entity_id": "climate.bad_heizung"})
    assert (await ws.receive_json())["result"] == {"ok": True}
    assert modes[-1].data == {"entity_id": "climate.bad_heizung", "hvac_mode": "off"}
    # Fenster zu → alter Zustand zurück
    hass.states.async_set("climate.bad_heizung", "off", {"hvac_modes": ["off", "heat"]})
    hass.states.async_set("binary_sensor.bad_fenster", "off", {"device_class": "window"})
    await hass.async_block_till_done()
    assert modes[-1].data["hvac_mode"] == "heat"
    assert temps[-1].data["temperature"] == 21.5
    assert not hass.data[DOMAIN].daily.paused


async def test_auto_pause_after_minutes(hass: HomeAssistant, setup_integration) -> None:
    await _house(hass, auto=True)
    modes = async_mock_service(hass, "climate", "set_hvac_mode")
    hass.states.async_set("binary_sensor.bad_fenster", "on", {"device_class": "window"})
    await hass.async_block_till_done()
    assert not modes  # erst nach 2 min
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=3))
    await hass.async_block_till_done()
    assert modes and modes[-1].data["hvac_mode"] == "off"
    assert "climate.bad_heizung" in hass.data[DOMAIN].daily.paused


async def test_auto_skips_when_closed_again(hass: HomeAssistant, setup_integration) -> None:
    await _house(hass, auto=True)
    modes = async_mock_service(hass, "climate", "set_hvac_mode")
    hass.states.async_set("binary_sensor.bad_fenster", "on", {"device_class": "window"})
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.bad_fenster", "off", {"device_class": "window"})
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=3))
    await hass.async_block_till_done()
    assert not modes


async def test_away_simulation(hass: HomeAssistant, setup_integration, hass_ws_client) -> None:
    await _house(hass)
    on = async_mock_service(hass, "light", "turn_on")
    off = async_mock_service(hass, "light", "turn_off")
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haus3d/away/status"})
    assert (await ws.receive_json())["result"] == {"on": False, "lights": 1, "paused": []}
    await hass.services.async_call(DOMAIN, "away", {"on": True}, blocking=True)
    daily = hass.data[DOMAIN].daily
    assert daily.away["on"]
    hass.states.async_set("sun.sun", "below_horizon")
    evening = dt_util.now().replace(hour=20, minute=0)
    with patch("custom_components.haus3d.daily.dt_util.now", return_value=evening), patch("custom_components.haus3d.daily.random.random", return_value=0.1):
        await daily._away_tick()
    assert on and on[-1].data["entity_id"] == "light.bad_decke"
    assert daily.away["mine"] == ["light.bad_decke"]
    # aus: eigene Lichter wieder aus
    await ws.send_json({"id": 2, "type": "haus3d/away/set", "on": False})
    assert (await ws.receive_json())["result"] == {"on": False}
    assert off and off[-1].data["entity_id"] == ["light.bad_decke"]
    assert not daily.away["on"] and daily.away["mine"] == []
