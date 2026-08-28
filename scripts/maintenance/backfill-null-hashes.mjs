#!/usr/bin/env node
/**
 * Optional belt-and-braces companion to migration 1_p1_hardening: instead of
 * one shared unusable hash, give every NULL-hash user their own unique
 * unusable hash. Run once AFTER deploy (admin → maintenance route covers the
 * common case; this script is for direct DB access users):
 *
 *   node scripts/maintenance/backfill-null-hashes.mjs
 *
 * Requires DATABASE_URL in the environment. Idempotent — only touches rows
 * where passwordHash IS NULL (there will be none after the migration).
 */
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'node:crypto'

const db = new PrismaClient()

function unusableHash() {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(randomBytes(32).toString('hex'), salt, 64).toString('hex')}`
}

const rows = await db.user.findMany({ where: { passwordHash: null }, select: { id: true, name: true } })
if (rows.length === 0) {
  console.log('[backfill] no NULL password hashes found — nothing to do.')
} else {
  for (const u of rows) {
    await db.user.update({ where: { id: u.id }, data: { passwordHash: unusableHash() } })
    console.log(`[backfill] set unusable hash for ${u.name}`)
  }
  console.log(`[backfill] done — ${rows.length} account(s). They sign in via the admin reset-link flow.`)
}

await db.$disconnect()
