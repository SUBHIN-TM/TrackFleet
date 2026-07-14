import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

const publicDriver = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  driverProfile: { select: { licenseNumber: true, photoUrl: true } },
};

// GET /api/drivers
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const drivers = await prisma.user.findMany({
      where: { tenantId: req.tenantId, role: 'DRIVER' },
      select: publicDriver,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ drivers });
  })
);

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  licenseNumber: z.string().optional(),
});

// POST /api/drivers — creates the login + driver profile
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);
    const exists = await prisma.user.findFirst({
      where: { tenantId: req.tenantId, email: data.email },
    });
    if (exists) throw new ApiError(409, 'A user with that email already exists in this organization');

    const passwordHash = await hashPassword(data.password);
    const driver = await prisma.user.create({
      data: {
        tenantId: req.tenantId,
        role: 'DRIVER',
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        driverProfile: { create: { licenseNumber: data.licenseNumber } },
      },
      select: publicDriver,
    });
    res.status(201).json({ driver });
  })
);

// PATCH /api/drivers/:id — update name/phone/license/status
const updateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  licenseNumber: z.string().optional(),
});
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(updateSchema, req.body);
    const driver = await prisma.user.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, role: 'DRIVER' },
    });
    if (!driver) throw new ApiError(404, 'Driver not found');

    const { licenseNumber, ...userData } = data;
    const updated = await prisma.user.update({
      where: { id: driver.id },
      data: {
        ...userData,
        ...(licenseNumber !== undefined
          ? { driverProfile: { upsert: { create: { licenseNumber }, update: { licenseNumber } } } }
          : {}),
      },
      select: publicDriver,
    });
    res.json({ driver: updated });
  })
);

export default router;
