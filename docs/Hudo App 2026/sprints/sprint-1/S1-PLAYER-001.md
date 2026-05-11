---
id: S1-PLAYER-001
title: Build video player component
sprint: 1
status: done
blocked_by: [S1-UPLOAD-001]
tags: [player, ui, signed-url]
---

# S1-PLAYER-001 — Build video player component

## What it does

HTML5 video player with custom controls and auto-refreshing signed playback URL.

## Files

- `components/player/VideoPlayer.tsx`
- `components/player/PlayerControls.tsx`
- `hooks/useVideoPlayer.ts`
- `hooks/useSignedUrl.ts`
- `app/(dashboard)/videos/[id]/page.tsx`

## Key behaviours

- Custom control bar: play/pause, scrub, time display, volume, fullscreen
- Signed URL fetched from `GET /api/videos/:id/playback-url` — never a direct R2 URL
- Signed URL auto-refreshes before 15-minute expiry without interrupting playback
- Exposes `currentTime`, `duration`, `seek(t)`, `play()`, `pause()` via context for comment integration

## Gotchas

- `useSignedUrl` must refresh before expiry, not after. Stale URL = broken playback mid-session.
- Raw R2 URL must never be stored or returned to the client — only the signed proxy URL.

## Related

- [[S1-PLAYER-002]] [[S1-PLAYER-003]] [[S1-PLAYER-004]] (all unblocked by this)
- [[ADR-001-video-never-touches-vercel]]
