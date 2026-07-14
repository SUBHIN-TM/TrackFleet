import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

const upsertSchema = z.object({
  regNumber: z.string().min(2),
  capacity: z.coerce.number().int().positive().default(40),
  photoUrl: z.string().url().optional().or(z.literal('')),
  active: z.boolean().optional(),
});

// GET /api/vehicles
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ vehicles });
  })
);

// POST /api/vehicles
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(upsertSchema, req.body);
    const vehicle = await prisma.vehicle
      .create({ data: { ...data, photoUrl: data.photoUrl || null, tenantId: req.tenantId } })
      .catch((e) => {
        if (e.code === 'P2002') throw new ApiError(409, 'A vehicle with that registration already exists');
        throw e;
      });
    res.status(201).json({ vehicle });
  })
);

// PATCH /api/vehicles/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(upsertSchema.partial(), req.body);
    // Scope-safe update: match id AND tenantId so no cross-tenant edits.
    const result = await prisma.vehicle.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data,
    });
    if (result.count === 0) throw new ApiError(404, 'Vehicle not found');
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    res.json({ vehicle });
  })
);

// DELETE /api/vehicles/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await prisma.vehicle.deleteMany({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (result.count === 0) throw new ApiError(404, 'Vehicle not found');
    res.status(204).end();
  })
);

export default router;
