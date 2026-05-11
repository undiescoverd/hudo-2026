---
id: S1-UPLOAD-002
title: Enforce storage quota at upload
sprint: 1
status: done
blocked_by: [S1-UPLOAD-001]
tags: [upload, quota, storage]
---

# S1-UPLOAD-002 — Enforce storage quota at upload

## What it does

Quota check before issuing presigned URL. Atomic increment after confirming upload in R2.

- Presign endpoint returns 402 `quota_exceeded` if over limit
- `storage_usage_bytes` incremented via Postgres RPC (atomic)
- Decrement on video delete is also atomic

## Files

- `app/api/videos/upload-url/route.ts`
- `lib/quota.ts`

## Key pattern

Quota uses a Postgres RPC — not a direct UPDATE — to prevent race conditions when multiple uploads happen simultaneously. Same pattern as version numbering.

## Related

- [[S1-UPLOAD-001]]
- [[agencies]] (storage_usage_bytes, storage_limit_bytes)
- [[ADR-002-version-numbers-via-rpc]] (same atomic RPC pattern)
