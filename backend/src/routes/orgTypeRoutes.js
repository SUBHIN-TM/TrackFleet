import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Organization types are platform-wide config — super-admin-only.
router.use(authenticate, authorize('SUPER_ADMIN'));

const withCount = { _count: { select: { tenants: true } } };

// `key` is the stable code other code may branch on, so it is set once at
// creation and never editable — renaming is what `name` is for.
const createSchema = z.object({
  key: z
    .string()
    .min(2)
    .regex(/^[A-Za-z0-9_]+$/, 'key must be letters, numbers, or underscores')
    .transform((s) => s.toUpperCase()),
  name: z.string().min(2),
  active: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  active: z.boolean().optional(),
});

// GET /api/org-types — list with the org count that drives the delete guard
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const orgTypes = await prisma.orgType.findMany({
      orderBy: { name: 'asc' },
      include: withCount,
    });
    res.json({ orgTypes });
  })
);

// POST /api/org-types
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);

    const clash = await prisma.orgType.findFirst({
      where: { OR: [{ key: data.key }, { name: data.name }] },
    });
    if (clash) {
      throw new ApiError(409, clash.key === data.key
        ? `Key "${data.key}" is already used by ${clash.name}`
        : `An organization type named "${data.name}" already exists`);
    }

    const orgType = await prisma.orgType.create({ data, include: withCount });
    res.status(201).json({ orgType });
  })
);

// PATCH /api/org-types/:id
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(updateSchema, req.body);

    if (data.name) {
      const clash = await prisma.orgType.findFirst({
        where: { name: data.name, NOT: { id: req.params.id } },
      });
      if (clash) throw new ApiError(409, `An organization type named "${data.name}" already exists`);
    }

    const orgType = await prisma.orgType
      .update({ where: { id: req.params.id }, data, include: withCount })
      .catch(() => null);
    if (!orgType) throw new ApiError(404, 'Organization type not found');
    res.json({ orgType });
  })
);

// DELETE /api/org-types/:id — blocked while any org still uses it.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const orgType = await prisma.orgType.findUnique({
      where: { id: req.params.id },
      include: withCount,
    });
    if (!orgType) throw new ApiError(404, 'Organization type not found');

    const inUse = orgType._count.tenants;
    if (inUse > 0) {
      throw new ApiError(
        409,
        `${inUse} ${inUse === 1 ? 'organization still uses' : 'organizations still use'} "${orgType.name}". ` +
          'Move them to another type first, or deactivate this one to hide it from new organizations.'
      );
    }

    await prisma.orgType.delete({ where: { id: orgType.id } });
    res.json({ ok: true });
  })
);

export default router;
