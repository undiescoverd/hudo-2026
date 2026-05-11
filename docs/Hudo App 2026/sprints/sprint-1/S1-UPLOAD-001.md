---
id: S1-UPLOAD-001
title: Build presigned upload flow
sprint: 1
status: done
linear: ""
blocked_by: []
tags: [upload, r2, storage]
---

# S1-UPLOAD-001 — Build presigned upload flow

## What it does

Two endpoints that issue presigned Cloudflare R2 URLs, allowing the browser to upload video bytes directly — never via Vercel.

- `POST /api/videos/upload-url` — standard uploads (≤50MB)
- `POST /api/videos/upload-url/multipart` — initiates multipart for >50MB
- `POST /api/videos/upload-url/multipart/complete` — completes multipart

## Files

- `app/api/videos/upload-url/route.ts`
- `app/api/videos/upload-url/multipart/route.ts`
- `app/api/videos/upload-url/multipart/complete/route.ts`

## Key rules enforced

- Content type: MP4/MOV only
- File size: ≤10GB
- Rate limited
- Video bytes never transit Vercel — client uploads directly to R2

## Notes

Foundation for all other upload tasks. `lib/storage.ts` is the only interface to R2 — all R2 calls go through it.

## Related

- [[S1-UPLOAD-002]] (storage quota, depends on this)
- [[S1-UPLOAD-003]] (UI, depends on this)
- [[S1-UPLOAD-004]] (version upload, depends on this)
- [[video-versions]] [[agencies]]
