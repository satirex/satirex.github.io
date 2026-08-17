// Adress-/Ortssuche über Nominatim (OpenStreetMap), auf die Hamburger
// Bounding Box eingegrenzt (viewbox + bounded=1) für relevantere Treffer.

import { HAMBURG, NOMINATIM_ENDPOINT } from "./config.js";

export function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

export async function searchPlace(query) {
  if (!query || query.trim().length < 3) return [];
  const { south, west, north, east } = HAMBURG.bounds;
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "6",
    viewbox: `${west},${north},${east},${south}`,
    bounded: "1",
    "accept-language": "de",
  });
  const res = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (${res.status})`);
  const results = await res.json();
  return results.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    type: r.type,
  }));
}
