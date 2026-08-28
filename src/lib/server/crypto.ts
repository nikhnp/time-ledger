import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
} from 'node:crypto'

/**
 * App-level secret encryption (P1-1e).
 *
 * v10.3 stored LLM API keys with reversible XOR "obfuscation" against a
 * hardcoded fallback key — effectively plaintext. This module replaces that
 * with AES-256-GCM keyed by LLM_ENCRYPTION_KEY (base64, 32 bytes).
 *
 * Storage format: "v2:<iv-b64>:<authTag-b64>:<ciphertext-b64>"
 * The `v2:` prefix lets decryptSecret dispatch (and lets the one-off
 * re-encrypt maintenance job find legacy XOR blobs, which are raw base64
 * with no prefix).
 */

const PREFIX = 'v2'

function encryptionKey(): Buffer {
  const raw = process.env.LLM_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'LLM_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('LLM_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32).')
  }
  return key
}

/** Encrypt a plaintext secret. Throws if LLM_ENCRYPTION_KEY is missing/invalid. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createSecretKey(encryptionKey()), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

/**
 * Decrypt a stored secret.
 * - `v2:` blobs decrypt via AES-256-GCM (auth tag verified — tampering throws).
 * - Legacy prefix-less blobs throw: run the re-encrypt maintenance job
 *   (workflow: "Maintenance" → job "reencrypt-llm-keys") BEFORE deploying
 *   this code, so no legacy blobs remain.
 * Callers should treat a throw as "key unreadable — re-enter" and surface a
 * friendly error, never a 500.
 */
export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Secret is not in v2 format — re-encrypt it (Maintenance → reencrypt-llm-keys).')
  }
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const ct = Buffer.from(parts[3], 'base64')
  const decipher = createDecipheriv('aes-256-gcm', createSecretKey(encryptionKey()), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/**
 * Legacy XOR decryption — used ONLY by the one-off re-encrypt maintenance job
 * to migrate existing v10.3 blobs. Matches v10.3's xorDecrypt exactly,
 * including the hardcoded fallback key.
 */
export function legacyXorDecrypt(cipherB64: string): string {
  const buf = Buffer.from(cipherB64, 'base64')
  const keyBuf = Buffer.from(
    process.env.LLM_KEY_OBFUSCATION_SECRET ?? 'ledger-v10-default-obfuscation-key',
    'utf8',
  )
  for (let i = 0; i < buf.length; i++) buf[i] ^= keyBuf[i % keyBuf.length]
  return buf.toString('utf8')
}
