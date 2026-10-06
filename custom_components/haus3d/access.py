"""Zugang zu Bearbeiten und Admin-Einstellungen per PIN (Standard 0000, je Bereich eigene PIN).

Die PINs liegen nur als Hash (PBKDF2-SHA256 mit Salz) in `.storage/haus3d.access`. Eine richtige PIN
liefert ein Token, das nur im Speicher lebt und nach 10 Minuten ohne Nutzung verfällt. Falsche PINs
werden still abgewiesen und gedrosselt (Schutz gegen Durchprobieren).
"""

from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_KEY_ACCESS = f"{DOMAIN}.access"
DEFAULT_PIN = "0000"
# Bearbeiten und Admin liefern ein Token; die Tür-PIN wird bei jedem Entriegeln neu geprüft (kein Token)
SCOPES = ("edit", "admin", "door")
LOGIN_SCOPES = ("edit", "admin")
TOKEN_IDLE_S = 600
ITERATIONS = 60_000
# Drosselung: höchstens etwa drei Prüfungen je Sekunde, nach 10 Fehlversuchen 30 s Pause (still)
MIN_GAP_S = 0.3
MAX_FAILS = 10
LOCK_S = 30.0

# Entwickler-Instanz: nur der Hash des Codes (PBKDF2, eigenes Salz) steht im Code. Er blendet lediglich das
# Spendenfeld aus und zeigt Entwickler-Infos – nie schaltet er bezahlte Funktionen frei.
DEV_SALT = "d52e7ccb2878c983c9ef88246e6d04ca"
DEV_HASH = "2b5c3691c8bd07e54bc4e4c26856490561ee408e065b32de0383a23247077472"
DEV_ITERATIONS = 200_000

# Einstellungen, die nur mit Admin-PIN geändert werden dürfen; mit der Bearbeiten-PIN bleiben sie,
# wie sie gespeichert sind (Grundriss, Karten, Kurzwahl, Dach usw. darf „Bearbeiten“ ändern).
ADMIN_SETTINGS = (
    "energy",
    "alerts",
    "routines",
    "security",
    "safety",
    "doorbell",
    "weather",
    "climate",
    "season",
    "house_flow",
    "presence",
    "north",
)


def valid_pin(pin: Any) -> bool:
    return isinstance(pin, str) and pin.isdigit() and 4 <= len(pin) <= 8


def _dev_hash(code: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(DEV_SALT), DEV_ITERATIONS).hex()


def _hash(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), ITERATIONS).hex()


class Access:
    """PINs, Tokens und Drosselung."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, 1, STORAGE_KEY_ACCESS)
        self._pins: dict[str, dict[str, str]] = {}
        self._tokens: dict[str, dict[str, Any]] = {}
        self._tries: dict[str, dict[str, float]] = {}
        self.dev = False

    async def async_load(self) -> None:
        stored = await self._store.async_load() or {}
        self._pins = {s: v for s, v in (stored.get("pins") or {}).items() if s in SCOPES and isinstance(v, dict)}
        self.dev = stored.get("dev") is True

    def is_default(self, scope: str) -> bool:
        return scope not in self._pins

    async def _async_matches(self, scope: str, pin: str) -> bool:
        entry = self._pins.get(scope)
        if entry is None:
            return secrets.compare_digest(pin, DEFAULT_PIN)
        digest = await self.hass.async_add_executor_job(_hash, pin, entry["salt"])
        return secrets.compare_digest(digest, entry["hash"])

    async def async_check(self, scope: str, pin: str, who: str, now: float | None = None) -> bool:
        """PIN richtig? Still und gedrosselt je Benutzer (gilt für alle Bereiche gemeinsam)."""
        now = time.monotonic() if now is None else now
        t = self._tries.setdefault(who, {"fails": 0, "last": -1e9, "until": 0.0})
        if now < t["until"] or now - t["last"] < MIN_GAP_S:
            t["last"] = now
            return False
        t["last"] = now
        if scope not in SCOPES or not valid_pin(pin) or not await self._async_matches(scope, pin):
            t["fails"] += 1
            if t["fails"] >= MAX_FAILS:
                t["fails"] = 0
                t["until"] = now + LOCK_S
            return False
        t["fails"] = 0
        return True

    async def async_verify(self, scope: str, pin: str, who: str, now: float | None = None) -> str | None:
        """Token bei richtiger PIN (Bearbeiten/Admin), sonst None."""
        if scope not in LOGIN_SCOPES or not await self.async_check(scope, pin, who, now):
            return None
        now = time.monotonic() if now is None else now
        token = secrets.token_urlsafe(24)
        self._tokens[token] = {"scope": scope, "last": now}
        return token

    def scope_of(self, token: Any, now: float | None = None) -> str | None:
        """Bereich eines gültigen Tokens (und Ablauf verlängern), sonst None."""
        if not isinstance(token, str):
            return None
        now = time.monotonic() if now is None else now
        entry = self._tokens.get(token)
        if entry is None:
            return None
        if now - entry["last"] > TOKEN_IDLE_S:
            del self._tokens[token]
            return None
        entry["last"] = now
        return entry["scope"]

    def allows(self, token: Any, need: str, now: float | None = None) -> bool:
        scope = self.scope_of(token, now)
        return scope == "admin" or (scope == "edit" and need == "edit")

    def revoke(self, token: Any) -> None:
        self._tokens.pop(token, None)

    async def _async_save(self) -> None:
        await self._store.async_save({"pins": self._pins, "dev": self.dev})

    async def async_set_dev(self, code: Any, who: str, now: float | None = None) -> bool:
        """Entwickler-Instanz bestätigen (still, gedrosselt wie die PIN)."""
        now = time.monotonic() if now is None else now
        t = self._tries.setdefault(who, {"fails": 0, "last": -1e9, "until": 0.0})
        if now < t["until"] or now - t["last"] < MIN_GAP_S:
            t["last"] = now
            return False
        t["last"] = now
        ok = isinstance(code, str) and code.isdigit() and 4 <= len(code) <= 12 and secrets.compare_digest(await self.hass.async_add_executor_job(_dev_hash, code), DEV_HASH)
        if not ok:
            t["fails"] += 1
            if t["fails"] >= MAX_FAILS:
                t["fails"] = 0
                t["until"] = now + LOCK_S
            return False
        t["fails"] = 0
        self.dev = True
        await self._async_save()
        return True

    async def async_clear_dev(self) -> None:
        self.dev = False
        await self._async_save()

    async def async_set_pin(self, scope: str, pin: str) -> None:
        salt = secrets.token_hex(16)
        digest = await self.hass.async_add_executor_job(_hash, pin, salt)
        self._pins[scope] = {"salt": salt, "hash": digest}
        await self._async_save()
        # andere Freigaben dieses Bereichs enden
        for tok in [k for k, v in self._tokens.items() if v["scope"] == scope]:
            del self._tokens[tok]


def keep_admin_settings(new: dict[str, Any], old: dict[str, Any]) -> dict[str, Any]:
    """Mit Bearbeiten-PIN: geschützte Einstellungen aus dem gespeicherten Stand übernehmen."""
    settings = dict(new.get("settings") or {})
    old_settings = old.get("settings") or {}
    for key in ADMIN_SETTINGS:
        if key in old_settings:
            settings[key] = old_settings[key]
        else:
            settings.pop(key, None)
    return {**new, "settings": settings}
