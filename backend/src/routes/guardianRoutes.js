import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/http.js';
import { authenticate, authorize } from '../middleware/auth.js';

// Parent-portal API. Guardians sign in by org + phone + password and only ever
// see their own linked passengers.
const router = Router();
router.use(authenticate, authorize('GUARDIAN'));

// GET /api/guardian/children — the passengers linked to this guardian, each with
// their assigned stop + route so the parent knows where their child boards.
router.get(
  '/children',
  asyncHandler(async (req, res) => {
    const links = await prisma.guardianPassenger.findMany({
      where: { guardianId: req.user.id },
      include: {
        passenger: {
          include: {
            stopAssignments: {
              include: { stop: { include: { route: { select: { name: true, direction: true } } } } },
            },
          },
        },
      },
    });

    const children = links
      .filter((l) => l.passenger.active)
      .map((l) => {
        const stop = l.passenger.stopAssignments[0]?.stop || null;
        return {
          id: l.passenger.id,
          name: l.passenger.name,
          category: l.passenger.category,
          relation: l.relation,
          phone: l.passenger.phone,
          stop: stop
            ? { name: stop.name, scheduledTime: stop.scheduledTime, route: stop.route?.name, direction: stop.route?.direction }
            : null,
        };
      });

    res.json({ children });
  })
);

export default router;
