"""Gemeinsame Fixtures."""

from __future__ import annotations

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.haus3d.const import DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Lädt custom_components/ in allen Tests."""
    return


@pytest.fixture
async def setup_integration(hass: HomeAssistant) -> MockConfigEntry:
    """Richtet Haus 3D mit HTTP-Server ein."""
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Haus 3D", data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry
