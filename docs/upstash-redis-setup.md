# Upstash Redis Setup Guide

Two isolated Redis databases for rate limiting: `hudo-dev` and `hudo-staging`. Production will be added later.

## Quick Setup

### 1. Create Two Databases in Upstash Console

Go to [console.upstash.com](https://console.upstash.com) and upgrade to **pay-as-you-go** (free tier only allows 1 database):

1. **Create Database: hudo-dev**
   - Name: `hudo-dev`
   - Region: `eu-west-2` (UK, matches Supabase)
   - Type: Standard (not Cluster)
   - Eviction Policy: `noeviction` (prevents silent rate limit bypass under memory pressure)
   - TLS Enabled: ✓

2. **Create Database: hudo-staging**
   - Name: `hudo-staging`
   - Region: `eu-west-2`
   - Type: Standard
   - Eviction Policy: `allkeys-lru`
   - TLS Enabled: ✓

### 2. Copy Connection Strings

For each database in Upstash console:
- Click the database
- Copy the **REST API URL** (e.g., `https://nice-seal-12345.upstash.io`)
- Copy the **REST API Token** (e.g., `AYEp...`)

### 3. Add to Environment Files

**.env.local** (dev):
```
UPSTASH_REDIS_REST_URL=https://nice-seal-12345.upstash.io
UPSTASH_REDIS_REST_TOKEN=AYEp...
```

**.env.staging** (staging):
```
UPSTASH_REDIS_REST_URL=https://another-seal-67890.upstash.io
UPSTASH_REDIS_REST_TOKEN=BZFq...
```

**Never commit credentials to git** — `.env.local` and `.env.staging` are gitignored.

**Production:** Will be added later in deployment phase.

## Validation

Once credentials are in place:

```bash
# Test both dev and staging connections
node scripts/validate-redis.js all
```

Or manually:
```bash
# Test dev connection
curl -X GET "https://nice-seal-12345.upstash.io/ping" \
  -H "Authorization: Bearer AYEp..."
# Expected: "PONG"
```

## Rate Limiting Usage

`lib/redis.ts` is already configured to use `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. No code changes needed once env vars are set.

Applied to:
- Auth endpoints: login, register, password reset
- Upload endpoint
- Comment endpoints
- Guest access endpoints

See `lib/redis.ts` for implementation.
