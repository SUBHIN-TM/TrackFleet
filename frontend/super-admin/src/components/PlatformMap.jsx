import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ---- live-vehicle marker helpers (delivery-app style) ----------------------

// Compass bearing from one lng/lat to the next — turns the heading arrow.
const toRad = (d) => (d * Math.PI) / 180;
function bearingOf([lng1, lat1], [lng2, lat2]) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lng2 - lng1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Injected once — the "live" halo that ripples out from the bus.
function ensurePulseStyle() {
  if (document.getElementById('tf-veh-style')) return;
  const st = document.createElement('style');
  st.id = 'tf-veh-style';
  st.textContent = `@keyframes tf-pulse {
    0%   { transform: scale(.55); opacity: .5 }
    70%  { transform: scale(2.1); opacity: 0 }
    100% { opacity: 0 }
  }`;
  document.head.appendChild(st);
}

// Pulse ring + a rotating heading arrow + an upright bus badge. The arrow lives
// in its own rotating layer so the bus itself never turns upside-down.
function buildVehicleEl() {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:42px;height:42px;pointer-events:none';
  el.innerHTML = `
    <div style="position:absolute;inset:2px;border-radius:50%;background:#22c55e;animation:tf-pulse 1.9s ease-out infinite"></div>
    <div class="tf-rot" style="position:absolute;inset:0;transition:transform .6s ease-out">
      <svg width="14" height="11" viewBox="0 0 14 11" style="position:absolute;top:-9px;left:50%;margin-left:-7px">
        <path d="M7 0 L13.5 11 L7 8 L0.5 11 Z" fill="#1d4ed8"/>
      </svg>
    </div>
    <div style="position:absolute;inset:4px;border-radius:50%;background:#fff;border:2.5px solid #1d4ed8;
                display:grid;place-items:center;font-size:17px;line-height:1;
                box-shadow:0 3px 12px rgba(29,78,216,.45)">🚌</div>`;
  return el;
}

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
  onToggleFollow,       // provide to show the follow button in the control stack
}) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [isFs, setIsFs] = useState(false);
  const mapRef = useRef(null);
  const markers = useRef([]);
  const searchMarker = useRef(null);
  const vehicleMarker = useRef(null);
  const prevPos = useRef(null); // last GPS fix — the start of the current glide
  const raf = useRef(0);
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
    // Fullscreen the WRAPPER (not the canvas) so our own controls come along.
    map.addControl(new maplibregl.FullscreenControl({ container: wrapRef.current }), 'top-right');
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

  // Track fullscreen so the map can fill the screen (and resize to match).
  useEffect(() => {
    const onFs = () => {
      const fs = document.fullscreenElement === wrapRef.current;
      setIsFs(fs);
      setTimeout(() => mapRef.current?.resize(), 60);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

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

  // Live vehicle marker, delivery-app style: the bus GLIDES between GPS fixes
  // (a raw setLngLat would teleport every poll) and a heading arrow turns to the
  // direction of travel, with a pulsing halo so "live" is unmistakable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!vehicle) {
      vehicleMarker.current?.remove(); vehicleMarker.current = null; prevPos.current = null;
      cancelAnimationFrame(raf.current);
      return;
    }
    ensurePulseStyle();

    if (!vehicleMarker.current) {
      vehicleMarker.current = new maplibregl.Marker({ element: buildVehicleEl() }).setLngLat(vehicle).addTo(map);
      prevPos.current = vehicle;
      if (followVehicle) map.easeTo({ center: vehicle, duration: 600 });
      return;
    }

    const from = prevPos.current || vehicle;
    const to = vehicle;
    prevPos.current = to;

    // Point the arrow along the leg we're about to travel.
    const moved = Math.abs(to[0] - from[0]) > 1e-7 || Math.abs(to[1] - from[1]) > 1e-7;
    if (moved) {
      const rot = vehicleMarker.current.getElement().querySelector('.tf-rot');
      if (rot) rot.style.transform = `rotate(${bearingOf(from, to)}deg)`;
    }

    // Ease the marker across the leg — ~1.2s reads as continuous motion.
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const DUR = 1200;
    const step = (now) => {
      const t = Math.min((now - t0) / DUR, 1);
      const e = t * (2 - t); // easeOutQuad
      const pos = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
      vehicleMarker.current?.setLngLat(pos);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    if (followVehicle) map.easeTo({ center: to, duration: DUR });

    return () => cancelAnimationFrame(raf.current);
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
  const btnOn = { background: '#2563eb', borderColor: '#2563eb', color: '#fff' };

  return (
    // The wrapper is what goes fullscreen, so our controls stay visible there.
    <div ref={wrapRef} style={{ position: 'relative', background: '#fff', height: isFs ? '100%' : undefined }}>
      <div ref={ref} style={{
        height: isFs ? '100%' : height,
        borderRadius: isFs ? 0 : 12,
        overflow: 'hidden',
        border: isFs ? 'none' : '1px solid #e6e6ef',
      }} />
      {/* Controls live top-left: bottom-right is MapLibre's attribution (ⓘ). */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 5 }}>
        {onToggleFollow && (
          <button type="button" onClick={onToggleFollow}
            style={{ ...btn, ...(followVehicle ? btnOn : {}) }}
            title={followVehicle ? 'Following the bus — click to stop' : 'Follow the bus'}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="8" opacity=".45" />
              <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
            </svg>
          </button>
        )}
        <button type="button" style={btn} title="Rotate left" onClick={() => rotate(-30)}>⟲</button>
        <button type="button" style={btn} title="Rotate right" onClick={() => rotate(30)}>⟳</button>
        <button type="button" style={btn} title="Tilt" onClick={() => tilt(20)}>⛰</button>
        <button type="button" style={{ ...btn, fontWeight: 800, fontSize: 13 }} title="Reset (face north, flat)" onClick={resetView}>N</button>
      </div>
    </div>
  );
}
