import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Bootstrap the platform owner (you). Safe to run repeatedly — it upserts.
const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@trackfleet.local';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'admin123';

async function main() {
  const existing = await prisma.user.findFirst({
    where: { email: SUPER_EMAIL, tenantId: null, role: 'SUPER_ADMIN' },
  });

  if (existing) {
    console.log(`Super admin already exists: ${SUPER_EMAIL}`);
    return;
  }

  const passwordHash = await bcrypt.hash(SUPER_PASSWORD, 10);
  await prisma.user.create({
    data: {
      role: 'SUPER_ADMIN',
      tenantId: null,
      name: 'Platform Owner',
      email: SUPER_EMAIL,
      passwordHash,
      status: 'ACTIVE',
    },
  });

  console.log('✅ Super admin created:');
  console.log(`   email:    ${SUPER_EMAIL}`);
  console.log(`   password: ${SUPER_PASSWORD}`);
  console.log('   (change the password after first login)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
