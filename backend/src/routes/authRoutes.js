import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyPassword, signToken } from '../lib/auth.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Tenant users (admin/parent/driver) log in via their org's portal, which
  // supplies the tenant slug. Super admins omit it.
  tenantSlug: z.string().optional(),
});

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, tenantSlug } = parseOr400(loginSchema, req.body);

    let tenantId = null;
    if (tenantSlug) {
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) throw new ApiError(401, 'Invalid credentials');
      if (tenant.status === 'SUSPENDED') throw new ApiError(403, 'This organization is suspended');
      tenantId = tenant.id;
    }

    const user = await prisma.user.findFirst({
      where: { email, tenantId },
    });
    if (!user) throw new ApiError(401, 'Invalid credentials');

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Invalid credentials');
    if (user.status === 'DISABLED') throw new ApiError(403, 'Account disabled');

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

export default router;
