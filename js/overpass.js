// Overpass-API-Anbindung: baut die Overpass-QL-Anfrage für ein Bounding Box,
// probiert bei Fehlern/Timeout weitere Spiegel-Server, und normalisiert die
// rohen OSM-Elemente in ein schlankes POI-Format, das der Rest der App nutzt.

import { CATEGORIES, OVERPASS_ENDPOINTS, FETCH_TIMEOUT_MS } from "./config.js";

function buildQuery(bbox) {
  const { south, west, north, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;
  const clauses = [];
  for (const cat of Object.values(CATEGORIES)) {
    for (const selector of cat.overpassSelectors) {
      const [key, value] = selector.split("=");
      clauses.push(`node["${key}"="${value}"](${bboxStr});`);
      clauses.push(`way["${key}"="${value}"](${bboxStr});`);
    }
  }
  return `[out:json][timeout:20];(${clauses.join("")});out center tags;`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function classify(tags) {
  if (tags.amenity === "fuel") return "fuel";
  if (
    tags.shop === "supermarket" ||
    tags.shop === "convenience" ||
    tags.shop === "discount_supermarket"
  ) {
    return "supermarket";
  }
  return null;
}

function formatAddress(tags) {
  const street = tags["addr:street"];
  const num = tags["addr:housenumber"];
  const plz = tags["addr:postcode"];
  const city = tags["addr:city"];
  const line1 = [street, num].filter(Boolean).join(" ");
  const line2 = [plz, city].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ") || null;
}

/** Normalisiert ein rohes Overpass-Element in unser POI-Format. */
function normalize(el) {
  const tags = el.tags || {};
  const category = classify(tags);
  if (!category) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  return {
    id: `${el.type}/${el.id}`,
    category,
    name: tags.name || (category === "fuel" ? "Tankstelle" : "Supermarkt"),
    brand: tags.brand || null,
    lat,
    lon,
    address: formatAddress(tags),
    openingHours: tags.opening_hours || null,
    phone: tags.phone || tags["contact:phone"] || null,
    website: tags.website || tags["contact:website"] || null,
    fuelTypes: category === "fuel" ? extractFuelTypes(tags) : null,
    fetchedAt: Date.now(),
  };
}

function extractFuelTypes(tags) {
  const map = {
    "fuel:diesel": "Diesel",
    "fuel:octane_95": "Super",
    "fuel:octane_98": "Super Plus",
    "fuel:e85": "E85",
    "fuel:lpg": "LPG",
    "fuel:electricity": "Laden",
  };
  const found = Object.entries(map)
    .filter(([key]) => tags[key] === "yes")
    .map(([, label]) => label);
  return found.length ? found : null;
}

/**
 * Lädt POIs für ein Bounding Box. Versucht der Reihe nach alle bekannten
 * Overpass-Spiegel, falls einer nicht erreichbar ist oder timeoutet.
 */
export async function fetchPois(bbox) {
  const query = buildQuery(bbox);
  const body = "data=" + encodeURIComponent(query);
  let lastError;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
        FETCH_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      return (json.elements || [])
        .map(normalize)
        .filter(Boolean);
    } catch (err) {
      lastError = err;
      continue; // nächsten Spiegel versuchen
    }
  }
  throw lastError || new Error("Alle Overpass-Server nicht erreichbar");
}

/* ==========================================================================
 * opening_hours (OSM-Syntax) – vereinfachte Auswertung "ist jetzt offen?"
 * Deckt die häufigsten Fälle ab: "24/7", "Mo-Fr 08:00-20:00; Sa 08:00-16:00",
 * Tageslisten mit Kommas, über Mitternacht laufende Zeiten. Bei nicht
 * unterstützter Syntax wird `null` (unbekannt) zurückgegeben statt zu raten.
 * ========================================================================== */

const DAY_CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function expandDayRange(token) {
  // "Mo-Fr" -> ["Mo","Tu","We","Th","Fr"], "Sa" -> ["Sa"], "Mo,We,Fr" handled by caller split
  const m = token.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
  if (!m) return null;
  const start = DAY_CODES.indexOf(m[1]);
  const end = m[2] ? DAY_CODES.indexOf(m[2]) : start;
  const days = [];
  let i = start;
  while (true) {
    days.push(DAY_CODES[i]);
    if (i === end) break;
    i = (i + 1) % 7;
  }
  return days;
}

function parseRule(rule) {
  // z.B. "Mo-Fr 08:00-20:00,Sa 08:00-16:00" -> [{days:[...], from, to}]
  const dayPartMatch = rule.match(/^([A-Za-z,\-\s]+?)\s+(\d{1,2}:\d{2}-\d{1,2}:\d{2})/);
  if (!dayPartMatch) return null;
  const [, dayPart, timePart] = dayPartMatch;
  const dayTokens = dayPart.split(",").map((s) => s.trim()).filter(Boolean);
  let days = [];
  for (const tok of dayTokens) {
    const expanded = expandDayRange(tok);
    if (!expanded) return null;
    days = days.concat(expanded);
  }
  const [from, to] = timePart.split("-");
  return { days, from, to };
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * @param {string} value - opening_hours-Tag
 * @returns {boolean|null} true/false wenn auswertbar, sonst null (unbekannt)
 */
export function isOpenNow(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "24/7") return true;

  // Nur einfache, semikolon-getrennte Regeln unterstützen (keine
  // Ausnahmen/Feiertage/PH-Syntax – dafür lieber "unbekannt" melden).
  if (/PH|SH|off\b|week \d/i.test(trimmed)) return null;

  const now = new Date();
  const today = DAY_CODES[(now.getDay() + 6) % 7]; // JS: So=0 -> unsere Liste beginnt Mo
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const rules = trimmed.split(";").map((r) => r.trim()).filter(Boolean);
  let matched = false;
  let openResult = false;

  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (!parsed) return null; // unbekannte Syntax -> lieber nicht raten
    if (!parsed.days.includes(today)) continue;
    matched = true;
    const from = timeToMinutes(parsed.from);
    const to = timeToMinutes(parsed.to);
    if (to > from) {
      openResult = nowMinutes >= from && nowMinutes < to;
    } else {
      // über Mitternacht, z.B. 20:00-02:00
      openResult = nowMinutes >= from || nowMinutes < to;
    }
    if (openResult) return true;
  }
  return matched ? openResult : false;
}
