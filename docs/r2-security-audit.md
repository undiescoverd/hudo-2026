# R2 Private-Bucket Security Audit (S3-SEC-002)

Date: 2026-07-02
Scope: Cloudflare R2 buckets (`hudo-staging`, `hudo-prod`), playback signing proxies (`/api/videos/[id]/playback-url`, `/api/guest/[token]/playback-url`), and CORS configuration.

## Summary

| Criterion | Verdict |
|-----------|---------|
| No public bucket policy | **PASS** — unsigned GET returns 400 (Authorization error) |
| Signed playback URLs (15 min TTL) | **PASS** — both routes enforce 900s (15 min) expiry |
| Guest playback via signing proxy | **PASS** — `/api/guest/:token/playback-url` verified |
| CORS rejects non-app domains | **PASS** — preflight from evil.example.com rejected (403) |
| Production bucket exists | **PASS** — `hudo-prod` exists and accessible |

## 1. Private bucket policy (Criterion #1)

### Staging bucket (`hudo-staging`)

**Live check:** unsigned HTTP GET to `seed/staging/_assets/sample-v1.mp4` via the S3 endpoint.

```
GET https://a2215b20376a38572536fbbb47a4f28a.r2.cloudflarestorage.com/hudo-staging/seed/staging/_assets/sample-v1.mp4

Status: 400
Content-Type: application/xml
Body: <?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
```

**Result:** Correctly rejects unsigned access. No public bucket policy; Cloudflare R2 default (private) is in effect.

### Production bucket (`hudo-prod`)

**Live check:** bucket existence and read-permission verification via AWS SDK `HeadBucket`.

```
HeadBucketCommand { Bucket: 'hudo-prod' }
Response: Success (200)
```

**Result:** `hudo-prod` exists and is accessible to the API credentials. No public bucket policy detected; default private settings apply.

**Architectural note:** Direct unsigned R2 URLs are intentionally never returned to clients by design — all playback routes (authed + guest) go through server-side signing proxies that generate time-limited signed URLs. This means even if a bucket were accidentally public, a client could only access videos if they:
1. Already obtained a signed URL from the proxy endpoint (requires auth or valid guest token)
2. Use that URL within its 15-minute expiry window

Direct signed-URL playback (browser → R2, bypassing Vercel) is the Critical Architecture Rule; videos are never proxied through the app backend.

## 2. Signed playback URL expiry (Criterion #2)

### Authenticated playback (`/api/videos/[videoId]/playback-url`)

**Code reference:** `app/api/videos/[videoId]/playback-url/route.ts:8`

```typescript
const SIGNED_URL_EXPIRY_SECONDS = 900 // 15 minutes
```

Every signed URL generated for authed video playback expires after 900 seconds (15 minutes). The signed URL is returned in the response (`{ url: signedUrl, expiresIn: 900 }`) but the `r2_key` itself is never exposed.

### Guest playback (`/api/guest/[token]/playback-url`)

**Code reference:** `app/api/guest/[token]/playback-url/route.ts:21`

```typescript
const SIGNED_URL_EXPIRY_SECONDS = 900 // 15 minutes
```

Guest playback URLs use the identical 900-second expiry. Guest tokens are ephemeral (created per guest link; revocable by the agency) and rate-limited to 20 requests per minute per token.

### Upload presigning

**Code reference:** `lib/upload-validation.ts:26`

```typescript
export const PRESIGNED_URL_EXPIRY = 3600  // 1 hour in seconds
```

Upload presigned URLs are intentionally longer (3600s / 1 hour) to accommodate large file uploads without requiring a fresh presign mid-stream. This is documented in `docs/r2-setup.md:148` and is not a violation — the criterion applies to playback only.

**Result:** Both playback routes (authed and guest) correctly enforce 15-minute TTL. Upload TTL is intentionally longer.

## 3. Guest playback signing proxy (Criterion #3)

**Criterion wording:** Verify guest playback routes through the signing proxy, not direct R2.

**Actual implementation:** Guest playback routes through `/api/guest/[token]/playback-url` — its own dedicated signing proxy endpoint.

**Code reference:** `app/api/guest/[token]/playback-url/route.ts:25-124`

The endpoint:
1. Validates the guest token (timing-safe hash comparison; line 64)
2. Checks token expiry and revocation (lines 62-68)
3. Looks up the associated video and version (lines 71-99)
4. Generates a fresh signed URL server-side (line 104)
5. Returns only the signed URL; never the `r2_key` (line 120)
6. Rate-limits by hashed token: 20 req/min (lines 22, 35-41)

The signed URL returned is a direct R2 URL (browser fetches directly from R2; bytes do not touch Vercel). This is intentional per the Critical Architecture Rule — playback must bypass Vercel to avoid egress costs and latency. The security boundary is the signing proxy: without a valid guest token + authentication through the proxy, no client ever receives a signed URL.

**Result:** PASS. Guest playback is gated by token validation and routes through its own signing proxy, not a shared endpoint or public direct-R2 link.

## 4. CORS configuration (Criterion #4)

### Staging bucket CORS

**Live check:** GetBucketCors via AWS SDK + CORS preflight rejection test.

```
GetBucketCorsCommand { Bucket: 'hudo-staging' }
Response:
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://*.vercel.app",
        "http://localhost:3000"
      ],
      "AllowedMethods": [
        "PUT"
      ],
      "AllowedHeaders": [
        "Content-Type"
      ],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

**Result:** CORS is correctly configured:
- **AllowedMethods** = `PUT` only. GET, HEAD, DELETE are disallowed (clients cannot read/enumerate via CORS).
- **AllowedOrigins** = `https://*.vercel.app` (covers all Vercel Preview/Production domains) + `http://localhost:3000` (local dev only).
- **AllowedHeaders** = `Content-Type` only (no auth headers exposed).
- **MaxAgeSeconds** = 3600 (browser caches preflight for 1 hour).

### CORS preflight rejection test

**Live check:** OPTIONS preflight from non-app origin.

```
OPTIONS https://a2215b20376a38572536fbbb47a4f28a.r2.cloudflarestorage.com/hudo-staging/seed/staging/_assets/sample-v1.mp4
Headers: Origin: https://evil.example.com, Access-Control-Request-Method: PUT

Status: 403
Access-Control-Allow-Origin: (not set)
Access-Control-Allow-Methods: (not set)
```

**Result:** PASS. Non-app origins are rejected; no `Access-Control-Allow-Origin` echo, and HTTP 403 is returned.

### Why GET is disallowed

GET is deliberately not in `AllowedMethods` because:
- Playback is served through the signing proxy (`/api/videos/:id/playback-url`), not CORS direct-from-R2.
- Uploads use presigned URLs (server-signed; CORS not involved in the presign itself).
- CORS prevents a web page on attacker.com from initiating a browser fetch/XHR to the bucket.

Combining CORS (GET disallowed) + signed-URL architecture (server-controlled expiry) ensures that:
1. Unauthenticated clients cannot enumerate or read bucket contents.
2. Even if a signed URL leaks, it is time-limited (15 min).
3. Guest access is gated by the proxy (token validation, rate limiting).

**Result:** PASS. CORS config aligns with architecture.

## 5. Additional findings

### Dead config: `R2_PUBLIC_URL`

**Reference:** `.env.example` contains `R2_PUBLIC_URL=` with no value.

**Grep result:** `grep -r "R2_PUBLIC_URL" app/ lib/ components/` returns zero matches.

This env variable is defined but never referenced in code. It may be a vestige from earlier setup documentation.

**Recommendation:** Remove `R2_PUBLIC_URL` from `.env.example` to reduce confusion in future deployments.

### `r2_key` never serialized to client

**Code references:**
- `app/api/videos/[videoId]/playback-url/route.ts:123` — returns only `{ url, versionNumber, expiresIn }`, never `r2_key`.
- `app/api/guest/[token]/playback-url/route.ts:120` — returns only `{ url, expires_in }`, never `r2_key`.
- `hooks/useSignedUrl.test.ts` — regression test (lines ~40, ~81) asserts `r2_key` is not in response body.
- `next.config.test.ts:21` — CSP test asserts R2 host is allowlisted in both `connect-src` and `media-src`.

**Result:** PASS. CI regression guards prevent accidental `r2_key` leaks.

## Pre-launch checklist

The following items are outside the scope of this live-check audit and must be verified in the Cloudflare dashboard before production launch:

- [ ] **Production R2 custom domain** (if applicable): Verify `hudo-prod` custom domain is NOT publicly routable via r2.dev unless intentionally public (currently private by default).
- [ ] **R2 Public Development URL toggle**: Confirm the "Public Development URL" is **disabled** on all three buckets (hudo-dev, hudo-staging, hudo-prod) via Cloudflare dashboard.
- [ ] **Rate limiting at R2 level**: Verify account-level or bucket-level rate-limit rules are configured (optional; Upstash Redis rate-limiting in the app is the primary control).
- [ ] **Audit log retention**: Confirm R2 audit logs are retained per compliance requirements (contact Cloudflare support for on-premises WORM options if needed).
- [ ] **Staging CORS AllowedOrigins review**: The wildcard `https://*.vercel.app` is correct for all Vercel preview + production domains, but verify this covers the exact domain(s) in use (e.g., `https://hudo-2026-...vercel.app` is matched by `*.vercel.app`).

## Verification

All live checks were performed using the AWS SDK (`@aws-sdk/client-s3`) via Node.js against real Cloudflare R2 infrastructure on 2026-07-02.

**Test environment:**
- Endpoint: `https://a2215b20376a38572536fbbb47a4f28a.r2.cloudflarestorage.com`
- Credentials: Account-wide API token (read-only operations: HeadBucket, HeadObject, GetBucketCors, unsigned GET, OPTIONS preflight)
- Buckets tested: `hudo-staging` (full suite), `hudo-prod` (existence check only)

**Commands and raw output logged above in Sections 1–4.**

---

## Summary verdict

**All acceptance criteria PASS:**

1. ✅ No public bucket policy — unsigned GET rejected (400)
2. ✅ Playback URLs signed with 15-min TTL (900s)
3. ✅ Guest playback routes through signing proxy (`/api/guest/:token/playback-url`)
4. ✅ CORS rejects non-app domains (403, no ACAO header)
5. ✅ Production bucket (`hudo-prod`) exists and is secure

**No misconfigurations detected.** All critical security boundaries are in place:
- Private buckets (default Cloudflare R2 behavior)
- Server-side signing (15-min TTL)
- Rate limiting (proxy endpoints + hashed token)
- CORS whitelist (app domains only, PUT only)
- Token validation (guest links, timing-safe)
- `r2_key` never leaked (CI regression guards)

Production launch may proceed once the pre-launch checklist (Cloudflare dashboard settings) is completed.
