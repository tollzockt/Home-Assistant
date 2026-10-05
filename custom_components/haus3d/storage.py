"""Speicherung des Gebäudes mit Revisionszähler und Verlauf."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    HISTORY_LIMIT,
    SEED_FILE,
    STORAGE_KEY_BACKGROUNDS,
    STORAGE_KEY_BUILDING,
    STORAGE_KEY_HISTORY,
    STORAGE_KEY_INVALID,
    STORAGE_VERSION,
)
from .schema import empty_building, validate_building

_LOGGER = logging.getLogger(__name__)


class RevisionConflict(Exception):
    """Der Stand wurde inzwischen von jemand anderem gespeichert."""


class Haus3DData:
    """Hält Gebäude, Revision und Verlauf und schreibt sie in .storage."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_BUILDING)
        self._history_store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_HISTORY)
        self.building: dict[str, Any] = empty_building()
        self.revision = 0
        self.history: list[dict[str, Any]] = []
        self._next_history_id = 1
        # Änderungen nacheinander: Revisionsprüfung und Schreiben dürfen sich nicht überholen
        self._lock = asyncio.Lock()
        self._bg_store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY_BACKGROUNDS)
        self._backgrounds: dict[str, str] | None = None

    async def async_load(self) -> None:
        """Lädt den gespeicherten Stand; beim ersten Start den mitgelieferten Startstand."""
        stored = await self._store.async_load()
        if stored and isinstance(stored.get("building"), dict):
            try:
                self.building = validate_building(stored["building"])
            except vol.Invalid as err:
                # nicht verwerfen: den Rohstand gesondert sichern, bevor das nächste Speichern ihn überschreibt
                await Store(self.hass, STORAGE_VERSION, STORAGE_KEY_INVALID).async_save(stored)
                _LOGGER.error(
                    "Gespeicherter Stand ist ungültig und wurde nach .storage/%s gesichert; starte leer: %s",
                    STORAGE_KEY_INVALID,
                    err,
                )
                self.building = empty_building()
            self.revision = int(stored.get("revision", 0))
        else:
            self.building = await self.hass.async_add_executor_job(_load_seed)
            self.revision = 1
            await self._async_save_building()

        history = await self._history_store.async_load()
        if history:
            self.history = list(history.get("items", []))[-HISTORY_LIMIT:]
            self._next_history_id = int(history.get("next_id", len(self.history) + 1))

    async def _async_save_building(self) -> None:
        await self._store.async_save({"revision": self.revision, "building": self.building})

    async def _async_save_history(self) -> None:
        await self._history_store.async_save({"next_id": self._next_history_id, "items": self.history})

    async def async_snapshot(self, reason: str) -> dict[str, Any]:
        """Hebt den aktuellen Stand im Verlauf auf (maximal HISTORY_LIMIT Einträge)."""
        async with self._lock:
            return await self._async_snapshot(reason)

    async def _async_snapshot(self, reason: str) -> dict[str, Any]:
        item = {
            "id": self._next_history_id,
            "created": dt_util.utcnow().isoformat(),
            "reason": reason,
            "revision": self.revision,
            "building": copy.deepcopy(self.building),
        }
        self._next_history_id += 1
        self.history.append(item)
        del self.history[:-HISTORY_LIMIT]
        await self._async_save_history()
        return item

    async def async_save(self, building: dict[str, Any], expected_revision: int | None) -> int:
        """Speichert ein (bereits validiertes) Gebäude; der alte Stand wandert in den Verlauf."""
        async with self._lock:
            if expected_revision is not None and expected_revision != self.revision:
                raise RevisionConflict
            await self._async_snapshot("save")
            self.building = building
            self.revision += 1
            await self._async_save_building()
            return self.revision

    async def async_restore(self, history_id: int) -> int:
        """Stellt einen Stand aus dem Verlauf wieder her (der aktuelle Stand wird vorher gesichert)."""
        async with self._lock:
            item = next((h for h in self.history if h["id"] == history_id), None)
            if item is None:
                raise KeyError(history_id)
            building = validate_building(item["building"])
            await self._async_snapshot("restore")
            self.building = building
            self.revision += 1
            await self._async_save_building()
            return self.revision

    async def _async_backgrounds(self) -> dict[str, str]:
        if self._backgrounds is None:
            stored = await self._bg_store.async_load()
            self._backgrounds = dict((stored or {}).get("images", {}))
        return self._backgrounds

    async def async_get_background(self, floor_id: str) -> str | None:
        """Bild (Daten-URL) einer Etage oder None."""
        return (await self._async_backgrounds()).get(floor_id)

    async def async_set_background(self, floor_id: str, image: str | None) -> None:
        """Bild einer Etage setzen (None entfernt es)."""
        images = await self._async_backgrounds()
        if image:
            images[floor_id] = image
        else:
            images.pop(floor_id, None)
        await self._bg_store.async_save({"images": images})

    def history_summary(self) -> list[dict[str, Any]]:
        """Verlauf ohne die Gebäudedaten, neueste zuerst."""
        return [
            {k: h[k] for k in ("id", "created", "reason", "revision")} | {"floors": len(h["building"].get("floors", []))}
            for h in reversed(self.history)
        ]


def _load_seed() -> dict[str, Any]:
    """Liest haus-daten.json aus dem Paket (im Executor, weil Dateizugriff)."""
    path = Path(__file__).parent / SEED_FILE
    try:
        return validate_building(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, vol.Invalid) as err:
        _LOGGER.warning("Startstand %s nicht nutzbar, starte leer: %s", path, err)
        return empty_building()
