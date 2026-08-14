import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { notifyUser } from '../lib/notify.js';
import { etaBetween, osrmMatch } from '../lib/osrm.js';

// ============================================================================
// Trips — the live layer. A TripSchedule is the plan; a Trip is one concrete
// run today. Drivers start/end trips, stream GPS, and tick the boarding list;
// admins watch every run live; guardians follow their own passengers only.
// TripEvent is APPEND-ONLY (audit trail); LocationPoint is the GPS trail.
// ============================================================================

const router = Router();

const ACTIVE = ['STARTED', 'IN_PROGRESS'];

// Local midnight — trips group under the calendar day the org lives in.
const todayDate = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
// Mon=1 … Sun=7, matching TripSchedule.daysOfWeek.
const todayDow = () => ((new Date().getDay() + 6) % 7) + 1;

const io = (req) => req.app.locals.io;
const emitTrip = (req, tripId, event, payload) => {
  try {
    io(req)?.to(`trip:${tripId}`).emit(event, { tripId, ...payload });
    io(req)?.to(`tenant:${req.tenantId}`).emit(event, { tripId, ...payload });
  } catch { /* realtime is best-effort */ }
};

const tripCounts = (passengers) => ({
  expected: passengers.length,
  onboard: passengers.filter((p) => p.status === 'ONBOARD').length,
  dropped: passengers.filter((p) => p.status === 'DROPPED').length,
  noShow: passengers.filter((p) => p.status === 'NO_SHOW').length,
  absent: passengers.filter((p) => p.status === 'ABSENT').length,
});

// Drop points that barely moved. A stationary bus heartbeats every few seconds,
// so hundreds of near-identical fixes pile up on one spot and swamp the 500 we
// keep — the real route then falls off the end of the window.
function thinTrail(points, minMetres = 5) {
  const out = [];
  let prev = null;
  for (const p of points) {
    if (!prev || metresBetween(prev, p) >= minMetres) {
      out.push(p);
      prev = p;
    }
  }
  // Always keep the latest fix: it's where the bus actually is.
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

// Haversine — good enough at bus distances.
function metresBetween(a, b) {
  const R = 6371e3, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A bus is not a teleporter. The driver app already filters noise, but it is
// the only thing standing between a broken receiver — or a forged request from
// a driver's stolen token — and the map every parent is watching.
//
// Deliberately generous: this rejects the impossible, not the unlikely. A
// genuine gap in reporting (tunnel, dead signal) legitimately covers real
// ground, so the allowance grows with the gap and only the ceiling is fixed.
const MAX_KMH = 160;          // motorway coach, with room to spare
const JUMP_GRACE_M = 250;     // absorbs a re-acquired fix after a signal gap

export function implausible(prev, next) {
  if (!prev) return null; // first point of a trip — nothing to contradict
  const seconds = Math.abs(next.recordedAt - new Date(prev.recordedAt)) / 1000;
  // Same instant, different place: no elapsed time can justify any distance.
  if (seconds <= 0) {
    return metresBetween(prev, next) > JUMP_GRACE_M ? 'duplicate-timestamp-jump' : null;
  }
  const metres = metresBetween(prev, next);
  const allowed = (MAX_KMH / 3.6) * seconds + JUMP_GRACE_M;
  return metres > allowed ? `implausible-jump:${Math.round(metres)}m/${Math.round(seconds)}s` : null;
}

// ---------------------------------------------------------------------------
// Road-snapped trail, cached per trip.
//
// Matching happens on read because the raw points are insert-only (rule #2) and
// a snap needs the trace AROUND a point, which doesn't exist yet when it lands.
// The cache is what makes that affordable: every admin and every parent watching
// one bus polls on its own 5s timer, and they must not each cost an OSRM call.
// One match per trip per window, shared by all of them.
const MATCH_TTL_MS = 5000;
const matchCache = new Map(); // tripId -> { at, key, trail }

async function matchedTrail(tripId, rawTrail) {
  if (rawTrail.length < 2) return rawTrail;

  // Key on the newest point: while the bus sits still nothing needs re-matching,
  // and the moment it moves the key changes and the snap refreshes.
  const tip = rawTrail[rawTrail.length - 1];
  const key = `${rawTrail.length}:${tip.lat.toFixed(5)},${tip.lng.toFixed(5)}`;
  const hit = matchCache.get(tripId);
  if (hit && hit.key === key && Date.now() - hit.at < MATCH_TTL_MS) return hit.trail;

  const snapped = await osrmMatch(rawTrail);
  // Keep each point's own timestamp and speed — only the position is corrected.
  // A null entry means OSRM wouldn't place that point; keep the raw one.
  const trail = snapped
    ? rawTrail.map((p, i) => (snapped[i] ? { ...p, ...snapped[i], snapped: true } : p))
    : rawTrail;

  if (matchCache.size > 500) matchCache.clear(); // crude bound, same as the ETA cache
  matchCache.set(tripId, { at: Date.now(), key, trail });
  return trail;
}

async function lastLocation(tripId) {
  const p = await prisma.locationPoint.findFirst({
    where: { tripId },
    orderBy: { recordedAt: 'desc' },
    select: { lat: true, lng: true, speed: true, heading: true, recordedAt: true, accuracy: true, held: true },
  });
  return p || null;
}

// Authorize a driver's write against a trip WITHOUT dragging the passenger
// board along. `ownTripOr404` joins every TripPassenger and every Passenger
// behind it — sensible for the boarding screen, absurd at 1200 GPS pings per
// bus per hour, which is the one endpoint that never looks at a passenger.
async function driverTripOr404(req) {
  const trip = await prisma.trip.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
    select: { id: true, status: true, driverId: true },
  });
  if (!trip) throw new ApiError(404, 'Trip not found');
  if (trip.driverId !== req.user.id) throw new ApiError(403, 'This is not your trip');
  return trip;
}

// Load a trip and assert it belongs to this tenant (and this driver, if asked).
async function ownTripOr404(req, { driverOnly = false } = {}) {
  const trip = await prisma.trip.findFirst({
    where: { id: req.params.id, tenantId: req.tenantId },
    include: { passengers: { include: { passenger: { select: { id: true, name: true } } } } },
  });
  if (!trip) throw new ApiError(404, 'Trip not found');
  if (driverOnly && trip.driverId !== req.user.id) throw new ApiError(403, 'This is not your trip');
  return trip;
}

// Notify every guardian of a passenger — best-effort, never blocks the trip.
async function notifyGuardians(passengerId, tenantId, note) {
  const links = await prisma.guardianPassenger.findMany({
    where: { passengerId },
    select: { guardianId: true },
  });
  await Promise.all(links.map((l) => notifyUser(l.guardianId, { ...note, tenantId })));
}

// The full live picture of one trip: map route, GPS trail, bus position and the
// passenger board. Shared by the tenant admin/driver view and the platform
// (super-admin) view — pass tenantId to scope it, or null to allow any org.
async function liveTripPayload(tripId, tenantId = null) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ...(tenantId ? { tenantId } : {}) },
    include: {
      passengers: {
        include: { passenger: { select: { id: true, name: true, category: true, phone: true } } },
        orderBy: { stopSequence: 'asc' },
      },
      vehicle: { select: { regNumber: true, fleetNo: true } },
      driver: { select: { id: true, name: true, loginId: true, phone: true } },
      schedule: { select: { name: true, startTime: true } },
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!trip) throw new ApiError(404, 'Trip not found');

  const route = await prisma.route.findUnique({
    where: { id: trip.routeId },
    select: {
      id: true, name: true,
      stops: { orderBy: { sequence: 'asc' }, select: { id: true, name: true, lat: true, lng: true, sequence: true } },
    },
  });
  // The path travelled. Take the NEWEST points and flip them back into order:
  // `asc` + `take` grabbed the OLDEST 500, so on a long trip the line froze on
  // the first few minutes and the bus appeared to leave no trail at all.
  //
  // `held: false` is what makes the 500 mean something. A parked bus heartbeats
  // every 3s onto one spot, so a 20-minute wait used to fill the whole window
  // with a single position and push the real route off the end — thinning them
  // afterwards was too late, they had already been counted. Excluding them in
  // SQL spends the window on places the bus actually went.
  const recent = await prisma.locationPoint.findMany({
    where: { tripId: trip.id, held: false },
    orderBy: { recordedAt: 'desc' },
    take: 500,
    select: { lat: true, lng: true, recordedAt: true, speed: true, accuracy: true },
  });
  const rawTrail = thinTrail(recent.reverse());

  // Snap the line to the roads. Falls back to the raw trail whenever matching
  // is unavailable or declines a point — a wandering line beats no line.
  const trail = await matchedTrail(trip.id, rawTrail);

  // Where the bus IS comes from the newest point of all, held or not: a parked
  // bus is excluded from the line above but must still sit on the map.
  const last = (await lastLocation(trip.id)) || trail[trail.length - 1];

  return {
    trip: {
      id: trip.id, status: trip.status, direction: trip.direction,
      startedAt: trip.startedAt, endedAt: trip.endedAt,
      scheduleName: trip.schedule?.name, startTime: trip.schedule?.startTime,
      vehicle: trip.vehicle, driver: trip.driver, org: trip.tenant,
      counts: tripCounts(trip.passengers),
    },
    passengers: trip.passengers.map((p) => ({
      id: p.passenger.id, name: p.passenger.name, category: p.passenger.category,
      status: p.status, boardedAt: p.boardedAt, droppedAt: p.droppedAt,
      stopSequence: p.stopSequence,
      stopName: route?.stops.find((s) => s.sequence === p.stopSequence)?.name || null,
    })),
    route,
    trail: trail.map((p) => [p.lng, p.lat]),
    lastLocation: last ? { lat: last.lat, lng: last.lng, recordedAt: last.recordedAt, speed: last.speed } : null,
  };
}

// ----------------------------------------------------------------------------
// SUPER ADMIN — platform-wide live view. Declared BEFORE the requireTenant
// guard below, since the platform owner has no tenant of their own.
// ----------------------------------------------------------------------------

// GET /api/trips/platform/live — every trip running right now, across all orgs.
router.get(
  '/platform/live',
  authenticate,
  authorize('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    const trips = await prisma.trip.findMany({
      where: { status: { in: ACTIVE } },
      include: {
        passengers: true,
        vehicle: { select: { regNumber: true, fleetNo: true } },
        driver: { select: { name: true, loginId: true, phone: true } },
        schedule: { select: { name: true, startTime: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    const runs = await Promise.all(
      trips.map(async (t) => ({
        id: t.id,
        org: t.tenant,
        scheduleName: t.schedule?.name,
        direction: t.direction,
        status: t.status,
        startedAt: t.startedAt,
        routeName: (await prisma.route.findUnique({ where: { id: t.routeId }, select: { name: true } }))?.name,
        vehicle: t.vehicle,
        driver: t.driver,
        counts: tripCounts(t.passengers),
        lastLocation: await lastLocation(t.id),
      }))
    );
    res.json({ runs });
  })
);

// GET /api/trips/platform/:id/live — full live detail for any org's trip.
router.get(
  '/platform/:id/live',
  authenticate,
  authorize('SUPER_ADMIN'),
  asyncHandler(async (req, res) => {
    res.json(await liveTripPayload(req.params.id, null));
  })
);

// Everything below is tenant-scoped (admins, drivers, guardians).
router.use(authenticate, requireTenant);

// ----------------------------------------------------------------------------
// DRIVER
// ----------------------------------------------------------------------------

// GET /api/trips/driver/today — my schedules for today + my trips today.
router.get(
  '/driver/today',
  authorize('DRIVER'),
  asyncHandler(async (req, res) => {
    const schedules = await prisma.tripSchedule.findMany({
      where: { tenantId: req.tenantId, driverId: req.user.id, active: true },
      include: {
        route: { select: { id: true, name: true, stops: { select: { id: true }, take: 1 } } },
        vehicle: { select: { id: true, regNumber: true, fleetNo: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    const dow = todayDow();
    const todays = schedules.filter((s) => Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(dow));

    const trips = await prisma.trip.findMany({
      where: { tenantId: req.tenantId, driverId: req.user.id, serviceDate: todayDate() },
      include: { passengers: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      schedules: todays.map((s) => {
        const trip = trips.find((t) => t.scheduleId === s.id && ACTIVE.includes(t.status))
          || trips.find((t) => t.scheduleId === s.id);
        return {
          id: s.id, name: s.name, direction: s.direction, startTime: s.startTime,
          route: { id: s.route.id, name: s.route.name },
          vehicle: s.vehicle,
          trip: trip ? { id: trip.id, status: trip.status, startedAt: trip.startedAt, endedAt: trip.endedAt, counts: tripCounts(trip.passengers) } : null,
        };
      }),
    });
  })
);

// POST /api/trips/start — begin a run for one of my schedules. Snapshots the
// route's passengers into the trip's expected list.
router.post(
  '/start',
  authorize('DRIVER'),
  asyncHandler(async (req, res) => {
    const { scheduleId } = parseOr400(z.object({ scheduleId: z.string().min(1) }), req.body);
    const schedule = await prisma.tripSchedule.findFirst({
      where: { id: scheduleId, tenantId: req.tenantId, driverId: req.user.id, active: true },
      include: { route: { select: { id: true, name: true } } },
    });
    if (!schedule) throw new ApiError(404, 'Schedule not found (or not assigned to you)');

    // Resume rather than duplicate: one active run per schedule per day.
    const existing = await prisma.trip.findFirst({
      where: { scheduleId, serviceDate: todayDate(), status: { in: ACTIVE } },
      include: { passengers: { include: { passenger: { select: { id: true, name: true, category: true } } } } },
    });
    if (existing) return res.json({ trip: existing, resumed: true });

    // Snapshot who is expected: the route's active members + their stop order.
    const members = await prisma.passenger.findMany({
      where: { tenantId: req.tenantId, routeId: schedule.routeId, active: true },
      include: { stopAssignments: { include: { stop: { select: { routeId: true, sequence: true } } } } },
    });
    // Parents who told us their child isn't travelling today: start them ABSENT
    // so the driver isn't hunting for someone who was never coming.
    const absentToday = new Set(
      (await prisma.absence.findMany({
        where: { date: todayDate(), passengerId: { in: members.map((m) => m.id) } },
        select: { passengerId: true },
      })).map((a) => a.passengerId)
    );

    const trip = await prisma.trip.create({
      data: {
        tenantId: req.tenantId,
        scheduleId: schedule.id,
        routeId: schedule.routeId,
        vehicleId: schedule.vehicleId,
        driverId: req.user.id,
        direction: schedule.direction,
        serviceDate: todayDate(),
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        passengers: {
          create: members.map((m) => ({
            passengerId: m.id,
            status: absentToday.has(m.id) ? 'ABSENT' : 'EXPECTED',
            stopSequence: m.stopAssignments.find((a) => a.stop.routeId === schedule.routeId)?.stop.sequence ?? null,
          })),
        },
        events: { create: { type: 'TRIP_START' } },
      },
      include: { passengers: { include: { passenger: { select: { id: true, name: true, category: true } } } } },
    });

    emitTrip(req, trip.id, 'trip:status', { status: trip.status });

    // Tell the guardians the bus is on its way — best-effort, and not to those
    // who already told us their child isn't travelling today.
    for (const m of members.filter((m) => !absentToday.has(m.id))) {
      notifyGuardians(m.id, req.tenantId, {
        type: 'TRIP_STARTED',
        title: `${schedule.route.name} has started 🚌`,
        body: `${schedule.name} (${schedule.direction === 'DROP' ? 'drop' : 'pickup'}) started at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Track it live in the parent portal.`,
        data: { tripId: trip.id, passengerId: m.id },
      }).catch(() => {});
    }

    res.status(201).json({ trip });
  })
);

// POST /api/trips/:id/location — GPS ping from the driver's phone.
router.post(
  '/:id/location',
  authorize('DRIVER'),
  asyncHandler(async (req, res) => {
    const data = parseOr400(
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        speed: z.coerce.number().optional(),
        heading: z.coerce.number().optional(),
        recordedAt: z.coerce.date().optional(),
        accuracy: z.coerce.number().min(0).optional(),
        held: z.coerce.boolean().optional(),
      }),
      req.body
    );
    const trip = await driverTripOr404(req);
    if (!ACTIVE.includes(trip.status)) throw new ApiError(409, 'Trip is not running');

    // The device clock is not ours and not trustworthy. Every read orders by
    // recordedAt, so a phone an hour fast would park its fix permanently at the
    // head of the trail and the bus would never appear to move again. Accept
    // the past (offline replay is legitimate) but never the future.
    const now = new Date();
    const claimed = data.recordedAt || now;
    const recordedAt = claimed > now ? now : claimed;

    // One implausible fix must not become "where the bus is". Compare against
    // the last known point: nothing on a road covers 400 m in a second.
    const prev = await lastLocation(trip.id);
    const rejection = implausible(prev, { lat: data.lat, lng: data.lng, recordedAt });
    if (rejection) {
      // 202, not 4xx: the phone did nothing wrong and must NOT retry or queue
      // this forever — we are simply declining to believe this one reading.
      return res.status(202).json({ ok: true, stored: false, reason: rejection });
    }

    await prisma.locationPoint.create({
      data: {
        tripId: trip.id,
        lat: data.lat, lng: data.lng,
        speed: data.speed, heading: data.heading,
        accuracy: data.accuracy, held: data.held ?? false,
        source: 'PHONE',
        recordedAt,
      },
    });
    emitTrip(req, trip.id, 'trip:location', {
      lat: data.lat, lng: data.lng, speed: data.speed, heading: data.heading,
      accuracy: data.accuracy, held: data.held ?? false,
      // The DEVICE's time, not ours. A queue draining after a signal blackout
      // replays real positions from minutes ago; stamping them `now` told every
      // watching parent the bus was teleporting through its own history.
      at: recordedAt,
    });
    res.status(201).json({ ok: true, stored: true });
  })
);

// POST /api/trips/:id/board — the boarding checklist. ONBOARD / NO_SHOW /
// DROPPED, or EXPECTED to undo a mistaken tap.
router.post(
  '/:id/board',
  authorize('DRIVER'),
  asyncHandler(async (req, res) => {
    const { passengerId, status } = parseOr400(
      z.object({
        passengerId: z.string().min(1),
        status: z.enum(['ONBOARD', 'NO_SHOW', 'DROPPED', 'EXPECTED']),
      }),
      req.body
    );
    const trip = await ownTripOr404(req, { driverOnly: true });
    if (!ACTIVE.includes(trip.status)) throw new ApiError(409, 'Trip is not running');

    const tp = trip.passengers.find((p) => p.passengerId === passengerId);
    if (!tp) throw new ApiError(404, 'Passenger is not on this trip');

    const now = new Date();
    const updated = await prisma.tripPassenger.update({
      where: { id: tp.id },
      data: {
        status,
        boardedAt: status === 'ONBOARD' ? now : status === 'EXPECTED' ? null : tp.boardedAt,
        droppedAt: status === 'DROPPED' ? now : status === 'EXPECTED' ? null : tp.droppedAt,
      },
    });

    // Audit trail — corrections carry a reason instead of a fake scan type.
    const EVENT = { ONBOARD: 'MANUAL_IN', NO_SHOW: 'NO_SHOW', DROPPED: 'SCAN_OUT' };
    if (EVENT[status]) {
      await prisma.tripEvent.create({
        data: { tripId: trip.id, type: EVENT[status], passengerId, method: 'MANUAL' },
      });
    } else {
      await prisma.tripEvent.create({
        data: { tripId: trip.id, type: 'MANUAL_IN', passengerId, method: 'MANUAL', reason: 'reverted to expected' },
      });
    }

    emitTrip(req, trip.id, 'trip:boarding', { passengerId, status });

    // Guardians hear about the moments that matter.
    const name = tp.passenger?.name || 'Your passenger';
    const NOTES = {
      ONBOARD: { type: 'BOARDED', title: `${name} is on the bus ✅`, body: `${name} boarded at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` },
      DROPPED: { type: 'DROPPED', title: `${name} has been dropped off 🏁`, body: `${name} left the bus at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` },
      NO_SHOW: { type: 'NO_SHOW', title: `${name} didn’t board ⚠️`, body: `${name} was marked not boarded. Contact the organization if this is unexpected.` },
    };
    if (NOTES[status]) {
      notifyGuardians(passengerId, req.tenantId, { ...NOTES[status], data: { tripId: trip.id, passengerId } }).catch(() => {});
    }

    res.json({ passenger: updated });
  })
);

// POST /api/trips/:id/end — finish the run. The driver ends their own trip; an
// org admin can also force-end any of their org's runs (driver forgot, phone
// died, run left open overnight). Who ended it goes in the audit trail.
router.post(
  '/:id/end',
  authorize('DRIVER', 'TENANT_ADMIN'),
  asyncHandler(async (req, res) => {
    const byAdmin = req.user.role === 'TENANT_ADMIN';
    const trip = await ownTripOr404(req, { driverOnly: !byAdmin });
    if (!ACTIVE.includes(trip.status)) throw new ApiError(409, 'Trip is not running');
    const { reason } = parseOr400(z.object({ reason: z.string().max(200).optional() }), req.body ?? {});

    const stillOnboard = trip.passengers.filter((p) => p.status === 'ONBOARD');
    const trip2 = await prisma.trip.update({
      where: { id: trip.id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    await prisma.tripEvent.create({
      data: {
        tripId: trip.id, type: 'TRIP_END',
        // Sweep note: ending with someone still marked onboard is worth flagging.
        reason: [
          `ended by ${byAdmin ? `admin ${req.user.name || req.user.email}` : 'driver'}`,
          reason,
          stillOnboard.length ? `${stillOnboard.length} passenger(s) still marked onboard` : null,
        ].filter(Boolean).join(' · '),
      },
    });
    if (stillOnboard.length) {
      await prisma.tripEvent.create({
        data: { tripId: trip.id, type: 'SWEEP_OVERRIDE', reason: stillOnboard.map((p) => p.passenger?.name).join(', ') },
      });
    }
    emitTrip(req, trip.id, 'trip:status', { status: 'COMPLETED' });
    res.json({ trip: trip2, warning: stillOnboard.length ? `${stillOnboard.length} passenger(s) were still marked onboard` : null });
  })
);

// ----------------------------------------------------------------------------
// ADMIN — live overview of today
// ----------------------------------------------------------------------------

// GET /api/trips/today — every run planned for today, with live state.
router.get(
  '/today',
  authorize('TENANT_ADMIN'),
  asyncHandler(async (req, res) => {
    const dow = todayDow();
    const schedules = await prisma.tripSchedule.findMany({
      where: { tenantId: req.tenantId, active: true },
      include: {
        route: { select: { id: true, name: true } },
        vehicle: { select: { id: true, regNumber: true, fleetNo: true } },
        driver: { select: { id: true, name: true, loginId: true, phone: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    const todays = schedules.filter((s) => Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(dow));

    const trips = await prisma.trip.findMany({
      where: { tenantId: req.tenantId, serviceDate: todayDate() },
      include: { passengers: true },
      orderBy: { createdAt: 'desc' },
    });

    const runs = await Promise.all(
      todays.map(async (s) => {
        const trip = trips.find((t) => t.scheduleId === s.id && ACTIVE.includes(t.status))
          || trips.find((t) => t.scheduleId === s.id);
        return {
          schedule: { id: s.id, name: s.name, startTime: s.startTime, direction: s.direction },
          route: s.route,
          vehicle: s.vehicle,
          driver: s.driver,
          trip: trip
            ? {
                id: trip.id, status: trip.status, startedAt: trip.startedAt, endedAt: trip.endedAt,
                counts: tripCounts(trip.passengers),
                lastLocation: ACTIVE.includes(trip.status) ? await lastLocation(trip.id) : null,
              }
            : null,
        };
      })
    );

    res.json({ runs });
  })
);

// ----------------------------------------------------------------------------
// GUARDIAN — live view of my own passengers only
// ----------------------------------------------------------------------------

// GET /api/trips/guardian/live
router.get(
  '/guardian/live',
  authorize('GUARDIAN'),
  asyncHandler(async (req, res) => {
    const links = await prisma.guardianPassenger.findMany({
      where: { guardianId: req.user.id },
      include: {
        passenger: {
          select: {
            id: true, name: true, category: true, active: true, routeId: true,
            route: { select: { id: true, name: true } },
          },
        },
      },
    });
    const kids = links.map((l) => l.passenger).filter((p) => p.active);
    const dow = todayDow();

    const children = await Promise.all(
      kids.map(async (kid) => {
        // Their most relevant trip today: an active one, else the latest one.
        const tp = await prisma.tripPassenger.findFirst({
          where: {
            passengerId: kid.id,
            trip: { serviceDate: todayDate() },
          },
          orderBy: { trip: { createdAt: 'desc' } },
          include: {
            trip: {
              include: {
                vehicle: { select: { regNumber: true, fleetNo: true } },
                driver: { select: { name: true, phone: true } },
                schedule: { select: { name: true, startTime: true, direction: true } },
              },
            },
          },
        });
        // Prefer an active trip if the latest found isn't.
        let best = tp;
        if (tp && !ACTIVE.includes(tp.trip.status)) {
          const active = await prisma.tripPassenger.findFirst({
            where: { passengerId: kid.id, trip: { serviceDate: todayDate(), status: { in: ACTIVE } } },
            include: {
              trip: {
                include: {
                  vehicle: { select: { regNumber: true, fleetNo: true } },
                  driver: { select: { name: true, phone: true } },
                  schedule: { select: { name: true, startTime: true, direction: true } },
                },
              },
            },
          });
          if (active) best = active;
        }

        // The child's own stop — shown as a pin on the parent's live map.
        const assignment = await prisma.stopAssignment.findFirst({
          where: { passengerId: kid.id },
          include: { stop: { select: { name: true, lat: true, lng: true } } },
        });
        const stop = assignment ? assignment.stop : null;

        // Runs scheduled for this child's route today that haven't started yet.
        // Parents want to know the bus is coming BEFORE the driver taps Start.
        let upcoming = [];
        if (kid.routeId) {
          const scheds = await prisma.tripSchedule.findMany({
            where: { tenantId: req.tenantId, routeId: kid.routeId, active: true },
            include: {
              vehicle: { select: { regNumber: true, fleetNo: true } },
              driver: { select: { name: true, phone: true } },
            },
            orderBy: { startTime: 'asc' },
          });
          const todaysTrips = await prisma.trip.findMany({
            where: { routeId: kid.routeId, serviceDate: todayDate() },
            select: { scheduleId: true },
          });
          const alreadyRun = new Set(todaysTrips.map((t) => t.scheduleId));
          upcoming = scheds
            .filter((s) => Array.isArray(s.daysOfWeek) && s.daysOfWeek.includes(dow) && !alreadyRun.has(s.id))
            .map((s) => ({
              id: s.id, name: s.name, startTime: s.startTime, direction: s.direction,
              vehicle: s.vehicle, driver: s.driver,
            }));
        }

        const base = {
          id: kid.id, name: kid.name, category: kid.category,
          stop, route: kid.route, upcoming,
        };

        if (!best) return { ...base, trip: null };
        const t = best.trip;
        const isLive = ACTIVE.includes(t.status);
        const tripRoute = await prisma.route.findUnique({
          where: { id: t.routeId },
          select: { name: true, stops: { orderBy: { sequence: 'asc' }, select: { id: true, name: true, lat: true, lng: true } } },
        });
        const routeName = tripRoute?.name;
        // Newest 300, flipped back into order (asc+take took the OLDEST, so the
        // parent's line froze at the start of the trip), thinned, then snapped
        // to the roads. `held: false` keeps a parked bus from eating the window
        // with hundreds of copies of one position. Same cache as the admin view,
        // so a class-worth of parents watching one bus costs one match.
        const trail = isLive
          ? (await matchedTrail(
              t.id,
              thinTrail(
                (await prisma.locationPoint.findMany({
                  where: { tripId: t.id, held: false }, orderBy: { recordedAt: 'desc' }, take: 300,
                  select: { lat: true, lng: true, recordedAt: true, accuracy: true },
                })).reverse()
              )
            )).map((p) => [p.lng, p.lat])
          : [];

        // The question a parent is actually asking: "how long until it matters
        // to ME?" Before boarding that's their stop; once aboard it's the last
        // stop of the route (where the child gets off).
        const here = isLive ? await lastLocation(t.id) : null;
        let eta = null;
        if (here) {
          const target =
            best.status === 'EXPECTED' ? stop :
            best.status === 'ONBOARD' ? tripRoute?.stops?.[tripRoute.stops.length - 1] :
            null;
          if (target) {
            const e = await etaBetween(here, target);
            if (e) eta = { ...e, stopName: target.name, forStatus: best.status };
          }
        }
        return {
          ...base,
          trip: {
            id: t.id,
            status: t.status,
            live: isLive,
            startedAt: t.startedAt,
            endedAt: t.endedAt,
            direction: t.direction,
            routeName,
            scheduleName: t.schedule?.name,
            vehicle: t.vehicle,
            driver: t.driver,
            myStatus: best.status,
            boardedAt: best.boardedAt,
            droppedAt: best.droppedAt,
            trail,
            eta,
            lastLocation: here,
          },
        };
      })
    );

    res.json({ children });
  })
);

// ----------------------------------------------------------------------------
// SHARED — live detail for one trip (admin any; driver their own)
// ----------------------------------------------------------------------------

// GET /api/trips/:id/live
router.get(
  '/:id/live',
  authorize('TENANT_ADMIN', 'DRIVER'),
  asyncHandler(async (req, res) => {
    const payload = await liveTripPayload(req.params.id, req.tenantId);
    if (req.user.role === 'DRIVER' && payload.trip.driver?.id !== req.user.id) {
      throw new ApiError(403, 'This is not your trip');
    }
    res.json(payload);
  })
);

export default router;
