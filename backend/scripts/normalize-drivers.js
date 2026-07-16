// One-off: older drivers were created with mustChangePassword=true, which makes
// login return a "set password" step (no token) — but drivers can't change their
// own password anymore. Clear the flag so they sign straight in.
//
// Run:  node scripts/normalize-drivers.js
import { prisma } from '../src/lib/prisma.js';

const r = await prisma.user.updateMany({
  where: { role: 'DRIVER', mustChangePassword: true },
  data: { mustChangePassword: false },
});
console.log(`Cleared mustChangePassword on ${r.count} driver(s).`);

await prisma.$disconnect();
