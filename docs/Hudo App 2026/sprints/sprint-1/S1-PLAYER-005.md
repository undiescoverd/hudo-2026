---
id: S1-PLAYER-005
title: Video thumbnail generation
sprint: 1
status: done
blocked_by: [S1-UPLOAD-001]
tags: [upload, thumbnail, canvas]
---

# S1-PLAYER-005 — Video thumbnail generation

## Files

- `hooks/useUpload.ts`
- `lib/thumbnail.ts`

## How it works

After upload completes:
1. Create `HTMLVideoElement`, seek to ~2s
2. Draw frame to `canvas`, call `canvas.toBlob()`
3. Upload blob to R2 at `videos/{videoId}/thumbnail.jpg`
4. Update `videos.thumbnail_url` in DB

Client-side canvas — no server processing. Thumbnail shown in video list/card components.

## Related

- [[S1-UPLOAD-001]]
- [[videos]] (thumbnail_url column added in migration 0009)
