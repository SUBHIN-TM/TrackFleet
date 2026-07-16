import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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

  // bus marker glides with each fix and keeps the camera on it
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!vehicle) { busMarker.current?.remove(); busMarker.current = null; return; }
    if (!busMarker.current) {
      const el = document.createElement('div');
      el.textContent = '🚌';
      el.style.cssText = 'font-size:20px;line-height:1;background:#fff;border:2px solid #1d4ed8;border-radius:50%;width:34px;height:34px;display:grid;place-items:center;box-shadow:0 2px 10px rgba(29,78,216,.45)';
      busMarker.current = new maplibregl.Marker({ element: el }).setLngLat(vehicle).addTo(map);
    } else {
      busMarker.current.setLngLat(vehicle);
    }
    map.easeTo({ center: vehicle, duration: 800 });
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
