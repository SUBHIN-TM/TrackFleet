import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { generateTempPassword } from '../lib/password.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

// Parents log in on their own portal with org + phone + password. No app exists
// yet, so this base is a placeholder the admin shares; the portal, once built,
// reads ?org= & ?phone= to prefill the form.
const PARENT_PORTAL = (process.env.PARENT_PORTAL_URL || 'http://localhost:5175').replace(/\/$/, '');
// Phone doubles as the guardian's login handle, so strip formatting for a stable
// match (the display copy keeps whatever the admin typed).
const normalizePhone = (p) => (p || '').replace(/[\s\-()]/g, '');
const parentPortalLink = (orgSlug, phone) =>
  `${PARENT_PORTAL}/login?${new URLSearchParams({ org: (orgSlug || '').toUpperCase(), phone }).toString()}`;

// provisionalPassword + loginId are admin-only credentials the admin re-shares;
// safe here because the whole router is TENANT_ADMIN-gated.
const passengerInclude = {
  guardians: {
    include: {
      guardian: { select: { id: true, name: true, phone: true, loginId: true, provisionalPassword: true } },
    },
  },
  stopAssignments: { select: { stopId: true } },
  route: { select: { id: true, name: true } },
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
  category: z.string().optional(),
  phone: z.string().optional(),
  homeAddress: z.string().optional(),
  // A passenger rides one route; the stop is their boarding point within it.
  // Both optional — some orgs (e.g. offices) run stopless routes.
  routeId: z.string().optional(),
  stopId: z.string().optional(),
  // Optionally create + link a guardian (parent). Login is by phone, no email;
  // a password is generated and handed over, same model as drivers.
  guardian: z
    .object({
      name: z.string().min(2),
      phone: z.string().min(5, 'enter a phone number'),
      relation: z.string().optional(),
    })
    .optional(),
});

// POST /api/passengers — add a passenger, optionally onto a stop and/or with a
// parent (guardian) login. Returns any guardian sign-in details to hand over.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);

    // Captured inside the tx, surfaced in the response so the admin can copy the
    // parent's credentials (phone + password + portal link).
    let guardianCredentials = null;

    const passenger = await prisma.$transaction(async (tx) => {
      // Resolve route membership from the explicit route, if given.
      let routeId = null;
      if (data.routeId) {
        const route = await tx.route.findFirst({ where: { id: data.routeId, tenantId: req.tenantId } });
        if (!route) throw new ApiError(400, 'That route is not in this organization');
        routeId = route.id;
      }

      const p = await tx.passenger.create({
        data: {
          tenantId: req.tenantId,
          name: data.name,
          category: data.category,
          phone: data.phone,
          homeAddress: data.homeAddress,
          routeId,
        },
      });

      // Map the passenger to a stop (their pickup/drop point) if one was chosen.
      if (data.stopId) {
        const stop = await tx.stop.findFirst({
          where: { id: data.stopId, route: { tenantId: req.tenantId } },
        });
        if (!stop) throw new ApiError(400, 'That stop is not in this organization');
        if (routeId && stop.routeId !== routeId) throw new ApiError(400, 'That stop is not on the selected route');
        // No explicit route chosen? Adopt the stop's route so the two agree.
        if (!routeId) await tx.passenger.update({ where: { id: p.id }, data: { routeId: stop.routeId } });
        await tx.stopAssignment.create({ data: { stopId: stop.id, passengerId: p.id } });
      }

      if (data.guardian) {
        const loginId = normalizePhone(data.guardian.phone);
        if (!loginId) throw new ApiError(400, 'Enter a valid guardian phone number');

        // Phone is the unique login handle: reuse an existing guardian (siblings
        // share a parent) or create a fresh one with a generated password.
        let guardian = await tx.user.findFirst({
          where: { tenantId: req.tenantId, role: 'GUARDIAN', loginId },
        });
        if (!guardian) {
          const password = generateTempPassword();
          guardian = await tx.user.create({
            data: {
              tenantId: req.tenantId,
              role: 'GUARDIAN',
              name: data.guardian.name,
              phone: data.guardian.phone,
              loginId,
              passwordHash: await hashPassword(password),
              provisionalPassword: password, // re-viewable so the admin can re-share
              mustChangePassword: false,
            },
          });
        }
        // Link (idempotent-ish): ignore if this parent is already on the passenger.
        await tx.guardianPassenger.upsert({
          where: { guardianId_passengerId: { guardianId: guardian.id, passengerId: p.id } },
          create: { guardianId: guardian.id, passengerId: p.id, relation: data.guardian.relation },
          update: { relation: data.guardian.relation },
        });
        guardianCredentials = {
          id: guardian.id,
          name: guardian.name,
          loginId: guardian.loginId,
          phone: guardian.phone,
          password: guardian.provisionalPassword, // null if a pre-existing guardian changed it
        };
      }
      return p;
    });

    const full = await prisma.passenger.findUnique({
      where: { id: passenger.id },
      include: passengerInclude,
    });

    // Attach the org slug so the admin gets a ready-to-send parent portal link.
    if (guardianCredentials) {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId }, select: { slug: true } });
      guardianCredentials.orgId = (tenant?.slug || '').toUpperCase();
      guardianCredentials.portalLink = parentPortalLink(tenant?.slug, guardianCredentials.loginId);
    }

    res.status(201).json({ passenger: full, guardianCredentials });
  })
);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  category: z.string().optional(),
  phone: z.string().optional(),
  homeAddress: z.string().optional(),
  active: z.boolean().optional(),
  // Editing can also re-tag the route/stop. null clears; omitted leaves as-is.
  routeId: z.string().nullable().optional(),
  stopId: z.string().nullable().optional(),
});

// PATCH /api/passengers/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { routeId, stopId, ...data } = parseOr400(updateSchema, req.body);
    const existing = await prisma.passenger.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) throw new ApiError(404, 'Passenger not found');

    await prisma.$transaction(async (tx) => {
      // Route membership first — the stop must agree with it.
      let effectiveRouteId = existing.routeId;
      if (routeId !== undefined) {
        if (routeId) {
          const route = await tx.route.findFirst({ where: { id: routeId, tenantId: req.tenantId } });
          if (!route) throw new ApiError(400, 'That route is not in this organization');
        }
        effectiveRouteId = routeId;
      }

      await tx.passenger.update({
        where: { id: existing.id },
        data: { ...data, ...(routeId !== undefined ? { routeId } : {}) },
      });

      if (stopId !== undefined) {
        // Replace the boarding stop wholesale (a passenger has exactly one).
        await tx.stopAssignment.deleteMany({ where: { passengerId: existing.id } });
        if (stopId) {
          const stop = await tx.stop.findFirst({
            where: { id: stopId, route: { tenantId: req.tenantId } },
          });
          if (!stop) throw new ApiError(400, 'That stop is not in this organization');
          if (effectiveRouteId && stop.routeId !== effectiveRouteId) {
            throw new ApiError(400, 'That stop is not on the selected route');
          }
          // No route picked? Adopt the stop's route so the two always agree.
          if (!effectiveRouteId) {
            await tx.passenger.update({ where: { id: existing.id }, data: { routeId: stop.routeId } });
          }
          await tx.stopAssignment.create({ data: { stopId: stop.id, passengerId: existing.id } });
        }
      } else if (routeId !== undefined) {
        // Route changed without choosing a stop — drop stops that no longer fit.
        await tx.stopAssignment.deleteMany({
          where: {
            passengerId: existing.id,
            ...(routeId ? { stop: { routeId: { not: routeId } } } : {}),
          },
        });
      }
    });

    const passenger = await prisma.passenger.findUnique({
      where: { id: req.params.id },
      include: passengerInclude,
    });
    res.json({ passenger });
  })
);

// POST /api/passengers/guardians/:guardianId/reset-password — the admin owns
// guardian passwords (same model as drivers): pass a chosen `password` or omit
// to generate one. Stored re-viewable so it can be re-shared on WhatsApp.
const guardianResetSchema = z.object({ password: z.string().min(6, 'use at least 6 characters').optional() });
router.post(
  '/guardians/:guardianId/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = parseOr400(guardianResetSchema, req.body ?? {});
    const guardian = await prisma.user.findFirst({
      where: { id: req.params.guardianId, tenantId: req.tenantId, role: 'GUARDIAN' },
    });
    if (!guardian) throw new ApiError(404, 'Guardian not found');

    const newPassword = password || generateTempPassword();
    const updated = await prisma.user.update({
      where: { id: guardian.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        provisionalPassword: newPassword,
        mustChangePassword: false,
      },
      select: { id: true, name: true, phone: true, loginId: true, provisionalPassword: true },
    });
    res.json({ guardian: updated });
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
