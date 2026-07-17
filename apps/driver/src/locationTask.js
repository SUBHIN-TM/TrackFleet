import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';
import { decideFix } from './gpsFilter';

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
const QLEN_KEY = 'tf_queue_len';     // just the count, so the UI needn't parse the queue
const POS_KEY = 'tf_last_pos';       // "lng,lat" of the last fix we SENT
const ANCHOR_KEY = 'tf_anchor';      // where we believe the bus actually is
const QUEUE_MAX = 500;               // ~25 min of 3s fixes; then drop oldest

export const setActiveTrip = (tripId) => AsyncStorage.setItem(TRIP_KEY, tripId);
export const clearActiveTrip = () =>
  AsyncStorage.multiRemove([TRIP_KEY, LAST_KEY, QUEUE_KEY, QLEN_KEY, POS_KEY, SEEN_KEY, ANCHOR_KEY]);
export const lastFixAt = async () => {
  const v = await AsyncStorage.getItem(LAST_KEY);
  return v ? Number(v) : null;
};

// Where the last SENT fix was — the UI reads this instead of asking the GPS for
// a new position every few seconds. Cheap, and it guarantees the driver's map
// shows exactly what the admin's map shows.
export async function lastSentPosition() {
  const v = await AsyncStorage.getItem(POS_KEY);
  if (!v) return null;
  const [lng, lat] = v.split(',').map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

// ---- the queue --------------------------------------------------------------

async function readQueue() {
  try { return JSON.parse(await AsyncStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
async function writeQueue(q) {
  // Keep the newest if we overflow: a fresh position matters more than an old one.
  const kept = q.slice(-QUEUE_MAX);
  await AsyncStorage.multiSet([[QUEUE_KEY, JSON.stringify(kept)], [QLEN_KEY, String(kept.length)]]);
}
// Reads a single small number — parsing the whole queue on a timer was making
// the app crawl.
export async function queuedCount() {
  return Number(await AsyncStorage.getItem(QLEN_KEY)) || 0;
}

// An Expo location -> the shape the API takes.
const toFix = (loc) => ({
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  // m/s -> km/h; negative means "unknown" on Android.
  speed: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : undefined,
  heading: loc.coords.heading >= 0 ? loc.coords.heading : undefined,
  // How much to trust the above. Not sent to the server — used here to decide
  // whether this fix deserves to move the bus at all.
  accuracy: loc.coords.accuracy ?? null,
  recordedAt: new Date(loc.timestamp).toISOString(),
  ts: loc.timestamp,
});

// ---- standing still ---------------------------------------------------------

async function readAnchor() {
  try { return JSON.parse(await AsyncStorage.getItem(ANCHOR_KEY)) || null; } catch { return null; }
}

// Storage around the pure decision in gpsFilter.js (which is unit-tested).
// Returns the fix to report, or null if it isn't worth reporting.
//
// The state is persisted on EVERY outcome, not just movement: it also counts
// how many fixes in a row have escaped the anchor, and losing that count would
// mean no movement could ever be confirmed.
async function settle(raw, { force = false } = {}) {
  const decision = decideFix(await readAnchor(), raw, { force });
  if (decision.state) await AsyncStorage.setItem(ANCHOR_KEY, JSON.stringify(decision.state));
  return decision.action === 'drop' ? null : decision.fix;
}

// Raw upload. Throws on any failure — callers decide whether to queue.
async function upload(tripId, fix) {
  await apiFetch(`/api/trips/${tripId}/location`, {
    method: 'POST',
    auth: true,
    body: { lat: fix.lat, lng: fix.lng, speed: fix.speed, heading: fix.heading, recordedAt: fix.recordedAt },
  });
  await AsyncStorage.multiSet([
    [SEEN_KEY, String(fix.ts)],
    [LAST_KEY, String(Date.now())],
    [POS_KEY, `${fix.lng},${fix.lat}`],
  ]);
}

// Send it, or keep it for later.
//   { sent: true }                    → really uploaded
//   { sent: false, offline: true }    → no signal (or server down): queued
//   { sent: false, offline: false }   → the server REFUSED it (e.g. the trip
//                                       ended). Queuing would retry forever and
//                                       falsely report "no connection", so drop.
async function sendOrQueue(tripId, fix) {
  try {
    await upload(tripId, fix);
    return { sent: true, offline: false };
  } catch (err) {
    const retryable = err.offline || (err.status >= 500);
    if (!retryable) return { sent: false, offline: false, refused: err.message };
    const q = await readQueue();
    q.push({ tripId, ...fix });
    await writeQueue(q);
    return { sent: false, offline: true };
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
    } catch (err) {
      if (!err.offline && err.status < 500) continue; // refused for good: skip it
      await writeQueue(q.slice(i)); // still offline — keep the rest, in order
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

  if (await queuedCount()) await flushQueue(); // signal may be back — backlog first, in order
  for (const loc of fresh) {
    const fix = await settle(toFix(loc));
    if (fix) await sendOrQueue(tripId, fix);
  }
});

// ---- foreground helpers -----------------------------------------------------

// Actively acquire a FRESH fix and send it. Returns { pos, sent, queued } —
// `sent` is the truth about the upload, never an assumption. The background
// stream replays Android's cached location, which can be minutes old while the
// screen shows something newer; everything on screen comes through here so the
// driver and the admin cannot disagree.
//
// `force` is the driver pressing "Locate me": they are telling us the bus is
// somewhere else, so the anchor moves even if the deadband would have held it.
// That's the whole point of the button — it's the manual override.
export async function pushCurrentFix(tripId, { force = false } = {}) {
  // High is accurate to a few metres and far cheaper than BestForNavigation,
  // which was pinning the GPS and making the whole app crawl.
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const raw = toFix(loc);
  const fix = await settle(raw, { force });
  // Too vague to place the bus. Say so rather than move it somewhere wrong.
  if (!fix) return { pos: null, sent: false, offline: false, vague: raw.accuracy, queued: await queuedCount() };

  if (await queuedCount()) await flushQueue();
  const { sent, offline } = await sendOrQueue(tripId, fix);
  return {
    pos: [fix.lng, fix.lat], sent, offline, held: !!fix.held,
    accuracy: raw.accuracy, queued: await queuedCount(),
  };
}

// Start streaming for a trip. Returns 'on' | 'foreground-only' | 'denied' | 'error'.
export async function startTracking(tripId) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  // Background permission is what keeps GPS alive with the screen off.
  const bg = await Location.requestBackgroundPermissionsAsync();

  await setActiveTrip(tripId);
  // A new run starts clean. Leftovers from an earlier trip are worthless — that
  // trip has ended, so the server rejects them and they'd sit in the queue
  // forever making the app claim "no connection". The anchor goes too: it marks
  // where the LAST run finished.
  await writeQueue([]);
  await AsyncStorage.removeItem(ANCHOR_KEY);

  // Put the bus on everyone's map NOW. Android only delivers a location once
  // the phone has MOVED, so a driver who starts while parked used to send
  // nothing at all — the admin saw "No GPS" and no bus icon.
  // `force` because a roughly-placed bus beats no bus: the GPS is still warming
  // up, so this first fix may be vague, and the stream sharpens it within
  // seconds (an accurate fix easily escapes a vague anchor's deadband).
  try { await pushCurrentFix(tripId, { force: true }); } catch { /* no fix yet; the stream follows */ }

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
