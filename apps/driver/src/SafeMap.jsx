import { Component } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import TripMap from './TripMap';

// A map must never take the app down with it. v1.1.0 crashed on launch because
// a map-module error propagated freely; here anything the map throws is caught
// and shown as a small notice, while the trip screen (checklist, GPS, end trip)
// keeps working.
export default class SafeMap extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn('TripMap failed, hiding it:', error?.message);
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>Map unavailable</Text>
          <Text style={styles.sub}>
            Tracking is unaffected — your location is still being shared. Use the stop list below.
          </Text>
        </View>
      );
    }
    return <TripMap {...this.props} />;
  }
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 14 },
  title: { color: '#e2e8f0', fontWeight: '800', fontSize: 14 },
  sub: { color: '#94a3b8', fontSize: 12.5, marginTop: 4, lineHeight: 17 },
});
