import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize } from '../middleware/auth.js';

// Parent-portal API. Guardians sign in by org + phone + password and only ever
// see their own linked passengers.
const router = Router();
router.use(authenticate, authorize('GUARDIAN'));

// GET /api/guardian/children — the passengers linked to this guardian, each with
// their assigned stop + route so the parent knows where their child boards.
router.get(
  '/children',
  asyncHandler(async (req, res) => {
    const links = await prisma.guardianPassenger.findMany({
      where: { guardianId: req.user.id },
      include: {
        passenger: {
          include: {
            stopAssignments: {
              include: { stop: { include: { route: { select: { name: true, direction: true } } } } },
            },
          },
        },
      },
    });

    const children = links
      .filter((l) => l.passenger.active)
      .map((l) => {
        const stop = l.passenger.stopAssignments[0]?.stop || null;
        return {
          id: l.passenger.id,
          name: l.passenger.name,
          category: l.passenger.category,
          relation: l.relation,
          phone: l.passenger.phone,
          stop: stop
            ? { name: stop.name, scheduledTime: stop.scheduledTime, route: stop.route?.name, direction: stop.route?.direction }
            : null,
        };
      });

    res.json({ children });
  })
);

// A guardian may only ever read their OWN linked passengers.
async function ownPassengerOr404(req, passengerId) {
  const link = await prisma.guardianPassenger.findFirst({
    where: { guardianId: req.user.id, passengerId },
    include: { passenger: true },
  });
  if (!link) throw new ApiError(404, 'Passenger not found');
  return link.passenger;
}

// GET /api/guardian/passengers/:id — the child's route: stops (with theirs
// marked) and the weekly plan, so parents can see where and when the bus runs.
router.get(
  '/passengers/:id',
  asyncHandler(async (req, res) => {
    const p = await ownPassengerOr404(req, req.params.id);

    const myStopId =
      (await prisma.stopAssignment.findFirst({ where: { passengerId: p.id }, select: { stopId: true } }))?.stopId || null;

    const route = p.routeId
      ? await prisma.route.findUnique({
          where: { id: p.routeId },
          select: {
            id: true, name: true, direction: true,
            stops: { orderBy: { sequence: 'asc' }, select: { id: true, name: true, lat: true, lng: true, sequence: true } },
          },
        })
      : null;

    const schedules = p.routeId
      ? await prisma.tripSchedule.findMany({
          where: { routeId: p.routeId, active: true },
          select: {
            id: true, name: true, startTime: true, direction: true, daysOfWeek: true,
            vehicle: { select: { regNumber: true, fleetNo: true } },
            driver: { select: { name: true, phone: true } },
          },
          orderBy: { startTime: 'asc' },
        })
      : [];

    res.json({
      passenger: { id: p.id, name: p.name, category: p.category },
      route, myStopId, schedules,
    });
  })
);

// GET /api/guardian/passengers/:id/journeys — this child's past rides, newest
// first: whether they boarded, when, on which bus and with which driver.
router.get(
  '/passengers/:id/journeys',
  asyncHandler(async (req, res) => {
    const p = await ownPassengerOr404(req, req.params.id);

    const rows = await prisma.tripPassenger.findMany({
      where: { passengerId: p.id, trip: { status: { in: ['COMPLETED', 'CANCELLED', 'INTERRUPTED'] } } },
      orderBy: { trip: { serviceDate: 'desc' } },
      take: 40,
      include: {
        trip: {
          include: {
            vehicle: { select: { regNumber: true, fleetNo: true } },
            driver: { select: { name: true } },
            schedule: { select: { name: true } },
          },
        },
      },
    });

    // Route names in one lookup rather than per row.
    const routeIds = [...new Set(rows.map((r) => r.trip.routeId))];
    const routes = await prisma.route.findMany({ where: { id: { in: routeIds } }, select: { id: true, name: true } });
    const routeName = Object.fromEntries(routes.map((r) => [r.id, r.name]));

    res.json({
      journeys: rows.map((r) => ({
        tripId: r.trip.id,
        date: r.trip.serviceDate,
        scheduleName: r.trip.schedule?.name,
        routeName: routeName[r.trip.routeId] || null,
        direction: r.trip.direction,
        tripStatus: r.trip.status,
        myStatus: r.status,
        boardedAt: r.boardedAt,
        droppedAt: r.droppedAt,
        startedAt: r.trip.startedAt,
        endedAt: r.trip.endedAt,
        vehicle: r.trip.vehicle,
        driver: r.trip.driver,
      })),
    });
  })
);

// ---- Absences: "my child isn't travelling that day" -------------------------
// Dates are stored at UTC midnight so a day is a day, not a timestamp.
const dayOf = (s) => { const d = new Date(s); d.setUTCHours(0, 0, 0, 0); return d; };

// GET /api/guardian/passengers/:id/absences — upcoming (and today's) absences.
router.get(
  '/passengers/:id/absences',
  asyncHandler(async (req, res) => {
    const p = await ownPassengerOr404(req, req.params.id);
    const from = new Date(); from.setUTCHours(0, 0, 0, 0);
    const absences = await prisma.absence.findMany({
      where: { passengerId: p.id, date: { gte: from } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, reason: true },
    });
    res.json({ absences });
  })
);

// POST /api/guardian/passengers/:id/absences — tell the org they won't travel.
// Upsert: marking the same day twice just updates the reason.
router.post(
  '/passengers/:id/absences',
  asyncHandler(async (req, res) => {
    const p = await ownPassengerOr404(req, req.params.id);
    const { date, reason } = parseOr400(
      z.object({ date: z.string().min(8), reason: z.string().max(200).optional() }),
      req.body
    );
    const day = dayOf(date);
    if (Number.isNaN(day.getTime())) throw new ApiError(400, 'Enter a valid date');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    if (day < today) throw new ApiError(400, 'Pick today or a future date');

    const absence = await prisma.absence.upsert({
      where: { passengerId_date: { passengerId: p.id, date: day } },
      create: { passengerId: p.id, date: day, reason },
      update: { reason },
      select: { id: true, date: true, reason: true },
    });

    // If today's run hasn't started yet the snapshot will pick this up; if it
    // is already running, mark them absent on it now so the driver sees it.
    await prisma.tripPassenger.updateMany({
      where: {
        passengerId: p.id,
        status: 'EXPECTED',
        trip: { serviceDate: day, status: { in: ['STARTED', 'IN_PROGRESS'] } },
      },
      data: { status: 'ABSENT' },
    });

    res.status(201).json({ absence });
  })
);

// DELETE /api/guardian/passengers/:id/absences/:absenceId — plans changed.
router.delete(
  '/passengers/:id/absences/:absenceId',
  asyncHandler(async (req, res) => {
    const p = await ownPassengerOr404(req, req.params.id);
    const { count } = await prisma.absence.deleteMany({
      where: { id: req.params.absenceId, passengerId: p.id },
    });
    if (!count) throw new ApiError(404, 'Absence not found');
    res.status(204).end();
  })
);

export default router;
