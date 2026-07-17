import { useEffect, useRef } from 'react';
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

// Pulse ring + rotating heading arrow + upright bus badge.
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

// Read-only live map for parents: the child's stop, the bus position (animated),
// and the path travelled. Vector style keeps labels upright when rotating.
export default function LiveMap({
  styleUrl,
  tileUrlTemplate,
  stop,            // { lat, lng, name } — the child's stop
  vehicle,         // [lng, lat] — live bus position
  trail = [],      // [[lng,lat], ...]
  height = 260,
}) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const stopMarker = useRef(null);
  const busMarker = useRef(null);
  const prevPos = useRef(null); // last GPS fix — the start of the current glide
  const raf = useRef(0);

  useEffect(() => {
    if (!ref.current || (!styleUrl && !tileUrlTemplate)) return;
    const style = styleUrl || {
      version: 8,
      sources: { osm: { type: 'raster', tiles: [tileUrlTemplate], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    };
    const center = vehicle || (stop ? [stop.lng, stop.lat] : [76.93, 8.52]);
    const map = new maplibregl.Map({ container: ref.current, style, center, zoom: 14 });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, tileUrlTemplate]);

  // child's stop pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !stop) return;
    if (stopMarker.current) stopMarker.current.remove();
    const el = document.createElement('div');
    el.style.cssText = 'width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563eb;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)';
    el.title = stop.name || 'Stop';
    stopMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([stop.lng, stop.lat]).addTo(map);
  }, [stop?.lat, stop?.lng]);

  // The bus GLIDES between GPS fixes (a raw setLngLat would teleport every
  // poll), with a heading arrow and live pulse — the delivery-app feel parents
  // already know. The camera follows it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!vehicle) {
      busMarker.current?.remove(); busMarker.current = null; prevPos.current = null;
      cancelAnimationFrame(raf.current);
      return;
    }
    ensurePulseStyle();

    if (!busMarker.current) {
      busMarker.current = new maplibregl.Marker({ element: buildVehicleEl() }).setLngLat(vehicle).addTo(map);
      prevPos.current = vehicle;
      map.easeTo({ center: vehicle, duration: 600 });
      return;
    }

    const from = prevPos.current || vehicle;
    const to = vehicle;
    prevPos.current = to;

    const moved = Math.abs(to[0] - from[0]) > 1e-7 || Math.abs(to[1] - from[1]) > 1e-7;
    if (moved) {
      const rot = busMarker.current.getElement().querySelector('.tf-rot');
      if (rot) rot.style.transform = `rotate(${bearingOf(from, to)}deg)`;
    }

    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const DUR = 1200;
    const step = (now) => {
      const t = Math.min((now - t0) / DUR, 1);
      const e = t * (2 - t); // easeOutQuad
      busMarker.current?.setLngLat([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    map.easeTo({ center: to, duration: DUR });

    return () => cancelAnimationFrame(raf.current);
  }, [vehicle?.[0], vehicle?.[1]]);

  // travelled path
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

  return <div ref={ref} style={{ height, borderRadius: 14, overflow: 'hidden', border: '1px solid #e6e6ef' }} />;
}
