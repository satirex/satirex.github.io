# Nahversorgung Hamburg — Supermärkte & Tankstellen (PWA)

Eine installierbare Progressive Web App, die Supermärkte und Tankstellen in
Hamburg live auf einer interaktiven Karte anzeigt. Läuft im mobilen Browser
(Android/Chrome, iOS/Safari) und lässt sich zum Startbildschirm hinzufügen.

## Architektur

Kein Build-Schritt, kein Framework, kein Bundler — reines ES-Module-JavaScript,
läuft direkt im Browser. Das hält die App leichtgewichtig, transparent und
einfach zu erweitern.

```
index.html            App-Shell (Markup), lädt Leaflet per CDN + eigene Module
manifest.webmanifest   PWA-Manifest (Icons, Name, Standalone-Modus, Shortcuts)
sw.js                  Service Worker: App-Shell-Cache + Laufzeit-Caching
css/main.css            Design-Tokens & sämtliche Styles (mobile-first)
js/
  config.js             Zentrale Konstanten (Hamburg-Grenzen, Kategorien, Endpunkte)
  db.js                 IndexedDB-Wrapper für Offline-Cache der POI-Daten
  overpass.js            Overpass-API-Client + POI-Normalisierung + opening_hours-Parser
  geolocation.js          Geolocation-Wrapper, Distanzberechnung
  search.js               Adresssuche über Nominatim
  map.js                  Leaflet-Kapselung (Marker, Clustering, Standortpunkt)
  ui.js                   Bottom Sheet, Listen-/Detailansicht, Chips, Toasts
  pwa-install.js           Install-Prompt (Android) & Home-Bildschirm-Hinweis (iOS)
  app.js                   Orchestrator: verdrahtet alle Module, hält den State
icons/                  Generierte App-Icons (inkl. maskable + Apple Touch Icon)
```

**Datenfluss:** Beim Bewegen der Karte wird ein Bounding Box an Overpass
geschickt (POIs für Supermärkte & Tankstellen), Ergebnisse werden im
State gehalten, in IndexedDB gesichert (Offline-Fallback) und als Marker /
Liste gerendert. Bereits geladene Regionen werden 6 Stunden lang nicht erneut
abgefragt (`CACHE.staleAfterMs` in `config.js`), zwischengespeicherte Daten
verfallen nach 7 Tagen.

**Warum kein Framework?** Bei diesem Funktionsumfang (eine Karte, eine Liste,
ein paar Filter) bringt React/Vue nur Build-Komplexität ohne echten Nutzen.
Die klare Modultrennung (Karte / Daten / UI / Standort) hält den Code trotzdem
wartbar und lässt sich bei Bedarf leicht in ein Framework migrieren.

## Datenquellen

- **Kartenkacheln:** OpenStreetMap-Standardkacheln (kostenlos, kein API-Key)
- **POI-Daten:** [Overpass API](https://overpass-api.de/) (OSM-Rohdaten für
  `shop=supermarket`, `shop=convenience`, `amenity=fuel`), mit automatischem
  Failover auf zwei weitere öffentliche Overpass-Spiegel
- **Adresssuche:** [Nominatim](https://nominatim.org/) (OSM-Geocoding),
  auf die Hamburger Bounding Box eingegrenzt

Alle drei sind kostenlose öffentliche Dienste ohne Registrierung. Für
Produktivbetrieb mit höherem Traffic empfiehlt sich ein eigener Overpass-/
Nominatim-Server oder ein kommerzieller Anbieter (siehe unten, "Skalierung").

## Lokal testen

Da Service Worker (und Geolocation) einen "secure context" brauchen, reicht
ein einfacher HTTP-Server auf `localhost` (gilt als sicher):

```bash
cd hamburg-poi-pwa
python3 -m http.server 8080
# dann im Browser: http://localhost:8080
```

Für einen Test auf dem echten Smartphone im selben WLAN:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# auf dem Handy: http://<Rechner-IP>:8080
```

Achtung: Ohne HTTPS funktioniert das **nur** für den lokalen Test. Für die
Installation als Homescreen-App braucht es echtes HTTPS (siehe Deployment).

## Deployment

Die App besteht nur aus statischen Dateien — jeder Static-Host mit HTTPS
funktioniert (z. B. Netlify, Vercel, GitHub Pages, Cloudflare Pages, ein
eigener nginx mit Let's-Encrypt-Zertifikat). Einfach den kompletten Ordner
hochladen. Wichtig:

- HTTPS ist Pflicht (PWA-Installation und Geolocation verlangen es)
- Bei Deployment in einem Unterordner (z. B. `/nahversorgung/`) funktionieren
  alle Pfade unverändert, da durchgängig relative Pfade verwendet werden

## Installation auf dem Smartphone

**Android (Chrome):** Beim Öffnen erscheint nach kurzer Zeit automatisch ein
Banner "App installieren". Alternativ über das Chrome-Menü ⋮ → "App
installieren".

**iPhone (Safari):** iOS unterstützt kein automatisches Install-Prompt. Die
App zeigt daher einen Hinweis: Teilen-Symbol ⬆️ antippen → "Zum
Home-Bildschirm". Danach startet die App im Vollbildmodus ohne Safari-Leiste,
inkl. eigenem App-Icon.

## Funktionsumfang

- Live-Karte mit geclusterten Markern für Supermärkte (grün) und Tankstellen
  (bernstein) – Farbwahl angelehnt an nautische Betonnung, passend zur
  Hafenstadt Hamburg
- Bottom Sheet im drei-stufigen "peek / half / full"-Verhalten (wie native
  Karten-Apps), per Wisch- oder Ziehgeste bedienbar
- Liste sortiert nach Entfernung zum eigenen Standort (falls freigegeben),
  sonst zum Kartenmittelpunkt
- Detailansicht je Ort: Adresse, Öffnungsstatus (aus OSM `opening_hours`
  ausgewertet), Distanz, Route (öffnet OSM-Routenplaner), Anruf-Button,
  bei Tankstellen die verfügbaren Kraftstoffarten
- Filter-Chips: Supermärkte, Tankstellen, "Jetzt geöffnet"
- Adresssuche (Nominatim), auf Hamburg eingegrenzt
- Standortanzeige mit Genauigkeitsradius, "Locate me"-FAB
- App-Shortcuts (Android: langes Drücken auf das Icon) direkt zu "nächste
  Tankstelle" / "nächster Supermarkt"
- Offline-fähig: App-Shell, zuletzt geladene Kartenkacheln und POI-Daten
  bleiben ohne Netz nutzbar; Statusanzeige informiert bei fehlender Verbindung
- Dark Mode folgt automatisch den Systemeinstellungen
- Safe-Area-Insets für iPhones mit Notch/Dynamic Island

## Bekannte Grenzen

- Der `opening_hours`-Parser (`js/overpass.js`) deckt die gängigsten
  OSM-Syntaxmuster ab (Wochentagsbereiche, einfache Zeitspannen, `24/7`),
  aber keine Feiertagsregeln (`PH`/`SH`) oder saisonale Ausdrücke — in diesen
  Fällen wird bewusst "unbekannt" statt eines geratenen Werts angezeigt.
- Öffentliche Overpass-/Nominatim-Server sind fair-use-limitiert. Bei sehr
  vielen gleichzeitigen Nutzer:innen empfiehlt sich ein eigener Overpass-
  Server oder ein kommerzieller Anbieter.
- POI-Datenqualität hängt von OpenStreetMap ab (crowd-gepflegt, i. d. R. sehr
  gut in Hamburg, aber nicht garantiert vollständig/aktuell).

## Erweiterbarkeit

Neue Kategorien (z. B. Bäckereien, Drogerien, Ladesäulen) hinzufügen:

1. In `js/config.js` einen neuen Eintrag unter `CATEGORIES` mit passenden
   `overpassSelectors` ergänzen
2. In `js/map.js` ein Icon-SVG in `ICONS_SVG` ergänzen
3. In `css/main.css` eine `.poi-marker--<kategorie>`-Farbe ergänzen
4. Optional einen Filter-Chip in `index.html` ergänzen

Der Rest der App (Laden, Cachen, Rendern, Detailansicht) funktioniert dank
der generischen Kategorie-Struktur automatisch mit.

## Lizenz der Kartendaten

© OpenStreetMap-Mitwirkende, veröffentlicht unter der [Open Database
License](https://www.openstreetmap.org/copyright). Die Attribution ist fest
in die Karte integriert (`css/main.css` / Leaflet-Attribution-Control) und
darf nicht entfernt werden.
