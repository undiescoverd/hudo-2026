# R2 Private-Bucket Security Audit (S3-SEC-002)

Date: 2026-07-02
Scope: Cloudflare R2 buckets (`hudo-staging`, `hudo-prod`), playback signing proxies (`/api/videos/[id]/playback-url`, `/api/guest/[token]/playback-url`), and CORS configuration.

## Summary

| Criterion | Verdict |
|-----------|---------|
| No public bucket policy (`hudo-staging`) | **PASS** — unsigned GET rejected at the auth layer (400) |
| No public bucket policy (`hudo-prod`) | **PASS at S3 endpoint** — unsigned GET + unsigned ListObjects rejected (400); bucket is empty; r2.dev toggle is dashboard-only and remains **unverified** (see pre-launch checklist) |
| Signed playback URLs (15 min TTL) | **PASS** — both routes enforce 900s (15 min) expiry |
| Guest playback via signing proxy | **PASS** — `/api/guest/:token/playback-url` verified |
| CORS rejects non-app domains | **PASS with finding** — arbitrary origins rejected, but `AllowedOrigins` includes the wildcard `https://*.vercel.app`, which matches ANY Vercel project (misconfiguration — see §4, flagged for a separate PR) |

## 1. Private bucket policy (Criterion #1)

### Staging bucket (`hudo-staging`)

**Live check:** unsigned HTTP GET to `seed/staging/_assets/sample-v1.mp4` via the S3 endpoint.

```
GET https://a2215b20….r2.cloudflarestorage.com/hudo-staging/seed/staging/_assets/sample-v1.mp4

Status: 400
Content-Type: application/xml
Body: <?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
```

**Why 400 (not 401/403) is still conclusive:** the unsigned request is rejected at R2's authentication layer — R2 returns `400 InvalidArgument` with an `Authorization` message for a missing/invalid SigV4 signature rather than a 403. Any non-2xx auth-layer rejection proves objects are not publicly readable via the S3 endpoint.

**Result:** Correctly rejects unsigned access at the S3 endpoint.

### Production bucket (`hudo-prod`)

**Live checks:**

1. Authenticated `HeadBucket` — the bucket exists and is accessible to the API credentials:

```
HeadBucketCommand { Bucket: 'hudo-prod' }
Response: Success (200)
```

2. Authenticated `ListObjectsV2` to find a real object key for the unsigned-GET test — the bucket is **empty**:

```
ListObjectsV2Command { Bucket: 'hudo-prod', MaxKeys: 5 }
KeyCount: 0   (bucket is EMPTY — no objects)
```

3. Unsigned GET on a plausible key (no real key exists to test against):

```
GET https://a2215b20….r2.cloudflarestorage.com/hudo-prod/test-object.mp4   (unsigned)

Status: 400
Body: <?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
```

4. Unsigned `ListObjectsV2` attempt (bucket root):

```
GET https://a2215b20….r2.cloudflarestorage.com/hudo-prod?list-type=2   (unsigned)

Status: 400
Body: <?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
```

**Result:** unsigned object reads and unsigned bucket listing against `hudo-prod` are both rejected at the auth layer via the S3 endpoint. Because the bucket is empty, no real object could be fetched, but the auth-layer rejection applies to the whole bucket path.

**Scope limit (both buckets):** the S3 API endpoint always requires SigV4 auth; the actual public-exposure vector for R2 is the **r2.dev Public Development URL** toggle and any **custom domain** — both are Cloudflare-dashboard-only settings with no S3-API surface, so they could not be checked with the available API credentials. The r2.dev URL uses a `pub-<hash>.r2.dev` hostname whose hash is not derivable from the account ID, so it is not discoverable (and therefore not probeable) without dashboard access. These remain explicit pre-launch checklist items below; this audit does **not** claim they are verified.

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

**Actual implementation:** Guest playback routes through `/api/guest/[token]/playback-url` — its own dedicated signing proxy endpoint, not the `/api/videos/:id/playback-url` endpoint the criterion names. Same security property (server-side signing, token-authenticated); this wording delta is called out so a future auditor doesn't go looking for guest traffic on the authed endpoint.

**Code reference:** `app/api/guest/[token]/playback-url/route.ts:25-124`

The endpoint:

1. Validates the guest token (timing-safe hash comparison; line 64)
2. Checks token expiry and revocation (lines 62-68)
3. Looks up the associated video and version (lines 71-99)
4. Generates a fresh signed URL server-side (line 104)
5. Returns only the signed URL; never the `r2_key` (line 120)
6. Rate-limits by hashed token: 20 req/min (lines 22, 35-41)

The signed URL returned is a direct R2 URL (browser fetches directly from R2; bytes do not touch Vercel). This is intentional per the Critical Architecture Rule — playback must bypass Vercel to avoid egress costs and latency. "No direct R2 URL" in the criterion means no **unsigned/permanent** URL; the security boundary is the signing proxy: without a valid guest token + authentication through the proxy, no client ever receives a signed URL.

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

What is correctly restrictive:

- **AllowedMethods** = `PUT` only. GET, HEAD, DELETE are disallowed (clients cannot read/enumerate via CORS).
- **AllowedHeaders** = `Content-Type` only (no auth headers exposed).
- **MaxAgeSeconds** = 3600 (browser caches preflight for 1 hour).

### MISCONFIGURATION FINDING: `AllowedOrigins` wildcard is too broad

**Finding:** `AllowedOrigins` includes `https://*.vercel.app`, which matches **any project deployed on Vercel by anyone** — e.g. a page on a malicious `https://attacker-app.vercel.app` deployment would receive a matching `Access-Control-Allow-Origin` and could drive browser-initiated PUTs against a presigned upload URL it obtained. This is a real class of non-app domain that is currently **not** rejected, and it is broader than the intended exact-origin config documented in `docs/r2-setup.md:30-40` (`https://hudo.app` + `http://localhost:3000` only).

**Impact assessment:** moderated by the rest of the architecture — the CORS rule only matters once an attacker already holds a valid presigned PUT URL (server-signed, auth-gated, rate-limited, 1-hour TTL, PUT-only, object key chosen by the server), and GET is not allowed regardless. But as deployed, the origin allowlist does not satisfy criterion #4's "rejects requests from non-app domains" for the `*.vercel.app` class.

**Disposition:** flagged for a **separate PR** (per this task's rule: the audit documents live findings, it does not fix them). The fix is to replace `https://*.vercel.app` with the exact production origin(s) plus a project-scoped preview pattern (this project's own preview domains), matching the intent of `docs/r2-setup.md`, then re-run the GetBucketCors + preflight checks.

### CORS preflight rejection test (arbitrary origin)

**Live check:** OPTIONS preflight from a non-Vercel, non-app origin.

```
OPTIONS https://a2215b20….r2.cloudflarestorage.com/hudo-staging/seed/staging/_assets/sample-v1.mp4
Headers: Origin: https://evil.example.com, Access-Control-Request-Method: PUT

Status: 403
Access-Control-Allow-Origin: (not set)
Access-Control-Allow-Methods: (not set)
```

**Result:** origins outside the allowlist are rejected (403, no `Access-Control-Allow-Origin` echo).

### Why GET is disallowed

GET is deliberately not in `AllowedMethods` because:

- Playback is served through the signing proxy (`/api/videos/:id/playback-url`), not CORS direct-from-R2.
- Uploads use presigned URLs (server-signed; CORS not involved in the presign itself).
- CORS prevents a web page on attacker.com from initiating a browser fetch/XHR to the bucket.

Combining CORS (GET disallowed) + signed-URL architecture (server-controlled expiry) ensures that:

1. Unauthenticated clients cannot enumerate or read bucket contents.
2. Even if a signed URL leaks, it is time-limited (15 min).
3. Guest access is gated by the proxy (token validation, rate limiting).

**Verdict: PASS with finding.** Arbitrary non-app origins are rejected and methods/headers are correctly minimal, but the `https://*.vercel.app` origin wildcard is a misconfiguration (any Vercel project matches) and must be tightened in a separate PR before this criterion is a clean PASS.

## 5. Additional findings

### Dead config: `R2_PUBLIC_URL`

**Reference:** `.env.local.example:33` contains `R2_PUBLIC_URL=https://video-dev.hudo.app`.

**Grep result:** `grep -rn "R2_PUBLIC_URL" app/ lib/ components/ hooks/` returns zero matches.

This env variable is defined in the example env file but never referenced in code — and its name ("PUBLIC") is misleading given the private-bucket architecture.

**Recommendation:** Remove `R2_PUBLIC_URL` from `.env.local.example` to reduce confusion in future deployments.

### `r2_key` never serialized to client

**Code references:**

- `app/api/videos/[videoId]/playback-url/route.ts:123` — returns only `{ url, versionNumber, expiresIn }`, never `r2_key`.
- `app/api/guest/[token]/playback-url/route.ts:120` — returns only `{ url, expires_in }`, never `r2_key`.
- `hooks/useSignedUrl.test.ts` — regression test (lines ~40, ~81) asserts `r2_key` is not in response body.
- `next.config.test.ts:21` — CSP test asserts R2 host is allowlisted in both `connect-src` and `media-src`.

**Result:** PASS. CI regression guards prevent accidental `r2_key` leaks.

## Pre-launch checklist

The following items could not be verified via the S3 API — they are Cloudflare-dashboard-only settings with no S3-API surface reachable by the available credentials — and must be verified in the Cloudflare dashboard before production launch:

- [ ] **R2 Public Development URL toggle**: Confirm the "Public Development URL" (r2.dev subdomain) is **disabled** on all three buckets (hudo-dev, hudo-staging, hudo-prod). This is the primary public-exposure vector for R2 and is dashboard-only — this audit could not check it (see §1 scope limit).
- [ ] **hudo-prod privacy sign-off**: this audit verified auth-layer rejection at the S3 endpoint only (and the bucket is currently empty); complete the dashboard checks above for hudo-prod specifically before any production object lands in it.
- [ ] **Custom domains**: Verify no custom domain is attached to any bucket unless intentionally public.
- [ ] **Fix CORS `AllowedOrigins` wildcard** (separate PR — see §4 finding): replace `https://*.vercel.app` with exact/project-scoped origins per `docs/r2-setup.md:30-40`, then re-run the GetBucketCors + preflight checks.
- [ ] **Rate limiting at R2 level**: Verify account-level or bucket-level rate-limit rules are configured (optional; Upstash Redis rate-limiting in the app is the primary control).
- [ ] **Audit log retention**: Confirm R2 audit logs are retained per compliance requirements.

## Verification

All live checks were performed using the AWS SDK (`@aws-sdk/client-s3`) via Node.js against real Cloudflare R2 infrastructure on 2026-07-02.

**Test environment:**

- Endpoint: `https://a2215b20….r2.cloudflarestorage.com` (account ID redacted)
- Credentials: Account-wide API token (read-only operations: HeadBucket, ListObjectsV2, HeadObject, GetBucketCors, unsigned GET, OPTIONS preflight)
- Buckets tested: `hudo-staging` (unsigned GET, CORS preflight, GetBucketCors), `hudo-prod` (HeadBucket, authenticated ListObjectsV2, unsigned GET, unsigned ListObjectsV2)

**Commands and raw output logged above in Sections 1–4.**
