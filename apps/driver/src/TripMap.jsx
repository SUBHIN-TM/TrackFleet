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
export default function TripMap({ stops = [], me, routeLine = [], nextStop, height = 260, onGrab, onRelease }) {
  const [styleUrl, setStyleUrl] = useState(null);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);
  const [zoom, setZoom] = useState(15);
  const camera = useRef(null);

  // Zoom by button: pinching inside a scrolling page is fiddly, and on a moving
  // bus the driver has one hand at best.
  const zoomBy = (delta) => {
    const z = Math.max(4, Math.min(19, zoom + delta));
    setZoom(z);
    camera.current?.zoomTo(z, { duration: 250 });
  };
  const recenter = () => {
    setFollow(true);
    if (me) camera.current?.easeTo({ center: me, zoom: Math.max(zoom, 15), duration: 500 });
  };

  // The server owns the style, so the provider can change without a new APK.
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/map/config`)
      .then((r) => r.json())
      .then((c) => alive && setStyleUrl(c.styleUrl || FALLBACK_STYLE))
      .catch(() => alive && setStyleUrl(FALLBACK_STYLE));
    return () => { alive = false; };
  }, []);

  // Keep the driver centred while they drive — but only while following, so a
  // manual pan isn't yanked back by the next GPS fix. Zoom is left alone: the
  // camera must never fight the driver's own zoom buttons.
  useEffect(() => {
    if (ready && follow && me && camera.current) {
      camera.current.easeTo({ center: me, duration: 800 });
    }
  }, [me?.[0], me?.[1], follow, ready]);

  if (!styleUrl) {
    return <View style={[styles.wrap, { height }, styles.center]}><ActivityIndicator color="#3b82f6" /></View>;
  }

  const line = routeLine.length >= 2
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeLine } }
    : null;

  return (
    // onTouchStart/End tell the parent to freeze page scrolling while a finger
    // is on the map — otherwise the ScrollView steals the gesture and panning
    // judders. Touching the map also drops follow, so it stops snapping back.
    <View style={[styles.wrap, { height }]}
      onTouchStart={() => { setFollow(false); onGrab?.(); }}
      onTouchEnd={() => onRelease?.()}
      onTouchCancel={() => onRelease?.()}>
      <Map style={{ flex: 1 }} mapStyle={styleUrl} logo={false} attribution compass
        onDidFinishLoadingMap={() => setReady(true)}>
        <Camera ref={camera}
          center={me || (stops[0] ? [stops[0].lng, stops[0].lat] : [76.93, 8.52])}
          zoom={zoom} />

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

      {/* Buttons, because pinch-zoom on a moving bus with one hand is hopeless */}
      <View style={styles.zoomCol}>
        {/* ASCII + and -, not ＋/−: fancy glyphs depend on the device font. */}
        <TouchableOpacity style={[styles.mapBtn, styles.mapBtnTop]} onPress={() => zoomBy(1)}>
          <Text style={styles.mapBtnText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapBtn} onPress={() => zoomBy(-1)}>
          <Text style={styles.mapBtnText}>-</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[styles.followBtn, follow && styles.followOn]} onPress={recenter}>
        <Text style={[styles.followText, follow && { color: '#fff' }]}>
          {follow ? 'Following you' : 'Centre on me'}
        </Text>
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
  zoomCol: { position: 'absolute', top: 10, right: 10, borderRadius: 10, overflow: 'hidden' },
  mapBtn: {
    width: 40, height: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  mapBtnTop: { borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  mapBtnText: { fontSize: 20, fontWeight: '800', color: '#334155', lineHeight: 24 },
  followBtn: {
    position: 'absolute', bottom: 10, right: 10, backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  followOn: { backgroundColor: '#2563eb' },
  followText: { fontSize: 12, fontWeight: '800', color: '#334155' },
});
