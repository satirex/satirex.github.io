// App-Einstiegspunkt: verdrahtet alle Module, hält den (kleinen) globalen
// Zustand und orchestriert den Datenfluss Karte <-> Overpass <-> IndexedDB
// <-> Bottom Sheet. Bewusst ohne Framework – bei dieser Größe reicht ein
// simpler, expliziter State-Objekt völlig aus und bleibt gut lesbar.

import { CATEGORIES, CACHE } from "./config.js";
import { PoiMap } from "./map.js";
import { fetchPois } from "./overpass.js";
import { savePois, getAllPois, setRegionFetchedAt, getRegionFetchedAt, pruneStale } from "./db.js";
import * as Geo from "./geolocation.js";
import { searchPlace, debounce } from "./search.js";
import { Sheet, renderList, renderDetail, showToast, setStatusPill, bindChips } from "./ui.js";
import { initInstallPrompts } from "./pwa-install.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  poisById: new Map(), // id -> poi (alle je geladenen POIs, Quelle der Wahrheit)
  filters: { supermarket: true, fuel: true, "open-now": false },
  fuelTypeFilter: new Set(), // leer = alle Kraftstoffarten
  userPos: null,
  selectedPoi: null,
  view: "list", // "list" | "detail"
  lastBboxKey: null,
};

let map;
let sheet;

/* ---------------------------------------------------------------------- *
 * Datenfluss
 * ---------------------------------------------------------------------- */

function regionKeyFor(bbox) {
  // Grob gerundet, damit kleine Kartenbewegungen keine neue Region ergeben.
  const round = (n) => Math.round(n * 50) / 50;
  return `${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
}

function upsertPois(list) {
  for (const poi of list) state.poisById.set(poi.id, poi);
}

async function loadFromCacheFirst() {
  try {
    const cached = await getAllPois();
    if (cached.length) {
      upsertPois(cached);
      renderMarkers();
      renderSheetForView();
    }
  } catch (err) {
    console.warn("Cache-Lesefehler", err);
  }
}

async function loadForBbox(bbox, force = false) {
  const key = regionKeyFor(bbox);
  if (!force && key === state.lastBboxKey) return;
  state.lastBboxKey = key;

  if (!force) {
    const lastFetch = await getRegionFetchedAt(key).catch(() => 0);
    const isFresh = Date.now() - lastFetch < CACHE.staleAfterMs;
    if (isFresh) return; // wir haben diese Region kürzlich schon geladen
  }

  setStatusPill("Aktualisiere …", "loading");
  try {
    const fresh = await fetchPois(bbox);
    upsertPois(fresh);
    await savePois(fresh);
    await setRegionFetchedAt(key);
    setStatusPill(null);
    renderMarkers();
    renderSheetForView();
  } catch (err) {
    console.warn("Overpass-Fehler", err);
    setStatusPill("Kartendaten nicht erreichbar", "offline");
    setTimeout(() => setStatusPill(null), 4000);
  }
}

/* ---------------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------------- */

function activeCategories() {
  return Object.keys(CATEGORIES).filter((id) => state.filters[id]);
}

function filteredPois() {
  const cats = new Set(activeCategories());
  const wantOpenOnly = !!state.filters["open-now"];
  let all = Array.from(state.poisById.values()).filter((p) => cats.has(p.category));
  if (wantOpenOnly) {
    // Bei "jetzt geöffnet" nur eindeutig geschlossene Orte ausblenden;
    // unbekannte Öffnungszeiten bleiben sichtbar statt fälschlich zu verschwinden.
    all = all.filter((p) => poiOpenState(p) !== false);
  }
  if (state.fuelTypeFilter.size) {
    all = all.filter(
      (p) => p.category !== "fuel" || (p.fuelTypes && p.fuelTypes.some((t) => state.fuelTypeFilter.has(t)))
    );
  }
  return all;
}

function poiOpenState(poi) {
  // kleine Indirektion, damit ui.js's isOpenNow nicht doppelt importiert werden muss
  return window.__hhIsOpenNow ? window.__hhIsOpenNow(poi.openingHours) : null;
}

function renderMarkers() {
  for (const catId of Object.keys(CATEGORIES)) {
    const visible = !!state.filters[catId];
    map.setCategoryVisible(catId, visible);
    if (!visible) continue;
    const list = filteredPois().filter((p) => p.category === catId);
    map.setCategoryMarkers(catId, list);
  }
}

function renderSheetForView() {
  if (state.view === "detail" && state.selectedPoi) {
    renderDetail({
      poi: state.selectedPoi,
      userPos: state.userPos,
      onBack: () => {
        state.view = "list";
        renderSheetForView();
      },
    });
    return;
  }
  const pois = filteredPois();
  const center = state.userPos || map.getCenter();
  renderList({
    pois,
    userPos: center,
    onSelect: (poi) => selectPoi(poi, { fly: true }),
    title: "In der Nähe",
    countLabel: pois.length ? `${pois.length}` : "",
  });
}

function selectPoi(poi, { fly = false } = {}) {
  state.selectedPoi = poi;
  state.view = "detail";
  if (fly) map.focusOn(poi);
  sheet.setState(sheet.state === "peek" ? "half" : sheet.state);
  renderSheetForView();
}

/* ---------------------------------------------------------------------- *
 * Bootstrap
 * ---------------------------------------------------------------------- */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showToast("Neue Version verfügbar – beim nächsten Start aktiv.");
        }
      });
    });
  } catch (err) {
    console.warn("Service Worker Registrierung fehlgeschlagen", err);
  }
}

function initOnboarding() {
  const seen = localStorage.getItem("hh-onboarding-seen") === "1";
  const overlay = $("#onboarding");
  if (seen) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  const dismiss = () => {
    overlay.hidden = true;
    localStorage.setItem("hh-onboarding-seen", "1");
  };
  $("#onboarding-start").addEventListener("click", dismiss);
  $("#onboarding-locate").addEventListener("click", () => {
    dismiss();
    requestUserLocation({ fly: true });
  });
}

function requestUserLocation({ fly = false } = {}) {
  const fab = $("#fab-locate");
  fab.classList.add("is-locating");
  Geo.getCurrentPosition()
    .then((pos) => {
      state.userPos = pos;
      map.updateUserPosition(pos);
      if (fly) map.flyToUser();
      renderSheetForView();
      Geo.watchPosition(
        (p) => {
          state.userPos = p;
          map.updateUserPosition(p);
        },
        () => {}
      );
    })
    .catch((err) => {
      console.warn("Standort nicht verfügbar", err);
      showToast("Standort konnte nicht ermittelt werden.");
    })
    .finally(() => fab.classList.remove("is-locating"));
}

function initSearch() {
  const input = $("#search-input");
  const clearBtn = $("#search-clear");
  const results = $("#search-results");

  const runSearch = debounce(async (q) => {
    if (!q || q.trim().length < 3) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    try {
      const hits = await searchPlace(q);
      results.innerHTML = "";
      if (!hits.length) {
        results.hidden = true;
        return;
      }
      for (const hit of hits) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = hit.label;
        btn.addEventListener("click", () => {
          map.map.setView([hit.lat, hit.lon], 15, { animate: true });
          results.hidden = true;
          input.blur();
        });
        li.appendChild(btn);
        results.appendChild(li);
      }
      results.hidden = false;
    } catch (err) {
      console.warn("Suche fehlgeschlagen", err);
    }
  }, 400);

  input.addEventListener("input", () => {
    clearBtn.hidden = input.value.length === 0;
    runSearch(input.value);
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    results.hidden = true;
    input.focus();
  });
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== input) results.hidden = true;
  });
}

function initChips() {
  bindChips((active) => {
    state.filters = { ...state.filters, ...active };
    renderMarkers();
    renderSheetForView();
  });
}

/** Wertet ?filter=fuel|supermarket aus (App-Shortcuts vom Homescreen-Icon). */
function applyShortcutFilter() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("filter");
  if (!requested || !CATEGORIES[requested]) return;

  for (const catId of Object.keys(CATEGORIES)) {
    state.filters[catId] = catId === requested;
  }
  document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
    const key = chip.dataset.filter;
    if (key === "supermarket" || key === "fuel") {
      chip.classList.toggle("is-active", state.filters[key]);
    }
  });
}

function initFabs() {
  $("#fab-locate").addEventListener("click", () => requestUserLocation({ fly: true }));
}

function initMenu() {
  const overlay = $("#menu-overlay");
  const openBtn = $("#fab-menu");
  const closeBtn = $("#menu-close");

  const open = () => (overlay.hidden = false);
  const close = () => (overlay.hidden = true);
  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close(); // Klick auf den Hintergrund schließt
  });

  initThemeSwitch();
  initFuelFilter();

  $("#menu-refresh").addEventListener("click", async () => {
    const bbox = map.getBounds();
    if (!bbox) {
      showToast("Bitte etwas näher heranzoomen.");
      return;
    }
    close();
    setStatusPill("Aktualisiere …", "loading");
    try {
      const fresh = await fetchPois(bbox);
      upsertPois(fresh);
      await savePois(fresh);
      await setRegionFetchedAt(regionKeyFor(bbox));
      setStatusPill(null);
      renderMarkers();
      renderSheetForView();
      showToast("Daten aktualisiert");
    } catch (err) {
      console.warn("Overpass-Fehler (manueller Refresh)", err);
      setStatusPill("Kartendaten nicht erreichbar", "offline");
      setTimeout(() => setStatusPill(null), 4000);
    }
  });
}

/** Merkt sich die Theme-Wahl (System/Hell/Dunkel) in localStorage und
 *  wendet sie über das data-theme-Attribut an, das die CSS-Overrides in
 *  main.css greifen lässt. */
function initThemeSwitch() {
  const buttons = document.querySelectorAll("#theme-segmented .segmented__option");
  const stored = localStorage.getItem("hh-theme") || "system";

  const apply = (theme) => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    buttons.forEach((b) => b.classList.toggle("is-active", b.dataset.theme === theme));
  };

  apply(stored);
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      localStorage.setItem("hh-theme", btn.dataset.theme);
      apply(btn.dataset.theme);
    });
  });
}

function initFuelFilter() {
  const chips = document.querySelectorAll("#fuel-filter .fuel-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const fuel = chip.dataset.fuel;
      if (state.fuelTypeFilter.has(fuel)) state.fuelTypeFilter.delete(fuel);
      else state.fuelTypeFilter.add(fuel);
      chip.classList.toggle("is-active");
      renderMarkers();
      renderSheetForView();
    });
  });
}

function initOfflineIndicator() {
  const update = () => {
    if (!navigator.onLine) setStatusPill("Offline", "offline");
    else setStatusPill(null);
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

async function main() {
  // isOpenNow global verfügbar machen, ohne einen zweiten Importpfad zu
  // brauchen (siehe poiOpenState) – hält app.js von einem Zyklus mit overpass.js frei.
  const { isOpenNow } = await import("./overpass.js");
  window.__hhIsOpenNow = isOpenNow;

  initOnboarding();
  initInstallPrompts();
  initOfflineIndicator();
  registerServiceWorker();
  pruneStale().catch(() => {});

  map = new PoiMap("map", {
    onMarkerClick: (poi) => selectPoi(poi, { fly: false }),
    onMoveEnd: (bbox) => {
      if (bbox) loadForBbox(bbox);
      renderSheetForView();
    },
  });

  sheet = new Sheet();
  initSearch();
  initChips();
  applyShortcutFilter();
  initFabs();
  initMenu();

  await loadFromCacheFirst();

  // Standort im Hintergrund anfragen (falls Berechtigung schon erteilt war),
  // ohne den Nutzer erneut zu unterbrechen.
  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state === "granted") requestUserLocation({ fly: false });
    } catch {
      /* Permissions API nicht überall verfügbar (u.a. iOS Safari) – dann still bleiben */
    }
  }

  window.addEventListener("resize", () => map.invalidateSize());
  window.addEventListener("orientationchange", () => setTimeout(() => map.invalidateSize(), 300));
}

main();
