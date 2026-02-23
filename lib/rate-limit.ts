import { type NextRequest } from 'next/server'

export const AUTH_RATE_LIMIT = 5
export const AUTH_RATE_WINDOW = 900 // 15 minutes in seconds

export interface RateLimitResult {
  limited: boolean
  retryAfter: number
}

/**
 * Extract client IP from request headers.
 * Uses the rightmost x-forwarded-for entry (appended by the last trusted proxy,
 * e.g. Vercel's edge), which cannot be spoofed by the client.
 * Falls back to x-real-ip, then 'unknown'.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const ips = forwarded.split(',')
    return ips[ips.length - 1].trim()
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * Dual-key auth rate limiting: checks both IP-based and email-based keys.
 * If either key is exhausted, the request is rate-limited.
 */
export async function checkAuthRateLimit(
  ip: string,
  email: string,
  endpoint: string
): Promise<RateLimitResult> {
  const normalizedEmail = email.trim().toLowerCase()
  const ipKey = `auth:${endpoint}:ip:${ip}`
  const emailKey = `auth:${endpoint}:email:${normalizedEmail}`

  // Dynamic import avoids module-level Redis env check at import time,
  // allowing pure exports (constants, getClientIp) to be tested without Redis.
  const { rateLimit } = await import('@/lib/redis')

  // Check IP first; only check email if IP is not exhausted.
  // Prevents a blocked IP from burning the email key's quota.
  const ipRemaining = await rateLimit(ipKey, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW)
  if (ipRemaining === -1) {
    return { limited: true, retryAfter: AUTH_RATE_WINDOW }
  }

  const emailRemaining = await rateLimit(emailKey, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW)

  return {
    limited: emailRemaining === -1,
    retryAfter: emailRemaining === -1 ? AUTH_RATE_WINDOW : 0,
  }
}
