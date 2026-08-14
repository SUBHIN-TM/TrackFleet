import 'dotenv/config';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { prisma } from './prisma.js';
import { signToken } from './auth.js';
import { attachRealtime } from './realtime.js';

// ============================================================================
// Who may watch a bus.
//
// These rooms carry the live position of somebody's child. Joining one has to
// be exactly as hard as calling the REST endpoint that returns the same data,
// so most of what follows is about who is REFUSED. Every allow test has a deny
// twin one organization over — rule #1 is only real if crossing tenants fails.
//
// Needs a database. It creates its own two organizations and removes them
// again; it touches nothing it did not make.
// ============================================================================

let server, port;
const made = { tenants: [], orgTypeCreated: null };
const F = {}; // fixtures

const connectAs = (token) =>
  new Promise((resolve, reject) => {
    const s = connect(`http://localhost:${port}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 4000,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => { s.close(); reject(err); });
  });

// Resolves to the server's verdict on a subscribe, via the ack.
const subscribe = (socket, channel, id) =>
  new Promise((resolve) => socket.emit(`subscribe:${channel}`, id, resolve));

const refused = async (token) => {
  await assert.rejects(() => connectAs(token));
};

before(async () => {
  const httpServer = http.createServer();
  const ioServer = new SocketServer(httpServer, { cors: { origin: true } });
  attachRealtime(ioServer);
  await new Promise((r) => httpServer.listen(0, r));
  port = httpServer.address().port;
  server = { httpServer, ioServer };

  // An org type is shared platform data, so reuse one if the platform has any.
  let orgType = await prisma.orgType.findFirst();
  if (!orgType) {
    orgType = await prisma.orgType.create({ data: { key: 'test-school', name: 'Test School' } });
    made.orgTypeCreated = orgType.id;
  }

  const makeTenant = async (slug) => {
    const t = await prisma.tenant.create({
      data: { name: `RT ${slug}`, slug: `rt-${slug}-${Date.now()}`, orgTypeId: orgType.id },
    });
    made.tenants.push(t.id);
    return t;
  };
  const makeUser = (tenantId, role, extra = {}) =>
    prisma.user.create({
      data: { tenantId, role, passwordHash: 'x', ...extra },
    });

  // Two organizations that must never see each other.
  F.orgA = await makeTenant('alpha');
  F.orgB = await makeTenant('beta');

  F.superAdmin = await prisma.user.create({
    data: { role: 'SUPER_ADMIN', tenantId: null, email: `rt-super-${Date.now()}@test.local`, passwordHash: 'x' },
  });
  F.adminA = await makeUser(F.orgA.id, 'TENANT_ADMIN');
  F.adminB = await makeUser(F.orgB.id, 'TENANT_ADMIN');
  F.driverA = await makeUser(F.orgA.id, 'DRIVER');
  F.otherDriverA = await makeUser(F.orgA.id, 'DRIVER');
  F.guardianA = await makeUser(F.orgA.id, 'GUARDIAN');
  F.otherGuardianA = await makeUser(F.orgA.id, 'GUARDIAN');
  F.disabledAdminA = await makeUser(F.orgA.id, 'TENANT_ADMIN', { status: 'DISABLED' });

  const makeTrip = async (tenant, driverId) => {
    const vehicle = await prisma.vehicle.create({
      data: { tenantId: tenant.id, regNumber: `KL-${Math.random().toString(36).slice(2, 8)}` },
    });
    const route = await prisma.route.create({ data: { tenantId: tenant.id, name: 'Test Route' } });
    return prisma.trip.create({
      data: {
        tenantId: tenant.id, routeId: route.id, vehicleId: vehicle.id, driverId,
        direction: 'PICKUP', serviceDate: new Date(), status: 'IN_PROGRESS',
      },
    });
  };

  F.tripA = await makeTrip(F.orgA, F.driverA.id);
  F.otherTripA = await makeTrip(F.orgA, F.otherDriverA.id);
  F.tripB = await makeTrip(F.orgB, F.adminB.id);

  // One child, on tripA, belonging to guardianA and to nobody else.
  F.child = await prisma.passenger.create({ data: { tenantId: F.orgA.id, name: 'Test Child' } });
  await prisma.guardianPassenger.create({
    data: { guardianId: F.guardianA.id, passengerId: F.child.id },
  });
  await prisma.tripPassenger.create({ data: { tripId: F.tripA.id, passengerId: F.child.id } });

  F.tokens = Object.fromEntries(
    ['superAdmin', 'adminA', 'adminB', 'driverA', 'otherDriverA', 'guardianA', 'otherGuardianA', 'disabledAdminA']
      .map((k) => [k, signToken(F[k])])
  );
});

after(async () => {
  // TripPassenger points at Passenger, which the tenant cascade won't reach
  // in the right order — clear the join rows first.
  for (const tenantId of made.tenants) {
    const trips = await prisma.trip.findMany({ where: { tenantId }, select: { id: true } });
    const tripIds = trips.map((t) => t.id);
    if (tripIds.length) {
      await prisma.locationPoint.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.tripPassenger.deleteMany({ where: { tripId: { in: tripIds } } });
    }
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  }
  if (F.superAdmin) await prisma.user.delete({ where: { id: F.superAdmin.id } }).catch(() => {});
  if (made.orgTypeCreated) await prisma.orgType.delete({ where: { id: made.orgTypeCreated } }).catch(() => {});
  server?.ioServer.close();
  server?.httpServer.close();
  await prisma.$disconnect();
});

// --- The handshake ---------------------------------------------------------

test('no token, no socket', async () => {
  await refused(undefined);
});

test('a forged token is refused', async () => {
  await refused('not.a.real.token');
});

test('a token signed with the wrong secret is refused', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  await refused(jwt.sign({ userId: F.adminA.id, role: 'TENANT_ADMIN' }, 'wrong-secret'));
});

test('a token for a user who no longer exists is refused', async () => {
  await refused(signToken({ id: 'clnonexistent000000000000', role: 'TENANT_ADMIN', tenantId: F.orgA.id }));
});

test('a DISABLED account loses its live feed immediately, not when its token expires', async () => {
  // The token is valid and unexpired; the user is reloaded on purpose.
  await refused(F.tokens.disabledAdminA);
});

test('a valid token connects', async () => {
  const s = await connectAs(F.tokens.adminA);
  assert.ok(s.connected);
  s.close();
});

// --- Tenant rooms (the whole-fleet board) ----------------------------------

test('an admin may watch their own organization', async () => {
  const s = await connectAs(F.tokens.adminA);
  assert.deepEqual(await subscribe(s, 'tenant', F.orgA.id), { ok: true });
  s.close();
});

test('an admin may NOT watch another organization', async () => {
  const s = await connectAs(F.tokens.adminA);
  assert.deepEqual(await subscribe(s, 'tenant', F.orgB.id), { ok: false });
  s.close();
});

test('a guardian may not watch a whole fleet, not even their own school', async () => {
  const s = await connectAs(F.tokens.guardianA);
  assert.deepEqual(await subscribe(s, 'tenant', F.orgA.id), { ok: false });
  s.close();
});

test('a driver may not watch a whole fleet either', async () => {
  const s = await connectAs(F.tokens.driverA);
  assert.deepEqual(await subscribe(s, 'tenant', F.orgA.id), { ok: false });
  s.close();
});

test('a missing tenant id is a refusal, not a wildcard', async () => {
  const s = await connectAs(F.tokens.adminA);
  assert.deepEqual(await subscribe(s, 'tenant', null), { ok: false });
  assert.deepEqual(await subscribe(s, 'tenant', ''), { ok: false });
  s.close();
});

// --- Trip rooms (one bus) --------------------------------------------------

test('an admin may watch any bus in their own organization', async () => {
  const s = await connectAs(F.tokens.adminA);
  assert.deepEqual(await subscribe(s, 'trip', F.tripA.id), { ok: true });
  assert.deepEqual(await subscribe(s, 'trip', F.otherTripA.id), { ok: true });
  s.close();
});

test('an admin may NOT watch a bus in another organization', async () => {
  const s = await connectAs(F.tokens.adminB);
  assert.deepEqual(await subscribe(s, 'trip', F.tripA.id), { ok: false });
  s.close();
});

test('a driver may watch the trip they are driving', async () => {
  const s = await connectAs(F.tokens.driverA);
  assert.deepEqual(await subscribe(s, 'trip', F.tripA.id), { ok: true });
  s.close();
});

test('a driver may NOT watch a colleague’s trip', async () => {
  const s = await connectAs(F.tokens.driverA);
  assert.deepEqual(await subscribe(s, 'trip', F.otherTripA.id), { ok: false });
  s.close();
});

test('a guardian may watch the bus their child is on', async () => {
  const s = await connectAs(F.tokens.guardianA);
  assert.deepEqual(await subscribe(s, 'trip', F.tripA.id), { ok: true });
  s.close();
});

test('being in the right school does NOT let a guardian watch an arbitrary bus', async () => {
  const s = await connectAs(F.tokens.otherGuardianA);
  assert.deepEqual(await subscribe(s, 'trip', F.tripA.id), { ok: false });
  s.close();
});

test('an unknown trip id is refused rather than joined blind', async () => {
  const s = await connectAs(F.tokens.adminA);
  assert.deepEqual(await subscribe(s, 'trip', 'clnosuchtrip0000000000000'), { ok: false });
  assert.deepEqual(await subscribe(s, 'trip', null), { ok: false });
  s.close();
});

// --- The platform owner ----------------------------------------------------

test('the super admin has no tenant of their own and may watch any of them', async () => {
  const s = await connectAs(F.tokens.superAdmin);
  assert.deepEqual(await subscribe(s, 'tenant', F.orgA.id), { ok: true });
  assert.deepEqual(await subscribe(s, 'tenant', F.orgB.id), { ok: true });
  assert.deepEqual(await subscribe(s, 'trip', F.tripA.id), { ok: true });
  assert.deepEqual(await subscribe(s, 'trip', F.tripB.id), { ok: true });
  s.close();
});

// --- The room actually delivers --------------------------------------------

test('a subscribed watcher receives the pushed fix, and an unsubscribed one does not', async () => {
  const watcher = await connectAs(F.tokens.guardianA);
  const bystander = await connectAs(F.tokens.otherGuardianA);

  await subscribe(watcher, 'trip', F.tripA.id);
  await subscribe(bystander, 'trip', F.tripA.id); // refused above; joins nothing

  const heard = new Promise((resolve) => watcher.once('trip:location', resolve));
  let leaked = null;
  bystander.once('trip:location', (m) => { leaked = m; });

  server.ioServer.to(`trip:${F.tripA.id}`).emit('trip:location', {
    tripId: F.tripA.id, lat: 8.5241, lng: 76.9366, speed: 24, at: '2026-01-01T12:00:00.000Z',
  });

  const msg = await heard;
  assert.equal(msg.lat, 8.5241);
  // The device's own timestamp, not the server's — a queue draining after a
  // blackout replays real positions from minutes ago.
  assert.equal(msg.at, '2026-01-01T12:00:00.000Z');
  assert.equal(leaked, null, 'the refused guardian heard nothing');

  watcher.close();
  bystander.close();
});

test('leaving a room stops the feed', async () => {
  const s = await connectAs(F.tokens.adminA);
  await subscribe(s, 'trip', F.tripA.id);
  s.emit('unsubscribe:trip', F.tripA.id);
  await new Promise((r) => setTimeout(r, 60)); // let the leave land

  let heard = null;
  s.once('trip:location', (m) => { heard = m; });
  server.ioServer.to(`trip:${F.tripA.id}`).emit('trip:location', { tripId: F.tripA.id, lat: 1, lng: 1 });
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(heard, null);
  s.close();
});
