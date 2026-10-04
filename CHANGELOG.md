# Änderungen

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
