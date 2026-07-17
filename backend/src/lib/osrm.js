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
