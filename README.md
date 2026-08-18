# Hamburg Nearby — Supermarkets & Gas Stations (PWA)

An installable Progressive Web App that shows supermarkets and gas stations
in Hamburg live on an interactive map. Runs in the mobile browser
(Android/Chrome, iOS/Safari) and can be added to the home screen.

## Architecture

No build step, no framework, no bundler — plain ES-module JavaScript,
runs directly in the browser. This keeps the app lightweight, transparent,
and easy to extend.

```
index.html            App shell (markup), loads Leaflet via CDN + own modules
manifest.webmanifest   PWA manifest (icons, name, standalone mode, shortcuts)
sw.js                  Service worker: app-shell cache + runtime caching
css/main.css            Design tokens & all styles (mobile-first)
js/
  config.js             Central constants (Hamburg bounds, categories, endpoints, known chains)
  db.js                 IndexedDB wrapper for offline POI cache
  overpass.js            Overpass API client + POI normalization + opening_hours parser/humanizer
  geolocation.js          Geolocation wrapper, distance calculation
  search.js               Address search via Nominatim
  map.js                  Leaflet wrapper (markers, clustering, location dot, base-layer switching)
  ui.js                   Bottom sheet, list/detail view, chips, toasts
  pwa-install.js           Install prompt (Android) & home-screen hint (iOS)
  app.js                   Orchestrator: wires up all modules, holds app state
icons/                  Generated app icons (incl. maskable + Apple touch icon)
```

**Data flow:** As the map moves, a bounding box is sent to Overpass (POIs for
supermarkets & gas stations), results are kept in app state, persisted to
IndexedDB (offline fallback), and rendered as markers/list. Already-loaded
regions aren't re-fetched for 6 hours (`CACHE.staleAfterMs` in `config.js`);
cached data expires after 7 days. The settings menu also offers a manual
"refresh now" action that bypasses this staleness check for the currently
visible area.

**Why no framework?** At this scope (a map, a list, a handful of filters),
React/Vue would add build complexity without real benefit. The clear module
separation (map / data / UI / location) keeps the code maintainable and
would make a later migration to a framework straightforward if ever needed.

## Data sources

- **Map tiles:** Standard OpenStreetMap tiles (free, no API key), with an
  optional satellite view via Esri World Imagery (also free, no API key)
- **POI data:** [Overpass API](https://overpass-api.de/) (raw OSM data for
  `shop=supermarket`, `shop=convenience`, `amenity=fuel`), with automatic
  failover across two additional public Overpass mirrors. Non-public
  locations (tagged `access=private`/`no`/`customers` — e.g. company depot
  fuel pumps) are filtered out.
- **Address search:** [Nominatim](https://nominatim.org/) (OSM geocoding),
  scoped to the Hamburg bounding box

All of these are free public services requiring no registration. For
production use with significant traffic, consider running your own
Overpass/Nominatim instance or a commercial provider.

## Running locally

Since service workers (and geolocation) require a secure context, a plain
HTTP server on `localhost` is enough (counts as secure):

```bash
cd hamburg-poi-pwa
python3 -m http.server 8080
# then open http://localhost:8080
```

To test on an actual phone on the same Wi-Fi:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# on the phone: http://<computer-ip>:8080
```

Note: without HTTPS this only works for local testing. Installing as a
home-screen app requires real HTTPS (see Deployment).

## Deployment

The app is just static files — any static host with HTTPS works (e.g.
Netlify, Vercel, GitHub Pages, Cloudflare Pages, or your own nginx with a
Let's Encrypt certificate). Just upload the whole folder. Important:

- HTTPS is required (PWA installation and geolocation both need it)
- All paths are relative, so deploying into a subfolder (e.g.
  `/nahversorgung/`) works without any changes
- If deploying to GitHub Pages, add an empty `.nojekyll` file at the repo
  root — otherwise GitHub's default Jekyll processing can interfere with
  plain static asset folders

## Installing on a phone

**Android (Chrome/Firefox):** An "Install app" banner usually appears
automatically shortly after opening. Alternatively, use the browser menu →
"Install app".

**iPhone (Safari):** iOS doesn't support an automatic install prompt. The
app shows a hint instead: tap the Share icon ⬆️ → "Add to Home Screen".
The app then launches full-screen without the Safari chrome, with its own
icon.

## Features

- Live map with clustered markers for supermarkets (teal) and gas stations
  (amber) — color choice inspired by nautical buoyage marks, fitting for a
  harbor city like Hamburg
- Bottom sheet with a three-state "peek / half / full" behavior (like
  native map apps), operable by swipe/drag or via an explicit toggle button
  in its header (for mouse/desktop use)
- List sorted by distance to the user's location (if granted), otherwise to
  the map center
- Detail view per place: address, open/closed status (evaluated from OSM
  `opening_hours`, shown in a human-readable German translation of the raw
  syntax), distance, route (opens OSM's route planner), call button, a
  direct "View on OpenStreetMap" link (so users can fix incorrect entries
  at the source), and — for gas stations — the available fuel types
- Filter chips: "All supermarkets" / "Known supermarkets" (major chains
  only, e.g. Edeka, Rewe, Aldi, Lidl), "All gas stations" / "Known gas
  stations" (major chains only, e.g. Aral, Shell, Esso), and "Open now".
  The "All" and "Known" chip within each category are mutually exclusive;
  both can still be switched off to hide the category entirely. Each chip
  shows a red/green status dot to make its active state unambiguous at a
  glance.
- Settings menu (gear/kebab button): manual "refresh data now" (bypasses
  the staleness cache), light/dark/system theme override, satellite map
  view toggle, and a fuel-type filter (Diesel, Super, Super Plus, E85, LPG,
  charging) — all persisted in `localStorage`
- Address search (Nominatim), scoped to Hamburg
- Location display with accuracy radius, "locate me" FAB
- App shortcuts (Android: long-press the home-screen icon) straight to
  "nearest gas station" / "nearest supermarket"
- Offline-capable: app shell, last-loaded map tiles, and POI data remain
  usable without a connection; a status indicator distinguishes "offline"
  from "map data service unreachable" (e.g. Overpass rate-limited)
- Dark mode follows system settings by default, with a manual override
- Safe-area insets for iPhones with a notch/Dynamic Island

## Known limitations

- The `opening_hours` parser and humanizer (`js/overpass.js`) cover the
  most common OSM syntax patterns (weekday ranges, simple time spans,
  `24/7`, `PH`/`SH` closures), but not every possible expression — in
  unsupported cases the app deliberately shows "unknown" rather than a
  guessed value, and the raw text is left untouched rather than
  mistranslated.
- Public Overpass/Nominatim servers are fair-use rate-limited. Under heavy
  concurrent usage, consider running a dedicated Overpass server or using a
  commercial provider.
- POI data quality depends on OpenStreetMap (crowd-maintained, generally
  very good in Hamburg, but not guaranteed to be complete or up to date).
- The "known chains" brand list (`KNOWN_CHAINS` in `js/config.js`) is a
  curated, intentionally non-exhaustive set of major German chains —
  regional or smaller chains won't show up under "Known X" even if
  well-established locally.

## Extensibility

Adding a new category (e.g. bakeries, drugstores, EV charging stations):

1. Add a new entry under `CATEGORIES` in `js/config.js` with matching
   `overpassSelectors`
2. Add an icon SVG to `ICONS_SVG` in `js/map.js`
3. Add a `.poi-marker--<category>` color in `css/main.css`
4. Optionally add a filter chip in `index.html`

The rest of the app (loading, caching, rendering, detail view) works
automatically thanks to the generic category structure.

## Map data license

© OpenStreetMap contributors, published under the [Open Database
License](https://www.openstreetmap.org/copyright). Attribution is built
into the map (`css/main.css` / Leaflet's attribution control) and must not
be removed. Satellite imagery attribution (Esri, Maxar, Earthstar
Geographics) is likewise built in and switches automatically with the map
style.
