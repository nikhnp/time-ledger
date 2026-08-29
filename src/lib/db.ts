import { PrismaClient } from '@prisma/client'

/**
 * Prisma client (SQLite in this sandbox).
 * The app's runtime data access lives in src/lib/neon-sql.ts (name kept for
 * compatibility with existing route imports) on top of this client.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
