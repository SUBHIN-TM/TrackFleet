import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

const passengerInclude = {
  guardians: { include: { guardian: { select: { id: true, name: true, email: true, phone: true } } } },
  stopAssignments: { select: { stopId: true } },
};

// GET /api/passengers
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const passengers = await prisma.passenger.findMany({
      where: { tenantId: req.tenantId },
      include: passengerInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ passengers });
  })
);

const createSchema = z.object({
  name: z.string().min(2),
  grade: z.string().optional(),
  homeAddress: z.string().optional(),
  homeLat: z.coerce.number().optional(),
  homeLng: z.coerce.number().optional(),
  // Optionally create + link a guardian (parent) with a login in one step.
  guardian: z
    .object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      phone: z.string().optional(),
      relation: z.string().optional(),
    })
    .optional(),
});

// POST /api/passengers — add a student, optionally with a parent account
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);

    const passenger = await prisma.$transaction(async (tx) => {
      const p = await tx.passenger.create({
        data: {
          tenantId: req.tenantId,
          name: data.name,
          grade: data.grade,
          homeAddress: data.homeAddress,
          homeLat: data.homeLat,
          homeLng: data.homeLng,
        },
      });

      if (data.guardian) {
        // Reuse an existing guardian account (same email in tenant) or create one.
        let guardian = await tx.user.findFirst({
          where: { tenantId: req.tenantId, email: data.guardian.email },
        });
        if (!guardian) {
          guardian = await tx.user.create({
            data: {
              tenantId: req.tenantId,
              role: 'GUARDIAN',
              name: data.guardian.name,
              email: data.guardian.email,
              phone: data.guardian.phone,
              passwordHash: await hashPassword(data.guardian.password),
            },
          });
        }
        await tx.guardianPassenger.create({
          data: { guardianId: guardian.id, passengerId: p.id, relation: data.guardian.relation },
        });
      }
      return p;
    });

    const full = await prisma.passenger.findUnique({
      where: { id: passenger.id },
      include: passengerInclude,
    });
    res.status(201).json({ passenger: full });
  })
);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  grade: z.string().optional(),
  homeAddress: z.string().optional(),
  homeLat: z.coerce.number().optional(),
  homeLng: z.coerce.number().optional(),
  active: z.boolean().optional(),
});

// PATCH /api/passengers/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(updateSchema, req.body);
    const result = await prisma.passenger.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data,
    });
    if (result.count === 0) throw new ApiError(404, 'Passenger not found');
    const passenger = await prisma.passenger.findUnique({
      where: { id: req.params.id },
      include: passengerInclude,
    });
    res.json({ passenger });
  })
);

// DELETE /api/passengers/:id  (soft: archive so history/billing stays intact)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await prisma.passenger.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId },
      data: { active: false },
    });
    if (result.count === 0) throw new ApiError(404, 'Passenger not found');
    res.status(204).end();
  })
);

export default router;
