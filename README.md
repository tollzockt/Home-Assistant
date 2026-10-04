# Haus 3D

Eine Home-Assistant-Integration, die deinen Hausgrundriss als interaktives 3D-Modell in einem eigenen
Seitenleisten-Panel zeigt, mit Live-Status von Licht, Fenstern, Türen, Rollläden, Raumklima und
Energiefluss.

Das Datenformat ist kompatibel mit [NeonPlan 3D](https://github.com/Mastershort/neonplan3d): Exporte von
dort lassen sich direkt einlesen, und Exporte von Haus 3D kann NeonPlan wieder öffnen.

## Neu in 0.14

Statusleiste, Hinweise am Modell, Gute-Nacht-Check, Anwesenheit, Energie-Karte 2.0 mit Tagesverlauf,
PV-Leistung je Dachfeld, Raumklima und Bodenfarbe, echter Sonnenstand und echtes Licht, Blickwinkel,
Wandtablet mit Ruhemodus sowie im Editor Tablet-Bedienung, Entwurfssicherung, Maße, Treppen mit Deckenloch
und Garten-Linien. Alle Einzelheiten in [CHANGELOG.md](CHANGELOG.md).

**Tippen auf Geräte:** Licht, Schalter, Lüfter und Rollladen schalten um; Schloss, Garagentor und Sirene
fragen vorher nach; Automationen, Klima, Alarm und Sensoren öffnen die Details (Automationen löst man
über Kurzwahl oder Funktionsrad aus). Lange drücken öffnet immer „Weitere Infos“.

**Wandtablet:** `/haus3d?kiosk&etage=eg` öffnet ohne Kopfzeile auf der Etage EG. „Bildschirm anlassen“
funktioniert nur über https; in der Companion-App bzw. Fully Kiosk die eigene Einstellung nutzen.
Hinweise (Regen bei offenem Fenster …) prüft der Browser – sie erscheinen, solange ein Gerät Haus 3D
offen hat.

## Funktionen

- **3D-Modell ohne Decken**, damit man von oben hineinschaut: Böden je Raum in der Farbe des Bodenbelags,
  Wände als Volumen mit echten Aussparungen für Fenster und Türen (Brüstung und Sturz als eigene Stücke),
  halbtransparente Glasscheiben, Garagentor, Gartenflächen (Rasen, Terrasse, Weg, Einfahrt, Pool mit
  Wasser, Beet, Hecke, Zaun).
- **Dach** (Zahnrad → Haus & Wetter): Flach-, Sattel-, Walm- oder Pultdach mit Neigung, Überstand und
  Firstrichtung. Es sitzt über der obersten Etage, ausgerichtet am Haus, und deckt nur die
  zusammenhängenden Räume ab (ein abseits stehender Schuppen bleibt frei). **L-, T- und U-Häuser**
  bekommen automatisch ein zusammengesetztes Dach: Hauptdach plus Flügel, die bis zum First laufen.
  **Dachfarbe** frei wählbar. **PV-Module auf dem Dach**: Anzahl je Himmelsrichtung (Ost, Süd, West,
  Nord); sie liegen hochkant von der Traufe aufwärts auf den Dachflächen, die in diese Richtung zeigen
  (beim L-Dach z. B. Süd auf dem Hauptdach, Ost und West auf dem Flügel), ohne die Bereiche, über denen
  ein anderes Dachteil liegt (beim L-Dach nur die Kehle). Dazu „Norden“ einstellen (oben, rechts, unten
  oder links im Plan). **PV-Felder** für die genaue Anordnung: je Feld Richtung, Spalten × Reihen, hoch
  oder quer, Abstand von links in Metern (von außen auf die Dachfläche gesehen) und Startreihe ab der
  Traufe; Felder ersetzen die Anzahl je Richtung. **Flügel-Ende** beim L-Dach: Giebel oder Walm. Sichtbar nur in der Ansicht
  „Alle“; wählt man eine Etage, schaut man hinein – die Etagen darunter bleiben dabei stehen (z. B. EG
  gewählt: KG mit seinen Außenwänden bleibt sichtbar). Genauer geht es im Editor auf der **Dach-Ebene**.
- **Balkon und Geländer**: Gartenfläche der Art „Balkon“ wird als Platte auf Höhe der Etage gebaut, mit
  Geländer an allen Kanten, die nicht am Haus liegen (Glas, Stäbe oder Holz, Höhe einstellbar). Auch
  Terrassen und andere Flächen können so ein Geländer oder einen Zaun bekommen.
- **Garten**: Bäume (Laub-, Nadel-, Obstbaum), Büsche, Blumen, Ziergras, Pflanzkübel, Whirlpool,
  Komposter, Findling,
  Steingruppe, Trittstein, Liege, Sonnenschirm, Gartentisch und Grill als Möbel. Gartenflächen auch als
  Kies, Pflaster oder Steingarten. Beete werden automatisch bepflanzt.
- **Wetter**: Bei Regen, Schauer, Gewitter, Schnee oder Hagel (Zustand einer `weather.*`-Entität) fällt
  draußen Regen oder Schnee, nicht in den Räumen. Bei Schnee werden Rasen, Wege und Dach weiß, bei
  Gewitter blitzt es. Die Wetter-Entität ist einstellbar (Standard: die erste vorhandene).
- **Bedienung über der 3D-Ansicht**:
  - **Etagen-Leiste rechts** (▲ Alle mit Dach / EG / KG … ▼).
  - **Karten oben rechts**: „Energie“ plus bis zu **5 eigene Karten** (Stift: Titel, Symbol, Werte;
    „+“ legt eine neue an). Jede Karte klappt einzeln auf und zu, eingeklappt zeigt sie einen Kurzwert.
  - **Weißer Punkt unten links – Kurzwahl**: Automationen (werden ausgelöst), Skripte, Szenen, Taster,
    Schalter, Lichter. Antippen führt aus, lange drücken zeigt Details. Hinzufügen über das „+“.
  - **Weißer Punkt unten rechts – Funktionen**: Energiefluss, Temperaturansicht, Stil durchschalten
    (Auto → Tag → Nacht → Cyberpunk), Dach, Raster, Wetter, Raumnamen, Geräte, Möbel, Ansicht einpassen.
    Über das „+“ lassen sich Funktionen ausblenden, umsortieren und eigene Einträge (Skripte,
    Automationen, Schalter …) hinzufügen.
  - Beide Menüs zeigen **4 Einträge** im Viertelkreis, dahinter fest das **„+“**. Sind es mehr, dreht man
    sie wie ein Rad (Mausrad, wischen oder die kleinen Pfeile). Beschriftungen stehen immer nach außen.
  - **Raster im Hintergrund** in allen Stilen (abschaltbar).
- Kamera drehen, zoomen und verschieben mit Maus oder Fingern.
  Auf schmalen Bildschirmen gibt es einen Menü-Knopf für die HA-Seitenleiste. Hell/Dunkel folgt HA.
- **Geräte automatisch im Raum**: Für jeden Raum mit `area_id` erscheinen die Entitäten des Bereichs
  (Licht, Schalter, Lüfter, Rollladen, Klima, Fenster-/Tür-/Garagenkontakte). Versteckte Entitäten sowie
  Diagnose- und Konfigurations-Entitäten werden ausgeblendet. Positionen aus `placements[]` haben Vorrang.
  - **Tippen/Klick**: Licht, Schalter, Lüfter und Rollladen umschalten; Schloss, Garagentor und Sirene
    mit Nachfrage; Automationen und alles andere öffnen den Dialog.
  - **Lange drücken oder Rechtsklick**: der normale HA-Dialog („Weitere Infos“).
- **Live-Status**: Räume mit eingeschaltetem Licht leuchten warm, offene Fenster/Türen werden rot
  markiert. Türblätter und Fensterflügel schwenken **animiert** auf, Rollläden fahren sichtbar hoch und
  runter. Raumbeschriftung mit Name, Temperatur und Luftfeuchte (Mittelwert der Sensoren im Bereich).
- **Raumfenster**: Etage wählen, dann auf einen Raum tippen. Es öffnet sich ein Fenster mit allen Geräten
  des Raums. Bis zu **3 Raumfenster** gleichzeitig, jedes lässt sich an der Titelleiste verschieben.
- **Geräte anpassen** (Stift im Raumfenster, nur Admins): einzelne Entitäten ausblenden (Haken weg) oder
  weitere Entitäten hinzufügen, auch aus anderen Bereichen. Gespeichert im Raum (`hidden_entities`,
  `panel`).
- **Temperaturansicht** (Thermometer-Knopf): Böden von blau (18 °C) bis rot (26 °C).
- **Energie**: Der Raum mit Balkonkraftwerk (im Editor beim Raum „Energie: Balkonkraftwerk“, früher Bereich `balkonkraftwerk` oder Name „Schuppen“) bekommt Solarmodule aufs
  Dach. Eine animierte Linie zeigt den Energiefluss zum Haus, ihre Geschwindigkeit folgt der
  Einspeiseleistung. Die Karte „Energie“ oben rechts lässt sich einklappen; welche Werte sie zeigt
  (auch zusätzliche Sensoren mit eigenem Namen), stellt man im Zahnrad-Menü ein.
- **Einstellungen** (Zahnrad): Stil **Auto** (Tag/Nacht nach `sun.sun`), **Tag**, **Nacht** oder
  **Cyberpunk**, Geräte als Symbole oder 3D-Objekte, Ebenen (Wände, Möbel, Geräte, Garten …) ein/aus.
- **Tablet-tauglich**: größere Schaltflächen bei Touch-Bedienung.
- **Simulationsmodus** (Zahnrad → Simulation starten, gilt nur für diesen Browser): zum gefahrlosen
  Ausprobieren. Schalten ändert nur simulierte Zustände, es geht **kein Dienstaufruf** an Home
  Assistant. Langes Drücken öffnet statt „Weitere Infos“ einen Simulationsdialog (an/aus, Fenster
  offen/zu, Rollladen-Position, Solltemperatur, Messwerte). Ein oranges Band oben zeigt den Modus und
  stellt Wetter (Sonne bis Gewitter, Schnee, Hagel), Tag/Nacht und Solarleistung ein. „Beispielgeräte“
  gibt Räumen ohne eigene Geräte ein Licht, einen Temperatursensor und einen Fensterkontakt. Änderungen
  am Grundriss bleiben in der Simulation lokal; beim Beenden wird der echte Stand neu geladen.
- **Import/Export, Verlauf** (nur für Admins, Menü ⋮): JSON exportieren/importieren, Stand sichern, einen
  der letzten 20 Stände wiederherstellen. Vor jedem Speichern wird der alte Stand automatisch gesichert.
- Läuft **komplett offline**: Three.js und OrbitControls liegen im Paket, kein CDN.

## Editor (für Admins)

Über den Stift in der Kopfzeile öffnet sich der Editor für die gewählte Etage. Oben rechts wählt man die
Ansicht **2D**, **2D + 3D** (nebeneinander, auf schmalen Geräten untereinander) oder **3D**.

- **Dach-Ebene** (Etagenauswahl → „Dach“): das Hausdach von oben mit Flächen, First und Nordpfeil.
  Werkzeuge **Kamin**, **Dachfenster** und **PV-Feld**: aufs Dach tippen, dann ziehen oder mit den
  Pfeilen schieben. PV-Felder (Spalten × Reihen, hochkant oder quer) richten sich nach der Dachfläche
  unter ihrer Mitte, Reihe 1 liegt an der Traufe; Module, die über First, Kehle oder Rand hinausragen,
  werden rot angezeigt und in 3D weggelassen. Rechts: Dachform, Neigung, Überstand, First, Flügel-Ende,
  Norden, Dachfarbe, **Dachdeckung** (Ziegel, Schiefer, Blech, Schindeln) sowie Farbe und Textur der
  **Giebel**. Kamin: Maße, Höhe über Dach, Drehung, Farbe, Textur. „Bisherige PV hier verschiebbar
  machen“ übernimmt die PV nach Himmelsrichtung als einzelne Felder.
  **Dachflächen anpassen**: Fläche antippen, die orangen Punkte an den Kanten ziehen (oder Werte
  eintragen), bis die Fläche genau auf den Hauswänden sitzt (gelb gestrichelt); die ganze Fläche ziehen
  oder mit den Pfeilen schieben. Gespeichert als `roof.adjust` je Dachteil.
- **Texturen** (nur Bild, kein Relief – schont Tablets): Auswahl neben jeder Farbe. Wände außen und innen
  (Putz, Klinker, Fachwerk, Naturstein, Holz senkrecht/waagerecht, Fassadenpaneele, Beton, Fliesen, Schiefer),
  Böden (nach Belag automatisch: Dielen, Fliesen, Teppich, Stein, Beton), Gartenflächen (Rasen, Kies,
  Pflaster, Platten, Holzdeck, Asphalt, Erde) und Dach. „Standard“ wählt passend, „glatt“ schaltet ab.
  Die Farbe tönt die Textur. Im Cyberpunk-Stil bleibt alles glatt.
- **Einzelne Wand gestalten**: Raum wählen, eine blaue Wand **antippen** (nicht ziehen) – oben erscheint
  „Wand x von y“ mit Farbe und Textur innen (bei Außenwänden auch außen) nur für diese Wand, z. B.
  **Fachwerk** an einer Wohnzimmerwand. Ein oranger Punkt markiert gestaltete Wände.
- **Räume zeichnen**: Rechteck ziehen oder freie Form Punkt für Punkt. Eckpunkte rasten am Raster
  und an vorhandenen Ecken ein. Ecken ziehen, über „+“ neue Ecken einfügen.
- **Einzelne Wände** (Werkzeug „Wand“): Anfang antippen, Ende antippen – fertig ist eine gerade Wand,
  ohne Raum. Sie rastet bei 0/45/90° und an Raumecken und Wandenden ein (Umschalt = frei); weiter
  tippen setzt die nächste Wand an, Esc oder Doppelklick beendet. Angeklickt: Enden ziehen, ganze Wand
  ziehen oder mit Pfeilen schieben, Länge, Dicke, Höhe (leer = Raumhöhe) und Farbe einstellen. Fenster
  und Türen lassen sich genauso hineinsetzen wie in Raumwände. Gespeichert in `walls[]` (wie NeonPlan).
- **Wände verschieben**: Raum wählen, dann eine blau markierte Wand ziehen. Sie wandert senkrecht (im
  Rasterschritt), angrenzende Räume ziehen mit, damit keine Lücke entsteht. Gemeinsame Ecken wandern
  ebenfalls in allen Räumen mit. Alt beim Ziehen = nur dieser Raum.
- **Eigenes Dach je Raum** (Schuppen, Carport, Anbau): Art, Neigung, Überstand, Firstrichtung bzw.
  Neigungsrichtung, beim Pultdach „hohe Seite tauschen“, Dachfarbe und Deckung. Wählt man die Etage,
  verschwindet das Raumdach samt Solarmodulen (man schaut hinein), ebenso mit „Dach“ aus; dazu eine
  **Außenfarbe** der Wände je Raum. Beim Schuppen mit Balkonkraftwerk liegen die Solarmodule auf den
  Dachflächen (Anzahl einstellbar).
- **Räume zuordnen**: Name, Home-Assistant-Bereich, Bodenbelag (18 Beläge) oder eigene Bodenfarbe,
  Wandfarbe innen. Außen- und Innenwandfarbe für das ganze Haus stehen bei der Etage (nichts gewählt).
- **Fenster, Türen, Garagentore**: auf eine Wand tippen, entlang der Wand ziehen. Maße, Anschlag,
  Aufschlagrichtung, Flügel, Aussehen sowie Kontakt und Rollladen (automatisch, keiner oder bestimmt).
- **Möbelkatalog**: 84 Typen in Kategorien (Wohnen, Essen, Küche, Schlafen, Bad, Büro, Technik, Licht,
  Garten, Bau, eigene Körper) mit 3D-Vorschaubild und Suche. Neu u. a. Netzwerk- und Serverschrank,
  Heizkessel, Warmwasserspeicher, Wärmepumpe, Sicherungskasten, **Säule** (rund), **Stütze** (eckig) –
  beide mit Höhe 0 bis zur Decke – und **Unterzug/Träger** (hängt unter der Decke).
- **Eigene Körper**: Quader und Zylinder mit frei wählbaren Maßen, Höhe über Boden, Farbe und Namen.
  Jedes Möbelstück kann außerdem eine eigene Farbe bekommen.
- **Magnet** (Magnet-Knopf, an): Möbel rasten beim Ziehen an Wänden ein, drehen sich mit der
  Vorderseite zum Raum und lassen sich an der Wand entlang schieben; in Ecken auch seitlich bündig.
  Alt beim Ziehen = frei.
- **Feinjustieren**: Pfeiltasten schieben die Auswahl (5 cm, mit Umschalt 1 cm), R dreht um 90°
  (Umschalt+R: 15°). Für Tablets gibt es im Eigenschaftenfeld ein Steuerkreuz mit Schrittweite,
  Drehknöpfen und „an die Wand stellen“.
- **3D-Ansicht im Editor**: zeigt jede Änderung sofort. Möbel lassen sich dort anklicken und auf dem
  Boden verschieben (mit Magnet), ein Klick auf einen Boden wählt den Raum.
- **Geräte platzieren**: Lampen, Steckdosen usw. an ihre echte Stelle setzen (`placements[]`).
- **Gartenflächen** zeichnen (auch Balkon), Art, Bereich und Geländer wählen.
- **Hang zwischen zwei Gartenebenen** (z. B. Garten am KG unten, Vorgarten am EG oben): Böschung als
  Gartenfläche der unteren Etage zeichnen, so dass ihre Ecken oben an die Fläche der oberen Etage
  stoßen, dann **Höhen automatisch**. Ecken oben bekommen den Höhenunterschied, unten 0, dazwischen
  wird verteilt. Alternativ Höhe je Ecke von Hand. Beim Verschieben von Ecken bleiben die Höhen.
- **Aufräumen** (Besen): gleicht Versätze von wenigen Zentimetern zwischen Räumen an (die 3D-Ansicht tut
  das ohnehin, sonst entstünden doppelte Wände mit Spalt), entfernt doppelte Eckpunkte und „Spitzen“ (Kanten, die auf sich selbst
  zurücklaufen), ohne Fenster und Türen zu verschieben, und rückt Möbel, die in Wände ragen, davor.
- **Außenwände bündig** (bei der Etage, nichts gewählt): setzt Außenwände, die bis 15 cm neben denen der
  Etage darunter liegen, genau darüber (z. B. EG auf KG). Fenster und Türen bleiben an ihrer Stelle.
- Rückgängig/Wiederholen (Strg+Z), Lücken schließen, Etagen anlegen/löschen.
  Gespeichert wird erst mit „Speichern“, der alte Stand landet im Verlauf.

## Update einspielen

Neue Versionen landen auf dem Zweig `main` von
[tollzockt/Haus3d-HomeAssistant](https://github.com/tollzockt/Haus3d-HomeAssistant).
Damit HACS sie als Update anbietet, braucht es ein **Release**:

1. Auf GitHub im Repository rechts **Releases → Draft a new release** (bzw. „Create a new release“).
2. **Choose a tag** → neuen Tag eintippen, genau wie die Version in `manifest.json` mit „v“ davor,
   z. B. `v0.14.0` → „Create new tag“. Ziel-Zweig: `main`.
3. Titel z. B. `0.14.0`, kurze Beschreibung, bei „Release label“ **None** (nicht Pre-release),
   **Publish release**.
4. In Home Assistant: **HACS → Haus 3D** (ggf. ⋮ → „Informationen aktualisieren“) → **Herunterladen**/
   **Aktualisieren** → Home Assistant **neu starten**.
5. Im Browser die Seite einmal neu laden (Strg+F5 bzw. App neu öffnen).

Ohne Release kann man in HACS unter ⋮ → **Erneut herunterladen** auch den Stand von `main` wählen.
Der Grundriss bleibt bei Updates erhalten (er liegt in `.storage/haus3d.building`).

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
  rooms[]         id, name, area_id, points [[x, z], …] in Metern, floor_material,
                  floor_color, wall_color, exterior_color ("#rrggbb", optional),
                  floor_texture, wall_texture, exterior_texture (Textur, "none" = glatt),
                  edge_styles {Kante: {color, texture, exterior_color, exterior_texture}},
                  roof {type, pitch, overhang, color, direction, flip, texture},
                  solar_panels (eigenes Dach je Raum)
  openings[]      id, room_id, edge, offset, width, type (window|door|garage), sill, height,
                  hinge, swing, style (passage|glass|front_glass|…), contact, cover
  outdoor[]       id, type (lawn|terrace|path|driveway|pool|bed|hedge|fence|balcony|gravel|paving|
                  rockery), points,
                  railing (glass|bars|wood|none), railing_height, texture
  placements[]    entity_id, x, z, y
  walls[]         id, a [x, z], b [x, z], thickness, height, color, texture (freistehende Wände)
  furniture[]     id, type, x, z, rotation, w, d, h, mount_y, entity, color, name
settings          wall_exterior (0.24), wall_interior (0.12), wall_colors {exterior, interior},
                  wall_textures {exterior, interior},
                  energy {…, extra: [{entity, name}]},
                  roof {type (none|flat|gable|hip|shed), pitch, overhang, direction (auto|x|z),
                        color, solar {N, E, S, W}, solar_arrays [{dir, cols, rows, orient, left, row}],
                        wing_end (gable|hip), floor, rooms, texture, gable_color, gable_texture,
                        items [{id, type (chimney|skylight|pv), x, z, …}],
                        adjust [{lo, hi, a, b}] (Dach-Ebene)}, north (Grad),
                  cards [{id, title, icon, entities [{entity, name}]}] (bis 5), quick [{entity, name}],
                  weather (Entität oder "none")
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
- `balcony`, `gravel`, `paving`, `rockery`, `railing`, Farben, eigene Körper und `settings.roof` sind
  Erweiterungen von Haus 3D; NeonPlan kennt sie nicht (unbekannte Möbel zeigt es als Kiste).
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

Zahnrad → „Energie-Anzeige (für alle)“: Balkonkraftwerk, Haus (PV Dach, Netz, Verbrauch) und Akku.
„Aus HA-Energie übernehmen“ schlägt Entitäten aus dem Energie-Dashboard vor (füllt nur die Felder,
gespeichert wird mit „Speichern“). Zeigt der Akku „lädt“ statt „entlädt“ (oder das Netz Bezug statt
Einspeisung), das Vorzeichen umkehren – die Vorschau zeigt es sofort. Leistungen in kW und Energien in
Wh werden automatisch umgerechnet.

## Entwicklung und Tests

```bash
# Wandberechnung, Gerätelogik, Import (node 20+)
node --test tests/js/*.test.mjs

# Backend gegen Home Assistant 2024.7 (Python 3.12)
pip install -r requirements_test.txt
python -m pytest -q

# Oberfläche mit nachgebautem hass-Objekt (Playwright): alle Browser-Tests samt Screenshots
NODE_PATH="$(npm root -g)" node tests/browser/run.mjs /tmp/shots
```

Die Wandberechnung (`frontend/walls.js`) ist ein eigenes Modul ohne Three.js. Die Tests prüfen gegen
`haus-daten.json`, dass es keine doppelten Innenwände gibt und jede Öffnung auf genau einem Wandsegment
landet.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Enthält [Three.js](https://threejs.org) r170 (MIT, siehe
[LICENSE-three.js.txt](LICENSE-three.js.txt) bzw. `custom_components/haus3d/frontend/vendor/LICENSE-three.txt`).
