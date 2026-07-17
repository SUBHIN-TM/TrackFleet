import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

// ============================================================================
// Background location + offline queue.
//
// A driver drives — they don't watch the phone, and a bus routinely crosses
// places with no signal. So:
//   • the task runs OUTSIDE React (registered at import) and survives a locked
//     screen, kept alive by an Android foreground service;
//   • every fix that can't be uploaded is QUEUED and retried, because a lost
//     position is a hole in the parent's map that nothing else can fill;
//   • nothing here ever claims a fix was sent when it wasn't.
// ============================================================================

export const LOCATION_TASK = 'trackfleet-location';
const TRIP_KEY = 'tf_active_trip';   // which trip the fixes belong to
const LAST_KEY = 'tf_last_fix';      // when we last SENT one (UI freshness)
const SEEN_KEY = 'tf_last_fix_ts';   // newest fix handled, kills duplicates
const QUEUE_KEY = 'tf_fix_queue';    // fixes waiting for a connection
const QUEUE_MAX = 500;               // ~25 min of 3s fixes; then drop oldest

export const setActiveTrip = (tripId) => AsyncStorage.setItem(TRIP_KEY, tripId);
export const clearActiveTrip = () => AsyncStorage.multiRemove([TRIP_KEY, LAST_KEY, QUEUE_KEY, SEEN_KEY]);
export const lastFixAt = async () => {
  const v = await AsyncStorage.getItem(LAST_KEY);
  return v ? Number(v) : null;
};

// ---- the queue --------------------------------------------------------------

async function readQueue() {
  try { return JSON.parse(await AsyncStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
async function writeQueue(q) {
  // Keep the newest if we overflow: a fresh position matters more than an old one.
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
}
export async function queuedCount() {
  return (await readQueue()).length;
}

// An Expo location -> the shape the API takes.
const toFix = (loc) => ({
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  // m/s -> km/h; negative means "unknown" on Android.
  speed: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : undefined,
  heading: loc.coords.heading >= 0 ? loc.coords.heading : undefined,
  recordedAt: new Date(loc.timestamp).toISOString(),
  ts: loc.timestamp,
});

// Raw upload. Throws on any failure — callers decide whether to queue.
async function upload(tripId, fix) {
  await apiFetch(`/api/trips/${tripId}/location`, {
    method: 'POST',
    auth: true,
    body: { lat: fix.lat, lng: fix.lng, speed: fix.speed, heading: fix.heading, recordedAt: fix.recordedAt },
  });
  await AsyncStorage.multiSet([[SEEN_KEY, String(fix.ts)], [LAST_KEY, String(Date.now())]]);
}

// Send it, or keep it for later. Returns true only if it really went.
async function sendOrQueue(tripId, fix) {
  try {
    await upload(tripId, fix);
    return true;
  } catch {
    const q = await readQueue();
    q.push({ tripId, ...fix });
    await writeQueue(q);
    return false;
  }
}

// Drain whatever the signal dropped. Stops at the first failure so order is
// kept and we don't hammer a dead connection.
export async function flushQueue() {
  const q = await readQueue();
  if (!q.length) return { sent: 0, left: 0 };
  let sent = 0;
  for (let i = 0; i < q.length; i++) {
    try {
      await upload(q[i].tripId, q[i]);
      sent++;
    } catch {
      await writeQueue(q.slice(i));
      return { sent, left: q.length - i };
    }
  }
  await writeQueue([]);
  return { sent, left: 0 };
}

// ---- the background task ----------------------------------------------------

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const tripId = await AsyncStorage.getItem(TRIP_KEY);
  if (!tripId) return; // trip ended — nothing to report

  // Android hands us batches that can overlap; only handle genuinely new fixes.
  const seen = Number(await AsyncStorage.getItem(SEEN_KEY)) || 0;
  const fresh = (data?.locations || [])
    .filter((l) => l.timestamp > seen)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!fresh.length) return;

  await flushQueue(); // signal may be back — send the backlog first, in order
  for (const loc of fresh) await sendOrQueue(tripId, toFix(loc));
});

// ---- foreground helpers -----------------------------------------------------

// Actively acquire a FRESH fix and send it. Returns { pos, sent, queued } —
// `sent` is the truth about the upload, never an assumption. The background
// stream replays Android's cached location, which can be minutes old while the
// screen shows something newer; everything on screen comes through here so the
// driver and the admin cannot disagree.
export async function pushCurrentFix(tripId) {
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
  const fix = toFix(loc);
  await flushQueue();
  const sent = await sendOrQueue(tripId, fix);
  return { pos: [fix.lng, fix.lat], sent, queued: await queuedCount() };
}

// Start streaming for a trip. Returns 'on' | 'foreground-only' | 'denied' | 'error'.
export async function startTracking(tripId) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  // Background permission is what keeps GPS alive with the screen off.
  const bg = await Location.requestBackgroundPermissionsAsync();

  await setActiveTrip(tripId);

  // Put the bus on everyone's map NOW. Android only delivers a location once
  // the phone has MOVED, so a driver who starts while parked used to send
  // nothing at all — the admin saw "No GPS" and no bus icon.
  try { await pushCurrentFix(tripId); } catch { /* no fix yet; the stream follows */ }

  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
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
  await flushQueue().catch(() => {}); // last chance to deliver the tail
  await clearActiveTrip();
}
