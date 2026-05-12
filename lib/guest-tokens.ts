/**
 * Guest token utilities for Hudo.
 *
 * Tokens are 32-byte cryptographically random values encoded as base64url.
 * Only the SHA-256 hex hash is persisted; plaintext tokens are never stored or logged.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto'

/**
 * Generates a cryptographically random guest token.
 * Returns a 43-character base64url string (32 bytes, no padding).
 * The plaintext token must be delivered to the recipient and NEVER logged or stored.
 */
export function generateGuestToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Hashes a guest token using SHA-256.
 * Returns a hex digest suitable for storage in the database.
 */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Verifies a plaintext token against a stored SHA-256 hex hash.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns false (without throwing) if either input is malformed.
 */
export function verifyGuestToken(plaintext: string, expectedHash: string): boolean {
  const hashedPlain = hashGuestToken(plaintext)
  const a = Buffer.from(hashedPlain, 'hex')
  const b = Buffer.from(expectedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
