// Zentrale Konfiguration der App. Alles, was sich "an einer Stelle" ändern
// soll (Kartenquelle, Hamburg-Grenzen, Kategorien, Caching-Parameter),
// lebt hier – die restlichen Module importieren nur daraus.

export const HAMBURG = {
  // Grober Umkreis der Freien und Hansestadt Hamburg inkl. Randgemeinden.
  center: [53.5511, 9.9937],
  defaultZoom: 12,
  minZoom: 10,
  maxZoom: 19,
  // [südwest, nordost] – begrenzt Suche/Karte auf die Metropolregion,
  // damit die App fokussiert bleibt und Overpass-Anfragen klein.
  bounds: {
    south: 53.39,
    west: 9.65,
    north: 53.75,
    east: 10.35,
  },
};

export const TILE_LAYER = {
  // Standard-OSM-Kacheln – kostenlos, kein API-Key nötig.
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  subdomains: ["a", "b", "c"],
};

export const SATELLITE_TILE_LAYER = {
  // Esri World Imagery – ebenfalls kostenlos ohne API-Key nutzbar,
  // Attribution ist Pflicht.
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution:
    'Satellitenbilder: &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
};

export const CATEGORIES = {
  supermarket: {
    id: "supermarket",
    label: "Supermarkt",
    labelPlural: "Supermärkte",
    color: "#1B998B",
    // OSM-Tags, die als "Supermarkt" gewertet werden.
    overpassSelectors: [
      'shop=supermarket',
      'shop=convenience',
      'shop=discount_supermarket',
    ],
  },
  fuel: {
    id: "fuel",
    label: "Tankstelle",
    labelPlural: "Tankstellen",
    color: "#FFB100",
    overpassSelectors: ["amenity=fuel"],
  },
};

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

export const CACHE = {
  dbName: "hh-nahversorgung",
  dbVersion: 1,
  poiStore: "pois",
  metaStore: "meta",
  // Wie alt dürfen zwischengespeicherte POIs sein, bevor wir im Hintergrund
  // neu laden (die App zeigt trotzdem sofort die alten Daten an).
  staleAfterMs: 1000 * 60 * 60 * 6, // 6 Stunden
  // Nach dieser Zeit gilt der lokale Cache als "zu alt für Offline-Anzeige".
  maxAgeMs: 1000 * 60 * 60 * 24 * 7, // 7 Tage
};

export const FETCH_TIMEOUT_MS = 12000;

// Ab diesem Zoom werden überhaupt POIs geladen (verhindert riesige
// Overpass-Anfragen bei weit rausgezoomter Karte).
export const MIN_ZOOM_FOR_DATA = 12;

// Für die Filter "Bekannte Supermärkte" / "Bekannte Tankstellen": grobe,
// bewusst nicht abschließende Liste der großen, bundesweit (bzw. in
// Norddeutschland) verbreiteten Ketten. Kleingeschrieben, da der Abgleich
// case-insensitive gegen brand- und name-Tag läuft (Teilstring-Suche, damit
// z. B. auch "REWE To Go" oder "TotalEnergies" erfasst werden).
export const KNOWN_CHAINS = {
  supermarket: ["edeka", "rewe", "aldi", "lidl", "penny", "netto", "kaufland", "famila", "combi", "sky"],
  fuel: ["aral", "shell", "esso", "total", "jet", "star", "hem", "avia"],
};

/** Prüft, ob ein POI zu einer der großen, bekannten Ketten seiner Kategorie gehört. */
export function isKnownChain(poi) {
  const list = KNOWN_CHAINS[poi.category];
  if (!list) return false;
  const haystack = `${poi.brand || ""} ${poi.name || ""}`.toLowerCase();
  return list.some((brand) => haystack.includes(brand));
}
