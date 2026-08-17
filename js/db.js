// Schlanker IndexedDB-Wrapper. Bewusst ohne externe Abhängigkeit (idb-Lib),
// damit die App ohne Build-Schritt funktioniert. Speichert POIs + einen
// kleinen "meta"-Store für Zeitstempel je Kategorie/Kachelregion.

import { CACHE } from "./config.js";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE.dbName, CACHE.dbVersion);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE.poiStore)) {
        const store = db.createObjectStore(CACHE.poiStore, { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
      }
      if (!db.objectStoreNames.contains(CACHE.metaStore)) {
        db.createObjectStore(CACHE.metaStore, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

/** Speichert (upsert) eine Liste von POIs. */
export async function savePois(pois) {
  if (!pois.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, CACHE.poiStore, "readwrite");
    for (const poi of pois) store.put(poi);
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

/** Liest alle zwischengespeicherten POIs (optional gefiltert nach Kategorie). */
export async function getAllPois(category = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, CACHE.poiStore, "readonly");
    const source = category ? store.index("category").getAll(category) : store.getAll();
    source.onsuccess = () => resolve(source.result || []);
    source.onerror = () => reject(source.error);
  });
}

/** Merkt sich, wann eine bestimmte Region zuletzt geladen wurde. */
export async function setRegionFetchedAt(regionKey, timestamp = Date.now()) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, CACHE.metaStore, "readwrite");
    store.put({ key: regionKey, timestamp });
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

export async function getRegionFetchedAt(regionKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = tx(db, CACHE.metaStore, "readonly");
    const req = store.get(regionKey);
    req.onsuccess = () => resolve(req.result ? req.result.timestamp : 0);
    req.onerror = () => reject(req.error);
  });
}

/** Entfernt Einträge, die älter als maxAgeMs sind (Aufräumen im Hintergrund). */
export async function pruneStale(maxAgeMs = CACHE.maxAgeMs) {
  const db = await openDb();
  const cutoff = Date.now() - maxAgeMs;
  return new Promise((resolve, reject) => {
    const store = tx(db, CACHE.poiStore, "readwrite");
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      if ((cursor.value.fetchedAt || 0) < cutoff) cursor.delete();
      cursor.continue();
    };
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}
