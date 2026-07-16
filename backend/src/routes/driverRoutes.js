import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { generateTempPassword } from '../lib/password.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, authorize('TENANT_ADMIN'), requireTenant);

const publicDriver = {
  id: true,
  name: true,
  email: true,
  loginId: true,
  phone: true,
  status: true,
  // Re-viewable sign-in password (null once the driver sets their own). This
  // endpoint is TENANT_ADMIN-only, so it's safe to include for the details panel.
  provisionalPassword: true,
  createdAt: true,
  driverProfile: { select: { licenseNumber: true, photoUrl: true } },
};

// Next free "DRV-NN" code for a tenant. Scans existing codes and takes max+1 so
// gaps from deleted drivers don't cause collisions; the unique index is the
// final backstop against a race. Zero-padded to 2, grows past 99 naturally.
async function nextDriverLoginId(tx, tenantId) {
  const drivers = await tx.user.findMany({
    where: { tenantId, loginId: { startsWith: 'DRV-' } },
    select: { loginId: true },
  });
  let max = 0;
  for (const d of drivers) {
    const m = /^DRV-(\d+)$/.exec(d.loginId || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `DRV-${String(max + 1).padStart(2, '0')}`;
}

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
  // Optional — most drivers have none. If given, it must be unique in the org.
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  licenseNumber: z.string().optional(),
});

// POST /api/drivers — mints a login code (DRV-NN) + a temp password. The driver
// has no mailbox, so the password is stored (provisionalPassword) and stays
// re-viewable by the admin until the driver changes it themselves.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);
    const email = data.email || null;
    if (email) {
      const exists = await prisma.user.findFirst({ where: { tenantId: req.tenantId, email } });
      if (exists) throw new ApiError(409, 'A user with that email already exists in this organization');
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const driver = await prisma.$transaction(async (tx) => {
      const loginId = await nextDriverLoginId(tx, req.tenantId);
      return tx.user.create({
        data: {
          tenantId: req.tenantId,
          role: 'DRIVER',
          name: data.name,
          email,
          loginId,
          phone: data.phone,
          passwordHash,
          // The admin owns this password — the driver can't change it — so it
          // stays re-viewable here. Changed only via the admin's reset action.
          provisionalPassword: tempPassword,
          // Never force a driver-side password change: they sign straight in.
          mustChangePassword: false,
          driverProfile: { create: { licenseNumber: data.licenseNumber } },
        },
        select: publicDriver,
      });
    });

    res.status(201).json({ driver });
  })
);

// POST /api/drivers/:id/reset-password — set a new password. The admin may pass
// their own `password`; if omitted we generate one. Either way it's stored
// re-viewable (provisionalPassword) since the admin owns driver credentials.
const resetSchema = z.object({ password: z.string().min(6, 'use at least 6 characters').optional() });
router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = parseOr400(resetSchema, req.body ?? {});
    const driver = await prisma.user.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId, role: 'DRIVER' },
    });
    if (!driver) throw new ApiError(404, 'Driver not found');

    const newPassword = password || generateTempPassword();
    const updated = await prisma.user.update({
      where: { id: driver.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        provisionalPassword: newPassword,
        mustChangePassword: false,
      },
      select: publicDriver,
    });
    res.json({ driver: updated });
  })
);

// DELETE /api/drivers/:id — soft delete. Disable the login but keep the record
// (trips reference the driver). Re-enable later by setting status ACTIVE.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await prisma.user.updateMany({
      where: { id: req.params.id, tenantId: req.tenantId, role: 'DRIVER' },
      data: { status: 'DISABLED' },
    });
    if (result.count === 0) throw new ApiError(404, 'Driver not found');
    res.status(204).end();
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
