import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

// ============================================================================
// Background location.
//
// A driver drives — they don't watch the phone. The screen locks, the app goes
// to the background, and a foreground-only watcher stops feeding GPS, so the
// bus freezes on everyone's map. This task runs OUTSIDE React (registered at
// import time) and keeps streaming, kept alive by an Android foreground service
// with a persistent notification, so the driver can see tracking is running.
// ============================================================================

export const LOCATION_TASK = 'trackfleet-location';
const TRIP_KEY = 'tf_active_trip';   // which trip the fixes belong to
const LAST_KEY = 'tf_last_fix';      // for the UI's "GPS live" indicator

// Remember/forget the trip the background task should post to.
export const setActiveTrip = (tripId) => AsyncStorage.setItem(TRIP_KEY, tripId);
export const clearActiveTrip = () => AsyncStorage.multiRemove([TRIP_KEY, LAST_KEY]);
export const lastFixAt = async () => {
  const v = await AsyncStorage.getItem(LAST_KEY);
  return v ? Number(v) : null;
};

const SEEN_KEY = 'tf_last_fix_ts'; // newest fix already sent, to kill duplicates

// One place that knows how to send a fix, used by both the immediate
// start-of-trip position and the background stream.
async function postFix(tripId, loc) {
  await apiFetch(`/api/trips/${tripId}/location`, {
    method: 'POST',
    auth: true,
    body: {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      // m/s -> km/h; negative means "unknown" on Android.
      speed: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : undefined,
      heading: loc.coords.heading >= 0 ? loc.coords.heading : undefined,
      recordedAt: new Date(loc.timestamp).toISOString(),
    },
  });
  await AsyncStorage.multiSet([
    [SEEN_KEY, String(loc.timestamp)],
    [LAST_KEY, String(Date.now())],
  ]);
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const tripId = await AsyncStorage.getItem(TRIP_KEY);
  if (!tripId) return; // trip ended — nothing to report

  // Android hands us batches that can overlap, so the same fix arrived several
  // times and cluttered the trail. Only send fixes newer than the last sent.
  const seen = Number(await AsyncStorage.getItem(SEEN_KEY)) || 0;
  const fresh = (data?.locations || [])
    .filter((l) => l.timestamp > seen)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!fresh.length) return;

  for (const loc of fresh) {
    try {
      await postFix(tripId, loc);
    } catch {
      // Offline or server blip — stop this batch and keep the marker where it
      // is, so the next batch retries from here instead of skipping ahead.
      break;
    }
  }
});

// Start streaming for a trip. Returns 'on' | 'denied' | 'error'.
export async function startTracking(tripId) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  // Background permission is what keeps GPS alive with the screen off.
  const bg = await Location.requestBackgroundPermissionsAsync();

  await setActiveTrip(tripId);

  // Put the bus on everyone's map NOW. Android only delivers a location once
  // the phone has MOVED, so a driver who starts while parked used to send
  // nothing at all — the admin saw "No GPS" and no bus icon, even though the
  // phone was fine.
  try {
    const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    await postFix(tripId, first);
  } catch {
    // No fix yet (indoors/cold start) — the stream below will catch up.
  }

  try {
    const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (already) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      // distanceInterval 0 = report on every tick even when stationary. A
      // distance filter silences a parked bus, which is indistinguishable from
      // a broken one: admins need a heartbeat to trust the tracking.
      timeInterval: 3000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false, // iOS would otherwise pause when "still"
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'TrackFleet — trip running',
        notificationBody: 'Sharing the bus location with your organization and parents.',
        notificationColor: '#1d4ed8',
      },
    });
    return bg.status === 'granted' ? 'on' : 'foreground-only';
  } catch {
    return 'error';
  }
}

export async function stopTracking() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch { /* already stopped */ }
  await clearActiveTrip();
}
