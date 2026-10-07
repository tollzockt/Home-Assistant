"""Alltag im Hintergrund (läuft auch ohne offenes Tablet).

- Heizung pausieren, solange ein Fenster im Raum offen ist (von Hand per Knopf oder automatisch nach
  einigen Minuten), und danach den alten Zustand wiederherstellen.
- Anwesenheit simulieren (Urlaub): abends einzelne Lichter in den Räumen des Hauses zufällig an und aus.
"""

from __future__ import annotations

from datetime import timedelta
import logging
import random
from typing import Any

from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY_DAILY = f"{DOMAIN}.daily"
WINDOW_CLASSES = ("window", "opening")
AWAY_TICK = timedelta(minutes=10)
AWAY_END = (23, 30)  # danach alles aus, was die Simulation angeschaltet hat
AWAY_MAX_ON = 2


def _daily_settings(building: dict[str, Any]) -> dict[str, Any]:
    d = (building.get("settings") or {}).get("daily") or {}
    wh = d.get("window_heat") or {}
    try:
        minutes = min(60, max(1, int(float(wh.get("minutes", 3)))))
    except (TypeError, ValueError):
        minutes = 3
    return {"auto": bool(wh.get("auto")), "minutes": minutes, "away_lights": [e for e in d.get("away_lights") or [] if isinstance(e, str) and e.startswith("light.")]}


class Daily:
    """Fenster/Heizung und Anwesenheitssimulation."""

    def __init__(self, hass: HomeAssistant, data: Any) -> None:
        self.hass = hass
        self.data = data  # storage.Haus3DData (Gebäude)
        self._store: Store[dict[str, Any]] = Store(hass, 1, STORAGE_KEY_DAILY)
        # climate_id -> {hvac_mode, temperature, contacts, auto}
        self.paused: dict[str, dict[str, Any]] = {}
        self.away: dict[str, Any] = {"on": False, "mine": []}
        self._areas_rev: int | None = None
        self._by_area: dict[str, dict[str, list[str]]] = {}
        self._timers: dict[str, CALLBACK_TYPE] = {}
        self._unsubs: list[CALLBACK_TYPE] = []

    async def async_start(self) -> None:
        stored = await self._store.async_load() or {}
        self.paused = {k: v for k, v in (stored.get("paused") or {}).items() if isinstance(v, dict)}
        self.away = {"on": bool((stored.get("away") or {}).get("on")), "mine": list((stored.get("away") or {}).get("mine") or [])}
        self._unsubs.append(self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._on_state))
        self._unsubs.append(async_track_time_interval(self.hass, self._away_tick, AWAY_TICK))

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

    async def _async_save(self) -> None:
        await self._store.async_save({"paused": self.paused, "away": self.away})

    # ------------------------------------------------------------------ Räume ↔ Entitäten

    def _area_of(self, entity_id: str) -> str | None:
        ent = er.async_get(self.hass).async_get(entity_id)
        if ent is None:
            return None
        if ent.area_id:
            return ent.area_id
        if ent.device_id and (dev := dr.async_get(self.hass).async_get(ent.device_id)):
            return dev.area_id
        return None

    def _areas(self) -> dict[str, dict[str, list[str]]]:
        """Je Bereich eines Raums im Grundriss: Fensterkontakte, Thermostate, Lichter (bei Änderung neu)."""
        rev = (self.data.revision, len(er.async_get(self.hass).entities))
        if self._areas_rev == rev:
            return self._by_area
        areas = {r.get("area_id") for f in self.data.building.get("floors", []) for r in f.get("rooms", []) if r.get("area_id")}
        out: dict[str, dict[str, list[str]]] = {a: {"contacts": [], "climate": [], "lights": []} for a in areas}
        for ent in er.async_get(self.hass).entities.values():
            area = self._area_of(ent.entity_id)
            if area not in out:
                continue
            domain = ent.entity_id.split(".")[0]
            if domain == "climate":
                out[area]["climate"].append(ent.entity_id)
            elif domain == "light":
                out[area]["lights"].append(ent.entity_id)
            elif domain == "binary_sensor" and (ent.device_class or ent.original_device_class) in WINDOW_CLASSES:
                out[area]["contacts"].append(ent.entity_id)
        self._by_area = out
        self._areas_rev = rev
        return out

    def _is_open(self, entity_id: str) -> bool:
        st = self.hass.states.get(entity_id)
        return st is not None and st.state == "on"

    # ------------------------------------------------------------------ Fenster ↔ Heizung

    @callback
    def _on_state(self, event: Event) -> None:
        entity_id = event.data.get("entity_id", "")
        if not entity_id.startswith("binary_sensor."):
            return
        new = event.data.get("new_state")
        # Wiederherstellen: alle Kontakte einer pausierten Heizung zu
        for climate, p in list(self.paused.items()):
            if entity_id in p.get("contacts", []) and not any(self._is_open(c) for c in p["contacts"]):
                self.hass.async_create_task(self.async_resume(climate))
        if new is None or new.state != "on":
            return
        settings = _daily_settings(self.data.building)
        if not settings["auto"]:
            return
        for area, ents in self._areas().items():
            if entity_id not in ents["contacts"] or not ents["climate"]:
                continue
            key = f"area:{area}"
            if key in self._timers:
                continue

            @callback
            def _check(_now: Any, area: str = area, key: str = key) -> None:
                self._timers.pop(key, None)
                ents = self._areas().get(area) or {}
                contacts = ents.get("contacts", [])
                if not any(self._is_open(c) for c in contacts):
                    return
                for climate in ents.get("climate", []):
                    if climate not in self.paused and self._heating(climate):
                        self.hass.async_create_task(self.async_pause(climate, contacts, auto=True))

            self._timers[key] = async_call_later(self.hass, settings["minutes"] * 60, _check)

    def _heating(self, climate: str) -> bool:
        st = self.hass.states.get(climate)
        if st is None or st.state in ("off", "unavailable", "unknown"):
            return False
        action = st.attributes.get("hvac_action")
        return action == "heating" or (action is None and st.state in ("heat", "auto", "heat_cool"))

    async def async_pause(self, climate: str, contacts: list[str], *, auto: bool = False, context: Any = None) -> bool:
        """Heizung aus (bzw. auf Minimum), bis alle Kontakte zu sind. False, wenn nichts offen ist."""
        st = self.hass.states.get(climate)
        if st is None:
            raise HomeAssistantError(f"{climate} gibt es nicht")
        if not contacts:
            area = self._area_of(climate)
            contacts = (self._areas().get(area) or {}).get("contacts", []) if area else []
        if not any(self._is_open(c) for c in contacts):
            return False
        if climate not in self.paused:
            self.paused[climate] = {"hvac_mode": st.state, "temperature": st.attributes.get("temperature"), "contacts": list(contacts), "auto": auto}
        else:
            self.paused[climate]["contacts"] = sorted(set(self.paused[climate]["contacts"]) | set(contacts))
        if "off" in (st.attributes.get("hvac_modes") or []):
            await self.hass.services.async_call("climate", "set_hvac_mode", {"entity_id": climate, "hvac_mode": "off"}, blocking=True, context=context)
        else:
            low = st.attributes.get("min_temp", 7)
            await self.hass.services.async_call("climate", "set_temperature", {"entity_id": climate, "temperature": low}, blocking=True, context=context)
        await self._async_save()
        _LOGGER.debug("Heizung %s pausiert (Fenster offen: %s)", climate, contacts)
        return True

    async def async_resume(self, climate: str) -> None:
        """Alten Zustand wiederherstellen."""
        p = self.paused.pop(climate, None)
        if p is None:
            return
        await self._async_save()
        try:
            if p.get("hvac_mode") and p["hvac_mode"] not in ("off", "unavailable", "unknown"):
                await self.hass.services.async_call("climate", "set_hvac_mode", {"entity_id": climate, "hvac_mode": p["hvac_mode"]}, blocking=True)
            if p.get("temperature") is not None:
                await self.hass.services.async_call("climate", "set_temperature", {"entity_id": climate, "temperature": p["temperature"]}, blocking=True)
        except HomeAssistantError as err:
            _LOGGER.warning("Heizung %s nicht wiederhergestellt: %s", climate, err)

    # ------------------------------------------------------------------ Anwesenheit simulieren

    def away_lights(self) -> list[str]:
        """Lichter für die Simulation: eingestellte, sonst alle Lichter in den Räumen des Grundrisses."""
        chosen = _daily_settings(self.data.building)["away_lights"]
        if chosen:
            return chosen
        return sorted({light for ents in self._areas().values() for light in ents["lights"]})

    async def async_set_away(self, on: bool) -> None:
        self.away["on"] = on
        if not on:
            await self._away_off()
        await self._async_save()

    async def _away_off(self) -> None:
        mine = [e for e in self.away.get("mine", []) if self.hass.states.get(e) is not None]
        self.away["mine"] = []
        if mine:
            await self.hass.services.async_call("light", "turn_off", {"entity_id": mine}, blocking=True)

    async def _away_tick(self, now: Any = None) -> None:
        if not self.away.get("on"):
            return
        local = dt_util.now()
        sun = self.hass.states.get("sun.sun")
        dark = sun is None or sun.state == "below_horizon"
        late = (local.hour, local.minute) >= AWAY_END or local.hour < 5
        if not dark or late:
            if self.away.get("mine"):
                await self._away_off()
                await self._async_save()
            return
        lights = self.away_lights()
        if not lights:
            return
        mine = [e for e in self.away.get("mine", []) if e in lights]
        # zufällig: ein Licht aus, ein anderes an – wie jemand, der durchs Haus geht
        if mine and random.random() < 0.5:
            off = random.choice(mine)
            mine.remove(off)
            await self.hass.services.async_call("light", "turn_off", {"entity_id": off}, blocking=True)
        if len(mine) < AWAY_MAX_ON and random.random() < 0.7:
            candidates = [e for e in lights if e not in mine and (st := self.hass.states.get(e)) is not None and st.state == "off"]
            if candidates:
                light = random.choice(candidates)
                mine.append(light)
                await self.hass.services.async_call("light", "turn_on", {"entity_id": light}, blocking=True)
        self.away["mine"] = mine
        await self._async_save()
