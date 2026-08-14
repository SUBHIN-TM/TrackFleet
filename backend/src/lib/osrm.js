// Road routing via OSRM (self-hosted). Shared by the route builder (draw the
// line) and live trips (how long until the bus reaches a stop).
const OSRM_URL = (process.env.OSRM_URL || '').replace(/\/$/, '');
const OSRM_TOKEN = process.env.OSRM_TOKEN || '';

export const osrmConfigured = () => Boolean(OSRM_URL);

// Returns { geometry, distanceMeters, durationSeconds } or null when routing is
// unavailable — callers treat null as "no ETA", never as an error.
export async function osrmRoute(waypoints) {
  if (!OSRM_URL || waypoints.length < 2) return null;
  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=polyline`;
  const r = await fetch(url, { headers: OSRM_TOKEN ? { 'X-OSRM-Token': OSRM_TOKEN } : {} });
  const data = await r.json();
  const route = data?.routes?.[0];
  if (data?.code !== 'Ok' || !route) return null;
  return {
    geometry: route.geometry,
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration),
  };
}

// ---------------------------------------------------------------------------
// Map matching — put the bus ON the road.
//
// A raw fix is a guess with a radius. Drawn straight onto a map it wanders into
// gardens and across rivers, and beside tall buildings it can sit a whole street
// away. OSRM's /match service runs the Newson & Krumm hidden Markov model over a
// WHOLE TRACE: each point gets candidate road segments, and the most probable
// sequence wins — so a fix that landed in a building is pulled back onto the
// road the bus could actually have driven from the previous fix.
//
// The trace matters. Matching one point alone is just nearest-road snapping,
// which confidently puts the bus on the wrong side of a dual carriageway. The
// sequence is what carries the evidence.
//
// `radiuses` is where the accuracy we now persist earns its keep: OSRM searches
// that far around each point for candidates. Too small and a genuinely vague fix
// finds no road and the whole match fails; too large and the search explodes
// (roughly quartic in the radius) and wrong candidates creep in.
const MATCH_RADIUS_MIN_M = 10;
const MATCH_RADIUS_MAX_M = 50;
const MATCH_MAX_POINTS = 100; // OSRM's own trace ceiling

const matchRadius = (accuracy) =>
  Math.round(Math.max(MATCH_RADIUS_MIN_M, Math.min(accuracy ?? 15, MATCH_RADIUS_MAX_M)));

// Snap a GPS trace to the road network.
//
// Takes [{lat, lng, accuracy?, recordedAt?}] oldest-first; returns an array the
// SAME length, each entry either {lat, lng} snapped or null where OSRM couldn't
// place that point. Returns null if matching is unavailable or failed outright —
// callers must then fall back to the raw trail, never to nothing.
export async function osrmMatch(points) {
  if (!OSRM_URL || !points || points.length < 2) return null;
  // Only the tail can be matched in one call. The head of a long trip is
  // history that has already been drawn; the live end is what must be right.
  const trace = points.slice(-MATCH_MAX_POINTS);

  const coords = trace.map((p) => `${p.lng},${p.lat}`).join(';');
  const radiuses = trace.map((p) => matchRadius(p.accuracy)).join(';');
  // Timestamps let the HMM reason about plausible travel between fixes rather
  // than treating the trace as an unordered cloud. Seconds, strictly ascending
  // — OSRM rejects the request otherwise, so only send them when they qualify.
  const secs = trace.map((p) => Math.floor(new Date(p.recordedAt ?? 0).getTime() / 1000));
  const ordered = secs.every((s, i) => i === 0 || s > secs[i - 1]);

  const url = `${OSRM_URL}/match/v1/driving/${coords}`
    + `?geometries=geojson&overview=false&annotations=false&gaps=ignore&tidy=false`
    + `&radiuses=${radiuses}`
    + (ordered ? `&timestamps=${secs.join(';')}` : '');

  try {
    const r = await fetch(url, { headers: OSRM_TOKEN ? { 'X-OSRM-Token': OSRM_TOKEN } : {} });
    const data = await r.json();
    if (data?.code !== 'Ok' || !Array.isArray(data.tracepoints)) return null;

    // tracepoints is parallel to the input, with null where a point was dropped.
    const snapped = data.tracepoints.map((tp) =>
      tp?.location ? { lat: tp.location[1], lng: tp.location[0] } : null
    );
    // Pad the head we didn't send, so the result still lines up with `points`.
    return [...Array(points.length - trace.length).fill(null), ...snapped];
  } catch {
    return null; // matching is an improvement, never a dependency
  }
}

// ETA between two points, cached briefly: parents poll every 5s, but a bus
// can't meaningfully change its ETA that fast, and OSRM shouldn't be hammered.
const cache = new Map();
const TTL_MS = 20000;

export async function etaBetween(from, to) {
  if (!from || !to || !OSRM_URL) return null;
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;

  let v = null;
  try {
    const r = await osrmRoute([{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }]);
    if (r) {
      v = {
        minutes: Math.max(1, Math.round(r.durationSeconds / 60)),
        distanceMeters: r.distanceMeters,
      };
    }
  } catch {
    v = null; // routing down — the UI simply hides the ETA
  }
  if (cache.size > 500) cache.clear(); // crude bound; keys are position-based
  cache.set(key, { at: Date.now(), v });
  return v;
}
