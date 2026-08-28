import { describe, it, expect, beforeAll, afterAll } from 'vitest'

/**
 * P1-1e: LLM API key encryption round-trips, tampering is detected, and the
 * legacy XOR path still decodes v10.3 blobs for the migration job.
 */

const KEY = Buffer.from('k'.repeat(32)).toString('base64')
const OLD_SECRET = 'ledger-v10-default-obfuscation-key'

beforeAll(() => {
  process.env.LLM_ENCRYPTION_KEY = KEY
  process.env.LLM_KEY_OBFUSCATION_SECRET = OLD_SECRET
})

afterAll(() => {
  delete process.env.LLM_ENCRYPTION_KEY
})

/** Replicates v10.3's xorEncrypt so tests can forge legacy blobs. */
function legacyXorEncrypt(plain: string): string {
  const buf = Buffer.from(plain, 'utf8')
  const keyBuf = Buffer.from(OLD_SECRET, 'utf8')
  for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length]
  return buf.toString('base64')
}

describe('secret encryption (P1-1e)', () => {
  it('round-trips encryptSecret → decryptSecret', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/server/crypto')
    const secret = 'sk-groq-abc123_def456'
    const stored = encryptSecret(secret)
    expect(stored.startsWith('v2:')).toBe(true)
    expect(stored).not.toContain(secret)
    expect(decryptSecret(stored)).toBe(secret)
  })

  it('produces a fresh IV per call (no repeated ciphertexts)', async () => {
    const { encryptSecret } = await import('@/lib/server/crypto')
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('rejects tampered ciphertext (GCM auth tag)', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/server/crypto')
    const stored = encryptSecret('do-not-touch')
    const parts = stored.split(':')
    const ct = Buffer.from(parts[3], 'base64')
    ct[0] ^= 0xff
    parts[3] = ct.toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })

  it('rejects legacy (non-v2) blobs via decryptSecret', async () => {
    const { decryptSecret } = await import('@/lib/server/crypto')
    expect(() => decryptSecret(legacyXorEncrypt('old-key'))).toThrow(/v2/)
  })

  it('legacyXorDecrypt still reads v10.3 blobs (migration path)', async () => {
    const { legacyXorDecrypt } = await import('@/lib/server/crypto')
    expect(legacyXorDecrypt(legacyXorEncrypt('legacy-secret'))).toBe('legacy-secret')
  })

  it('refuses a wrong-length LLM_ENCRYPTION_KEY', async () => {
    process.env.LLM_ENCRYPTION_KEY = Buffer.from('short').toString('base64')
    const { encryptSecret } = await import('@/lib/server/crypto')
    expect(() => encryptSecret('x')).toThrow(/32 bytes/)
    process.env.LLM_ENCRYPTION_KEY = KEY
  })
})
