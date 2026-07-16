import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

const routeInclude = {
  stops: {
    orderBy: { sequence: 'asc' },
    include: { assignments: { include: { passenger: { select: { id: true, name: true } } } } },
  },
  // Passengers who ride this route (membership via Passenger.routeId).
  passengers: { where: { active: true }, select: { id: true, name: true, category: true }, orderBy: { name: 'asc' } },
};

// Verify a route belongs to this tenant (used before mutating its stops).
async function ownRouteOr404(tenantId, routeId) {
  const route = await prisma.route.findFirst({ where: { id: routeId, tenantId } });
  if (!route) throw new ApiError(404, 'Route not found');
  return route;
}

// GET /api/routes
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const routes = await prisma.route.findMany({
      where: { tenantId: req.tenantId },
      include: routeInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ routes });
  })
);

// GET /api/routes/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: routeInclude,
    });
    res.json({ route });
  })
);

const routeSchema = z.object({
  name: z.string().min(2),
  direction: z.enum(['PICKUP', 'DROP', 'BOTH']).default('PICKUP'),
});

// POST /api/routes
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(routeSchema, req.body);
    const route = await prisma.route.create({ data: { ...data, tenantId: req.tenantId } });
    res.status(201).json({ route });
  })
);

// PATCH /api/routes/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(routeSchema.partial().extend({ active: z.boolean().optional() }), req.body);
    const result = await prisma.route.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data,
    });
    if (result.count === 0) throw new ApiError(404, 'Route not found');
    const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: routeInclude });
    res.json({ route });
  })
);

// ---- Stops ----

const stopSchema = z.object({
  name: z.string().min(1),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  geofenceRadius: z.coerce.number().int().positive().default(150),
  scheduledTime: z.string().optional(),
  sequence: z.coerce.number().int().nonnegative(),
});

// POST /api/routes/:id/stops — add a stop to a route
router.post(
  '/:id/stops',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const data = parseOr400(stopSchema, req.body);
    const stop = await prisma.stop.create({ data: { ...data, routeId: req.params.id } });
    res.status(201).json({ stop });
  })
);

// PATCH /api/routes/:id/stops/:stopId
router.patch(
  '/:id/stops/:stopId',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const data = parseOr400(stopSchema.partial(), req.body);
    const result = await prisma.stop.updateMany({
      where: { id: req.params.stopId, routeId: req.params.id },
      data,
    });
    if (result.count === 0) throw new ApiError(404, 'Stop not found');
    const stop = await prisma.stop.findUnique({ where: { id: req.params.stopId } });
    res.json({ stop });
  })
);

// DELETE /api/routes/:id/stops/:stopId
router.delete(
  '/:id/stops/:stopId',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const result = await prisma.stop.deleteMany({
      where: { id: req.params.stopId, routeId: req.params.id },
    });
    if (result.count === 0) throw new ApiError(404, 'Stop not found');
    res.status(204).end();
  })
);

// ---- Route membership (which passengers ride this route) ----

// PUT /api/routes/:id/passengers — set the full passenger membership of this
// route from a multi-select checklist. Passengers in the list are moved here
// (from whatever route they were in); passengers previously in this route but
// omitted are unassigned. A passenger is only ever in one route.
router.put(
  '/:id/passengers',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const routeId = req.params.id;
    const { passengerIds } = parseOr400(z.object({ passengerIds: z.array(z.string()) }), req.body);

    await prisma.$transaction(async (tx) => {
      // Only this tenant's passengers can be assigned.
      const valid = await tx.passenger.findMany({
        where: { tenantId: req.tenantId, id: { in: passengerIds } },
        select: { id: true },
      });
      const addIds = valid.map((p) => p.id);
      const addSet = new Set(addIds);

      // Who is leaving: currently in this route but not in the new list.
      const current = await tx.passenger.findMany({
        where: { tenantId: req.tenantId, routeId },
        select: { id: true },
      });
      const removeIds = current.map((p) => p.id).filter((id) => !addSet.has(id));

      if (addIds.length) {
        // Move them here, and drop any boarding stop that was on another route.
        await tx.passenger.updateMany({ where: { id: { in: addIds } }, data: { routeId } });
        await tx.stopAssignment.deleteMany({
          where: { passengerId: { in: addIds }, stop: { routeId: { not: routeId } } },
        });
      }
      if (removeIds.length) {
        await tx.stopAssignment.deleteMany({ where: { passengerId: { in: removeIds }, stop: { routeId } } });
        await tx.passenger.updateMany({ where: { id: { in: removeIds } }, data: { routeId: null } });
      }
    });

    const route = await prisma.route.findUnique({ where: { id: routeId }, include: routeInclude });
    res.json({ route });
  })
);

// PUT /api/routes/:id/stops/:stopId/passengers — set who boards at this stop
// from a multi-select checklist. Assigning also makes the passenger a member of
// this route and gives them exactly one boarding stop (their previous stop is
// replaced). Passengers unchecked here keep riding the route, just without this
// stop.
router.put(
  '/:id/stops/:stopId/passengers',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const routeId = req.params.id;
    const stop = await prisma.stop.findFirst({ where: { id: req.params.stopId, routeId } });
    if (!stop) throw new ApiError(404, 'Stop not found on this route');
    const { passengerIds } = parseOr400(z.object({ passengerIds: z.array(z.string()) }), req.body);

    await prisma.$transaction(async (tx) => {
      const valid = await tx.passenger.findMany({
        where: { tenantId: req.tenantId, id: { in: passengerIds } },
        select: { id: true },
      });
      const addIds = valid.map((p) => p.id);
      const addSet = new Set(addIds);

      const atStop = await tx.stopAssignment.findMany({ where: { stopId: stop.id }, select: { passengerId: true } });
      const removeIds = atStop.map((a) => a.passengerId).filter((id) => !addSet.has(id));

      if (addIds.length) {
        // Make them route members and give them only this stop (one stop each).
        await tx.passenger.updateMany({ where: { id: { in: addIds } }, data: { routeId } });
        await tx.stopAssignment.deleteMany({ where: { passengerId: { in: addIds }, stopId: { not: stop.id } } });
        for (const passengerId of addIds) {
          await tx.stopAssignment.upsert({
            where: { stopId_passengerId: { stopId: stop.id, passengerId } },
            create: { stopId: stop.id, passengerId },
            update: {},
          });
        }
      }
      if (removeIds.length) {
        await tx.stopAssignment.deleteMany({ where: { stopId: stop.id, passengerId: { in: removeIds } } });
      }
    });

    const route = await prisma.route.findUnique({ where: { id: routeId }, include: routeInclude });
    res.json({ route });
  })
);

// POST /api/routes/:id/stops/:stopId/board — set the boarding stop for a BATCH
// of passengers (the assign dialog's "stop for selected" dropdown). Unlike the
// PUT above, this only touches the listed passengers — whoever else already
// boards at this stop is left alone. Each passenger keeps exactly one stop.
router.post(
  '/:id/stops/:stopId/board',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const routeId = req.params.id;
    const stop = await prisma.stop.findFirst({ where: { id: req.params.stopId, routeId } });
    if (!stop) throw new ApiError(404, 'Stop not found on this route');
    const { passengerIds } = parseOr400(z.object({ passengerIds: z.array(z.string()).min(1) }), req.body);

    await prisma.$transaction(async (tx) => {
      const valid = await tx.passenger.findMany({
        where: { tenantId: req.tenantId, id: { in: passengerIds } },
        select: { id: true },
      });
      const ids = valid.map((p) => p.id);
      if (!ids.length) return;
      // Board here ⇒ member of this route, and this is their only stop.
      await tx.passenger.updateMany({ where: { id: { in: ids } }, data: { routeId } });
      await tx.stopAssignment.deleteMany({ where: { passengerId: { in: ids }, stopId: { not: stop.id } } });
      for (const passengerId of ids) {
        await tx.stopAssignment.upsert({
          where: { stopId_passengerId: { stopId: stop.id, passengerId } },
          create: { stopId: stop.id, passengerId },
          update: {},
        });
      }
    });

    const route = await prisma.route.findUnique({ where: { id: routeId }, include: routeInclude });
    res.json({ route });
  })
);

// ---- Stop assignments (which passenger boards at which stop) ----

const assignSchema = z.object({ passengerId: z.string(), stopId: z.string() });

// POST /api/routes/:id/assign — assign a passenger to a stop
router.post(
  '/:id/assign',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    const { passengerId, stopId } = parseOr400(assignSchema, req.body);

    // Both the stop and passenger must belong to this tenant/route.
    const stop = await prisma.stop.findFirst({ where: { id: stopId, routeId: req.params.id } });
    if (!stop) throw new ApiError(404, 'Stop not found on this route');
    const passenger = await prisma.passenger.findFirst({
      where: { id: passengerId, tenantId: req.tenantId },
    });
    if (!passenger) throw new ApiError(404, 'Passenger not found');

    const assignment = await prisma.stopAssignment
      .create({ data: { passengerId, stopId } })
      .catch((e) => {
        if (e.code === 'P2002') throw new ApiError(409, 'Passenger already assigned to this stop');
        throw e;
      });
    res.status(201).json({ assignment });
  })
);

// DELETE /api/routes/:id/assign/:assignmentId
router.delete(
  '/:id/assign/:assignmentId',
  asyncHandler(async (req, res) => {
    await ownRouteOr404(req.tenantId, req.params.id);
    // Ensure the assignment's stop is on this route before deleting.
    const assignment = await prisma.stopAssignment.findFirst({
      where: { id: req.params.assignmentId, stop: { routeId: req.params.id } },
    });
    if (!assignment) throw new ApiError(404, 'Assignment not found');
    await prisma.stopAssignment.delete({ where: { id: assignment.id } });
    res.status(204).end();
  })
);

export default router;
