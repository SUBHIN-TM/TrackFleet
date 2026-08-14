import { verifyToken } from './auth.js';
import { prisma } from './prisma.js';

// ============================================================================
// Realtime gateway auth.
//
// The rooms carry live child-bus positions, so joining one is exactly as
// sensitive as calling the REST endpoint that returns the same data — and it
// must be exactly as hard. Before this, `subscribe:tenant` joined any room for
// anyone who could reach the port: no token, no tenant check, nothing. Rule #1
// says every query filters by tenantId; a socket that skips it is the same
// leak by another door.
//
// Two gates:
//   1. the HANDSHAKE — no valid token, no connection at all;
//   2. each SUBSCRIBE — you may only join rooms your role can see.
// ============================================================================

// Who may watch a whole organization's fleet.
const FLEET_ROLES = new Set(['TENANT_ADMIN', 'SUPER_ADMIN']);

// Reject at the handshake so an unauthenticated client never holds a socket.
async function authenticateSocket(socket, next) {
  // `auth` is the socket.io channel for credentials; the header is accepted too
  // so a client that can only set headers isn't locked out.
  const raw = socket.handshake.auth?.token
    || (socket.handshake.headers?.authorization || '').replace(/^Bearer /, '');
  if (!raw) return next(new Error('unauthorized'));

  let payload;
  try {
    payload = verifyToken(raw);
  } catch {
    return next(new Error('unauthorized'));
  }

  // Reload rather than trusting the token body: a disabled account must lose
  // its live feed immediately, not whenever its 7-day token happens to expire.
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, tenantId: true, status: true },
  });
  if (!user || user.status === 'DISABLED') return next(new Error('unauthorized'));

  socket.data.user = user;
  next();
}

// May this user watch this whole tenant's fleet?
function canWatchTenant(user, tenantId) {
  if (!tenantId) return false;
  // The platform owner has no tenant of their own and legitimately watches all.
  if (user.role === 'SUPER_ADMIN') return true;
  return FLEET_ROLES.has(user.role) && user.tenantId === tenantId;
}

// May this user watch this one trip?
async function canWatchTrip(user, tripId) {
  if (!tripId) return false;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, tenantId: true, driverId: true },
  });
  if (!trip) return false;

  if (user.role === 'SUPER_ADMIN') return true;
  // Everyone else must at minimum be inside the same organization.
  if (user.tenantId !== trip.tenantId) return false;

  if (user.role === 'TENANT_ADMIN') return true;
  if (user.role === 'DRIVER') return trip.driverId === user.id;

  // A guardian follows their own children and nobody else's — being in the
  // right school is not enough to watch an arbitrary bus.
  if (user.role === 'GUARDIAN') {
    const link = await prisma.tripPassenger.findFirst({
      where: { tripId, passenger: { guardians: { some: { guardianId: user.id } } } },
      select: { id: true },
    });
    return Boolean(link);
  }

  return false;
}

export function attachRealtime(io) {
  io.use((socket, next) => {
    authenticateSocket(socket, next).catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    // Clients join a room per trip so parents only get their bus, and admins a
    // room per tenant for the whole-fleet live board. `ack` lets a client tell
    // "denied" from "subscribed but the bus hasn't moved yet" — silence would
    // otherwise look identical to a working feed.
    socket.on('subscribe:trip', async (tripId, ack) => {
      const allowed = await canWatchTrip(user, tripId).catch(() => false);
      if (allowed) socket.join(`trip:${tripId}`);
      if (typeof ack === 'function') ack({ ok: allowed });
    });

    socket.on('unsubscribe:trip', (tripId) => socket.leave(`trip:${tripId}`));

    socket.on('subscribe:tenant', (tenantId, ack) => {
      const allowed = canWatchTenant(user, tenantId);
      if (allowed) socket.join(`tenant:${tenantId}`);
      if (typeof ack === 'function') ack({ ok: allowed });
    });

    socket.on('unsubscribe:tenant', (tenantId) => socket.leave(`tenant:${tenantId}`));
  });
}
