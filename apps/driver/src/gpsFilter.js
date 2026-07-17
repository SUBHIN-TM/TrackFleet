// ============================================================================
// Is the bus actually moving?
//
// GPS never repeats itself. A phone lying on a parked dashboard reports a
// position that wanders a few metres every fix — much more beside tall
// buildings or under trees. The driver app uploads a fix every ~3s, so that
// wander was being drawn on the admin's and the parents' maps as the bus
// driving in little circles while the driver sat perfectly still.
//
// Pure decision logic: no storage, no native modules, no clock. Everything it
// needs is an argument, which is what makes it testable — see gpsFilter.test.js.
// ============================================================================

// A fix vaguer than this isn't a position, it's a guess — typically the phone
// falling back to wifi/cell towers while the GPS is still warming up.
export const MAX_ACCURACY_M = 50;

// Speed straight from the receiver (Doppler). Unlike comparing two noisy
// positions, this is a direct measurement, so it's the honest answer to
// "are we moving?" — and it catches a slow creep in traffic that the
// deadband alone would sit on.
export const MOVING_KMH = 2.5;

// When accuracy is unknown, assume a typical phone fix.
const ASSUMED_ACCURACY_M = 15;

// `accuracy` is a 68% confidence radius, NOT a maximum: about a third of fixes
// land outside it, so a deadband the size of the accuracy is escaped constantly
// — that alone let a parked bus jump 37 times in 10 minutes. Three radii covers
// ~99% of the noise.
const DEADBAND_SIGMAS = 3;
const DEADBAND_MIN_M = 25;
const DEADBAND_MAX_M = 60;

// ...and even 3 radii isn't enough on its own, because GPS error is not random
// per fix: multipath off a wall or bad satellite geometry pushes several fixes
// the same way for seconds at a time. So movement must also PERSIST — one
// excursion is noise, two in a row is a bus. This costs ~3s of latency only
// when the receiver reports no speed; real driving is caught instantly by
// MOVING_KMH below.
const ESCAPES_TO_MOVE = 2;

// Metres between two {lat,lng} points (haversine).
export function metresBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// How far a fix must travel from the anchor before it counts as an escape.
// Trust a fix to the extent it claims to be trustworthy — but always in whole
// confidence radii, never the bare accuracy figure.
export function deadbandFor(accuracy) {
  const sigma = accuracy ?? ASSUMED_ACCURACY_M;
  return Math.max(DEADBAND_MIN_M, Math.min(sigma * DEADBAND_SIGMAS, DEADBAND_MAX_M));
}

const pointOf = (fix) => ({ lat: fix.lat, lng: fix.lng });

// Decide what to do with a raw fix.
//
// `state` is what we believe so far: { anchor: {lat,lng}, strikes } — strikes
// being how many consecutive fixes have escaped the deadband. Pass null on the
// first fix of a trip. Every result carries the next `state`; the caller just
// stores it (see locationTask.js).
//
//   { action: 'drop' }        too vague to place the bus — report nothing
//   { action: 'move', fix }   real movement — report it, and re-anchor here
//   { action: 'hold', fix }   noise — report the ANCHOR, so the bus stays put
//
// A 'hold' still carries the fix's fresh timestamp, so the server keeps getting
// a heartbeat and "GPS live" stays true. The bus simply stops dancing.
//
// `force` is the driver pressing "Locate me": they are telling us the bus is
// somewhere else, so the anchor moves even where the deadband would have held.
export function decideFix(state, raw, { force = false } = {}) {
  const anchor = state?.anchor || null;
  const strikes = state?.strikes || 0;

  if (!force && raw.accuracy != null && raw.accuracy > MAX_ACCURACY_M) {
    // Keep the anchor AND the strikes: a vague fix is not evidence of anything,
    // so it must neither move the bus nor forget what we were watching.
    return { action: 'drop', reason: 'accuracy', accuracy: raw.accuracy, state: state || null };
  }

  const moving = { action: 'move', fix: raw, state: { anchor: pointOf(raw), strikes: 0 } };
  if (!anchor || force) return moving;

  // The receiver measured its own speed — believe it immediately. This is what
  // makes the deadband safe to be generous with.
  if ((raw.speed ?? 0) >= MOVING_KMH) return { ...moving, moved: metresBetween(anchor, raw) };

  const moved = metresBetween(anchor, raw);
  if (moved >= deadbandFor(raw.accuracy)) {
    if (strikes + 1 >= ESCAPES_TO_MOVE) return { ...moving, moved };
    // First escape: suspicious, not yet convincing. Hold, but remember.
    return { ...held(anchor, raw), moved, state: { anchor, strikes: strikes + 1 } };
  }

  // Back inside the deadband: whatever we saw was noise. Forget it.
  return { ...held(anchor, raw), moved, state: { anchor, strikes: 0 } };
}

// Anchor position, fresh timestamp. Speed is zeroed because we have just
// decided this bus is not moving; passing the noise through would have the
// admin watching a parked bus report 4 km/h.
const held = (anchor, raw) => ({
  action: 'hold',
  fix: { ...raw, lat: anchor.lat, lng: anchor.lng, speed: 0, held: true },
});
