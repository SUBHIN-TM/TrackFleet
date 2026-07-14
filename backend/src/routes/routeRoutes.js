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
