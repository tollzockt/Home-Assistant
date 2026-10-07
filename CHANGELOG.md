# Änderungen

## 0.20.1

- **Kamera-Sichtbereich ausblendbar**: eigener Schalter „Kamera-Sicht“ im Zahnrad (Kachel), in den Ebenen
  und als Funktion fürs Rad. Die Kamera-Symbole bleiben, nur die blauen Sichtkegel verschwinden.

## 0.20.0

### Neu
- **Dachgeschoss als Etage**: In der Etagen-Auswahl des Editors legt „+ Dachgeschoss“ eine Etage für Räume
  unter dem Dach an (oder Haken „Dachgeschoss“ in den Etagen-Eigenschaften). Ist in den Einstellungen ein
  Dach an, sitzt es auf dem Kniestock des Dachgeschosses, die Dachflächen ergeben sich aus dessen Räumen und
  Innenwände enden unter der Schräge. Der Eintrag „Dach“ (Kamin, Dachfenster, PV) erscheint nur noch, wenn
  ein Dach an ist.
- **Name oben links** im Bearbeiten-Modus antippen und ändern (leer = „Haus 3D“).
- **Rahmenfarbe** für Fenster und Türen im Editor (Farbfeld wie bei Möbeln), auch in 3D.

### Geändert
- **Simulation nur im Admin-Modus**: Kachel im Zahnrad nur mit aktivem Admin, endet mit dem Admin-Modus und
  startet beim Laden nie von selbst. Auf den aktuellen Stand gebracht: Beispielräume haben eine Leistung
  (folgt dem Licht – Leitungen und Verteiler zeigen Fluss), Solar-Regler rechnet Hausverbrauch, Netzbezug/
  Einspeisung und Speicher (auch eingebaute von PV/Balkonkraftwerk) passend zueinander, Einspeise-Verteiler
  mit Zähler, Schloss ohne PIN, Ventile und Heizungsmodus.
- **Energiefluss aus** (Rad) blendet die Leitungen im Haus ganz aus, nicht nur die Punkte.

### Behoben
- Tablet: Die Liste in „Geräte anpassen“ scrollt mit dem Finger (eigener Scrollbereich, Kopf und Knöpfe
  bleiben stehen; Wischen schaltet keinen Haken um).

## 0.19.0

### Neu
- **Leitungsnetz**: Verteiler (Haupt-/Unterverteilung mit Zähler, Einspeisung, Router, Switch,
  Wasseranschluss, Warmwasser, Durchführung über Etagen), Abzweige an bestehenden Leitungen, Fluss je
  Leitungsstück von der Wurzel bis zu den Verbrauchern – Menge als Dichte und Tempo der Punkte, Richtung
  nach Flussrichtung. Antippen zeigt Wert und angeschlossene Verbraucher.
- **Leitungen bearbeiten**: Punkte ziehen, einfügen, löschen; Höhe je Punkt oder für alle.
- Leitungstyp **Netzwerk**; Leitungsende an einem **Gerät** (Alternative zu Raum/Sensor).

### Behoben
- Strom auf Zubringern ohne eigenes Ziel (z. B. Hauptverteilung → Garage → Büro) fließt jetzt auf dem
  ganzen Weg.

## 0.18.3

- **Eigener Speicher bei PV-Anlage und Balkonkraftwerk**: Haken „mit eigenem Speicher“ (z. B. Hybrid-Anlage,
  Solarbank) mit Ladestand, Speicherleistung, Kapazität und Reserve. Wird beim Speicher mitgezählt und beim
  berechneten Hausverbrauch berücksichtigt; kein zusätzlicher AC-Speicher nötig.
- Gerätevorlagen (SENEC, Anker, Fronius, Huawei …) füllen bei PV/Balkonkraftwerk den eingebauten Speicher
  gleich mit. SENEC findet jetzt auch die Namen der lokalen API (…powergenerated_now) und der WebAPI.

## 0.18.2

- Spenden jetzt auch per PayPal (Zahnrad → ♥ Haus 3D unterstützen, Sponsor-Knopf im Repo).

## 0.18.1

### Neu
- **Unterstützen**: Zeile „♥ Haus 3D unterstützen“ im Zahnrad mit Spendenlinks (GitHub Sponsors; weitere
  folgen), einmaliger dezenter Hinweis nach 14 Tagen (nie im Wandtablet-Modus), Sponsor-Knopf im Repo.
  Haus 3D bleibt kostenlos.
- **Entwickler-Instanz**: kleines Haus-Symbol unten rechts in den Admin-Einstellungen; nach Bestätigung
  entfällt das Spendenfeld und es gibt die Kategorie „Entwickler“ (Infos, Leistungsanzeige, Simulation).
  Der Code wird im Backend nur als Hash geprüft und schaltet nichts Kostenpflichtiges frei.

## 0.18.0

### Wichtig beim Update
- Schlösser lassen sich in Haus 3D nur noch mit der **Tür-PIN** entriegeln/öffnen (Standard **0000**,
  bitte unter Admin → PIN & Zugang ändern). Abschließen bleibt ohne PIN.

### Neu
- **Tür-PIN**: eigener Befehl `haus3d/lock/unlock` prüft die PIN im Backend (still, gedrosselt, kein
  Token) und schließt erst dann auf; das PIN-Feld zeigt, welche Tür entriegelt wird.
- **Möbelkatalog**: IKEA, weitere Lampen, LED, Gaming, Wallbox & E-Auto, Wechselrichter & Speicher,
  Solar-Aufständerungen (rund 140 Teile mit Maßen nach Herstellerangaben, eigene 3D-Modelle).
- **Gerätevorlagen** für PV, Balkonkraftwerk und Speicher in der Energie-Einrichtung mit
  Entitätsvorschlägen aus der passenden Integration. Dabei u. a. SENEC.Home und Anker SOLIX Solarbank.

## 0.17.0

### Neu
- **Leitungen** im Editor (Strom, Wasser kalt/warm) entlang Boden und Wand, mit Höhe je Punkt; in 3D als
  Rohr mit laufenden Punkten, solange Strom bzw. Wasser fließt (eigener Sensor oder Zielraum). Ersetzt die
  Luftlinien vom Hausanschluss zu den Räumen.
- **Netzwerkgeräte** (UniFi Network): Symbole/3D-Geräte, Fenster mit IP, WLAN, Signal, Access Point,
  Laufzeit, Clients, Neustart; Liste „Netzwerk“ im Funktionsrad.
- **Energie neu**: Haus, Netzbezug, Einspeisung als Grundlage; PV, Balkonkraftwerk und AC-Speicher als
  Erweiterungen mit eigenen Entitäten, alle Werte summiert. Bestehende Einstellungen werden übernommen.
- **Heizkörper antippen** öffnet ein Thermostat-Fenster.
- **Kameras**: Dreh-Griff im Editor, Öffnungswinkel, Neigung, Reichweite.

### Geändert
- Raum antippen fährt die Kamera hin; Raumfenster per Gedrückthalten.
- Größere Trefferflächen für Geräte in 3D.
- Bearbeiten- und Admin-Modus stehen oben mit „Beenden“; Admin endet auch im Zahnrad über „Beenden“.
- Anwesenheit: Text nicht mehr verdeckt.
- Popups: Name in der Kopfzeile wird nicht mehr vom Schließen-Knopf verdrängt.

## 0.16.0

### Wichtig beim Update
- **Speichern braucht jetzt eine PIN** (Standard **0000** für Bearbeiten und Admin). Bitte direkt unter
  Zahnrad → Admin-Einstellungen → PIN & Zugang eigene PINs setzen.
- Stifte, „+“ und Editor erscheinen erst nach **Bearbeiten** (PIN), auch für HA-Admins.
- Das ⋮-Menü (Export, Import, Verlauf) ist jetzt unter Admin-Einstellungen → Daten & Verlauf.

### Neu
- **Schlichtes Zahnrad** mit Stil, Qualität, Geräte-Darstellung, Anzeige-Kacheln, Simulation und den
  Feldern **Bearbeiten** (wird zu **Beenden**) und **Admin-Einstellungen**.
- **Admin-Fenster mit Kategorien**; antippen zeigt die Einstellungen dieses Bereichs, „‹“ zurück.
- **PIN-Feld** mit großen Tasten (Tablet), Tastatur geht auch. Falsche PIN: nichts passiert. Eigene PIN je
  Bereich (4–8 Ziffern), nur als Hash gespeichert; Durchprobieren wird still gebremst.
- **Karten als Tabs** inkl. **Energie-Karte**: Titel, Symbol, Zeilen anzeigen/ausblenden, eigene Namen,
  Reihenfolge (▲▼), Überschuss-Ampel und Verlauf-Knopf schaltbar; Tab „+“ = neue Karte, unten
  „Entfernen“. Der Stift an einer Karte öffnet direkt ihren Tab.
- Grünes Band „Bearbeiten aktiv“ mit „Grundriss“ und „Beenden“.
- Funktionsrad: Stil, Dach, Raster, Wetter, Raumnamen, Geräte, Möbel, Anwesenheit, Schatten und Vollbild
  sind ins Zahnrad gewandert.

## 0.15.0

### Kameras, Medien, Kurzwahl
- **Kameras** als Symbol im Raum; Tipp öffnet das Kamerafenster (Standbild alle 2 s, „Live“ über HA).
  Fest platzierte Kameras bekommen im Editor eine **Blickrichtung**; der **Sichtkegel** erscheint in 2D
  und 3D.
- **Klingel**: Kamera als „Klingel-Kamera“ markieren und einen Auslöser wählen (event.… mit
  device_class doorbell oder ein Binärsensor). Klingeln weckt das Tablet und öffnet die Kamera.
- **Raumfenster**: Medienplayer (Titel, Zurück/Wiedergabe/Weiter, stumm, Lautstärke, an/aus),
  **Saugroboter** (Saugen, Pause, Zur Station, Suchen, Akku), Kamera-Vorschau.
- **Kurzwahl 2.0**: laufende Automationen/Skripte drehen einen Ring, darunter „vor 10 min“ bzw.
  „aus“. Langes Drücken: Auslösen, Stoppen, Ein/Aus, **Ablauf ansehen** (Trace), Bearbeiten.

### Licht, Schatten, Energie
- **Echte Schatten** der Sonne (Qualität „Ausgewogen“ und „Schön“, Ebene „Schatten“ im Funktionsrad).
- **PV-Verschattung prüfen** (PV-Feld antippen): Verlust je Feld über einen Tag, stärkste Uhrzeit,
  beliebiger Tag; **Schatten-Zeitraffer** lässt die Sonne über den Tag laufen.
- **Kontaktschatten** unter Möbeln und Bäumen.
- **Jahreszeiten im Garten**: Rasen und Laub nach Datum (oder fest: Zahnrad → Haus & Wetter).
- **Energiefluss im ganzen Haus**: Linien vom Hausanschluss zu Räumen mit Verbrauch und zum Netz
  (rot Bezug, grün Einspeisung); abschaltbar unter Haus & Wetter.

### Benutzer, Dienste, Begehen
- **Meine Ansicht**: Stil, Ebenen, Qualität und gemerkte Blickwinkel gelten für den HA-Benutzer auf
  allen Geräten. Am Wandtablet abschaltbar („Eigene Ansicht“).
- **Dienste** `haus3d.show`, `haus3d.notify`, `haus3d.highlight`, `haus3d.reload` steuern offene
  Haus-3D-Seiten aus Automationen, mit `target` nur ein bestimmtes Tablet.
- **Begehen** (Funktionsrad): Blick aus Augenhöhe, Ziehen schaut sich um, Tippen auf den Boden geht hin,
  Joystick/WASD/Pfeiltasten; Wände halten auf, Türen lassen durch.

### Editor
- **Bauplan-Foto** je Etage unterlegen (verkleinert, getrennt vom Grundriss gespeichert), verschieben,
  drehen, Deckkraft, **Maßstab aus zwei Punkten**.
- **Fang-Hilfen**: Fluchtlinien zu vorhandenen Ecken; **Länge und Winkel eintippen** (Ziffern tippen
  springt ins Feld).
- **Mehrfachauswahl** (Schalter „Mehrfach“, Umschalt-Klick oder Rahmen aufziehen): verschieben,
  Pfeiltasten, kopieren/einfügen (Strg+C/V), duplizieren (Strg+D), löschen; **Vorlagen** für alle Etagen.
- **Treppen**: L-Treppe **mit Podest** oder **gewendelt**, U-Treppe, Wendeltreppe; Deckenloch passend
  zur Form. **Gauben** (Schlepp-, Sattel-, Flachdach) im Dach-Editor, verdecken PV-Module.
- Behoben: Kontrollkästchen im Editor waren verschoben; Keller allein gewählt lag unter dem Rasen.

## 0.14.2

Tablet-Bedienung:
- **Funktionsrad per Finger drehen**: Rad unten rechts (und links) mit dem Finger im Bogen wischen, es
  läuft mit Schwung nach und rastet ein. Die Pfeiltasten am Rad sind weg; Mausrad geht weiter.
- **Nichts überlappt mehr**: Liegen die Karten (Energie, Kurzwahl) über der Etagenleiste, rutscht die
  Leiste darunter bzw. nach links oben, auch auf dem Handy und im Hochformat.
- **Editor am Tablet**: eine Zeile mit „Werkzeug ▾“ und „⋯“ statt langer Knopfleiste, Eigenschaften
  ein-/ausblendbar (mehr Platz zum Zeichnen), Dialoge als Blatt von unten mit großen Tasten.

## 0.14.1

- Behoben: „Unable to load custom panel“ nach dem Update auf 0.14.0, solange die App bzw. Seite
  noch die alte Version geladen hatte (das Panel-Element wurde ein zweites Mal registriert).

## 0.14.0

Großes Update: Alltag, Energie, Optik, Wandtablet und Editor. Gespeicherte Grundrisse bleiben erhalten.

### Wichtig beim Update
- **Tipp auf eine Automation** (im Raumfenster oder auf einem Symbol) öffnet jetzt die Details. Ausgelöst
  wird sie nur noch über Kurzwahl und Funktionsrad (vorher schaltete ein Tipp sie versehentlich ab).
- **Nachfrage** vor heiklen Aktionen: Haustür aufschließen, Garagentor öffnen/schließen, Sirene an
  (abschaltbar unter Zahnrad → Haus & Wetter). Je Kurzwahl-Eintrag lässt sich „Nachfragen“ anhaken.
- **Energie-Anzeige ohne Voreinstellung**: Neue Installationen zeigen „Energie einrichten“. Bestehende
  Installationen behalten ihre Entitäten. „Aus HA-Energie übernehmen“ füllt die Felder.
- **Hinweise** (Regen bei offenem Fenster usw.) laufen im Browser, also nur, solange ein Gerät Haus 3D
  geöffnet hat.

### Alltag
- **Statusleiste** im Kopf: Licht an, offen/gekippt, Garage, Schlösser, Alarm; Etagen-Abzeichen.
- **Anwesenheit**: Personen mit Bild, „Bewegung vor n min“ am Raumnamen.
- **Hinweise am Modell**: Regen bei offenem Fenster, Wasser-/Rauchmelder, Tür/Garage zu lange offen,
  Heizen bei offenem Fenster, Feuchte, Akku; Banner mit „Zeigen“/„Ausblenden“, Raum wird eingefärbt.
- **Gute-Nacht-Check / Haus verlassen**: Liste mit Sammel-Aktionen (Tore, Schlösser, Lichter, Rollläden)
  und eigenem Skript; Ansicht „Sicherheit“ (zu = grün, gekippt = orange, offen = rot); Kippsensor je
  Fenster.
- **Raumfenster 2.0**: Aktionsleiste (Licht aus, Rollladen auf/stopp/zu, Szenen), Heizung mit Stepper,
  Klima-Block mit Taupunkt und Lüftungsampel.

### Energie
- **Energie-Karte 2.0**: Netz-Zeile (Bezug/Einspeisung), Akku-Balken mit „lädt … · voll ca. 13:40“,
  Überschuss-Ampel (und Status-Chip), wählbare Kurzanzeige, Vorzeichen-Umkehr mit Live-Vorschau.
- **Tagesverlauf**: Mini-Kurven je Zeile, Dialog mit Wischen, Gestern/Heute und kWh-Summen.
- **PV je Dachfeld**: Name, Leistungs-/Ertrags-Entität und Wp je Feld; Schild „Süd 3,2 kW“ (geschätzt
  mit „ca.“), Infokarte. Module jetzt instanziert (deutlich weniger Rechenlast).
- **Bodenfarbe**: Temperatur, Feuchte oder Leistung je Raum mit Legende; Heizkörper glühen beim Heizen.

### Optik und Wandtablet
- **Echter Sonnenstand**: Licht kommt aus der Richtung der Sonne, Norden als genauer Winkel.
- **Echtes Licht**: Lampenfarbe und Helligkeit, nachts leuchtende Fenster.
- **Blickwinkel**: Iso, Oben, Süd/Nord/Ost/West, bis zu 6 gemerkte Ansichten; Ansicht je Etage gemerkt.
- **Wandtablet**: `/haus3d?kiosk&etage=eg`, Kopfzeile aus, Bildschirm anlassen (nur über https),
  Vollbild, Startetage; **Ruhemodus** und **Dimmen** nach Uhrzeit, Hinweise wecken.
- **Qualitätsstufen** Akku/Ausgewogen/Schön (automatisch am Tablet), Leistungsanzeige, gedrosselte
  Hintergrund-Animationen.

### Editor
- **Tablet**: Schalter „Frei“/„Einzeln“, Leiste beim Zeichnen, Langdruck-Menü, größere Griffe.
- **Entwurf sichern** (automatisch) mit Fortsetzen/Verwerfen, **Zwischenspeichern**.
- **Maße**: Kantenlängen, Länge/Breite/Tiefe eintippen, Messen, Flächenliste.
- **PV-Hindernisse**: Kamin und Dachfenster verdecken Module.
- **Treppe** gerade oder viertelgewendelt mit Geländer und **Deckenloch** in der Etage darüber,
  „Bis zur nächsten Etage“.
- **Garten-Linien**: Weg, Hecke, Zaun (Holz, Doppelstabmatte, Lamellen) und Mauer als Linie zeichnen.

### Sonstiges
- Startstand ist ein neutrales Beispielhaus; im Paket stehen keine echten Sensornamen mehr.
- Neue Einstellungen werden weich geprüft: ein ungültiger Wert wird ersetzt statt den Stand abzulehnen.
