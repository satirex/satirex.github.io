// Kapselt die Geolocation-API in eine kleine, promise-/callback-basierte
// Schnittstelle inkl. eines fortlaufenden "watch", den die App nutzt, um
// den blauen Standortpunkt live zu bewegen.

let watchId = null;

export function isSupported() {
  return "geolocation" in navigator;
}

export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error("Geolocation wird von diesem Browser nicht unterstützt."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000, ...options }
    );
  });
}

/** Startet fortlaufende Standort-Updates. Gibt eine Stop-Funktion zurück. */
export function watchPosition(onUpdate, onError) {
  if (!isSupported()) return () => {};
  stopWatch();
  watchId = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
    (err) => onError && onError(err),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
  );
  return stopWatch;
}

export function stopWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/** Haversine-Distanz in Metern zwischen zwei Koordinaten. */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters) {
  if (meters == null) return "";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}
