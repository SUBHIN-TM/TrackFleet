import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

// Recurring plan mapping route → vehicle → driver → days → time. Concrete daily
// Trip records are generated from these later; for now this is the mapping CRUD.
const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

const include = {
  route: { select: { id: true, name: true, direction: true } },
  vehicle: { select: { id: true, regNumber: true, fleetNo: true } },
  driver: { select: { id: true, name: true, loginId: true } },
};

// GET /api/schedules
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const schedules = await prisma.tripSchedule.findMany({
      where: { tenantId: req.tenantId },
      include,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ schedules });
  })
);

const fields = {
  name: z.string().min(2, 'give the schedule a name'),
  routeId: z.string().min(1),
  vehicleId: z.string().min(1),
  driverId: z.string().min(1),
  direction: z.enum(['PICKUP', 'DROP', 'BOTH']),
  // Mon=1 … Sun=7. At least one day, no duplicates.
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1, 'pick at least one day'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'use HH:MM'),
};
const createSchema = z.object(fields);
const updateSchema = z.object({ ...fields, active: z.boolean() }).partial();

// Every referenced resource must belong to this tenant (and the driver must be a
// driver) — otherwise an admin could map another org's bus/driver.
async function assertOwnership(tenantId, { routeId, vehicleId, driverId }) {
  const [route, vehicle, driver] = await Promise.all([
    prisma.route.findFirst({ where: { id: routeId, tenantId } }),
    prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId } }),
    prisma.user.findFirst({ where: { id: driverId, tenantId, role: 'DRIVER' } }),
  ]);
  if (!route) throw new ApiError(400, 'That route is not in this organization');
  if (!vehicle) throw new ApiError(400, 'That vehicle is not in this organization');
  if (!driver) throw new ApiError(400, 'That driver is not in this organization');
}

// POST /api/schedules
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);
    await assertOwnership(req.tenantId, data);
    const schedule = await prisma.tripSchedule.create({
      data: { tenantId: req.tenantId, ...data },
      include,
    });
    res.status(201).json({ schedule });
  })
);

// PATCH /api/schedules/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(updateSchema, req.body);
    const existing = await prisma.tripSchedule.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) throw new ApiError(404, 'Schedule not found');

    if (data.routeId || data.vehicleId || data.driverId) {
      await assertOwnership(req.tenantId, {
        routeId: data.routeId || existing.routeId,
        vehicleId: data.vehicleId || existing.vehicleId,
        driverId: data.driverId || existing.driverId,
      });
    }
    const schedule = await prisma.tripSchedule.update({ where: { id: existing.id }, data, include });
    res.json({ schedule });
  })
);

// DELETE /api/schedules/:id — soft delete (keeps any generated trips valid).
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await prisma.tripSchedule.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data: { active: false },
    });
    if (result.count === 0) throw new ApiError(404, 'Schedule not found');
    res.status(204).end();
  })
);

export default router;
