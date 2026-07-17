import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// The provider-swappable map wrapper — MapLibre GL, the ONLY place the map SDK
// is imported. Renders raster tiles (from tileUrlTemplate), numbered stop
// markers, and the road-snapped route line. Click the map to drop a stop.
export default function PlatformMap({
  tileUrlTemplate,
  styleUrl,             // vector style URL (labels stay upright on rotate); falls back to raster
  stops = [],           // [{ lat, lng, name }]
  routeLine = [],       // [[lng,lat], ...] road path (decoded polyline)
  center = [76.93, 8.52],
  zoom = 12,
  height = 460,
  fitKey,               // change to refit the view to the stops
  onMapClick,           // (lng, lat) => void
  flyTo,                // [lng, lat] to recenter on (e.g. a search hit)
  flyKey,               // change to (re)trigger the flyTo + preview pin
  vehicle,              // [lng, lat] — live bus position (animated marker)
  trail = [],           // [[lng,lat], ...] — the path travelled so far
  followVehicle = false, // keep the camera on the bus as it moves
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef([]);
  const searchMarker = useRef(null);
  const vehicleMarker = useRef(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  // init map once per style source
  useEffect(() => {
    if (!ref.current || (!styleUrl && !tileUrlTemplate)) return;
    // A vector style URL renders labels as live text that stays upright when the
    // map rotates (Google-Maps-like). Without one, fall back to raster tiles.
    const style = styleUrl || {
      version: 8,
      sources: { osm: { type: 'raster', tiles: [tileUrlTemplate], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    };
    const map = new maplibregl.Map({
      container: ref.current,
      style,
      center,
      zoom,
    });
    mapRef.current = map;
    // visualizePitch shows the compass tilt; the compass also rotates on drag.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    // "Locate me" — centers on the user's GPS position for easy route building.
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      'top-right'
    );
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('click', (e) => clickRef.current?.(e.lngLat.lng, e.lngLat.lat));
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, tileUrlTemplate]);

  // stop markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = stops.map((s, i) => {
      const el = document.createElement('div');
      el.textContent = String(i + 1);
      el.style.cssText = 'background:#2f6df6;color:#fff;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:700 12px sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)';
      el.title = s.name || `Stop ${i + 1}`;
      return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
    });
  }, [stops]);

  // road-path line
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeLine } }] };
    const draw = () => {
      const src = map.getSource('route');
      if (src) src.setData(data);
      else {
        map.addSource('route', { type: 'geojson', data });
        // Insert beneath the first text/symbol layer so labels stay on top (like Google).
        const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#1d4ed8', 'line-width': 4 } }, firstSymbol);
      }
    };
    if (map.isStyleLoaded()) draw(); else map.once('load', draw);
  }, [routeLine]);

  // live vehicle marker — a bus chip that glides to each new GPS fix
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!vehicle) { vehicleMarker.current?.remove(); vehicleMarker.current = null; return; }
    if (!vehicleMarker.current) {
      const el = document.createElement('div');
      el.textContent = '🚌';
      el.style.cssText = 'font-size:22px;line-height:1;background:#fff;border:2px solid #1d4ed8;border-radius:50%;width:38px;height:38px;display:grid;place-items:center;box-shadow:0 2px 10px rgba(29,78,216,.45)';
      vehicleMarker.current = new maplibregl.Marker({ element: el }).setLngLat(vehicle).addTo(map);
    } else {
      vehicleMarker.current.setLngLat(vehicle);
    }
    if (followVehicle) map.easeTo({ center: vehicle, duration: 800 });
  }, [vehicle?.[0], vehicle?.[1], followVehicle]);

  // travelled path — green line under the planned (blue) route line
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trail } };
    const draw = () => {
      const src = map.getSource('trail');
      if (src) src.setData(data);
      else {
        map.addSource('trail', { type: 'geojson', data });
        const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
        map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.85 } }, firstSymbol);
      }
    };
    if (map.isStyleLoaded()) draw(); else map.once('load', draw);
  }, [trail]);

  // fly to a searched location and drop a distinct (amber) preview pin there
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: flyTo, zoom: 16, duration: 800 });
    if (searchMarker.current) searchMarker.current.remove();
    const el = document.createElement('div');
    el.style.cssText = 'width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
    searchMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(flyTo).addTo(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  // refit view to stops when asked
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitKey === undefined || stops.length === 0) return;
    if (stops.length === 1) { map.flyTo({ center: [stops[0].lng, stops[0].lat], zoom: 14 }); return; }
    const b = new maplibregl.LngLatBounds();
    stops.forEach((s) => b.extend([s.lng, s.lat]));
    map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 600 });
  }, [fitKey]);

  // Rotate/tilt helpers — easeTo animates the change smoothly.
  const rotate = (delta) => { const m = mapRef.current; if (m) m.easeTo({ bearing: m.getBearing() + delta, duration: 300 }); };
  const tilt = (delta) => { const m = mapRef.current; if (m) m.easeTo({ pitch: Math.max(0, Math.min(60, m.getPitch() + delta)), duration: 300 }); };
  const resetView = () => { const m = mapRef.current; if (m) m.easeTo({ bearing: 0, pitch: 0, duration: 300 }); };

  const btn = {
    width: 34, height: 34, display: 'grid', placeItems: 'center', cursor: 'pointer',
    background: '#fff', border: '1px solid #e0e0ea', borderRadius: 9, fontSize: 16,
    color: '#3a3a52', boxShadow: '0 2px 8px rgba(0,0,0,.12)', lineHeight: 1, userSelect: 'none',
  };

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid #e6e6ef' }} />
      {/* Map rotation / tilt controls — turn the map so the road is easy to click. */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 5 }}>
        <button type="button" style={btn} title="Rotate left" onClick={() => rotate(-30)}>⟲</button>
        <button type="button" style={btn} title="Rotate right" onClick={() => rotate(30)}>⟳</button>
        <button type="button" style={btn} title="Tilt" onClick={() => tilt(20)}>⛰</button>
        <button type="button" style={{ ...btn, fontWeight: 800, fontSize: 13 }} title="Reset (face north, flat)" onClick={resetView}>N</button>
      </div>
    </div>
  );
}
