# ADR-001 — Video never touches Vercel

**Status:** Accepted
**Date:** 2025 (S0)

## Decision

Video bytes must never transit the Vercel server. The browser uploads directly to Cloudflare R2 via presigned URLs. Playback uses a signing proxy endpoint that returns a short-lived signed URL — the raw R2 URL is never returned to the client.

## Why

- Vercel has a 4.5MB body size limit on serverless functions (configurable but not designed for video)
- Video files can be up to 10GB — routing through Vercel would be technically impossible and wasteful
- R2 has no egress fees between Cloudflare and the browser
- Direct upload removes a network hop, improving upload speed and reliability

## Consequences

- Every new upload endpoint must issue presigned URLs — it must never act as a proxy
- Every new playback endpoint must use `lib/storage.ts` signing functions — never return `r2_key` directly
- Guest access to video also goes through the signing proxy (token validated first)

## Enforcement

- `lib/storage.ts` is the only allowed interface to R2. Do not instantiate the S3 client anywhere else.
- The `r2_key` column in [[video-versions]] is internal — never serialised into any API response.

## Related

- [[video-versions]] (r2_key)
- [[S1-PLAYER-001]] (useSignedUrl hook)
- [[guest-links]]
