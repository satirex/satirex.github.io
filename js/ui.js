// Bedien-Ebene: Bottom Sheet (Drag-Gesten), Listen-/Detailansicht,
// Filter-Chips, Toast- und Status-Anzeigen. Reine DOM-Logik, kennt weder
// Leaflet noch Overpass – bekommt fertige POI-Objekte und Callbacks.

import { CATEGORIES } from "./config.js";
import { formatDistance, distanceMeters } from "./geolocation.js";
import { isOpenNow } from "./overpass.js";

const $ = (sel) => document.querySelector(sel);

export class Sheet {
  constructor(onStateChange) {
    this.el = $("#sheet");
    this.grabber = $("#sheet-grabber");
    this.header = this.el.querySelector(".sheet__header");
    this.body = $("#sheet-body");
    this.onStateChange = onStateChange;
    this.state = "peek";
    this._bindDrag();
  }

  setState(state) {
    this.state = state;
    this.el.dataset.state = state;
    this.onStateChange?.(state);
  }

  _bindDrag() {
    let startY = 0;
    let startTranslate = 0;
    let dragging = false;
    const heightPx = () => this.el.getBoundingClientRect().height;

    const stateToTranslate = (state) => {
      const h = heightPx();
      if (state === "full") return 0;
      if (state === "half") return h * 0.38;
      return h - 128 - this._safeBottom();
    };

    const currentTranslate = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(this.el).transform);
      return m.m42;
    };

    const onStart = (clientY) => {
      dragging = true;
      startY = clientY;
      startTranslate = currentTranslate();
      this.el.classList.add("is-dragging");
    };
    const onMove = (clientY) => {
      if (!dragging) return;
      const delta = clientY - startY;
      const h = heightPx();
      const next = Math.min(Math.max(startTranslate + delta, 0), h);
      this.el.style.transform = `translateY(${next}px)`;
    };
    const onEnd = (clientY) => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove("is-dragging");
      const delta = clientY - startY;
      const h = heightPx();
      const positions = { full: 0, half: h * 0.38, peek: h - 128 - this._safeBottom() };
      const current = startTranslate + delta;
      let nearest = "peek";
      let nearestDist = Infinity;
      for (const [state, pos] of Object.entries(positions)) {
        const d = Math.abs(pos - current);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = state;
        }
      }
      // schnelle Wischgeste übersteuert die reine Positions-Nähe
      if (Math.abs(delta) > 60) {
        if (delta < 0 && this.state === "peek") nearest = "half";
        else if (delta < 0 && this.state === "half") nearest = "full";
        else if (delta > 0 && this.state === "full") nearest = "half";
        else if (delta > 0 && this.state === "half") nearest = "peek";
      }
      this.el.style.transform = "";
      this.setState(nearest);
    };

    this.grabber.addEventListener("touchstart", (e) => onStart(e.touches[0].clientY), { passive: true });
    this.grabber.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
    this.grabber.addEventListener("touchend", (e) => onEnd(e.changedTouches[0].clientY));
    this.header.addEventListener("touchstart", (e) => onStart(e.touches[0].clientY), { passive: true });
    this.header.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
    this.header.addEventListener("touchend", (e) => onEnd(e.changedTouches[0].clientY));

    // Desktop/Maus-Fallback (praktisch beim Testen im Browser)
    this.grabber.addEventListener("mousedown", (e) => {
      onStart(e.clientY);
      const move = (ev) => onMove(ev.clientY);
      const up = (ev) => {
        onEnd(ev.clientY);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  }

  _safeBottom() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom");
    return parseFloat(v) || 0;
  }
}

export function renderList({ pois, userPos, onSelect, title, countLabel }) {
  const body = $("#sheet-body");
  $("#sheet-title").textContent = title;
  $("#sheet-count").textContent = countLabel;

  if (!pois.length) {
    body.innerHTML = `
      <div class="sheet__empty">
        <strong>Nichts gefunden</strong>
        Bewege die Karte oder ändere die Filter, um Orte in der Nähe zu sehen.
      </div>`;
    return;
  }

  const withDistance = pois.map((poi) => ({
    poi,
    dist: userPos ? distanceMeters(userPos, { lat: poi.lat, lon: poi.lon }) : null,
  }));
  if (userPos) withDistance.sort((a, b) => a.dist - b.dist);

  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const { poi, dist } of withDistance) {
    const row = document.createElement("button");
    row.className = "poi-row";
    row.type = "button";
    const open = isOpenNow(poi.openingHours);
    const dotClass = open === true ? "status-dot--open" : open === false ? "status-dot--closed" : "status-dot--unknown";
    const dotLabel = open === true ? "Geöffnet" : open === false ? "Geschlossen" : "Öffnungszeiten unbekannt";
    row.innerHTML = `
      <span class="poi-row__mark poi-row__mark--${poi.category}">${markGlyph(poi.category)}</span>
      <span class="poi-row__main">
        <span class="poi-row__name">${escapeHtml(poi.name)}</span>
        <span class="poi-row__meta"><span class="status-dot ${dotClass}" title="${dotLabel}"></span>${dotLabel}${poi.address ? " · " + escapeHtml(poi.address) : ""}</span>
      </span>
      <span class="poi-row__dist">${dist != null ? formatDistance(dist) : ""}</span>
    `;
    row.addEventListener("click", () => onSelect(poi));
    frag.appendChild(row);
  }
  body.appendChild(frag);
}

export function renderDetail({ poi, userPos, onBack }) {
  const body = $("#sheet-body");
  $("#sheet-title").textContent = CATEGORIES[poi.category]?.label || "Ort";
  $("#sheet-count").textContent = "";

  const dist = userPos ? distanceMeters(userPos, { lat: poi.lat, lon: poi.lon }) : null;
  const open = isOpenNow(poi.openingHours);
  const openLabel = open === true ? "Geöffnet" : open === false ? "Geschlossen" : "Unbekannt";
  const mapsUrl = `https://www.openstreetmap.org/directions?from=&to=${poi.lat}%2C${poi.lon}`;
  const telUrl = poi.phone ? `tel:${poi.phone.replace(/\s+/g, "")}` : null;

  body.innerHTML = `
    <div class="detail">
      <button class="detail__back" id="detail-back">
        <svg class="icon" viewBox="0 0 24 24" width="16" height="16"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Zurück
      </button>
      <h3 class="detail__title">${escapeHtml(poi.name)}</h3>
      <p class="detail__subtitle">${poi.address ? escapeHtml(poi.address) : "Adresse nicht hinterlegt"}</p>
      <div class="detail__actions">
        <a class="btn btn--primary" href="${mapsUrl}" target="_blank" rel="noopener">Route</a>
        ${telUrl ? `<a class="btn btn--ghost" href="${telUrl}">Anrufen</a>` : ""}
      </div>
      <div class="detail__facts">
        <div class="detail__fact">
          <div class="detail__fact-label">Status</div>
          <div class="detail__fact-value">${openLabel}</div>
        </div>
        <div class="detail__fact">
          <div class="detail__fact-label">Entfernung</div>
          <div class="detail__fact-value">${dist != null ? formatDistance(dist) : "—"}</div>
        </div>
        <div class="detail__fact">
          <div class="detail__fact-label">Öffnungszeiten</div>
          <div class="detail__fact-value">${poi.openingHours ? escapeHtml(poi.openingHours) : "—"}</div>
        </div>
        <div class="detail__fact">
          <div class="detail__fact-label">${poi.category === "fuel" ? "Kraftstoffe" : "Marke"}</div>
          <div class="detail__fact-value">${
            poi.category === "fuel"
              ? (poi.fuelTypes ? poi.fuelTypes.join(", ") : "—")
              : (poi.brand || "—")
          }</div>
        </div>
      </div>
    </div>
  `;
  $("#detail-back").addEventListener("click", onBack);
}

function markGlyph(category) {
  return category === "fuel" ? "⛽" : "🛒";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function showToast(message, durationMs = 2600) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (el.hidden = true), durationMs);
}

export function setStatusPill(text, tone) {
  const el = $("#status-pill");
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.tone = tone || "";
}

export function bindChips(onChange) {
  const chips = document.querySelectorAll(".chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("is-active");
      const active = {};
      chips.forEach((c) => (active[c.dataset.filter] = c.classList.contains("is-active")));
      onChange(active);
    });
  });
}
