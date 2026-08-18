// Service Worker – Nahversorgung Hamburg
// Strategy overview:
//  - App shell (HTML/CSS/JS/icons + Leaflet CDN assets): cache-first, precached on install
//  - Map tiles (OSM):                                    cache-first, capped + expiring
//  - Overpass API (POI data):                             network-first, falls back to cache offline
//  - Nominatim (search):                                   network-only (freshness matters, low volume)

const VERSION = "v1.1.0";
const SHELL_CACHE = `hh-shell-${VERSION}`;
const TILE_CACHE = `hh-tiles-${VERSION}`;
const API_CACHE = `hh-api-${VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/main.css",
  "./js/app.js",
  "./js/config.js",
  "./js/db.js",
  "./js/geolocation.js",
  "./js/map.js",
  "./js/overpass.js",
  "./js/search.js",
  "./js/ui.js",
  "./js/pwa-install.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
];

const TILE_MAX_ENTRIES = 800; // roughly enough for Hamburg at a handful of zoom levels
const API_MAX_ENTRIES = 40;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll fails hard on a single miss; add individually so one bad CDN
      // response doesn't block the whole install.
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try {
            await cache.add(new Request(url, { mode: url.startsWith("http") ? "cors" : "same-origin" }));
          } catch (err) {
            // Non-fatal: asset will be fetched (and cached) on first real request instead.
            console.warn("[sw] precache skipped:", url, err);
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, TILE_CACHE, API_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

function isTileRequest(url) {
  return /tile\.openstreetmap\.org|\.tile\.openstreetmap\.org|basemaps\.cartocdn\.com|arcgisonline\.com/.test(url.host + url.pathname) ||
         /\/\d+\/\d+\/\d+(\.png)?$/.test(url.pathname);
}

function isOverpassRequest(url) {
  return /overpass-api\.de|overpass\.kumi\.systems/.test(url.host);
}

function isNominatimRequest(url) {
  return /nominatim\.openstreetmap\.org/.test(url.host);
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      trimCache(cacheName, maxEntries);
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function networkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      trimCache(cacheName, maxEntries);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isTileRequest(url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, TILE_MAX_ENTRIES));
    return;
  }

  if (isOverpassRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE, API_MAX_ENTRIES));
    return;
  }

  if (isNominatimRequest(url)) {
    return; // network only, browser default
  }

  // App shell + same-origin assets + CDN libs: cache-first with background refresh
  if (url.origin === self.location.origin || SHELL_ASSETS.includes(request.url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => undefined);
        return cached || (await network) || Response.error();
      })()
    );
  }
});

// Allow the page to trigger an immediate activation after an update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
