import { PrismaClient } from '@prisma/client';

// Single shared Prisma client for the whole API process.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'warn', 'error'],
});
