import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Everything here is super-admin-only.
router.use(authenticate, authorize('SUPER_ADMIN'));

const createSchema = z.object({
  name: z.string().min(2),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, or dashes'),
  vertical: z.enum(['SCHOOL', 'HOSPITAL', 'COMPANY']).default('SCHOOL'),
  features: z.record(z.any()).optional(),
  admin: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  }),
});

// POST /api/tenants — provision a tenant + its first Tenant Admin
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);

    const existing = await prisma.tenant.findUnique({ where: { slug: data.slug } });
    if (existing) throw new ApiError(409, 'That slug is already taken');

    const passwordHash = await hashPassword(data.admin.password);

    const tenant = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          vertical: data.vertical,
          status: 'ACTIVE',
          features: data.features ?? {},
        },
      });
      await tx.user.create({
        data: {
          tenantId: t.id,
          role: 'TENANT_ADMIN',
          name: data.admin.name,
          email: data.admin.email,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      return t;
    });

    res.status(201).json({ tenant });
  })
);

// GET /api/tenants — list all tenants with a passenger + user count
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, passengers: true, vehicles: true } } },
    });
    res.json({ tenants });
  })
);

// GET /api/tenants/:id — full detail incl. the tenant's admin logins
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { users: true, passengers: true, vehicles: true, routes: true } },
        users: {
          where: { role: 'TENANT_ADMIN' },
          select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!tenant) throw new ApiError(404, 'Tenant not found');
    // Expose admins under a clear key; keep raw users out of the payload.
    const { users, ...rest } = tenant;
    res.json({ tenant: { ...rest, admins: users } });
  })
);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL']).optional(),
  features: z.record(z.any()).optional(),
});

// PATCH /api/tenants/:id — rename, suspend/activate, or edit feature flags
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(updateSchema, req.body);
    const tenant = await prisma.tenant
      .update({ where: { id: req.params.id }, data })
      .catch(() => null);
    if (!tenant) throw new ApiError(404, 'Tenant not found');
    res.json({ tenant });
  })
);

// ---- Tenant admin management (super admin sets these logins manually) ----

const adminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

// POST /api/tenants/:id/admins — add another admin login to a tenant
router.post(
  '/:id/admins',
  asyncHandler(async (req, res) => {
    const data = parseOr400(adminSchema, req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) throw new ApiError(404, 'Tenant not found');

    const dupe = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: data.email } });
    if (dupe) throw new ApiError(409, 'That email is already used in this tenant');

    const admin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        role: 'TENANT_ADMIN',
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        status: 'ACTIVE',
      },
      select: { id: true, name: true, email: true, status: true, createdAt: true },
    });
    res.status(201).json({ admin });
  })
);

// POST /api/tenants/:id/admins/:userId/reset-password — set a new password manually
router.post(
  '/:id/admins/:userId/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = parseOr400(z.object({ password: z.string().min(6) }), req.body);
    const admin = await prisma.user.findFirst({
      where: { id: req.params.userId, tenantId: req.params.id, role: 'TENANT_ADMIN' },
    });
    if (!admin) throw new ApiError(404, 'Admin not found for this tenant');

    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(password) },
    });
    res.json({ ok: true, message: 'Password updated' });
  })
);

export default router;
