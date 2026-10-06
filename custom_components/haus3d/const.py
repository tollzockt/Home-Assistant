"""Konstanten für Haus 3D."""

from __future__ import annotations

DOMAIN = "haus3d"
VERSION = "0.18.2"

STORAGE_VERSION = 1
STORAGE_KEY_BUILDING = f"{DOMAIN}.building"
STORAGE_KEY_HISTORY = f"{DOMAIN}.history"
# ungültiger gespeicherter Stand wird hierhin gesichert, statt verloren zu gehen
STORAGE_KEY_INVALID = f"{DOMAIN}.building_invalid"
# Bauplan-Fotos/Luftbilder je Etage (getrennt vom Grundriss, damit der klein bleibt)
STORAGE_KEY_BACKGROUNDS = f"{DOMAIN}.backgrounds"
BACKGROUND_MAX_CHARS = 3_000_000  # Daten-URL (JPEG, im Browser auf höchstens 1600 px verkleinert)

# Signal an offene Panels (Dienste haus3d.show/notify/highlight/reload)
SIGNAL_COMMAND = f"{DOMAIN}_command"

# Anzahl der aufgehobenen Stände
HISTORY_LIMIT = 20

# Startstand beim ersten Laden (liegt im Paket)
SEED_FILE = "haus-daten.json"

PANEL_URL_PATH = "haus3d"
PANEL_TITLE = "Haus 3D"
PANEL_ICON = "mdi:home-floor-3"
PANEL_COMPONENT = "haus3d-panel"

STATIC_URL = "/haus3d_static"

# Formatkennung der NeonPlan-Exporte (für Kompatibilität beim Import/Export)
NEONPLAN_EXPORT_FORMAT = "neonplan3d"
NEONPLAN_BACKUP_FORMAT = "neonplan3d-backup"

# Energie-Anzeige: Entitäten werden in den Einstellungen gewählt (bewusst keine Standard-IDs)
DEFAULT_ENERGY = {
    "solar": None,
    "einspeisung": None,
    "akku_ladestand": None,
    "akku_leistung": None,
    "ertrag_heute": None,
    "haus_pv": None,
    "netz": None,
    "verbrauch": None,
}
