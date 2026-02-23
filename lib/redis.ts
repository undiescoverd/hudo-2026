import { Redis } from '@upstash/redis'

/**
 * Upstash Redis client for rate limiting.
 * Uses REST API for serverless compatibility (Vercel).
 * Never used for persistent data — only ephemeral rate limit counters.
 */
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
})

/**
 * Rate limit: returns remaining quota or 0 if limit exceeded.
 * @param key - Rate limit key (e.g., "auth:register:user@example.com")
 * @param limit - Max requests per window
 * @param window - Time window in seconds
 * @returns remaining quota (>= 0) or -1 if limit exceeded
 */
export async function rateLimit(key: string, limit: number, window: number): Promise<number> {
  const current = await redis.incr(key)

  if (current === 1) {
    // First request in this window: set expiry
    await redis.expire(key, window)
  }

  if (current > limit) {
    return -1 // Limit exceeded
  }

  return limit - current // Remaining quota
}

/**
 * Reset a rate limit key (admin only).
 */
export async function resetRateLimit(key: string): Promise<void> {
  await redis.del(key)
}

/**
 * Get current count for a rate limit key.
 */
export async function getRateLimitCount(key: string): Promise<number> {
  const count = await redis.get<number>(key)
  return count ?? 0
}
