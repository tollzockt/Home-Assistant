"""Dienste von Haus 3D: offene Panels (z. B. das Wandtablet) aus Automationen steuern."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DOMAIN, SIGNAL_COMMAND

_TARGET = {vol.Optional("target"): cv.string}

SERVICES: dict[str, vol.Schema] = {
    # Etage, Blickwinkel (iso, oben, sued, nord, ost, west oder Name einer gemerkten Ansicht) oder Raum zeigen
    "show": vol.Schema({vol.Optional("floor"): cv.string, vol.Optional("view"): cv.string, vol.Optional("room"): cv.string, **_TARGET}),
    # Hinweis am Modell (Banner, weckt das Tablet)
    "notify": vol.Schema(
        {
            vol.Required("message"): cv.string,
            vol.Optional("level", default="warn"): vol.In(["info", "warn", "critical"]),
            vol.Optional("room"): cv.string,
            vol.Optional("icon"): cv.icon,
            **_TARGET,
        }
    ),
    # Raum kurz hervorheben (blinkt)
    "highlight": vol.Schema(
        {vol.Required("room"): cv.string, vol.Optional("seconds", default=10): vol.All(vol.Coerce(int), vol.Range(min=1, max=600)), **_TARGET}
    ),
    # Panels laden den Grundriss neu
    "reload": vol.Schema({**_TARGET}),
}


# Dienste mit Wirkung im Hintergrund (daily.py)
AWAY_SCHEMA = vol.Schema({vol.Required("on"): cv.boolean})


@callback
def async_register_services(hass: HomeAssistant) -> None:
    """Registriert die Dienste (einmal je Lauf)."""

    @callback
    def handle(call: ServiceCall) -> None:
        async_dispatcher_send(hass, SIGNAL_COMMAND, {"service": call.service, **dict(call.data)})

    for name, schema in SERVICES.items():
        if not hass.services.has_service(DOMAIN, name):
            hass.services.async_register(DOMAIN, name, handle, schema=schema)

    async def away(call: ServiceCall) -> None:
        # Anwesenheit simulieren (Urlaub), z. B. aus einer Automation „alle weg“
        if (data := hass.data.get(DOMAIN)) is not None:
            await data.daily.async_set_away(call.data["on"])

    if not hass.services.has_service(DOMAIN, "away"):
        hass.services.async_register(DOMAIN, "away", away, schema=AWAY_SCHEMA)


@callback
def async_remove_services(hass: HomeAssistant) -> None:
    for name in [*SERVICES, "away"]:
        hass.services.async_remove(DOMAIN, name)
