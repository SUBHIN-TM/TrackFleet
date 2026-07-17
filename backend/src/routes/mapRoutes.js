import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { osrmRoute, osrmConfigured } from '../lib/osrm.js';

const router = Router();
router.use(authenticate); // any logged-in user (admin/parent) can load the map

const TILE_URL = process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Vector style — labels are drawn as text (not baked into tiles), so they stay
// upright & readable when the map is rotated, like Google Maps. Swap for a
// self-hosted or MapTiler style in production via MAP_STYLE_URL. Empty = raster.
const MAP_STYLE_URL = process.env.MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/liberty';
// Geocoder for place search. Defaults to public Nominatim (OSM); point this at a
// self-hosted instance for production to avoid its 1-req/sec usage policy.
const GEOCODER_URL = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');

// GET /api/map/config — the frontend <PlatformMap> fetches the tile URL from here
// so the tile source is server-configured, never hardcoded in the client.
router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({ tileUrlTemplate: TILE_URL, styleUrl: MAP_STYLE_URL || null });
  })
);

// GET /api/map/search?q=... — geocode a place name/address to coordinates so the
// admin can find a spot on the map and drop a stop there. Proxied server-side to
// keep the geocoder configurable and send a policy-compliant User-Agent.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 3) return res.json({ results: [] });

    const url = `${GEOCODER_URL}/search?format=jsonv2&addressdetails=0&limit=6&q=${encodeURIComponent(q)}`;
    let data;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'TrackFleet/1.0 (fleet admin map search)', 'Accept-Language': 'en' },
      });
      data = await r.json();
    } catch (e) {
      throw new ApiError(502, `Geocoder unreachable: ${e.message}`);
    }

    const results = (Array.isArray(data) ? data : [])
      .map((d) => ({ name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    res.json({ results });
  })
);

const routeSchema = z.object({
  waypoints: z
    .array(z.object({ lat: z.number(), lng: z.number() }))
    .min(2, 'need at least 2 waypoints'),
});

// POST /api/map/route — snap a list of stops to the road network via OSRM.
// Returns an encoded polyline + total distance + duration for the Route Builder.
router.post(
  '/route',
  asyncHandler(async (req, res) => {
    if (!osrmConfigured()) throw new ApiError(503, 'Routing is not configured (OSRM_URL missing)');
    const { waypoints } = parseOr400(routeSchema, req.body);

    let route;
    try {
      route = await osrmRoute(waypoints);
    } catch (e) {
      throw new ApiError(502, `Routing service unreachable: ${e.message}`);
    }
    if (!route) throw new ApiError(502, 'OSRM could not build a route from those points');
    res.json(route);
  })
);

export default router;
