// ============================================================================
// PRODUCTION QA: builds a complete demo org, then exercises the entire product
// over the real public HTTPS endpoint — org → driver → live trip → boarding →
// admin live board → guardian live view → notifications → end trip.
//
//   BASE_URL=https://trackfleet.360turningpoint.com node scripts/qa-prod-flow.js
//
// Leaves behind a working demo org (TF-QADEMO) the owner can explore.
// ============================================================================
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/auth.js';
import { generateTempPassword } from '../src/lib/password.js';

const API = (process.env.BASE_URL || 'http://localhost:4004').replace(/\/$/, '');
const ok = (l) => console.log(`  ✅ ${l}`);
const fail = (l, x) => { console.error(`  ❌ ${l}`, x || ''); process.exitCode = 1; };

async function http(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`Target: ${API}\n— Demo org fixtures —`);

// Idempotent: reuse the demo org if it exists.
let tenant = await prisma.tenant.findUnique({ where: { slug: 'tf-qademo' } });
if (!tenant) {
  const orgType = await prisma.orgType.findFirst({ where: { key: 'SCHOOL' } });
  tenant = await prisma.tenant.create({
    data: { name: 'QA Demo School', slug: 'tf-qademo', status: 'ACTIVE', orgTypeId: orgType.id, features: {} },
  });
}
ok(`org "${tenant.name}" (TF-QADEMO, #${tenant.code})`);

const adminPw = generateTempPassword();
let admin = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'TENANT_ADMIN' } });
if (!admin) {
  admin = await prisma.user.create({
    data: {
      tenantId: tenant.id, role: 'TENANT_ADMIN', email: 'demo-admin@trackfleet.local', name: 'Demo Admin',
      passwordHash: await hashPassword(adminPw), emailVerifiedAt: new Date(), mustChangePassword: false,
    },
  });
} else {
  await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(adminPw) } });
}
ok(`admin demo-admin@trackfleet.local / ${adminPw}`);

// Everything else through the REAL API as that admin (the true product path).
console.log('\n— Build the org through the public API —');
let r = await http('/api/auth/login', { method: 'POST', body: { email: 'demo-admin@trackfleet.local', password: adminPw, tenantSlug: 'TF-QADEMO' } });
r.data.token ? ok('admin signed in over HTTPS') : fail('admin login', r.data);
const aTok = r.data.token;

// Vehicle
r = await http('/api/vehicles', { token: aTok });
let vehicle = (r.data.vehicles || []).find((v) => v.regNumber === 'KL-99-QA-0001');
if (!vehicle) {
  r = await http('/api/vehicles', { method: 'POST', token: aTok, body: { regNumber: 'KL-99-QA-0001', fleetNo: 'QA-BUS-1', capacity: 30 } });
  vehicle = r.data.vehicle;
}
vehicle?.id ? ok(`vehicle ${vehicle.regNumber}`) : fail('vehicle', r.data);

// Driver — created via API so the DRV code + password provisioning is exercised.
r = await http('/api/drivers', { token: aTok });
let driver = (r.data.drivers || [])[0];
if (!driver) {
  r = await http('/api/drivers', { method: 'POST', token: aTok, body: { name: 'Demo Driver', phone: '9999888801' } });
  driver = r.data.driver;
}
const driverPw = driver.provisionalPassword;
driver?.loginId && driverPw ? ok(`driver ${driver.loginId} / ${driverPw}`) : fail('driver create', r.data);

// Route + stops (Trivandrum area)
r = await http('/api/routes', { token: aTok });
let route = (r.data.routes || []).find((x) => x.name === 'QA Demo Route');
if (!route) {
  r = await http('/api/routes', { method: 'POST', token: aTok, body: { name: 'QA Demo Route', direction: 'PICKUP' } });
  route = r.data.route;
  const stops = [
    { name: 'Kazhakkoottam', lat: 8.5666, lng: 76.8737, sequence: 1 },
    { name: 'Technopark', lat: 8.5578, lng: 76.8807, sequence: 2 },
    { name: 'Sreekaryam', lat: 8.5449, lng: 76.9124, sequence: 3 },
  ];
  for (const s of stops) await http(`/api/routes/${route.id}/stops`, { method: 'POST', token: aTok, body: { ...s, geofenceRadius: 150 } });
}
r = await http(`/api/routes/${route.id}`, { token: aTok });
route = r.data.route;
route?.stops?.length >= 3 ? ok(`route "${route.name}" with ${route.stops.length} stops`) : fail('route/stops', r.data);

// Passengers with a phone-login guardian — through the API.
let guardianCreds = null;
r = await http('/api/passengers', { token: aTok });
let pax = (r.data.passengers || []).filter((p) => p.route?.id === route.id);
if (pax.length < 2) {
  r = await http('/api/passengers', {
    method: 'POST', token: aTok,
    body: { name: 'Demo Kid One', category: 'Class 5A', stopId: route.stops[0].id, routeId: route.id,
      guardian: { name: 'Demo Parent', phone: '9999888899', relation: 'Parent' } },
  });
  guardianCreds = r.data.guardianCredentials;
  await http('/api/passengers', {
    method: 'POST', token: aTok,
    body: { name: 'Demo Kid Two', category: 'Class 3B', stopId: route.stops[1].id, routeId: route.id },
  });
  r = await http('/api/passengers', { token: aTok });
  pax = (r.data.passengers || []).filter((p) => p.route?.id === route.id);
}
pax.length >= 2 ? ok(`${pax.length} passengers mapped to stops`) : fail('passengers', r.data);
if (!guardianCreds) {
  const g = await prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'GUARDIAN', loginId: '9999888899' } });
  guardianCreds = g ? { loginId: g.loginId, password: g.provisionalPassword } : null;
}
guardianCreds?.password ? ok(`guardian ${guardianCreds.loginId} / ${guardianCreds.password}`) : fail('guardian creds');

// Schedule
r = await http('/api/schedules', { token: aTok });
let sched = (r.data.schedules || []).find((s) => s.name === 'QA Morning Pickup');
if (!sched) {
  r = await http('/api/schedules', {
    method: 'POST', token: aTok,
    body: { name: 'QA Morning Pickup', routeId: route.id, vehicleId: vehicle.id, driverId: driver.id,
      direction: 'PICKUP', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: '07:30' },
  });
  sched = r.data.schedule;
}
sched?.id ? ok(`schedule "${sched.name}"`) : fail('schedule', r.data);

// ---------- the live flow ----------
console.log('\n— Live trip over HTTPS —');
r = await http('/api/auth/login', { method: 'POST', body: { tenantSlug: 'TF-QADEMO', loginId: driver.loginId, password: driverPw } });
r.data.token ? ok('driver signed in') : fail('driver login', r.data);
const dTok = r.data.token;

r = await http('/api/trips/start', { method: 'POST', token: dTok, body: { scheduleId: sched.id } });
const trip = r.data.trip;
trip?.id ? ok(`trip started (${trip.passengers.length} expected)`) : fail('trip start', r.data);

for (const s of route.stops) {
  r = await http(`/api/trips/${trip.id}/location`, { method: 'POST', token: dTok, body: { lat: s.lat, lng: s.lng, speed: 30 } });
  if (r.status !== 201) fail('gps ping', r.data);
}
ok(`streamed ${route.stops.length} GPS points`);

const kid1 = trip.passengers.find((p) => p.passenger?.name === 'Demo Kid One') || trip.passengers[0];
r = await http(`/api/trips/${trip.id}/board`, { method: 'POST', token: dTok, body: { passengerId: kid1.passengerId, status: 'ONBOARD' } });
r.status === 200 ? ok('boarded Demo Kid One') : fail('board', r.data);

r = await http('/api/trips/today', { token: aTok });
const run = r.data.runs?.find((x) => x.schedule.id === sched.id);
run?.trip?.counts?.onboard === 1 && run.trip.lastLocation
  ? ok(`admin live board: onboard=1, GPS present`) : fail('admin board', JSON.stringify(run?.trip));

r = await http('/api/auth/login', { method: 'POST', body: { tenantSlug: 'TF-QADEMO', loginId: guardianCreds.loginId, password: guardianCreds.password } });
r.data.token ? ok('guardian signed in (phone)') : fail('guardian login', r.data);
r = await http('/api/trips/guardian/live', { token: r.data.token });
const child = r.data.children?.find((c) => c.name === 'Demo Kid One');
child?.trip?.live && child.trip.myStatus === 'ONBOARD' && child.trip.lastLocation
  ? ok(`guardian sees child ONBOARD, bus live, driver ${child.trip.driver?.name}`) : fail('guardian live', JSON.stringify(child));

r = await http(`/api/trips/${trip.id}/end`, { method: 'POST', token: dTok });
r.data.trip?.status === 'COMPLETED' ? ok('trip ended') : fail('end', r.data);

console.log(process.exitCode ? '\n❌ PRODUCTION QA FAILED' : '\n🎉 PRODUCTION QA PASSED — demo org TF-QADEMO left in place for you to explore');
console.log(`\nDemo logins:
  Admin    → ${API}/admin     : demo-admin@trackfleet.local / ${adminPw} (org TF-QADEMO)
  Guardian → ${API}/guardian  : org TF-QADEMO, phone ${guardianCreds?.loginId} / ${guardianCreds?.password}
  Driver   → mobile app       : org TF-QADEMO, ${driver?.loginId} / ${driverPw}`);
await prisma.$disconnect();
