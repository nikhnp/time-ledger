/**
 * CUID2-style ID generator.
 *
 * Used by neon-sql auth routes to generate IDs without depending on Prisma's
 * @default(cuid()) auto-generation (since we're bypassing Prisma for auth).
 *
 * Format: 24-char lowercase string starting with a letter.
 * Sufficient collision-resistance for single-tenant use.
 */
import { randomBytes } from 'node:crypto'

export function generateId(prefix = ''): string {
  // 16 random bytes → 32 hex chars → take 24, prefix with a letter
  const hex = randomBytes(16).toString('hex')
  const letter = String.fromCharCode(97 + Math.floor(Math.random() * 26)) // a-z
  return prefix + letter + hex.slice(0, 23)
}
