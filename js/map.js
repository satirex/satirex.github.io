// Kapselt sämtliche Leaflet-Interaktion. Der Rest der App kennt kein
// Leaflet-API direkt, sondern spricht nur mit diesem Modul – so bliebe ein
// Wechsel der Kartenbibliothek später lokal begrenzt.

import { HAMBURG, TILE_LAYER, CATEGORIES, MIN_ZOOM_FOR_DATA } from "./config.js";

const ICONS_SVG = {
  supermarket:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M4 8h16l-1.5 10.5a2 2 0 0 1-2 1.5H7.5a2 2 0 0 1-2-1.5L4 8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 8V6a4 4 0 0 1 8 0v2" stroke="currentColor" stroke-width="2"/></svg>',
  fuel:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 20h10M15 10h2a2 2 0 0 1 2 2v3.5a1.5 1.5 0 0 0 3 0V9l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 6h4" stroke="currentColor" stroke-width="2"/></svg>',
};

export class PoiMap {
  /**
   * @param {string} containerId
   * @param {{onMarkerClick: (poi:object)=>void, onMoveEnd: (bbox:object, zoom:number)=>void}} handlers
   */
  constructor(containerId, handlers) {
    this.handlers = handlers;
    this.map = L.map(containerId, {
      center: HAMBURG.center,
      zoom: HAMBURG.defaultZoom,
      minZoom: HAMBURG.minZoom,
      maxZoom: HAMBURG.maxZoom,
      zoomControl: false,
      attributionControl: true,
      tap: true,
    });

    L.tileLayer(TILE_LAYER.url, {
      attribution: TILE_LAYER.attribution,
      subdomains: TILE_LAYER.subdomains,
      maxZoom: HAMBURG.maxZoom,
      crossOrigin: true,
    }).addTo(this.map);

    this.clusterGroups = {};
    this.markersById = new Map();

    for (const cat of Object.values(CATEGORIES)) {
      const group = L.markerClusterGroup({
        maxClusterRadius: 55,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        iconCreateFunction: (cluster) =>
          L.divIcon({
            html: `<div class="marker-cluster-custom">${cluster.getChildCount()}</div>`,
            className: "",
            iconSize: [36, 36],
          }),
      });
      this.clusterGroups[cat.id] = group;
      group.addTo(this.map);
    }

    this.userMarker = null;
    this.accuracyCircle = null;

    let moveTimer = null;
    this.map.on("moveend zoomend", () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => this._emitBoundsChange(), 250);
    });

    // Erste Ladung anstoßen, sobald der Kartencontainer seine echte Größe hat.
    requestAnimationFrame(() => {
      this.map.invalidateSize();
      this._emitBoundsChange();
    });
  }

  _emitBoundsChange() {
    const zoom = this.map.getZoom();
    if (zoom < MIN_ZOOM_FOR_DATA) {
      this.handlers.onMoveEnd?.(null, zoom);
      return;
    }
    const b = this.map.getBounds();
    this.handlers.onMoveEnd?.(
      { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      zoom
    );
  }

  _makeDivIcon(poi) {
    const svg = ICONS_SVG[poi.category] || "";
    return L.divIcon({
      className: "",
      html: `<div class="poi-marker poi-marker--${poi.category}"><span class="icon">${svg}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 28],
      popupAnchor: [0, -26],
    });
  }

  /** Ersetzt die angezeigten Marker einer Kategorie vollständig. */
  setCategoryMarkers(categoryId, pois) {
    const group = this.clusterGroups[categoryId];
    if (!group) return;
    group.clearLayers();
    this.markersById.forEach((_, key) => {
      if (key.startsWith(`${categoryId}:`)) this.markersById.delete(key);
    });

    const layers = pois.map((poi) => {
      const marker = L.marker([poi.lat, poi.lon], { icon: this._makeDivIcon(poi) });
      marker.on("click", () => this.handlers.onMarkerClick?.(poi));
      this.markersById.set(`${categoryId}:${poi.id}`, marker);
      return marker;
    });
    group.addLayers(layers);
  }

  setCategoryVisible(categoryId, visible) {
    const group = this.clusterGroups[categoryId];
    if (!group) return;
    if (visible && !this.map.hasLayer(group)) group.addTo(this.map);
    if (!visible && this.map.hasLayer(group)) this.map.removeLayer(group);
  }

  focusOn(poi, zoom = 17) {
    this.map.flyTo([poi.lat, poi.lon], Math.max(this.map.getZoom(), zoom), { duration: 0.6 });
  }

  updateUserPosition({ lat, lon, accuracy }) {
    const latlng = [lat, lon];
    if (!this.userMarker) {
      this.userMarker = L.marker(latlng, {
        icon: L.divIcon({ className: "", html: '<div class="user-marker"></div>', iconSize: [18, 18] }),
        zIndexOffset: 1000,
      }).addTo(this.map);
      this.accuracyCircle = L.circle(latlng, {
        radius: accuracy || 30,
        color: "#1a73e8",
        weight: 1,
        fillOpacity: 0.08,
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng(latlng);
      this.accuracyCircle.setLatLng(latlng).setRadius(accuracy || 30);
    }
  }

  flyToUser(zoom = 15) {
    if (!this.userMarker) return;
    this.map.flyTo(this.userMarker.getLatLng(), zoom, { duration: 0.6 });
  }

  getCenter() {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  getBounds() {
    if (this.map.getZoom() < MIN_ZOOM_FOR_DATA) return null;
    const b = this.map.getBounds();
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  }

  invalidateSize() {
    this.map.invalidateSize();
  }
}
