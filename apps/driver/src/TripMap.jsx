// ⚠️ BROKEN — NOT IMPORTED ANYWHERE. DO NOT RE-ENABLE AS-IS.
//
// This targets @maplibre/maplibre-react-native v9. Installed is v11, which:
//   • has NO default export        → `import MapLibreGL from ...` is undefined
//   • has NO setAccessToken        → the call below threw AT IMPORT TIME
//   • renamed the components       → MapView→Map, MarkerView→Marker,
//                                    ShapeSource→GeoJSONSource
// The undefined-default crash killed the app on launch (v1.1.0). Rewrite
// against the v11 named exports and TEST ON A REAL DEVICE before wiring it
// back into App.js.
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { API_URL } from './config';

MapLibreGL.setAccessToken(null);

const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// The driver's own view of the run: where they are, the road ahead, and which
// stop is next. Without this a driver on an unfamiliar route is flying blind.
export default function TripMap({ stops = [], me, routeLine = [], nextStop, height = 260 }) {
  const [styleUrl, setStyleUrl] = useState(null);
  const [follow, setFollow] = useState(true);
  const camera = useRef(null);

  // The server owns the map style (swap providers without shipping an APK).
  useEffect(() => {
    fetch(`${API_URL}/api/map/config`)
      .then((r) => r.json())
      .then((c) => setStyleUrl(c.styleUrl || FALLBACK_STYLE))
      .catch(() => setStyleUrl(FALLBACK_STYLE));
  }, []);

  // Keep the driver centred while they drive, unless they panned away.
  useEffect(() => {
    if (follow && me && camera.current) {
      camera.current.setCamera({ centerCoordinate: me, zoomLevel: 15, animationDuration: 800 });
    }
  }, [me?.[0], me?.[1], follow]);

  if (!styleUrl) {
    return <View style={[styles.wrap, { height }, styles.center]}><ActivityIndicator color="#3b82f6" /></View>;
  }

  const line = routeLine.length >= 2
    ? { type: 'Feature', geometry: { type: 'LineString', coordinates: routeLine } }
    : null;

  return (
    <View style={[styles.wrap, { height }]}>
      <MapLibreGL.MapView style={{ flex: 1 }} mapStyle={styleUrl} logoEnabled={false}
        attributionEnabled compassEnabled onTouchStart={() => setFollow(false)}>
        <MapLibreGL.Camera
          ref={camera}
          defaultSettings={{
            centerCoordinate: me || (stops[0] ? [stops[0].lng, stops[0].lat] : [76.93, 8.52]),
            zoomLevel: 14,
          }}
        />

        {/* The road ahead */}
        {line && (
          <MapLibreGL.ShapeSource id="route" shape={line}>
            <MapLibreGL.LineLayer id="route-line"
              style={{ lineColor: '#1d4ed8', lineWidth: 5, lineOpacity: 0.85, lineCap: 'round', lineJoin: 'round' }} />
          </MapLibreGL.ShapeSource>
        )}

        {/* Stops in order — the next one is highlighted so it's obvious */}
        {stops.map((s, i) => {
          const isNext = nextStop && s.id === nextStop.id;
          return (
            <MapLibreGL.MarkerView key={s.id} id={`stop-${s.id}`} coordinate={[s.lng, s.lat]}>
              <View style={[styles.stopPin, isNext && styles.stopPinNext]}>
                <Text style={styles.stopPinText}>{i + 1}</Text>
              </View>
            </MapLibreGL.MarkerView>
          );
        })}

        {/* The bus: the driver's own phone */}
        {me && (
          <MapLibreGL.MarkerView id="me" coordinate={me}>
            <View style={styles.mePin}><Text style={{ fontSize: 16 }}>🚌</Text></View>
          </MapLibreGL.MarkerView>
        )}
      </MapLibreGL.MapView>

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
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    borderWidth: 2.5, borderColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center',
  },
  followBtn: {
    position: 'absolute', bottom: 10, right: 10, backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
  },
  followOn: { backgroundColor: '#2563eb' },
  followText: { fontSize: 12, fontWeight: '800', color: '#334155' },
});
