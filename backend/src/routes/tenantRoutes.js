import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/auth.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { buildSlug, normalizeSlug, rootIsReserved, slugRoot } from '../lib/slug.js';
import { generateTempPassword } from '../lib/password.js';
import { sendAdminInvite } from '../lib/mailer.js';
import { notifyUser, notifySuperAdmins } from '../lib/notify.js';

const router = Router();

// Everything here is super-admin-only.
router.use(authenticate, authorize('SUPER_ADMIN'));

const createSchema = z.object({
  name: z.string().min(2),
  // slug (login id) is optional — auto-generated from the name when omitted.
  // Supply the root only ("greenvalley"); the TF- prefix is added for you.
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/, 'login id must be letters, numbers, or dashes')
    .optional(),
  orgTypeId: z.string().min(1, 'pick an organization type'),
  features: z.record(z.any()).optional(),
  // The super admin never picks a password — the admin is emailed a temp one and
  // chooses their own. The name is only a placeholder ("Primary Admin") until
  // someone supplies the real one; both sides can edit it later.
  admin: z.object({
    email: z.string().email(),
    name: z.string().min(2).optional(),
  }),
});

// Placeholder shown until the real person tells us their name. Numbered so a
// second or third login is distinguishable at a glance.
const placeholderAdminName = (n) => (n === 0 ? 'Primary Admin' : `Admin ${n + 1}`);

const isFree = async (slug) => !(await prisma.tenant.findUnique({ where: { slug } }));

// POST /api/tenants — provision a tenant + its first Tenant Admin
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parseOr400(createSchema, req.body);

    // Fail with a readable message rather than a raw FK violation.
    const orgType = await prisma.orgType.findUnique({ where: { id: data.orgTypeId } });
    if (!orgType) throw new ApiError(400, 'That organization type does not exist');
    if (!orgType.active) throw new ApiError(400, `"${orgType.name}" is inactive and cannot take new organizations`);

    // An explicit login id from the super admin wins, but must still be free.
    let slug = data.slug ? buildSlug(normalizeSlug(data.slug)) : null;
    if (slug && !(await isFree(slug))) throw new ApiError(409, 'That login id is already taken');

    // Otherwise derive it from the name. The bare form is preferred; when it is
    // taken (or reserved) we fall back to appending the tenant's `code`, which
    // the db only assigns on insert — hence the placeholder-then-rewrite below.
    const root = slugRoot(data.name);
    const preferred = buildSlug(root);
    if (!slug && !rootIsReserved(root) && (await isFree(preferred))) slug = preferred;

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const tenant = await prisma.$transaction(async (tx) => {
      let t = await tx.tenant.create({
        data: {
          name: data.name,
          slug: slug ?? `pending-${randomUUID()}`,
          orgTypeId: data.orgTypeId,
          status: 'ACTIVE',
          features: data.features ?? {},
        },
      });

      if (!slug) {
        // `code` is unique, so "tf-greenvalley-1002" cannot collide.
        t = await tx.tenant.update({
          where: { id: t.id },
          data: { slug: `${preferred}-${t.code}` },
        });
      }

      const admin = await tx.user.create({
        data: {
          tenantId: t.id,
          role: 'TENANT_ADMIN',
          // Placeholder unless the super admin was told the real name; the
          // admin can correct it during first-login setup or in their profile.
          name: data.admin.name || placeholderAdminName(0),
          email: data.admin.email,
          passwordHash,
          status: 'ACTIVE',
          mustChangePassword: true,
        },
      });
      return { tenant: t, admin };
    });
    const { tenant: createdTenant, admin: createdAdmin } = tenant;

    // Sent after the commit — an SMTP hiccup must not roll back a created org.
    // If it fails the org still exists, so say so plainly and let the super
    // admin resend rather than pretending the invite went out.
    let invite = { sent: true };
    try {
      await sendAdminInvite({
        to: data.admin.email,
        orgName: createdTenant.name,
        loginId: createdTenant.slug.toUpperCase(),
        tempPassword,
      });
    } catch (err) {
      console.error('Invite email failed:', err);
      invite = { sent: false, error: err.message };
    }

    // In-app notifications: greet the freshly invited admin (they'll see it on
    // first login) and log the new org on the super admin's bell.
    const loginId = createdTenant.slug.toUpperCase();
    await notifyUser(createdAdmin.id, {
      type: 'WELCOME',
      title: 'Welcome to TrackFleet 🎉',
      body: `Your workspace for ${createdTenant.name} is ready. Finish setup to start managing your fleet.`,
      tenantId: createdTenant.id,
      data: { orgName: createdTenant.name, loginId },
    });
    await notifySuperAdmins({
      type: 'TENANT_CREATED',
      title: 'New organization created',
      body: `${createdTenant.name} (${loginId}) was added. An invite was emailed to ${data.admin.email}.`,
      tenantId: createdTenant.id,
      data: { orgName: createdTenant.name, loginId, adminEmail: data.admin.email },
    });

    res.status(201).json({ tenant: createdTenant, invite });
  })
);

// GET /api/tenants — list all tenants with a passenger + user count
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        orgType: true,
        _count: { select: { users: true, passengers: true, vehicles: true } },
      },
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
        orgType: true,
        _count: { select: { users: true, passengers: true, vehicles: true, routes: true } },
        users: {
          where: { role: 'TENANT_ADMIN' },
          select: {
            id: true, name: true, email: true, phone: true, status: true, createdAt: true,
            // Lets the UI show who has actually completed first-login setup.
            emailVerifiedAt: true, mustChangePassword: true,
          },
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
  // Lets a super admin move orgs off a type they want to retire.
  orgTypeId: z.string().min(1).optional(),
});

// PATCH /api/tenants/:id — rename, suspend/activate, retype, or edit flags
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = parseOr400(updateSchema, req.body);

    if (data.orgTypeId) {
      const orgType = await prisma.orgType.findUnique({ where: { id: data.orgTypeId } });
      if (!orgType) throw new ApiError(400, 'That organization type does not exist');
    }

    const tenant = await prisma.tenant
      .update({ where: { id: req.params.id }, data, include: { orgType: true } })
      .catch(() => null);
    if (!tenant) throw new ApiError(404, 'Tenant not found');
    res.json({ tenant });
  })
);

// ---- Tenant admin management (invite by email; they set their own password) ----

const adminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).optional(),
});

const adminFields = {
  id: true, name: true, email: true, status: true, createdAt: true,
  emailVerifiedAt: true, mustChangePassword: true,
};

// POST /api/tenants/:id/admins — invite another admin to a tenant
router.post(
  '/:id/admins',
  asyncHandler(async (req, res) => {
    const data = parseOr400(adminSchema, req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) throw new ApiError(404, 'Tenant not found');

    const dupe = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: data.email } });
    if (dupe) throw new ApiError(409, 'That email is already used in this tenant');

    // Numbered off the existing admins, so the second login reads "Admin 2".
    const existing = await prisma.user.count({ where: { tenantId: tenant.id, role: 'TENANT_ADMIN' } });

    const tempPassword = generateTempPassword();
    const admin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        role: 'TENANT_ADMIN',
        name: data.name || placeholderAdminName(existing),
        email: data.email,
        passwordHash: await hashPassword(tempPassword),
        status: 'ACTIVE',
        mustChangePassword: true,
      },
      select: adminFields,
    });

    let invite = { sent: true };
    try {
      await sendAdminInvite({
        to: data.email, orgName: tenant.name,
        loginId: tenant.slug.toUpperCase(), tempPassword,
      });
    } catch (err) {
      console.error('Invite email failed:', err);
      invite = { sent: false, error: err.message };
    }

    const loginId = tenant.slug.toUpperCase();
    await notifyUser(admin.id, {
      type: 'WELCOME',
      title: 'Welcome to TrackFleet 🎉',
      body: `You’ve been added as an admin for ${tenant.name}. Finish setup to get started.`,
      tenantId: tenant.id,
      data: { orgName: tenant.name, loginId },
    });
    await notifySuperAdmins({
      type: 'ADMIN_INVITED',
      title: 'New admin invited',
      body: `${data.email} was invited as an admin of ${tenant.name}.`,
      tenantId: tenant.id,
      data: { orgName: tenant.name, loginId, adminEmail: data.email },
    });

    res.status(201).json({ admin, invite });
  })
);

// PATCH /api/tenants/:id/admins/:userId — rename an admin, for when the
// organization tells you who the login actually belongs to. Name only: a super
// admin has no business editing anyone's email or password.
router.patch(
  '/:id/admins/:userId',
  asyncHandler(async (req, res) => {
    const { name } = parseOr400(z.object({ name: z.string().min(2) }), req.body);
    const found = await prisma.user.findFirst({
      where: { id: req.params.userId, tenantId: req.params.id, role: 'TENANT_ADMIN' },
    });
    if (!found) throw new ApiError(404, 'Admin not found for this tenant');

    const admin = await prisma.user.update({
      where: { id: found.id },
      data: { name },
      select: adminFields,
    });
    res.json({ admin });
  })
);

// POST /api/tenants/:id/admins/:userId/resend-invite — issue a fresh temp
// password and email it again. Replaces the old "super admin types a password"
// flow: nobody but the admin should ever know their password.
router.post(
  '/:id/admins/:userId/resend-invite',
  asyncHandler(async (req, res) => {
    const admin = await prisma.user.findFirst({
      where: { id: req.params.userId, tenantId: req.params.id, role: 'TENANT_ADMIN' },
      include: { tenant: true },
    });
    if (!admin) throw new ApiError(404, 'Admin not found for this tenant');

    const tempPassword = generateTempPassword();
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        passwordHash: await hashPassword(tempPassword),
        // Re-inviting resets the whole first-login flow: prove the mailbox
        // again, then choose a new password.
        mustChangePassword: true,
        emailVerifiedAt: null,
      },
    });

    await sendAdminInvite({
      to: admin.email,
      orgName: admin.tenant.name,
      loginId: admin.tenant.slug.toUpperCase(),
      tempPassword,
    });

    res.json({ ok: true, message: `A new invite was emailed to ${admin.email}` });
  })
);

export default router;
