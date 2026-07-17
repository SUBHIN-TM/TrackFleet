import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
// MapLibre RN v11: NAMED exports only, no default, no access token.
// Component/prop names differ from v9 — verified against the installed
// typings: Map(mapStyle) · Camera(ref.easeTo{center}) · Marker(lngLat) ·
// GeoJSONSource(data) · Layer(type/paint). Getting these wrong crashes the
// app at import time, which is exactly what v1.1.0 did.
import { Map, Camera, Marker, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { API_URL } from './config';

const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// The driver's own view: where I am, the road ahead, which stop is next — and
// proof their GPS is alive (the dot moves with them).
export default function TripMap({ stops = [], me, routeLine = [], nextStop, height = 260 }) {
  const [styleUrl, setStyleUrl] = useState(null);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);
  const camera = useRef(null);

  // The server owns the style, so the provider can change without a new APK.
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/map/config`)
      .then((r) => r.json())
      .then((c) => alive && setStyleUrl(c.styleUrl || FALLBACK_STYLE))
      .catch(() => alive && setStyleUrl(FALLBACK_STYLE));
    return () => { alive = false; };
  }, []);

  // Keep the driver centred while they drive, unless they panned away to look.
  useEffect(() => {
    if (ready && follow && me && camera.current) {
      camera.current.easeTo({ center: me, zoom: 15, duration: 800 });
    }
  }, [me?.[0], me?.[1], follow, ready]);

  if (!styleUrl) {
    return <View style={[styles.wrap, { height }, styles.center]}><ActivityIndicator color="#3b82f6" /></View>;
  }

  const line = routeLine.length >= 2
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeLine } }
    : null;

  return (
    <View style={[styles.wrap, { height }]}>
      <Map style={{ flex: 1 }} mapStyle={styleUrl} logo={false} attribution compass
        onDidFinishLoadingMap={() => setReady(true)}>
        <Camera ref={camera}
          center={me || (stops[0] ? [stops[0].lng, stops[0].lat] : [76.93, 8.52])}
          zoom={14} />

        {/* The road ahead, drawn under the pins */}
        {line && (
          <GeoJSONSource id="route" data={line}>
            <Layer id="route-line" type="line"
              paint={{ 'line-color': '#1d4ed8', 'line-width': 5, 'line-opacity': 0.85 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
          </GeoJSONSource>
        )}

        {/* Stops in order — next one green so it's obvious at a glance */}
        {stops.map((s, i) => (
          <Marker key={s.id} id={`stop-${s.id}`} lngLat={[s.lng, s.lat]}>
            <View style={[styles.stopPin, nextStop?.id === s.id && styles.stopPinNext]}>
              <Text style={styles.stopPinText}>{i + 1}</Text>
            </View>
          </Marker>
        ))}

        {/* Me. If this dot moves as you drive, GPS is working. */}
        {me && (
          <Marker id="me" lngLat={me}>
            <View style={styles.mePin}><Text style={{ fontSize: 15 }}>🚌</Text></View>
          </Marker>
        )}
      </Map>

      <TouchableOpacity style={[styles.followBtn, follow && styles.followOn]} onPress={() => setFollow((f) => !f)}>
        <Text style={[styles.followText, follow && { color: '#fff' }]}>{follow ? '◎ Following' : '◎ Follow me'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1e293b', marginBottom: 14 },
  center: { alignItems: 'center', justifyContent: 'center' },
  stopPin: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#64748b',
    borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  stopPinNext: { backgroundColor: '#16a34a', transform: [{ scale: 1.25 }] },
  stopPinText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  mePin: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff',
    borderWidth: 2.5, borderColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center',
  },
  followBtn: {
    position: 'absolute', bottom: 10, right: 10, backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
  },
  followOn: { backgroundColor: '#2563eb' },
  followText: { fontSize: 12, fontWeight: '800', color: '#334155' },
});
