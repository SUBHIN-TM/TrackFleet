// One-time backfill: every driver must have a visible provisioning password the
// admin can read/hand over. Older drivers (created before that field existed, or
// whose password was never provisioned) have provisionalPassword = null — this
// mints a fresh one for each and stores the matching hash so the login still works.
//
// Run:  node scripts/backfill-driver-passwords.js
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/auth.js';
import { generateTempPassword } from '../src/lib/password.js';

const drivers = await prisma.user.findMany({
  where: { role: 'DRIVER', provisionalPassword: null },
  select: { id: true, name: true, loginId: true },
});

if (drivers.length === 0) {
  console.log('All drivers already have a password. Nothing to do.');
} else {
  for (const d of drivers) {
    const password = generateTempPassword();
    await prisma.user.update({
      where: { id: d.id },
      data: { passwordHash: await hashPassword(password), provisionalPassword: password },
    });
    console.log(`  ${d.loginId || d.id} (${d.name}) -> ${password}`);
  }
  console.log(`\nBackfilled ${drivers.length} driver(s).`);
}

await prisma.$disconnect();
