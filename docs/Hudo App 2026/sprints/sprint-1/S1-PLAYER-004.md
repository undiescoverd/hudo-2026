---
id: S1-PLAYER-004
title: Mobile player layout
sprint: 1
status: not_started
blocked_by: [S1-PLAYER-001]
tags: [player, mobile, layout, responsive]
---

# S1-PLAYER-004 — Mobile player layout

## Files

- `components/player/VideoPlayer.tsx`
- `components/player/MobilePlayerLayout.tsx`
- `app/(dashboard)/videos/[id]/page.tsx`

## Layout spec

- `<768px`: video fills top half, comment panel fills bottom half
- Persistent comment input bar pinned to bottom
- Tapping scrub timeline seeks + opens comment input pre-filled with timestamp
- No horizontal scroll at any breakpoint

## Implementation rule

CSS grid/flex only — no JS-based layout switching.

## Related

- [[S1-PLAYER-001]]
