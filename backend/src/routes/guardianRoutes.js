import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../lib/http.js';
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

export default router;
