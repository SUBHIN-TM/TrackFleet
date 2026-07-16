// ============================================================================
// QA: full live-trip flow, end to end, against the running dev server.
//
//  1. Ensures QA fixtures exist (schedule for DRV-01 today, a QA admin, a QA
//     guardian linked to a passenger on the route) — via Prisma.
//  2. Runs the real HTTP flow: driver starts trip → streams GPS → boards
//     passengers → admin watches /today + /live → guardian watches
//     /guardian/live → driver ends trip.
//
//  Run:  node scripts/qa-live-flow.js   (server must be up on :4004)
// ============================================================================
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/auth.js';

const API = 'http://localhost:4004';
const ok = (label) => console.log(`  ✅ ${label}`);
const fail = (label, extra) => { console.error(`  ❌ ${label}`, extra || ''); process.exitCode = 1; };

async function http(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ---------- 1. fixtures ----------
console.log('— Fixtures —');
const tenant = await prisma.tenant.findUnique({ where: { slug: 'tf-interval' } });
if (!tenant) { fail('tenant tf-interval not found'); process.exit(1); }

const driver = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'DRIVER', loginId: 'DRV-01' } });
if (!driver) { fail('driver DRV-01 not found'); process.exit(1); }

// A route that has stops and at least one active passenger.
const route = await prisma.route.findFirst({
  where: { tenantId: tenant.id, active: true, stops: { some: {} }, passengers: { some: { active: true } } },
  include: { stops: { orderBy: { sequence: 'asc' } }, passengers: { where: { active: true } } },
});
if (!route) { fail('no route with stops + passengers — assign passengers to a route first'); process.exit(1); }
ok(`route "${route.name}" — ${route.stops.length} stops, ${route.passengers.length} passengers`);

const vehicle = await prisma.vehicle.findFirst({ where: { tenantId: tenant.id, active: true } });
const dow = ((new Date().getDay() + 6) % 7) + 1;

let schedule = await prisma.tripSchedule.findFirst({ where: { tenantId: tenant.id, name: 'QA Live Run' } });
if (!schedule) {
  schedule = await prisma.tripSchedule.create({
    data: {
      tenantId: tenant.id, name: 'QA Live Run', routeId: route.id, vehicleId: vehicle.id,
      driverId: driver.id, direction: 'PICKUP', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: '07:00',
    },
  });
} else {
  schedule = await prisma.tripSchedule.update({
    where: { id: schedule.id },
    data: { driverId: driver.id, routeId: route.id, vehicleId: vehicle.id, active: true, daysOfWeek: [1, 2, 3, 4, 5, 6, 7] },
  });
}
ok(`schedule "QA Live Run" assigned to ${driver.name} (runs every day incl. today=${dow})`);

// QA admin (known password, no OTP dance).
const qaAdminEmail = 'qa-admin@trackfleet.local';
let qaAdmin = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: qaAdminEmail } });
if (!qaAdmin) {
  qaAdmin = await prisma.user.create({
    data: {
      tenantId: tenant.id, role: 'TENANT_ADMIN', email: qaAdminEmail, name: 'QA Admin',
      passwordHash: await hashPassword('QaAdmin123'), emailVerifiedAt: new Date(), mustChangePassword: false,
    },
  });
}
ok('QA admin ready (qa-admin@trackfleet.local / QaAdmin123)');

// QA guardian linked to the route's first passenger.
const kid = route.passengers[0];
const qaPhone = '9999000001';
let qaGuardian = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'GUARDIAN', loginId: qaPhone } });
if (!qaGuardian) {
  qaGuardian = await prisma.user.create({
    data: {
      tenantId: tenant.id, role: 'GUARDIAN', name: 'QA Parent', phone: qaPhone, loginId: qaPhone,
      passwordHash: await hashPassword('QaParent123'), provisionalPassword: 'QaParent123', mustChangePassword: false,
    },
  });
}
await prisma.guardianPassenger.upsert({
  where: { guardianId_passengerId: { guardianId: qaGuardian.id, passengerId: kid.id } },
  create: { guardianId: qaGuardian.id, passengerId: kid.id, relation: 'Parent' },
  update: {},
});
ok(`QA guardian linked to passenger "${kid.name}" (${qaPhone} / QaParent123)`);

// Clean any leftover active QA trip from a previous run so /start creates fresh.
const stale = await prisma.trip.findMany({ where: { scheduleId: schedule.id, status: { in: ['STARTED', 'IN_PROGRESS'] } } });
for (const t of stale) await prisma.trip.update({ where: { id: t.id }, data: { status: 'CANCELLED', endedAt: new Date() } });
if (stale.length) ok(`cancelled ${stale.length} stale QA trip(s)`);

// ---------- 2. the live flow over HTTP ----------
console.log('\n— Driver flow —');
let r = await http('/api/auth/login', { method: 'POST', body: { tenantSlug: 'TF-INTERVAL', loginId: 'DRV-01', password: '123456' } });
r.data.token ? ok('driver signed in') : fail('driver login', r.data);
const dTok = r.data.token;

r = await http('/api/trips/driver/today', { token: dTok });
const todaySched = r.data.schedules?.find((s) => s.name === 'QA Live Run');
todaySched ? ok(`driver sees today's run "${todaySched.name}" (${todaySched.route.name})`) : fail("driver/today missing QA run", r.data);

r = await http('/api/trips/start', { method: 'POST', token: dTok, body: { scheduleId: schedule.id } });
const trip = r.data.trip;
trip?.id ? ok(`trip started — ${trip.passengers.length} expected passengers`) : fail('start trip', r.data);

// GPS: walk along the route's stops.
const path = route.stops.flatMap((s, i) => {
  const next = route.stops[i + 1];
  if (!next) return [[s.lat, s.lng]];
  return [[s.lat, s.lng], [(s.lat + next.lat) / 2, (s.lng + next.lng) / 2]];
});
for (const [lat, lng] of path) {
  r = await http(`/api/trips/${trip.id}/location`, { method: 'POST', token: dTok, body: { lat, lng, speed: 32 } });
  if (r.status !== 201) fail('location ping', r.data);
}
ok(`streamed ${path.length} GPS points along the route`);

// Board the linked kid, no-show another (if there is one).
r = await http(`/api/trips/${trip.id}/board`, { method: 'POST', token: dTok, body: { passengerId: kid.id, status: 'ONBOARD' } });
r.status === 200 ? ok(`boarded "${kid.name}"`) : fail('board', r.data);
const other = trip.passengers.find((p) => p.passengerId !== kid.id);
if (other) {
  r = await http(`/api/trips/${trip.id}/board`, { method: 'POST', token: dTok, body: { passengerId: other.passengerId, status: 'NO_SHOW' } });
  r.status === 200 ? ok(`marked "${other.passenger?.name}" no-show`) : fail('no-show', r.data);
}

console.log('\n— Admin flow —');
r = await http('/api/auth/login', { method: 'POST', body: { email: qaAdminEmail, password: 'QaAdmin123', tenantSlug: 'TF-INTERVAL' } });
r.data.token ? ok('admin signed in') : fail('admin login', r.data);
const aTok = r.data.token;

r = await http('/api/trips/today', { token: aTok });
const run = r.data.runs?.find((x) => x.schedule.id === schedule.id);
run?.trip && ['STARTED', 'IN_PROGRESS'].includes(run.trip.status)
  ? ok(`admin board shows LIVE run — onboard=${run.trip.counts.onboard}, noShow=${run.trip.counts.noShow}, lastLocation=${run.trip.lastLocation ? 'yes' : 'no'}`)
  : fail('admin /today live run', JSON.stringify(run));

r = await http(`/api/trips/${trip.id}/live`, { token: aTok });
r.data.trail?.length >= path.length && r.data.passengers?.length
  ? ok(`admin live detail — trail=${r.data.trail.length} pts, passengers=${r.data.passengers.length}, bus @ ${JSON.stringify(r.data.lastLocation && [r.data.lastLocation.lat, r.data.lastLocation.lng])}`)
  : fail('admin /live detail', JSON.stringify({ trail: r.data.trail?.length }));

console.log('\n— Guardian flow —');
r = await http('/api/auth/login', { method: 'POST', body: { tenantSlug: 'TF-INTERVAL', loginId: qaPhone, password: 'QaParent123' } });
r.data.token ? ok('guardian signed in (phone login)') : fail('guardian login', r.data);
const gTok = r.data.token;

r = await http('/api/trips/guardian/live', { token: gTok });
const child = r.data.children?.find((c) => c.id === kid.id);
child?.trip?.live && child.trip.myStatus === 'ONBOARD' && child.trip.lastLocation
  ? ok(`guardian sees "${child.name}" ONBOARD, bus live @ ${child.trip.lastLocation.lat.toFixed(4)},${child.trip.lastLocation.lng.toFixed(4)}, driver=${child.trip.driver?.name}, vehicle=${child.trip.vehicle?.regNumber}`)
  : fail('guardian live view', JSON.stringify(child));

// Notifications got written?
const notes = await prisma.notification.findMany({ where: { userId: qaGuardian.id }, orderBy: { createdAt: 'desc' }, take: 3 });
notes.some((n) => n.type === 'BOARDED') && notes.some((n) => n.type === 'TRIP_STARTED')
  ? ok(`guardian notifications written (${notes.map((n) => n.type).join(', ')})`)
  : fail('guardian notifications', notes.map((n) => n.type).join(', '));

console.log('\n— End trip —');
r = await http(`/api/trips/${trip.id}/end`, { method: 'POST', token: dTok });
r.data.trip?.status === 'COMPLETED'
  ? ok(`trip completed${r.data.warning ? ` (warning: ${r.data.warning})` : ''}`)
  : fail('end trip', r.data);

r = await http('/api/trips/today', { token: aTok });
const run2 = r.data.runs?.find((x) => x.schedule.id === schedule.id);
run2?.trip?.status === 'COMPLETED' ? ok('admin board shows the run as Completed') : fail('admin post-end state', JSON.stringify(run2?.trip));

console.log(process.exitCode ? '\n❌ QA flow had failures' : '\n🎉 QA flow passed end to end');
await prisma.$disconnect();
