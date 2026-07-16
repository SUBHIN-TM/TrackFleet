import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyPassword, signToken, hashPassword } from '../lib/auth.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { normalizeSlug } from '../lib/slug.js';
import { issueOtp, consumeOtp, signChallenge, readChallenge, OTP_TTL_MINUTES } from '../lib/otp.js';
import { notifyUser, notifySuperAdmins } from '../lib/notify.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, loginId: u.loginId, role: u.role, tenantId: u.tenantId,
  // The admin portal shows the org name (not "School Admin") in its top bar, so
  // include it whenever the record was loaded with its tenant. Null for super
  // admins, who have no tenant.
  tenantName: u.tenant?.name ?? null,
  tenantSlug: u.tenant?.slug ?? null,
});

const loginSchema = z
  .object({
    // Admins/guardians sign in by email; drivers by their org login code
    // (DRV-01). Exactly one identifier is supplied by whichever app is calling.
    // trim() first: a copy-pasted trailing space must not fail the login.
    email: z.string().trim().email().optional(),
    loginId: z.string().min(1).optional().transform((s) => (s ? s.trim().toUpperCase() : s)),
    password: z.string().min(1),
    // Tenant users (admin/parent/driver) log in via their org's portal, which
    // supplies the tenant slug. Super admins omit it. Normalized because people
    // type the "TF-INTERVAL" form printed on their welcome email.
    tenantSlug: z.string().optional().transform((s) => (s ? normalizeSlug(s) : s)),
  })
  .refine((d) => d.email || d.loginId, { message: 'Enter your email or driver ID', path: ['email'] });

// Resolves the tenant + user for a login attempt. Every failure is the same
// 401 so this can't be used to discover which orgs, emails, or codes exist. A
// loginId always resolves within a tenant (drivers have no email); an email may
// resolve globally (super admin) or within a tenant.
async function findLoginUser({ email, loginId, tenantSlug }) {
  let tenantId = null;
  if (tenantSlug) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new ApiError(401, 'Invalid credentials');
    if (tenant.status === 'SUSPENDED') throw new ApiError(403, 'This organization is suspended');
    tenantId = tenant.id;
  }
  // A driver code is only meaningful inside its org.
  if (loginId && !tenantId) throw new ApiError(401, 'Invalid credentials');
  const where = loginId ? { loginId, tenantId } : { email, tenantId };
  const user = await prisma.user.findFirst({ where, include: { tenant: true } });
  if (!user) throw new ApiError(401, 'Invalid credentials');
  return user;
}

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, loginId, password, tenantSlug } = parseOr400(loginSchema, req.body);
    const user = await findLoginUser({ email, loginId, tenantSlug });

    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, 'Invalid credentials');
    }
    if (user.status === 'DISABLED') throw new ApiError(403, 'Account disabled');

    // First login: prove the mailbox before any session exists. Only for admins,
    // who sign in BY email. Drivers sign in by code and guardians by phone —
    // neither uses email as a credential, so both skip straight through.
    if (!['DRIVER', 'GUARDIAN'].includes(user.role) && user.email && !user.emailVerifiedAt) {
      await issueOtp(user, 'VERIFY_EMAIL');
      return res.json({
        step: 'VERIFY_EMAIL',
        challengeToken: signChallenge(user, 'VERIFY_EMAIL'),
        email: user.email,
        expiresInMinutes: OTP_TTL_MINUTES,
      });
    }

    // Invited admin who hasn't replaced the emailed temp password yet.
    if (user.mustChangePassword) {
      return res.json({
        step: 'SET_PASSWORD',
        challengeToken: signChallenge(user, 'SET_PASSWORD'),
        email: user.email,
      });
    }

    res.json({ step: 'DONE', token: signToken(user), user: publicUser(user) });
  })
);

// POST /api/auth/verify-otp — completes the first-login mailbox check.
router.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
    const { challengeToken, code } = parseOr400(
      z.object({ challengeToken: z.string().min(1), code: z.string().regex(/^\d{6}$/, 'enter the 6-digit code') }),
      req.body
    );

    const userId = readChallenge(challengeToken, 'VERIFY_EMAIL');
    await consumeOtp(userId, 'VERIFY_EMAIL', code);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
      include: { tenant: true },
    });

    // Invited admins go straight on to replacing the temp password.
    if (user.mustChangePassword) {
      return res.json({ step: 'SET_PASSWORD', challengeToken: signChallenge(user, 'SET_PASSWORD'), email: user.email });
    }
    res.json({ step: 'DONE', token: signToken(user), user: publicUser(user) });
  })
);

// POST /api/auth/set-password — replaces the emailed temp password.
router.post(
  '/set-password',
  asyncHandler(async (req, res) => {
    const { challengeToken, password, name } = parseOr400(
      z.object({
        challengeToken: z.string().min(1),
        password: z.string().min(8, 'use at least 8 characters'),
        name: z.string().min(2).optional(),
      }),
      req.body
    );

    const userId = readChallenge(challengeToken, 'SET_PASSWORD');
    const current = await prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
    if (!current) throw new ApiError(401, 'This session expired — please sign in again');

    // Reusing the emailed password would leave a live credential sitting in
    // their inbox, which is the whole reason for this step.
    if (await verifyPassword(password, current.passwordHash)) {
      throw new ApiError(400, 'Choose a different password from the temporary one we emailed you');
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        // A chosen password must never remain re-viewable by the admin.
        provisionalPassword: null,
        emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
        ...(name ? { name } : {}),
      },
      include: { tenant: true },
    });

    // Onboarding is now complete: greet the admin and let the super admin know
    // this invite turned into a real, active account. Best-effort — a failed
    // notification must not stop them getting their session token.
    if (user.role === 'TENANT_ADMIN') {
      const who = user.name || user.email;
      const orgName = current.tenant?.name || 'their organization';
      await notifyUser(user.id, {
        type: 'ACCOUNT_READY',
        title: 'You’re all set 🎉',
        body: `Your password is set and your ${orgName} account is active. Welcome aboard!`,
        tenantId: user.tenantId,
      });
      await notifySuperAdmins({
        type: 'ADMIN_ONBOARDED',
        title: 'Admin activated their account',
        body: `${who} set their password and signed in to ${orgName}.`,
        tenantId: user.tenantId,
        data: { adminName: who, adminEmail: user.email, orgName },
      });
    }

    res.json({ step: 'DONE', token: signToken(user), user: publicUser(user) });
  })
);

// POST /api/auth/forgot-password — the client passes whatever is already in the
// login form, so the admin never retypes their email.
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email, tenantSlug } = parseOr400(
      z.object({
        email: z.string().trim().email(),
        tenantSlug: z.string().optional().transform((s) => (s ? normalizeSlug(s) : s)),
      }),
      req.body
    );

    // Always answers the same way: whether an account exists is not public.
    const generic = { ok: true, expiresInMinutes: OTP_TTL_MINUTES };

    let user;
    try {
      user = await findLoginUser({ email, tenantSlug });
    } catch {
      return res.json(generic);
    }
    if (user.status === 'DISABLED') return res.json(generic);

    try {
      await issueOtp(user, 'RESET_PASSWORD');
    } catch (err) {
      // A rate limit is worth surfacing; anything else stays generic.
      if (err.status === 429) throw err;
      return res.json(generic);
    }

    res.json({ ...generic, challengeToken: signChallenge(user, 'RESET_PASSWORD') });
  })
);

// POST /api/auth/reset-password — OTP + new password, in one step.
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { challengeToken, code, password } = parseOr400(
      z.object({
        challengeToken: z.string().min(1),
        code: z.string().regex(/^\d{6}$/, 'enter the 6-digit code'),
        password: z.string().min(8, 'use at least 8 characters'),
      }),
      req.body
    );

    const userId = readChallenge(challengeToken, 'RESET_PASSWORD');
    await consumeOtp(userId, 'RESET_PASSWORD', code);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        provisionalPassword: null,
        // Receiving the code proves the mailbox, which is what verification is.
        emailVerifiedAt: new Date(),
      },
      include: { tenant: true },
    });

    res.json({ step: 'DONE', token: signToken(user), user: publicUser(user) });
  })
);

// POST /api/auth/resend-otp — same code path, new email.
router.post(
  '/resend-otp',
  asyncHandler(async (req, res) => {
    const { challengeToken, purpose } = parseOr400(
      z.object({
        challengeToken: z.string().min(1),
        purpose: z.enum(['VERIFY_EMAIL', 'RESET_PASSWORD']),
      }),
      req.body
    );

    const userId = readChallenge(challengeToken, purpose);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(401, 'This session expired — please sign in again');

    await issueOtp(user, purpose);
    res.json({ ok: true, expiresInMinutes: OTP_TTL_MINUTES });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    // Reload with the tenant so the response carries the org name/slug, matching
    // the shape the login endpoints return.
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { tenant: true } });
    res.json({ user: publicUser(user) });
  })
);

// PATCH /api/auth/profile — anyone signed in can correct their own name. Orgs
// are invited under a placeholder ("Primary Admin"), so this is how the real
// person fixes it without going through the super admin.
router.patch(
  '/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const { name } = parseOr400(z.object({ name: z.string().min(2) }), req.body);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name },
      include: { tenant: true },
    });
    res.json({ user: publicUser(user) });
  })
);

export default router;
