import { type NextRequest } from 'next/server'

export const AUTH_RATE_LIMIT = 5
export const AUTH_RATE_WINDOW = 900 // 15 minutes in seconds

export interface RateLimitResult {
  limited: boolean
  retryAfter: number
}

/**
 * Extract client IP from request headers.
 * Vercel sets x-forwarded-for; falls back to x-real-ip, then 'unknown'.
 */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
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

  const [ipRemaining, emailRemaining] = await Promise.all([
    rateLimit(ipKey, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW),
    rateLimit(emailKey, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW),
  ])

  const limited = ipRemaining === -1 || emailRemaining === -1

  return {
    limited,
    retryAfter: limited ? AUTH_RATE_WINDOW : 0,
  }
}
