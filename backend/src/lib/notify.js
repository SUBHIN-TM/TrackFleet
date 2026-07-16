import { prisma } from './prisma.js';

// In-app notifications. These are the little bell-icon messages the super admin
// and tenant admins see in their portals — NOT emails (those live in mailer.js).
//
// The golden rule here: creating a notification is a side effect that must never
// break the thing that triggered it. If provisioning an org succeeds but writing
// the "welcome" note fails, the org must still exist. So every function below
// logs and swallows its own errors rather than throwing at the call site.

// Write one notification for one recipient. Returns the row, or null on failure.
export async function notifyUser(userId, { type, title, body, tenantId = null, data = {} }) {
  try {
    return await prisma.notification.create({
      data: { userId, tenantId, type, title, body, data },
    });
  } catch (err) {
    console.error(`notifyUser(${userId}, ${type}) failed:`, err.message);
    return null;
  }
}

// Fan a notification out to every platform owner. There is usually just one
// super admin, but the platform allows several, and each should see it.
export async function notifySuperAdmins({ type, title, body, tenantId = null, data = {} }) {
  try {
    const supers = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });
    if (!supers.length) return [];
    await prisma.notification.createMany({
      data: supers.map((s) => ({ userId: s.id, tenantId, type, title, body, data })),
    });
    return supers.map((s) => s.id);
  } catch (err) {
    console.error(`notifySuperAdmins(${type}) failed:`, err.message);
    return [];
  }
}
