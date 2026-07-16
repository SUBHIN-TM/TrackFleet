import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError, parseOr400 } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Every route here is "my notifications" — a user only ever sees their own,
// so all queries are scoped to req.user.id. No role gate needed: super admins
// and tenant admins alike have a bell.
router.use(authenticate);

// GET /api/notifications?limit=30 — latest first, plus the unread count for the
// badge. One round-trip powers the whole dropdown.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit } = parseOr400(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
      req.query
    );

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({ where: { userId: req.user.id, read: false } }),
    ]);

    res.json({ notifications, unreadCount });
  })
);

// POST /api/notifications/:id/read — mark a single one read. Scoped by userId in
// the where-clause so nobody can flip someone else's notification.
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { read: true },
    });
    if (!count) throw new ApiError(404, 'Notification not found');
    res.json({ ok: true });
  })
);

// POST /api/notifications/read-all — clear the badge in one go.
router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
    res.json({ ok: true, updated: count });
  })
);

export default router;
