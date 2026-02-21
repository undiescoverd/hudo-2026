# Hudo — R2 Bucket Setup & Configuration

## Overview

Cloudflare R2 is used for all video storage across Hudo. Videos are uploaded directly from the browser to R2 via presigned URLs, bypassing Vercel entirely. Playback is served through a signing proxy (`/api/videos/:id/playback-url`) to maintain security and audit control.

## Buckets

Three isolated R2 buckets, one per environment:

| Bucket | Environment | Region | Purpose |
|--------|-------------|--------|---------|
| `hudo-dev` | Development | Auto | Development & testing |
| `hudo-staging` | Staging | Auto | Pre-production validation |
| `hudo-prod` | Production | Auto | Live user videos |

Each bucket is **private** with no public bucket policy and no public fallback.

## Bucket Configuration

### Privacy & Access Control

All buckets must be **private** — no public read/write access:

- **Object CANNED ACL**: Private
- **Bucket Policy**: None (no public access)
- **Public Fallback**: Disabled

### CORS Policy

CORS must be configured on **all three buckets** to allow browser-based PUT uploads from the app domain only:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://hudo.app",
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

**Important:** `AllowedMethods` includes **PUT only**. GET is **not** allowed via CORS because:
- Playback is served through the signing proxy (`/api/videos/:id/playback-url`)
- The proxy fetches from R2 using server-side credentials
- Direct R2 URLs are never returned to any client

### Object Versioning

Object versioning must be **enabled** on all buckets to support video version history:

- **Enable**: Object Versioning → On

Versioning allows multiple versions of the same object to be stored independently, enabling the version history feature.

## Environment Variables & Credentials

R2 API credentials are stored in **Vercel environment groups** (one per environment: dev, staging, prod).

Each environment requires:

```bash
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<api-token-id>
R2_SECRET_ACCESS_KEY=<api-token-secret>
R2_BUCKET_NAME=hudo-dev|hudo-staging|hudo-prod
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

These variables are set in Vercel via the UI or API (see [Vercel environment variables guide](https://vercel.com/docs/concepts/projects/environment-variables)).

For local development, copy `.env.example` to `.env.local` and fill in the `hudo-dev` bucket credentials.

## Creating Buckets (Manual Steps)

1. **Log in to Cloudflare** → R2 dashboard
2. **Create bucket**: Click "Create bucket"
   - Name: `hudo-dev`, `hudo-staging`, or `hudo-prod`
   - Region: Auto (default)
3. **Disable public access**:
   - Settings → Permissions → Block public access: **On**
4. **Enable object versioning**:
   - Settings → Object versioning: **On**
5. **Configure CORS**:
   - Settings → CORS → Paste the CORS JSON above
6. **Create API token** (if not already created):
   - R2 → Manage API tokens → Create API token
   - Permissions: `Edit (all)` (includes object read/write)
   - Resources: Select all buckets or specific bucket
   - Copy **Access Key ID**, **Secret Access Key**, and **Account ID**

## Verification Steps

### 1. Verify Direct Unsigned URL Returns 403

An unsigned R2 URL should **not** be accessible without credentials:

```bash
curl -v https://<account-id>.r2.cloudflarestorage.com/hudo-dev/test-object
```

**Expected response:**
```
HTTP/1.1 403 Forbidden
Access Denied
```

### 2. Verify CORS Rejects Non-App Domain

A PUT request from a non-app domain should be rejected:

```bash
curl -X OPTIONS -v \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: PUT" \
  https://<presigned-url>
```

**Expected response:**
```
HTTP/1.1 403 Forbidden
```

Or no `Access-Control-Allow-Origin` header in the response.

### 3. Verify App Domain Can Upload

A presigned URL request from the app domain should succeed:

```bash
# From browser console on https://hudo.app or http://localhost:3000
fetch('https://<presigned-url>', {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4' },
  body: new Blob(['test'], { type: 'video/mp4' })
})
.then(r => console.log(r.status)) // Should be 200
```

## Security Notes

- **Presigned URLs**: All R2 uploads use presigned URLs generated server-side by the app. They include an expiration time (e.g., 1 hour) and are valid for PUT only.
- **Playback**: All R2 reads are done server-side by the signing proxy. No client ever receives an unsigned R2 URL.
- **Audit**: Every upload and playback request is logged in the `audit_log` table.
- **Rate Limiting**: All R2 upload endpoints are rate-limited via Upstash Redis.

## References

- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [R2 CORS Configuration](https://developers.cloudflare.com/r2/api/s3/cors/)
- [Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 API Tokens](https://developers.cloudflare.com/r2/api/s3/authentication/)
