#!/usr/bin/env node
/**
 * P1-3: migration deploy wrapper for the Netlify build.
 *
 * Why this exists: production already has tables but (being a v10.3 `db push`
 * database) no migration history. A plain `prisma migrate deploy` would try
 * to re-run the 0_init baseline against existing tables and fail. Prisma's
 * answer is `migrate resolve --applied 0_init` — a one-time baseline mark.
 *
 * This script makes that idempotent and zero-touch:
 *   1. fresh/empty database             -> nothing to baseline; deploy applies everything
 *   2. existing db, no _prisma_migrations -> `resolve --applied 0_init`, then deploy
 *   3. existing db with history         -> deploy (applies any pending migrations)
 *
 * Runs on plain node (the dev/ops substrate has no bun/python). Exits
 * non-zero on failure so the Netlify build aborts before shipping broken
 * schema state.
 */
import { execSync, spawnSync } from 'node:child_process'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[migrate-safe] DATABASE_URL is not set — cannot run migrations.')
  process.exit(1)
}

function execSql(script) {
  // Injection-safe: the only interpolated value is a boolean from
  // to_regclass(...) IS NOT NULL below — no user input ever reaches here.
  const r = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
    input: script,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (r.status !== 0) {
    throw new Error(`query failed: ${r.stderr}`)
  }
}

async function probe() {
  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  try {
    const rows = await db.$queryRawUnsafe(
      `SELECT
         (SELECT to_regclass('"_prisma_migrations"') IS NOT NULL) AS migrations,
         (SELECT to_regclass('"User"') IS NOT NULL) AS users`,
    )
    return rows?.[0] ?? { migrations: false, users: false }
  } finally {
    await db.$disconnect()
  }
}

async function main() {
  const { migrations, users } = await probe()

  if (!users) {
    console.log('[migrate-safe] fresh database — applying full migration history.')
  } else if (!migrations) {
    console.log('[migrate-safe] existing database without migration history — baselining 0_init as applied.')
    execSync('npx prisma migrate resolve --applied 0_init', { stdio: 'inherit' })
  } else {
    console.log('[migrate-safe] migration history present — deploying pending migrations.')
  }

  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  console.log('[migrate-safe] done.')
}

main().catch((err) => {
  console.error('[migrate-safe] FAILED:', err.message)
  process.exit(1)
})
