# Haus 3D

Eine Home-Assistant-Integration, die deinen Hausgrundriss als interaktives 3D-Modell in einem eigenen
Seitenleisten-Panel zeigt, mit Live-Status von Licht, Fenstern, Türen, Rollläden, Raumklima und
Balkonkraftwerk.

Das Datenformat ist kompatibel mit [NeonPlan 3D](https://github.com/Mastershort/neonplan3d): Exporte von
dort lassen sich direkt einlesen, und Exporte von Haus 3D kann NeonPlan wieder öffnen.

## Funktionen

- **3D-Modell ohne Decken**, damit man von oben hineinschaut: Böden je Raum in der Farbe des Bodenbelags,
  Wände als Volumen mit echten Aussparungen für Fenster und Türen (Brüstung und Sturz als eigene Stücke),
  halbtransparente Glasscheiben, Garagentor, Gartenflächen (Rasen, Terrasse, Weg, Einfahrt, Pool mit
  Wasser, Beet, Hecke, Zaun).
- **Etagen-Umschalter** (Alle / KG / EG …), Kamera drehen, zoomen und verschieben mit Maus oder Fingern.
  Auf schmalen Bildschirmen gibt es einen Menü-Knopf für die HA-Seitenleiste. Hell/Dunkel folgt HA.
- **Geräte automatisch im Raum**: Für jeden Raum mit `area_id` erscheinen die Entitäten des Bereichs
  (Licht, Schalter, Lüfter, Rollladen, Klima, Fenster-/Tür-/Garagenkontakte). Versteckte Entitäten sowie
  Diagnose- und Konfigurations-Entitäten werden ausgeblendet. Positionen aus `placements[]` haben Vorrang.
  - **Tippen/Klick**: Licht, Schalter, Lüfter und Rollladen umschalten (andere öffnen den Dialog).
  - **Lange drücken oder Rechtsklick**: der normale HA-Dialog („Weitere Infos“).
- **Live-Status**: Räume mit eingeschaltetem Licht leuchten warm, offene Fenster/Türen werden rot
  markiert (Türblätter schwenken auf), Rollläden hängen je nach Position vor dem Fenster. Raumbeschriftung
  mit Name, Temperatur und Luftfeuchte (Mittelwert der Sensoren im Bereich).
- **Temperaturansicht** (Thermometer-Knopf): Böden von blau (18 °C) bis rot (26 °C).
- **Balkonkraftwerk**: Der Raum mit `area_id: balkonkraftwerk` (z. B. „Schuppen“) bekommt Solarmodule aufs
  Dach. Eine animierte Linie zeigt den Energiefluss zum Haus, ihre Geschwindigkeit folgt der
  Einspeiseleistung. Eine kleine Karte zeigt die Werte.
- **Import/Export, Verlauf** (nur für Admins, Menü ⋮): JSON exportieren/importieren, Stand sichern, einen
  der letzten 20 Stände wiederherstellen. Vor jedem Speichern wird der alte Stand automatisch gesichert.
- Läuft **komplett offline**: Three.js und OrbitControls liegen im Paket, kein CDN.

## Editor (für Admins)

Über den Stift in der Kopfzeile öffnet sich ein 2D-Editor für die gewählte Etage:

- **Räume zeichnen**: Rechteck ziehen oder freie Form Punkt für Punkt. Eckpunkte rasten am Raster
  und an vorhandenen Ecken ein. Ecken ziehen, über „+“ neue Ecken einfügen.
- **Räume zuordnen**: Name, Home-Assistant-Bereich und Bodenbelag.
- **Fenster, Türen, Garagentore**: auf eine Wand tippen, entlang der Wand ziehen. Maße, Anschlag,
  Aufschlagrichtung, Flügel, Aussehen sowie Kontakt und Rollladen (automatisch, keiner oder bestimmt).
- **Möbel**: 56 Typen (wie NeonPlan) einfügen, ziehen, am orangen Punkt drehen. Lampen-Möbel mit
  Licht-Entität leuchten im 3D-Modell.
- **Geräte platzieren**: Lampen, Steckdosen usw. an ihre echte Stelle setzen (`placements[]`).
- **Gartenflächen** zeichnen, Art und Bereich wählen.
- Rückgängig/Wiederholen (Strg+Z), Lücken schließen, 3D-Vorschau, Etagen anlegen/löschen.
  Gespeichert wird erst mit „Speichern“, der alte Stand landet im Verlauf.

## Installation über HACS

1. In Home Assistant **HACS** öffnen.
2. Oben rechts ⋮ → **Benutzerdefinierte Repositories**.
3. Repository `https://github.com/tollzockt/Haus3d-HomeAssistant` eintragen, Kategorie **Integration**, hinzufügen.
4. In HACS nach **Haus 3D** suchen und **Herunterladen**.
5. Home Assistant **neu starten**.
6. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Haus 3D**. Es sind keine Eingaben nötig.
7. In der Seitenleiste erscheint **Haus 3D**.

Voraussetzung: Home Assistant **2024.7** oder neuer.

### Manuelle Installation

Den Ordner `custom_components/haus3d` nach `<config>/custom_components/haus3d` kopieren, neu starten und
die Integration wie oben hinzufügen.

## Startstand und Datenformat

Beim allerersten Start übernimmt Haus 3D die Datei `custom_components/haus3d/haus-daten.json` als
Startstand. Danach liegt der Grundriss in `.storage/haus3d.building` (mit Revisionszähler), der Verlauf in
`.storage/haus3d.history`. Die mitgelieferte Datei ist ein **Beispielhaus**. Den eigenen Grundriss liest
man am einfachsten über **⋮ → Importieren** ein (NeonPlan-Export oder rohe JSON-Datei).

Das Format entspricht NeonPlan 3D (`version: 1`):

```text
floors[]          id, name, elevation, height, ha_floor
  rooms[]         id, name, area_id, points [[x, z], …] in Metern, floor_material
  openings[]      id, room_id, edge, offset, width, type (window|door|garage), sill, height,
                  hinge, swing, style (passage|glass|front_glass|…), contact, cover
  outdoor[]       id, type (lawn|terrace|path|driveway|pool|bed|hedge|fence), points
  placements[]    entity_id, x, z, y
  furniture[]     wird übernommen, aber (noch) nicht dargestellt
settings          wall_exterior (0.24), wall_interior (0.12), energy {…}
```

- Räume werden auf der **Mitte der Innenwände** gezeichnet. Kanten, die zwei Räume teilen, werden zu
  **einer** Innenwand (`wall_interior`), einzelne Kanten zu Außenwänden (`wall_exterior`, nach außen).
  Teilweise geteilte Kanten werden in Segmente aufgeteilt.
- Öffnungen hängen an `room_id` + `edge` (Kante von Punkt *i* zu *i+1*). **`offset` ist der Abstand der
  Mitte der Öffnung** vom Punkt *i* (wie bei NeonPlan).
- `contact`/`cover` einer Öffnung: `null` = automatisch aus dem Bereich des Raums, `"none"` = keins,
  sonst die Entitäts-ID.
- Gartenflächen liegen auf der Höhe ihrer Etage. **Hang/Böschung:** Eine Gartenfläche kann zusätzlich
  `heights` haben (Meter über ihrer Etage, ein Wert je Eckpunkt); sie wird dann schräg dargestellt.
- Gartenflächen mit `area_id` (und optional `name`) bekommen wie Räume eine Beschriftung und die Geräte
  ihres Bereichs (z. B. Gartenlicht). NeonPlan ignoriert diese Zusatzfelder.
- Räume, die mit Spalt nebeneinander gezeichnet sind (Innenmaße), bietet der Import an zu schließen:
  gegenüberliegende Kanten bis 45 cm Abstand kommen auf eine gemeinsame Mittellinie.

### NeonPlan-Export aufbereiten

```bash
node tools/neonplan_aufbereiten.mjs neonplan-export.json haus3d.json
```

Löst Garten-Etagen (unter 1 m Höhe, Gartenflächen als Räume gezeichnet) in Gartenflächen der Hausetage
auf gleicher Höhe auf, schließt Lücken zwischen Räumen und trägt die Energie-Entitäten ein. Danach
`haus3d.json` im Panel importieren.

### Energie-Entitäten

Leistungen in kW und Energien in Wh werden automatisch umgerechnet.

## Korrektur Wohnzimmer (Werkzeug)

`tools/wohnzimmer_korrektur.py` ersetzt im Raum „Wohnzimmer“ auf Kante 0 das alte einzelne Fenster durch
zwei Fenster (Breite 1,25, Brüstung 0,3, Höhe 1,9) und eine Glastür (Breite 1,0, Höhe 2,2, Anschlag
rechts, öffnet nach außen). Weil `offset` im Format die Mitte meint, muss angegeben werden, wie die Werte
0,55 / 2,1 / 4,9 gemeint sind:

```bash
# 1. im Panel: ⋮ → Exportieren (ergibt z. B. haus3d-2026-10-02.json)
python3 tools/wohnzimmer_korrektur.py --offset rand  haus3d-2026-10-02.json   # Werte = linker Rand
python3 tools/wohnzimmer_korrektur.py --offset mitte haus3d-2026-10-02.json   # Werte = Mitte
```

Ragt eine neue Öffnung über die Kante hinaus, bricht das Skript ab, ohne die Datei zu ändern
(`--force` schreibt trotzdem).
Danach die Datei über **⋮ → Importieren** einlesen.

## Entwicklung und Tests

```bash
# Wandberechnung, Gerätelogik, Import (node 20+)
node --test tests/js/*.test.mjs

# Backend gegen Home Assistant 2024.7 (Python 3.12)
pip install -r requirements_test.txt
python -m pytest -q

# Screenshots der Oberfläche mit nachgebautem hass-Objekt (Playwright)
NODE_PATH="$(npm root -g)" node tests/browser/shot.mjs /tmp/shots
```

Die Wandberechnung (`frontend/walls.js`) ist ein eigenes Modul ohne Three.js. Die Tests prüfen gegen
`haus-daten.json`, dass es keine doppelten Innenwände gibt und jede Öffnung auf genau einem Wandsegment
landet.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Enthält [Three.js](https://threejs.org) r170 (MIT, siehe
[LICENSE-three.js.txt](LICENSE-three.js.txt) bzw. `custom_components/haus3d/frontend/vendor/LICENSE-three.txt`).
